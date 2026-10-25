-- DealLens server-side operations, part 2: submission workflow, documents, processing, assignment, clarifications.

-- Core transition primitive. Validates against public.submission_transitions, locks the row,
-- records history and audit. Raises on invalid transitions (callers decide whether to log).
create or replace function private.apply_transition(
  p_submission uuid, p_to public.submission_status, p_actor_kind text, p_reason text default null
) returns public.submission_status
language plpgsql security definer set search_path = '' as $$
declare v_from public.submission_status; v_company uuid;
begin
  select submission_status, company_id into v_from, v_company from public.submissions where id = p_submission for update;
  if not found then raise exception 'Submission not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.submission_transitions
                 where from_status = v_from and to_status = p_to and actor = p_actor_kind) then
    raise exception 'Transition % -> % is not permitted for %', v_from, p_to, p_actor_kind using errcode = '55000';
  end if;
  update public.submissions set submission_status = p_to,
    submitted_at = case when p_to = 'uploaded' and submitted_at is null then now() else submitted_at end,
    published_at = case when p_to = 'published' then now() else published_at end
  where id = p_submission;
  insert into public.submission_status_history (submission_id, from_status, to_status, actor_user_id, actor_kind, reason)
  values (p_submission, v_from, p_to, auth.uid(), p_actor_kind, p_reason);
  perform private.audit('submission.transition', 'submission', p_submission::text, v_company, p_submission,
    jsonb_build_object('from', v_from, 'to', p_to, 'actor_kind', p_actor_kind));
  return v_from;
end $$;

