-- Reports: content snapshots and final renders.
--
-- A draft PDF is rendered from a snapshot of client-safe data captured at generation time. The reviewer approves
-- that snapshot; approval triggers a final render of the SAME snapshot with approval metadata. Publication requires
-- the final render, so the published PDF contains exactly the content that was reviewed.

alter table public.reports
  add column snapshot jsonb,
  add column is_final_render boolean not null default false;

-- Immutability now also covers the snapshot.
create or replace function public.reports_immutable_when_published() returns trigger
language plpgsql as $$
begin
  if old.status = 'published' then
    if tg_op = 'DELETE' then
      raise exception 'published reports cannot be deleted';
    end if;
    if new.status <> 'superseded' or new.storage_path is distinct from old.storage_path or new.config is distinct from old.config
       or new.content_checksum is distinct from old.content_checksum or new.snapshot is distinct from old.snapshot then
      raise exception 'published reports are immutable; create a new version instead';
    end if;
  elsif old.status = 'superseded' and tg_op = 'UPDATE' then
    raise exception 'superseded reports are immutable';
  elsif old.status in ('pending_review', 'approved') and tg_op = 'UPDATE' and new.snapshot is distinct from old.snapshot then
    raise exception 'the reviewed snapshot cannot change; request changes to create a new draft';
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.update_report_draft(p_report uuid, p_title text, p_config jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.reports;
begin
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  v_uid := private.require_work(r.submission_id);
  if r.status not in ('draft', 'changes_requested') then raise exception 'Only drafts can be edited' using errcode = '55000'; end if;
  if jsonb_typeof(p_config -> 'sections') <> 'array' then raise exception 'Report config must list sections' using errcode = '22023'; end if;
  update public.reports set report_title = trim(p_title), config = p_config, status = 'draft', storage_path = null, content_checksum = null,
    generated_at = null, snapshot = null, is_final_render = false where id = p_report;
  insert into public.processing_jobs (submission_id, report_id, job_type)
  select r.submission_id, p_report, 'generate_report'
  where not exists (select 1 from public.processing_jobs where report_id = p_report and job_status in ('queued', 'running'));
  perform private.audit('report.updated', 'report', p_report::text, private.submission_company(r.submission_id), r.submission_id);
end $$;

create or replace function public.submit_report_for_review(p_report uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.reports; s public.submissions;
begin
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  v_uid := private.require_work(r.submission_id);
  if r.status not in ('draft', 'changes_requested') then raise exception 'Report is not a draft' using errcode = '55000'; end if;
  if r.snapshot is null or r.storage_path is null or r.generated_at is null or not exists (
      select 1 from storage.objects where bucket_id = 'reports' and name = r.storage_path) then
    raise exception 'Generate the PDF draft before submitting for review' using errcode = '55000';
  end if;
  if exists (select 1 from public.processing_jobs where report_id = p_report and job_status in ('queued', 'running')) then
    raise exception 'The draft is being regenerated; wait for it to finish' using errcode = '55000';
  end if;
  select * into s from public.submissions where id = r.submission_id;
  if s.submission_status <> 'in_analysis' then
    raise exception 'Resolve open clarifications before submitting the report' using errcode = '55000';
  end if;
  update public.reports set status = 'pending_review' where id = p_report;
  perform private.apply_transition(r.submission_id, 'under_review', 'finance_analyst', 'Report submitted for review');
  perform private.audit('report.submitted_for_review', 'report', p_report::text, s.company_id, s.id, jsonb_build_object('version', r.report_version));
  perform private.notify_role('finance_reviewer', 'report_review', 'Report awaiting review',
    '"' || r.report_title || '" v' || r.report_version || ' is awaiting review.', 'report', p_report,
    '/analyst/submissions/' || s.id || '/reports');
end $$;

create or replace function public.review_report(p_report uuid, p_decision text, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_role('finance_reviewer'); r public.reports; v_four_eyes boolean;
begin
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if not private.is_internal_in_scope(r.submission_id) then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if r.status <> 'pending_review' then raise exception 'Report is not pending review' using errcode = '55000'; end if;
  select (value #>> '{}')::boolean into v_four_eyes from public.platform_settings where key = 'require_four_eyes_approval';
  if coalesce(v_four_eyes, true) and r.created_by = v_uid then
    raise exception 'Reports must be approved by a reviewer other than their author' using errcode = '42501';
  end if;
  if p_decision = 'approved' then
    update public.reports set status = 'approved', reviewed_by = v_uid, approved_by = v_uid, approved_at = now(), review_notes = p_notes
      where id = p_report;
    perform private.apply_transition(r.submission_id, 'reviewed', 'finance_reviewer', 'Report approved');
    -- Final render of the approved snapshot with approval metadata.
    insert into public.processing_jobs (submission_id, report_id, job_type) values (r.submission_id, p_report, 'generate_report');
  elsif p_decision = 'changes_requested' then
    if coalesce(length(trim(p_notes)), 0) < 3 then raise exception 'Describe the changes required' using errcode = '22023'; end if;
    update public.reports set status = 'changes_requested', reviewed_by = v_uid, review_notes = p_notes where id = p_report;
    perform private.apply_transition(r.submission_id, 'in_analysis', 'finance_reviewer', 'Changes requested');
  else
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  perform private.audit('report.' || p_decision, 'report', p_report::text, private.submission_company(r.submission_id), r.submission_id);
  perform private.notify(r.created_by, 'report_' || p_decision, 'Report ' || replace(p_decision, '_', ' '),
    '"' || r.report_title || '" v' || r.report_version || ': ' || replace(p_decision, '_', ' ') || '.', 'report', p_report,
    '/analyst/submissions/' || r.submission_id || '/reports');
end $$;

create or replace function public.publish_report(p_report uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_active(); r public.reports; s public.submissions; v_kind text;
begin
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  select * into s from public.submissions where id = r.submission_id for update;
  if private.has_role('finance_reviewer') and private.is_internal_in_scope(s.id) then v_kind := 'finance_reviewer';
  elsif private.has_role('finance_analyst') and s.assigned_analyst_id = v_uid then v_kind := 'finance_analyst';
  else
    perform private.audit('report.publish_rejected', 'report', p_report::text, s.company_id, s.id, jsonb_build_object('reason', 'not authorised'));
    raise exception 'You are not authorised to publish this report' using errcode = '42501';
  end if;
  if r.status <> 'approved' or r.approved_by is null then raise exception 'Only approved reports can be published' using errcode = '55000'; end if;
  if not r.is_final_render or r.storage_path is null or not exists (select 1 from storage.objects where bucket_id = 'reports' and name = r.storage_path) then
    raise exception 'The final approved PDF is still being generated; try again shortly' using errcode = '55000';
  end if;
  update public.reports set status = 'superseded' where submission_id = s.id and status = 'published';
  update public.reports set status = 'published', published_by = v_uid, published_at = now() where id = p_report;
  perform private.apply_transition(s.id, 'published', v_kind, 'Report published');
  perform private.audit('report.published', 'report', p_report::text, s.company_id, s.id, jsonb_build_object('version', r.report_version, 'checksum', r.content_checksum));
  perform private.notify_company(s.company_id, 'report_published', 'Report published',
    '"' || r.report_title || '" has been published.', 'report', p_report, '/submissions/' || s.id || '?tab=reports');
end $$;

-- A published submission can be reopened by the assigned analyst to prepare a new report version.
-- (transition published → in_analysis already exists for finance_analyst.)
