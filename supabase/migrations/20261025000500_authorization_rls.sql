-- DealLens authorization: helper predicates and Row Level Security.
--
-- Model:
--   * Reads go through RLS policies on every table (no table is readable without a policy).
--   * Writes from the browser/app never touch tables directly: authenticated users have no
--     INSERT/UPDATE/DELETE privileges. All mutations go through SECURITY DEFINER functions
--     (migration 0006) which re-check identity, role, resource scope and workflow state,
--     run in one transaction and write the audit log.
--   * The processing worker connects with a privileged database role and bypasses RLS.

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper predicates (SECURITY DEFINER so they can read role tables without recursion)
-- ---------------------------------------------------------------------------
create or replace function private.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.account_status = 'active');
$$;

create or replace function private.has_role(p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active() and exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and ur.revoked_at is null and r.role_key = p_role);
$$;

create or replace function private.user_has_role(p_user uuid, p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = p_user and ur.revoked_at is null and r.role_key = p_role and p.account_status = 'active');
$$;

create or replace function private.is_internal() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('finance_analyst') or private.has_role('finance_reviewer');
$$;

create or replace function private.is_company_member(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('company_user') and exists (
    select 1 from public.company_memberships m join public.companies c on c.id = m.company_id
    where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active' and c.status = 'active');
$$;

create or replace function private.is_submission_member(p_submission uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.submissions s where s.id = p_submission and private.is_company_member(s.company_id));
$$;

-- Internal (finance team) scope: reviewers see every submitted package; analysts see work assigned
-- to them plus the unassigned queue they may claim from.
create or replace function private.is_internal_in_scope(p_submission uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.submissions s
    where s.id = p_submission and s.submission_status <> 'draft' and (
      private.has_role('finance_reviewer')
      or (private.has_role('finance_analyst') and (
            s.assigned_analyst_id = auth.uid()
            or (s.assigned_analyst_id is null and s.submission_status in ('awaiting_review', 'processing_failed'))))));
$$;

-- Financial content (line items, metrics, documents' files, clarifications).
-- Superadmins are intentionally NOT included: administrative role does not imply content access.
create or replace function private.can_view_content(p_submission uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_submission_member(p_submission) or private.is_internal_in_scope(p_submission);
$$;

-- Submission metadata (name, status, period, processing status) – adds superadmin oversight.
create or replace function private.can_view_submission(p_submission uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_view_content(p_submission) or private.has_role('superadmin');
$$;

-- Write scope for analysis work: the assigned analyst, or any reviewer.
create or replace function private.can_work_submission(p_submission uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.submissions s
    where s.id = p_submission and s.submission_status not in ('draft', 'archived') and (
      private.has_role('finance_reviewer')
      or (private.has_role('finance_analyst') and s.assigned_analyst_id = auth.uid())));
$$;

create or replace function private.can_see_profile(p_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_profile = auth.uid()
    or private.has_role('superadmin')
    or private.is_internal()
    or (private.is_active() and (
          private.user_has_role(p_profile, 'finance_analyst') or private.user_has_role(p_profile, 'finance_reviewer')
          or exists (select 1 from public.company_memberships a join public.company_memberships b on a.company_id = b.company_id
                     where a.user_id = auth.uid() and b.user_id = p_profile and a.status = 'active' and b.status = 'active')));
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges: no direct writes for client roles, nothing at all for anon.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere and define read policies. (Not FORCEd: SECURITY DEFINER functions owned
-- by the table owner must be able to write after performing their own checks.)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy profiles_read on public.profiles for select to authenticated using (private.can_see_profile(id));
create policy roles_read on public.roles for select to authenticated using (true);
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or private.has_role('superadmin'));

create policy companies_read on public.companies for select to authenticated
  using (private.has_role('superadmin') or private.is_internal() or private.is_company_member(id));
create policy memberships_read on public.company_memberships for select to authenticated
  using (user_id = auth.uid() or private.has_role('superadmin') or private.is_internal());
create policy access_requests_read on public.access_requests for select to authenticated
  using (user_id = auth.uid() or private.has_role('superadmin'));
create policy invitations_read on public.invitations for select to authenticated using (private.has_role('superadmin'));
create policy settings_read on public.platform_settings for select to authenticated using (private.is_active());

create policy deals_read on public.deal_projects for select to authenticated
  using (private.has_role('superadmin') or private.is_internal() or private.is_company_member(company_id));
create policy submissions_read on public.submissions for select to authenticated using (private.can_view_submission(id));
create policy transitions_read on public.submission_transitions for select to authenticated using (true);
create policy status_history_read on public.submission_status_history for select to authenticated
  using (private.can_view_submission(submission_id));
create policy documents_read on public.documents for select to authenticated
  using (deleted_at is null and private.can_view_submission(submission_id));
create policy jobs_read on public.processing_jobs for select to authenticated using (private.can_view_submission(submission_id));

create policy periods_read on public.financial_periods for select to authenticated using (private.can_view_content(submission_id));
create policy line_items_read on public.financial_line_items for select to authenticated using (private.can_view_content(submission_id));
create policy metrics_read on public.financial_metrics for select to authenticated using (private.can_view_content(submission_id));
create policy reconciliations_read on public.reconciliations for select to authenticated using (private.can_view_content(submission_id));
create policy revisions_read on public.line_item_revisions for select to authenticated using (
  exists (select 1 from public.financial_line_items li where li.id = line_item_id and private.is_internal_in_scope(li.submission_id)));

create policy dq_read on public.data_quality_issues for select to authenticated using (
  private.is_internal_in_scope(submission_id) or (client_visible and private.is_submission_member(submission_id)));
create policy red_flags_read on public.red_flags for select to authenticated using (private.is_internal_in_scope(submission_id));
create policy adjustments_read on public.ebitda_adjustments for select to authenticated using (private.is_internal_in_scope(submission_id));
create policy valuation_read on public.valuation_models for select to authenticated using (private.is_internal_in_scope(submission_id));
create policy assignments_read on public.analysis_assignments for select to authenticated using (
  private.is_internal_in_scope(submission_id) or private.has_role('superadmin'));

create policy findings_read on public.findings for select to authenticated using (
  private.is_internal_in_scope(submission_id)
  or (visibility = 'client_visible' and status in ('approved', 'closed') and private.is_submission_member(submission_id)));
create policy finding_comments_read on public.finding_comments for select to authenticated using (
  exists (select 1 from public.findings f where f.id = finding_id and (
    private.is_internal_in_scope(f.submission_id)
    or (finding_comments.visibility = 'client_visible' and f.visibility = 'client_visible'
        and f.status in ('approved', 'closed') and private.is_submission_member(f.submission_id)))));

create policy clarifications_read on public.clarification_requests for select to authenticated using (private.can_view_content(submission_id));
create policy clarification_attachments_read on public.clarification_attachments for select to authenticated using (
  exists (select 1 from public.clarification_requests c where c.id = clarification_id and private.can_view_content(c.submission_id)));

create policy reports_read on public.reports for select to authenticated using (
  private.is_internal_in_scope(submission_id)
  or (private.has_role('superadmin'))
  or (status in ('published', 'superseded') and private.is_submission_member(submission_id)));

create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());

create policy audit_read on public.audit_logs for select to authenticated using (
  private.has_role('superadmin') or (submission_id is not null and private.is_internal_in_scope(submission_id)));
