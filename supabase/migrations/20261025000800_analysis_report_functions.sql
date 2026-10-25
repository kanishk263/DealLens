-- DealLens server-side operations, part 3: data review, red flags, EBITDA adjustments, findings,
-- valuation models and the report lifecycle.

create or replace function private.require_work(p_submission uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_active();
begin
  if not private.can_work_submission(p_submission) then
    raise exception 'Submission not in your scope' using errcode = '42501';
  end if;
  return v_uid;
end $$;

create or replace function private.submission_company(p_submission uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select company_id from public.submissions where id = p_submission;
$$;

-- ---------------------------------------------------------------------------
-- Line-item mapping review (raw values are never modified; every change is versioned)
-- ---------------------------------------------------------------------------
create or replace function public.update_line_item(
  p_line_item uuid, p_category text, p_mapping_status public.mapping_status, p_normalized_value numeric, p_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; li public.financial_line_items;
begin
  select * into li from public.financial_line_items where id = p_line_item for update;
  if not found then raise exception 'Line item not found' using errcode = 'P0002'; end if;
  v_uid := private.require_work(li.submission_id);
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'A reason is required for every correction' using errcode = '22023'; end if;
  if p_mapping_status not in ('analyst_mapped', 'analyst_confirmed', 'excluded', 'unmapped') then
    raise exception 'Analysts may only set analyst_mapped, analyst_confirmed, excluded or unmapped' using errcode = '22023';
  end if;
  if p_mapping_status in ('analyst_mapped', 'analyst_confirmed') and p_category is null then
    raise exception 'A category is required' using errcode = '22023';
  end if;
  insert into public.line_item_revisions (line_item_id, changed_by, previous, next, reason)
  values (p_line_item, v_uid,
    jsonb_build_object('normalized_category', li.normalized_category, 'mapping_status', li.mapping_status, 'normalized_value', li.normalized_value),
    jsonb_build_object('normalized_category', p_category, 'mapping_status', p_mapping_status, 'normalized_value', p_normalized_value),
    trim(p_reason));
  update public.financial_line_items set normalized_category = case when p_mapping_status = 'unmapped' then null else p_category end,
    mapping_status = p_mapping_status, normalized_value = p_normalized_value, reviewed_by = v_uid, reviewed_at = now()
  where id = p_line_item;
  perform private.audit('line_item.updated', 'financial_line_item', p_line_item::text, private.submission_company(li.submission_id),
    li.submission_id, jsonb_build_object('category', p_category, 'mapping_status', p_mapping_status,
      'value_changed', p_normalized_value is distinct from li.normalized_value));
end $$;

create or replace function public.review_data_quality_issue(p_issue uuid, p_status public.issue_status, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; i public.data_quality_issues;
begin
  select * into i from public.data_quality_issues where id = p_issue for update;
  if not found then raise exception 'Issue not found' using errcode = 'P0002'; end if;
  v_uid := private.require_work(i.submission_id);
  if p_status in ('resolved', 'dismissed') and coalesce(length(trim(p_notes)), 0) < 3 then
    raise exception 'Resolution notes are required' using errcode = '22023';
  end if;
  update public.data_quality_issues set status = p_status, resolution_notes = p_notes,
    resolved_by = case when p_status in ('resolved', 'dismissed') then v_uid end,
    resolved_at = case when p_status in ('resolved', 'dismissed') then now() end
  where id = p_issue;
  perform private.audit('data_quality.' || p_status, 'data_quality_issue', p_issue::text, private.submission_company(i.submission_id), i.submission_id);
end $$;

create or replace function public.review_red_flag(p_flag uuid, p_status text, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; f public.red_flags;
begin
  select * into f from public.red_flags where id = p_flag for update;
  if not found then raise exception 'Red flag not found' using errcode = 'P0002'; end if;
  v_uid := private.require_work(f.submission_id);
  if p_status not in ('open', 'dismissed', 'resolved', 'escalated') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if coalesce(length(trim(p_notes)), 0) < 3 then raise exception 'An explanation is required' using errcode = '22023'; end if;
  update public.red_flags set review_status = p_status, review_notes = trim(p_notes), reviewed_by = v_uid, reviewed_at = now() where id = p_flag;
  perform private.audit('red_flag.' || p_status, 'red_flag', p_flag::text, private.submission_company(f.submission_id), f.submission_id,
    jsonb_build_object('rule_key', f.rule_key));
end $$;

-- ---------------------------------------------------------------------------
-- EBITDA adjustments (proposed → approved/rejected by a different finance-team member)
-- ---------------------------------------------------------------------------
create or replace function public.propose_ebitda_adjustment(
  p_submission uuid, p_period uuid, p_type text, p_description text, p_amount numeric, p_sign smallint,
  p_evidence text, p_rationale text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_work(p_submission); v_currency text; v_id uuid;
begin
  select currency into v_currency from public.financial_periods where id = p_period and submission_id = p_submission;
  if v_currency is null then raise exception 'Period does not belong to this submission' using errcode = '22023'; end if;
  if coalesce(length(trim(p_evidence)), 0) < 3 or coalesce(length(trim(p_rationale)), 0) < 10 then
    raise exception 'Supporting evidence and a rationale (10+ characters) are required' using errcode = '22023';
  end if;
  insert into public.ebitda_adjustments (submission_id, financial_period_id, adjustment_type, description, amount, sign, currency,
    supporting_evidence, rationale, proposed_by)
  values (p_submission, p_period, p_type, trim(p_description), p_amount, p_sign, v_currency, trim(p_evidence), trim(p_rationale), v_uid)
  returning id into v_id;
  perform private.audit('ebitda_adjustment.proposed', 'ebitda_adjustment', v_id::text, private.submission_company(p_submission), p_submission,
    jsonb_build_object('type', p_type, 'signed_amount', p_amount * p_sign));
  return v_id;
end $$;

create or replace function public.review_ebitda_adjustment(p_adjustment uuid, p_decision text, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; a public.ebitda_adjustments;
begin
  select * into a from public.ebitda_adjustments where id = p_adjustment for update;
  if not found then raise exception 'Adjustment not found' using errcode = 'P0002'; end if;
  v_uid := private.require_work(a.submission_id);
  if p_decision not in ('approved', 'rejected', 'proposed') then raise exception 'Invalid decision' using errcode = '22023'; end if;
  if p_decision <> 'proposed' and a.proposed_by = v_uid then
    raise exception 'Adjustments must be reviewed by someone other than the proposer' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_notes)), 0) < 3 then raise exception 'Review notes are required' using errcode = '22023'; end if;
  update public.ebitda_adjustments set status = p_decision, reviewed_by = v_uid, review_notes = trim(p_notes), reviewed_at = now()
    where id = p_adjustment;
  perform private.audit('ebitda_adjustment.' || p_decision, 'ebitda_adjustment', p_adjustment::text,
    private.submission_company(a.submission_id), a.submission_id);
end $$;

-- ---------------------------------------------------------------------------
-- Findings and comments
-- ---------------------------------------------------------------------------
create or replace function public.save_finding(
  p_id uuid, p_submission uuid, p_category text, p_title text, p_description text, p_severity public.severity,
  p_impact numeric, p_impact_currency text, p_source_references jsonb, p_recommendation text, p_visibility public.visibility
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_work(p_submission); v_id uuid; v_code text; v_old public.findings;
begin
  if jsonb_typeof(coalesce(p_source_references, '[]'::jsonb)) <> 'array' then
    raise exception 'source_references must be an array' using errcode = '22023';
  end if;
  if p_id is null then
    select 'F-' || lpad((count(*) + 1)::text, 3, '0') into v_code from public.findings where submission_id = p_submission;
    insert into public.findings (reference_code, submission_id, category, title, description, severity, quantified_impact, impact_currency,
      source_references, recommendation, visibility, owner_id, created_by, updated_by)
    values (v_code, p_submission, p_category, trim(p_title), trim(p_description), p_severity, p_impact, upper(p_impact_currency),
      coalesce(p_source_references, '[]'::jsonb), p_recommendation, p_visibility, v_uid, v_uid, v_uid)
    returning id into v_id;
    perform private.audit('finding.created', 'finding', v_id::text, private.submission_company(p_submission), p_submission,
      jsonb_build_object('visibility', p_visibility, 'severity', p_severity));
  else
    select * into v_old from public.findings where id = p_id and submission_id = p_submission for update;
    if not found then raise exception 'Finding not found' using errcode = 'P0002'; end if;
    if v_old.status = 'closed' then raise exception 'Closed findings cannot be edited' using errcode = '55000'; end if;
    -- Editing an approved finding sends it back to draft so it must be re-approved.
    update public.findings set category = p_category, title = trim(p_title), description = trim(p_description), severity = p_severity,
      quantified_impact = p_impact, impact_currency = upper(p_impact_currency), source_references = coalesce(p_source_references, '[]'::jsonb),
      recommendation = p_recommendation, visibility = p_visibility, updated_by = v_uid,
      status = case when v_old.status = 'approved' then 'draft' else v_old.status end
    where id = p_id returning id into v_id;
    perform private.audit('finding.updated', 'finding', v_id::text, private.submission_company(p_submission), p_submission,
      jsonb_build_object('visibility_from', v_old.visibility, 'visibility_to', p_visibility, 'reset_approval', v_old.status = 'approved'));
  end if;
  return v_id;
end $$;

create or replace function public.set_finding_status(p_finding uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; f public.findings;
begin
  select * into f from public.findings where id = p_finding for update;
  if not found then raise exception 'Finding not found' using errcode = 'P0002'; end if;
  v_uid := private.require_work(f.submission_id);
  if p_status not in ('draft', 'in_review', 'approved', 'closed') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if p_status = 'approved' and not (private.has_role('finance_reviewer') or f.created_by <> v_uid) then
    raise exception 'Findings must be approved by a reviewer or a colleague other than the author' using errcode = '42501';
  end if;
  update public.findings set status = p_status, updated_by = v_uid where id = p_finding;
  perform private.audit('finding.' || p_status, 'finding', p_finding::text, private.submission_company(f.submission_id), f.submission_id);
end $$;

create or replace function public.add_finding_comment(p_finding uuid, p_text text, p_visibility public.visibility) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_sub uuid; v_id uuid;
begin
  select submission_id into v_sub from public.findings where id = p_finding;
  if v_sub is null then raise exception 'Finding not found' using errcode = 'P0002'; end if;
  v_uid := private.require_work(v_sub);
  insert into public.finding_comments (finding_id, author_id, comment_text, visibility) values (p_finding, v_uid, trim(p_text), p_visibility)
  returning id into v_id;
  perform private.audit('finding.comment_added', 'finding', p_finding::text, private.submission_company(v_sub), v_sub,
    jsonb_build_object('visibility', p_visibility));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Valuation models (each save is a new immutable version)
-- ---------------------------------------------------------------------------
create or replace function public.save_valuation_model(
  p_submission uuid, p_model_name text, p_method text, p_assumptions jsonb, p_inputs jsonb, p_outputs jsonb,
  p_currency text, p_engine_version text, p_comments text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_work(p_submission); v_version int; v_id uuid;
begin
  if p_method not in ('comparables', 'dcf') then raise exception 'Invalid valuation method' using errcode = '22023'; end if;
  perform 1 from public.submissions where id = p_submission for update;
  select coalesce(max(model_version), 0) + 1 into v_version from public.valuation_models
    where submission_id = p_submission and model_name = trim(p_model_name);
  insert into public.valuation_models (submission_id, model_name, valuation_method, assumptions, calculation_inputs, calculation_outputs,
    currency, model_version, engine_version, analyst_comments, created_by)
  values (p_submission, trim(p_model_name), p_method, p_assumptions, p_inputs, p_outputs, upper(p_currency), v_version, p_engine_version,
    p_comments, v_uid)
  returning id into v_id;
  perform private.audit('valuation.saved', 'valuation_model', v_id::text, private.submission_company(p_submission), p_submission,
    jsonb_build_object('method', p_method, 'version', v_version, 'engine_version', p_engine_version));
  return v_id;
end $$;

create or replace function public.review_valuation_model(p_model uuid, p_status text, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; m public.valuation_models;
begin
  select * into m from public.valuation_models where id = p_model for update;
  if not found then raise exception 'Model not found' using errcode = 'P0002'; end if;
  v_uid := private.require_work(m.submission_id);
  if p_status not in ('pending_review', 'approved', 'rejected') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if p_status in ('approved', 'rejected') and (not private.has_role('finance_reviewer') or m.created_by = v_uid) then
    raise exception 'Valuation models are approved by a reviewer other than their author' using errcode = '42501';
  end if;
  update public.valuation_models set review_status = p_status, reviewed_by = case when p_status <> 'pending_review' then v_uid end,
    review_notes = p_notes where id = p_model;
  perform private.audit('valuation.' || p_status, 'valuation_model', p_model::text, private.submission_company(m.submission_id), m.submission_id);
end $$;

-- ---------------------------------------------------------------------------
-- Reports: draft → pending_review → (changes_requested | approved) → published → superseded
-- ---------------------------------------------------------------------------
create or replace function public.create_report_draft(p_submission uuid, p_title text, p_type text, p_config jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_work(p_submission); s public.submissions; v_version int; v_id uuid;
begin
  select * into s from public.submissions where id = p_submission for update;
  if s.submission_status not in ('in_analysis', 'clarification_required') then
    raise exception 'Reports can be drafted only while the submission is in analysis' using errcode = '55000';
  end if;
  if exists (select 1 from public.reports where submission_id = p_submission and status in ('draft', 'pending_review', 'changes_requested', 'approved')) then
    raise exception 'An open report draft already exists for this submission' using errcode = '55000';
  end if;
  if jsonb_typeof(p_config -> 'sections') <> 'array' then raise exception 'Report config must list sections' using errcode = '22023'; end if;
  select coalesce(max(report_version), 0) + 1 into v_version from public.reports where submission_id = p_submission;
  insert into public.reports (submission_id, report_title, report_type, report_version, config, created_by)
  values (p_submission, trim(p_title), p_type, v_version, p_config, v_uid) returning id into v_id;
  insert into public.processing_jobs (submission_id, report_id, job_type) values (p_submission, v_id, 'generate_report');
  perform private.audit('report.created', 'report', v_id::text, s.company_id, p_submission, jsonb_build_object('version', v_version));
  return v_id;
end $$;

create or replace function public.update_report_draft(p_report uuid, p_title text, p_config jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.reports;
begin
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  v_uid := private.require_work(r.submission_id);
  if r.status not in ('draft', 'changes_requested') then raise exception 'Only drafts can be edited' using errcode = '55000'; end if;
  update public.reports set report_title = trim(p_title), config = p_config, status = 'draft', storage_path = null,
    content_checksum = null, generated_at = null where id = p_report;
  insert into public.processing_jobs (submission_id, report_id, job_type)
  select r.submission_id, p_report, 'generate_report'
  where not exists (select 1 from public.processing_jobs where report_id = p_report and job_status in ('queued', 'running'));
  perform private.audit('report.updated', 'report', p_report::text, private.submission_company(r.submission_id), r.submission_id);
end $$;

create or replace function public.regenerate_report(p_report uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.reports;
begin
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  v_uid := private.require_work(r.submission_id);
  if r.status not in ('draft', 'changes_requested') then raise exception 'Only drafts can be regenerated' using errcode = '55000'; end if;
  insert into public.processing_jobs (submission_id, report_id, job_type)
  select r.submission_id, p_report, 'generate_report'
  where not exists (select 1 from public.processing_jobs where report_id = p_report and job_status in ('queued', 'running'));
  perform private.audit('report.regeneration_requested', 'report', p_report::text, private.submission_company(r.submission_id), r.submission_id);
end $$;

create or replace function public.submit_report_for_review(p_report uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.reports; s public.submissions;
begin
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  v_uid := private.require_work(r.submission_id);
  if r.status not in ('draft', 'changes_requested') then raise exception 'Report is not a draft' using errcode = '55000'; end if;
  if r.storage_path is null or r.generated_at is null or not exists (
      select 1 from storage.objects where bucket_id = 'reports' and name = r.storage_path) then
    raise exception 'Generate the PDF draft before submitting for review' using errcode = '55000';
  end if;
  select * into s from public.submissions where id = r.submission_id;
  if s.submission_status <> 'in_analysis' then
    raise exception 'Resolve open clarifications before submitting the report' using errcode = '55000';
  end if;
  update public.reports set status = 'pending_review' where id = p_report;
  perform private.apply_transition(r.submission_id, 'under_review', 'finance_analyst', 'Report submitted for review');
  perform private.audit('report.submitted_for_review', 'report', p_report::text, s.company_id, s.id);
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
  if r.status <> 'pending_review' then raise exception 'Report is not pending review' using errcode = '55000'; end if;
  select (value #>> '{}')::boolean into v_four_eyes from public.platform_settings where key = 'require_four_eyes_approval';
  if coalesce(v_four_eyes, true) and r.created_by = v_uid then
    raise exception 'Reports must be approved by a reviewer other than their author' using errcode = '42501';
  end if;
  if p_decision = 'approved' then
    update public.reports set status = 'approved', reviewed_by = v_uid, approved_by = v_uid, approved_at = now(), review_notes = p_notes
      where id = p_report;
    perform private.apply_transition(r.submission_id, 'reviewed', 'finance_reviewer', 'Report approved');
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
  if not exists (select 1 from storage.objects where bucket_id = 'reports' and name = r.storage_path) then
    raise exception 'Report file is missing; regenerate before publishing' using errcode = '55000';
  end if;
  update public.reports set status = 'superseded' where submission_id = s.id and status = 'published';
  update public.reports set status = 'published', published_by = v_uid, published_at = now() where id = p_report;
  perform private.apply_transition(s.id, 'published', v_kind, 'Report published');
  perform private.audit('report.published', 'report', p_report::text, s.company_id, s.id, jsonb_build_object('version', r.report_version));
  perform private.notify_company(s.company_id, 'report_published', 'Report published',
    '"' || r.report_title || '" has been published.', 'report', p_report, '/submissions/' || s.id || '?tab=reports');
end $$;

-- Downloads are audited through this function (called by the server before issuing a signed URL).
create or replace function public.log_download(p_entity_type text, p_entity_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_sub uuid;
begin
  perform private.require_active();
  if p_entity_type = 'report' then select submission_id into v_sub from public.reports where id = p_entity_id;
  elsif p_entity_type = 'document' then select submission_id into v_sub from public.documents where id = p_entity_id;
  else raise exception 'Invalid entity type' using errcode = '22023'; end if;
  if v_sub is null or not private.can_view_content(v_sub) then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform private.audit(p_entity_type || '.downloaded', p_entity_type, p_entity_id::text, private.submission_company(v_sub), v_sub);
end $$;

-- ---------------------------------------------------------------------------
-- Function privileges: client roles may call the public operations; nothing for anon.
-- bootstrap_superadmin is service_role only.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.bootstrap_superadmin(uuid, text) from authenticated;
revoke execute on all functions in schema private from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;