-- Which actor kind does the caller act as for this submission?
create or replace function private.actor_kind_for(p_submission uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when private.has_role('finance_reviewer') and private.is_internal_in_scope(p_submission) then 'finance_reviewer'
    when private.has_role('finance_analyst') and exists (
      select 1 from public.submissions where id = p_submission and assigned_analyst_id = auth.uid()) then 'finance_analyst'
    when private.has_role('superadmin') then 'superadmin'
    when private.is_submission_member(p_submission) then 'company_user'
    else null end;
$$;

-- Generic transition endpoint for moves without a dedicated operation. Publication, review and
-- report submission are deliberately excluded: they require the report workflow functions.
-- Rejected attempts are written to the audit log (the function returns instead of raising so the log persists).
create or replace function public.transition_submission(p_submission uuid, p_to public.submission_status, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_active(); v_kind text; v_from public.submission_status;
begin
  if p_to in ('published', 'reviewed', 'under_review', 'processing', 'awaiting_review', 'processing_failed') then
    perform private.audit('submission.transition_rejected', 'submission', p_submission::text, null, null,
      jsonb_build_object('to', p_to, 'reason', 'requires dedicated workflow'));
    return jsonb_build_object('ok', false, 'error', 'This status can only be reached through its dedicated workflow step.');
  end if;
  v_kind := private.actor_kind_for(p_submission);
  -- Reviewers acting on analysis-stage moves are treated like the assigned analyst.
  if v_kind = 'finance_reviewer' and p_to in ('in_analysis', 'uploaded', 'clarification_required') then
    if exists (select 1 from public.submission_transitions t join public.submissions s on s.submission_status = t.from_status
               where s.id = p_submission and t.to_status = p_to and t.actor = 'finance_analyst') then
      v_kind := 'finance_analyst';
    end if;
  end if;
  if v_kind is null then
    perform private.audit('submission.transition_rejected', 'submission', p_submission::text, null, null,
      jsonb_build_object('to', p_to, 'reason', 'not in scope'));
    return jsonb_build_object('ok', false, 'error', 'You do not have access to this submission.');
  end if;
  begin
    v_from := private.apply_transition(p_submission, p_to, v_kind, p_reason);
  exception when sqlstate '55000' then
    perform private.audit('submission.transition_rejected', 'submission', p_submission::text, null, p_submission,
      jsonb_build_object('to', p_to, 'actor_kind', v_kind, 'reason', 'not permitted from current status'));
    return jsonb_build_object('ok', false, 'error', 'That status change is not permitted from the current status.');
  end;
  if p_to = 'uploaded' then
    perform private.enqueue_document_jobs(p_submission, true);
  end if;
  return jsonb_build_object('ok', true, 'from', v_from, 'to', p_to);
end $$;

-- ---------------------------------------------------------------------------
-- Submissions and documents (company users)
-- ---------------------------------------------------------------------------
create or replace function public.create_submission(
  p_company uuid, p_name text, p_deal_type public.deal_type, p_period_start date, p_period_end date,
  p_currency text, p_unit text, p_notes text default null, p_deal_project uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_role('company_user'); v_id uuid; v_synth boolean;
begin
  if not private.is_company_member(p_company) then
    raise exception 'You are not a member of this company' using errcode = '42501';
  end if;
  if p_deal_project is not null and not exists (select 1 from public.deal_projects where id = p_deal_project and company_id = p_company) then
    raise exception 'Deal project does not belong to this company' using errcode = '22023';
  end if;
  if p_period_end <= p_period_start then raise exception 'Reporting period end must be after start' using errcode = '22023'; end if;
  select is_synthetic into v_synth from public.companies where id = p_company;
  insert into public.submissions (company_id, deal_project_id, submitted_by, submission_name, deal_type, notes,
    reporting_period_start, reporting_period_end, reporting_currency, reporting_unit, is_synthetic)
  values (p_company, p_deal_project, v_uid, trim(p_name), p_deal_type, p_notes, p_period_start, p_period_end,
    upper(p_currency), p_unit, coalesce(v_synth, false))
  returning id into v_id;
  insert into public.submission_status_history (submission_id, to_status, actor_user_id, actor_kind)
  values (v_id, 'draft', v_uid, 'company_user');
  perform private.audit('submission.created', 'submission', v_id::text, p_company, v_id);
  return v_id;
end $$;

create or replace function public.register_document(
  p_submission uuid, p_filename text, p_file_type text, p_size bigint, p_checksum text, p_category public.document_category,
  p_clarification uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_role('company_user'); s public.submissions; v_id uuid := gen_random_uuid();
  v_path text; v_version int; v_dup uuid; v_max_mb numeric; v_safe text;
begin
  select * into s from public.submissions where id = p_submission for update;
  if not found or not private.is_company_member(s.company_id) then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if s.submission_status not in ('draft', 'processing_failed', 'clarification_required') then
    raise exception 'Documents cannot be added while the submission is %', s.submission_status using errcode = '55000';
  end if;
  if p_clarification is not null and not exists (
      select 1 from public.clarification_requests where id = p_clarification and submission_id = p_submission and status = 'open') then
    raise exception 'Clarification request not open' using errcode = '22023';
  end if;
  select (value #>> '{}')::numeric into v_max_mb from public.platform_settings where key = 'max_upload_mb';
  if p_size <= 0 or p_size > coalesce(v_max_mb, 25) * 1024 * 1024 then
    raise exception 'File exceeds the maximum upload size' using errcode = '22023';
  end if;
  -- Storage paths are built here from ids only; the user-supplied filename is sanitised and never controls the folder.
  v_safe := regexp_replace(lower(p_filename), '[^a-z0-9._-]+', '_', 'g');
  v_safe := regexp_replace(v_safe, '\.\.+', '.', 'g');
  v_safe := left(trim(both '._' from v_safe), 120);
  if v_safe = '' then v_safe := 'document'; end if;
  v_path := s.company_id || '/' || s.id || '/' || v_id || '/' || v_safe;
  select coalesce(max(document_version), 0) + 1 into v_version from public.documents
    where submission_id = p_submission and lower(original_filename) = lower(p_filename);
  select d.id into v_dup from public.documents d join public.submissions s2 on s2.id = d.submission_id
    where d.checksum = p_checksum and s2.company_id = s.company_id and d.deleted_at is null limit 1;
  insert into public.documents (id, submission_id, uploaded_by, original_filename, storage_path, file_type, file_size_bytes,
    checksum, document_category, document_version, processing_status, extraction_metadata)
  values (v_id, p_submission, v_uid, p_filename, v_path, p_file_type, p_size, p_checksum, p_category, v_version, 'uploading',
    case when v_dup is not null then jsonb_build_object('possible_duplicate_of', v_dup) else '{}'::jsonb end);
  if p_clarification is not null then
    insert into public.clarification_attachments (clarification_id, document_id) values (p_clarification, v_id);
  end if;
  return jsonb_build_object('document_id', v_id, 'storage_path', v_path, 'possible_duplicate_of', v_dup);
end $$;

create or replace function public.finalize_document(p_document uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_active(); d public.documents; v_company uuid;
begin
  select * into d from public.documents where id = p_document for update;
  if not found or d.uploaded_by <> v_uid then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if d.processing_status <> 'uploading' then raise exception 'Document already finalised' using errcode = '55000'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'documents' and name = d.storage_path) then
    raise exception 'Uploaded file not found in storage' using errcode = '55000';
  end if;
  update public.documents set processing_status = 'uploaded' where id = p_document;
  select company_id into v_company from public.submissions where id = d.submission_id;
  perform private.audit('document.uploaded', 'document', p_document::text, v_company, d.submission_id,
    jsonb_build_object('file_type', d.file_type, 'size', d.file_size_bytes, 'category', d.document_category, 'version', d.document_version));
end $$;

-- Rollback for a failed upload: removes the metadata row (the caller removes any partial object).
create or replace function public.abandon_document(p_document uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_path text;
begin
  delete from public.documents where id = p_document and uploaded_by = v_uid and processing_status = 'uploading'
  returning storage_path into v_path;
  return v_path;
end $$;

-- Soft delete while still a draft. Published history is protected because documents of
-- submitted packages cannot be removed.
create or replace function public.remove_document(p_document uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_role('company_user'); d public.documents; s public.submissions;
begin
  select * into d from public.documents where id = p_document for update;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  select * into s from public.submissions where id = d.submission_id;
  if not private.is_company_member(s.company_id) then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if s.submission_status not in ('draft', 'processing_failed') then
    raise exception 'Documents can only be removed before analysis starts' using errcode = '55000';
  end if;
  update public.documents set deleted_at = now() where id = p_document;
  delete from public.financial_line_items where source_document_id = p_document;
  perform private.audit('document.deleted', 'document', p_document::text, s.company_id, s.id);
  return d.storage_path;
end $$;

create or replace function private.enqueue_document_jobs(p_submission uuid, p_only_pending boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count int; v_max int;
begin
  select (value #>> '{}')::int into v_max from public.platform_settings where key = 'max_processing_attempts';
  update public.documents set processing_status = 'queued'
    where submission_id = p_submission and deleted_at is null
      and (not p_only_pending or processing_status in ('uploaded', 'failed', 'queued'))
      and processing_status not in ('uploading', 'unsupported');
  insert into public.processing_jobs (submission_id, document_id, job_type, max_attempts)
  select d.submission_id, d.id, 'extract_document', coalesce(v_max, 3) from public.documents d
  where d.submission_id = p_submission and d.processing_status = 'queued' and d.deleted_at is null
    and not exists (select 1 from public.processing_jobs j where j.document_id = d.id and j.job_type = 'extract_document'
                    and j.job_status in ('queued', 'running'));
  get diagnostics v_count = row_count;
  -- No new documents (e.g. reprocessing request): go straight to re-analysis.
  if v_count = 0 then
    perform private.enqueue_analysis(p_submission);
  end if;
  return v_count;
end $$;

create or replace function private.enqueue_analysis(p_submission uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.processing_jobs (submission_id, job_type)
  select p_submission, 'analyze_submission'
  where not exists (select 1 from public.processing_jobs where submission_id = p_submission and job_type = 'analyze_submission'
                    and job_status = 'queued');
$$;

create or replace function public.submit_submission(p_submission uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_role('company_user'); s public.submissions;
begin
  select * into s from public.submissions where id = p_submission for update;
  if not found or not private.is_company_member(s.company_id) then raise exception 'Submission not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.documents where submission_id = p_submission and deleted_at is null and processing_status <> 'uploading') then
    raise exception 'Upload at least one document before submitting' using errcode = '55000';
  end if;
  perform private.apply_transition(p_submission, 'uploaded', 'company_user', 'Document package submitted');
  perform private.enqueue_document_jobs(p_submission, true);
  perform private.notify_role('finance_reviewer', 'submission_received', 'Submission received',
    'A new submission has been received and queued for processing.', 'submission', p_submission, '/analyst/queue');
  perform private.notify_role('finance_analyst', 'submission_received', 'Submission received',
    'A new submission has been received and queued for processing.', 'submission', p_submission, '/analyst/queue');
end $$;

create or replace function public.retry_processing(p_submission uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_active(); v_kind text;
begin
  v_kind := case
    when private.has_role('superadmin') then 'superadmin'
    when private.is_submission_member(p_submission) then 'company_user'
    when private.has_role('finance_analyst') and private.is_internal_in_scope(p_submission) then 'finance_analyst'
    else null end;
  if v_kind is null then raise exception 'Submission not found' using errcode = 'P0002'; end if;
  perform private.apply_transition(p_submission, 'uploaded', v_kind, 'Processing retry requested');
  perform private.enqueue_document_jobs(p_submission, true);
  perform private.audit('processing.retry_requested', 'submission', p_submission::text, null, p_submission);
end $$;

create or replace function public.request_reanalysis(p_submission uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_active();
  if not private.can_work_submission(p_submission) then raise exception 'Submission not in your scope' using errcode = '42501'; end if;
  perform private.enqueue_analysis(p_submission);
  perform private.audit('analysis.requested', 'submission', p_submission::text, null, p_submission);
end $$;

-- ---------------------------------------------------------------------------
-- Assignment (race-safe claim)
-- ---------------------------------------------------------------------------
create or replace function public.claim_submission(p_submission uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_role('finance_analyst'); s public.submissions;
begin
  -- Row lock serialises concurrent claims; the partial unique index on analysis_assignments is a second guard.
  select * into s from public.submissions where id = p_submission for update;
  if not found then raise exception 'Submission not found' using errcode = 'P0002'; end if;
  if s.assigned_analyst_id is not null then raise exception 'Submission has already been claimed' using errcode = '55000'; end if;
  if s.submission_status <> 'awaiting_review' then raise exception 'Submission is not awaiting review' using errcode = '55000'; end if;
  insert into public.analysis_assignments (submission_id, analyst_id, assigned_by, claimed_at) values (p_submission, v_uid, v_uid, now());
  update public.submissions set assigned_analyst_id = v_uid where id = p_submission;
  perform private.apply_transition(p_submission, 'in_analysis', 'finance_analyst', 'Claimed by analyst');
  perform private.audit('assignment.claimed', 'submission', p_submission::text, s.company_id, p_submission);
  perform private.notify_company(s.company_id, 'analyst_assigned', 'Analyst assigned',
    'An analyst has started reviewing "' || s.submission_name || '".', 'submission', p_submission, '/submissions/' || p_submission);
end $$;

create or replace function public.assign_submission(p_submission uuid, p_analyst uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_active(); s public.submissions;
begin
  if not (private.has_role('superadmin') or private.has_role('finance_reviewer')) then
    raise exception 'Insufficient role' using errcode = '42501';
  end if;
  if not private.user_has_role(p_analyst, 'finance_analyst') then
    raise exception 'Assignee must be an active finance analyst' using errcode = '22023';
  end if;
  select * into s from public.submissions where id = p_submission for update;
  if not found then raise exception 'Submission not found' using errcode = 'P0002'; end if;
  if s.submission_status in ('draft', 'archived', 'published') then
    raise exception 'Submission cannot be assigned in status %', s.submission_status using errcode = '55000';
  end if;
  update public.analysis_assignments set assignment_status = 'released', completed_at = now()
    where submission_id = p_submission and assignment_status = 'active';
  insert into public.analysis_assignments (submission_id, analyst_id, assigned_by) values (p_submission, p_analyst, v_uid);
  update public.submissions set assigned_analyst_id = p_analyst where id = p_submission;
  if s.submission_status = 'awaiting_review' then
    perform private.apply_transition(p_submission, 'in_analysis',
      case when private.has_role('superadmin') then 'superadmin' else 'finance_analyst' end, 'Assigned');
  end if;
  perform private.audit('assignment.assigned', 'submission', p_submission::text, s.company_id, p_submission,
    jsonb_build_object('analyst_id', p_analyst, 'previous_analyst_id', s.assigned_analyst_id));
  perform private.notify(p_analyst, 'assignment', 'Submission assigned to you',
    '"' || s.submission_name || '" has been assigned to you.', 'submission', p_submission, '/analyst/submissions/' || p_submission);
end $$;

-- ---------------------------------------------------------------------------
-- Clarifications
-- ---------------------------------------------------------------------------
create or replace function public.create_clarification(p_submission uuid, p_question text, p_requested_documents text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_active(); s public.submissions; v_id uuid;
begin
  if not private.can_work_submission(p_submission) then raise exception 'Submission not in your scope' using errcode = '42501'; end if;
  select * into s from public.submissions where id = p_submission for update;
  if s.submission_status not in ('in_analysis', 'clarification_required') then
    raise exception 'Clarifications can only be requested during analysis' using errcode = '55000';
  end if;
  insert into public.clarification_requests (submission_id, requested_by, question, requested_documents)
  values (p_submission, v_uid, trim(p_question), p_requested_documents) returning id into v_id;
  if s.submission_status = 'in_analysis' then
    perform private.apply_transition(p_submission, 'clarification_required', 'finance_analyst', 'Clarification requested');
  end if;
  perform private.audit('clarification.requested', 'clarification_request', v_id::text, s.company_id, p_submission);
  perform private.notify_company(s.company_id, 'clarification_requested', 'Clarification requested',
    'The finance team has a question about "' || s.submission_name || '".', 'clarification_request', v_id,
    '/submissions/' || p_submission || '?tab=clarifications');
  return v_id;
end $$;

create or replace function public.respond_clarification(p_clarification uuid, p_response text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_role('company_user'); c public.clarification_requests; s public.submissions;
begin
  select * into c from public.clarification_requests where id = p_clarification for update;
  if not found or not private.is_submission_member(c.submission_id) then raise exception 'Clarification not found' using errcode = 'P0002'; end if;
  if c.status <> 'open' then raise exception 'Clarification is no longer open' using errcode = '55000'; end if;
  if coalesce(length(trim(p_response)), 0) < 2 then raise exception 'A response is required' using errcode = '22023'; end if;
  update public.clarification_requests set status = 'answered', response_text = trim(p_response), responded_by = v_uid, responded_at = now()
    where id = p_clarification;
  select * into s from public.submissions where id = c.submission_id;
  perform private.audit('clarification.answered', 'clarification_request', p_clarification::text, s.company_id, s.id);
  perform private.notify(c.requested_by, 'clarification_answered', 'Clarification answered',
    'A company user responded to your clarification on "' || s.submission_name || '".', 'clarification_request', p_clarification,
    '/analyst/submissions/' || s.id || '/clarifications');
end $$;

create or replace function public.resolve_clarification(p_clarification uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_active(); c public.clarification_requests; s public.submissions;
begin
  select * into c from public.clarification_requests where id = p_clarification for update;
  if not found or not private.can_work_submission(c.submission_id) then raise exception 'Clarification not found' using errcode = 'P0002'; end if;
  if p_status not in ('resolved', 'cancelled') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if c.status in ('resolved', 'cancelled') then raise exception 'Clarification already closed' using errcode = '55000'; end if;
  update public.clarification_requests set status = p_status, resolved_at = now() where id = p_clarification;
  select * into s from public.submissions where id = c.submission_id for update;
  -- Newly attached documents are queued for extraction so the analysis reflects them.
  if exists (select 1 from public.clarification_attachments a join public.documents d on d.id = a.document_id
             where a.clarification_id = p_clarification and d.processing_status = 'uploaded') then
    perform private.enqueue_document_jobs(s.id, true);
  end if;
  if s.submission_status = 'clarification_required' and not exists (
      select 1 from public.clarification_requests where submission_id = s.id and status in ('open', 'answered')) then
    perform private.apply_transition(s.id, 'in_analysis', 'finance_analyst', 'All clarifications closed');
  end if;
  perform private.audit('clarification.' || p_status, 'clarification_request', p_clarification::text, s.company_id, s.id);
end $$;
