-- DealLens core schema, part 4: assignments, findings, clarifications, valuation, reports, notifications, audit.

create table public.analysis_assignments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  analyst_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assignment_status text not null default 'active' check (assignment_status in ('active', 'released', 'completed')),
  assigned_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz
);
-- At most one active assignment per submission: this unique index is what makes claiming race-safe.
create unique index analysis_assignments_one_active on public.analysis_assignments (submission_id) where assignment_status = 'active';
create index analysis_assignments_analyst_idx on public.analysis_assignments (analyst_id, assignment_status);

create type public.visibility as enum ('internal', 'client_visible');

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  category text not null check (category in ('revenue', 'profitability', 'ebitda', 'working_capital', 'debt', 'cash_flow', 'data_quality', 'valuation', 'other')),
  title text not null check (length(title) between 3 and 200),
  description text not null check (length(description) between 3 and 5000),
  severity public.severity not null,
  quantified_impact numeric,
  impact_currency char(3),
  source_references jsonb not null default '[]'::jsonb,
  recommendation text,
  visibility public.visibility not null default 'internal',
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'closed')),
  owner_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, reference_code),
  constraint findings_impact_currency check (quantified_impact is null or impact_currency is not null)
);
create index findings_submission_idx on public.findings (submission_id, status);

create table public.finding_comments (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  comment_text text not null check (length(comment_text) between 1 and 5000),
  visibility public.visibility not null default 'internal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index finding_comments_finding_idx on public.finding_comments (finding_id, created_at);

create table public.clarification_requests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  assigned_to uuid references public.profiles (id) on delete set null,
  question text not null check (length(question) between 5 and 5000),
  requested_documents text,
  status text not null default 'open' check (status in ('open', 'answered', 'resolved', 'cancelled')),
  response_text text,
  responded_by uuid references public.profiles (id) on delete set null,
  responded_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index clarification_requests_submission_idx on public.clarification_requests (submission_id, status);

-- Documents uploaded in answer to a clarification are linked here.
create table public.clarification_attachments (
  clarification_id uuid not null references public.clarification_requests (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  primary key (clarification_id, document_id)
);

create table public.valuation_models (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  model_name text not null check (length(model_name) between 2 and 120),
  valuation_method text not null check (valuation_method in ('comparables', 'dcf')),
  assumptions jsonb not null,
  calculation_inputs jsonb not null,
  calculation_outputs jsonb not null,
  currency char(3) not null,
  model_version integer not null,
  engine_version text not null,
  analyst_comments text,
  created_by uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  review_status text not null default 'draft' check (review_status in ('draft', 'pending_review', 'approved', 'rejected')),
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, model_name, model_version)
);
create index valuation_models_submission_idx on public.valuation_models (submission_id);

create type public.report_status as enum ('draft', 'pending_review', 'changes_requested', 'approved', 'published', 'superseded');

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete restrict,
  report_title text not null check (length(report_title) between 3 and 200),
  report_type text not null default 'financial_due_diligence' check (report_type in ('financial_due_diligence', 'valuation_summary', 'data_quality')),
  report_version integer not null,
  status public.report_status not null default 'draft',
  config jsonb not null,
  storage_path text,
  content_checksum text,
  generated_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  review_notes text,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, report_version)
);
create index reports_submission_idx on public.reports (submission_id, status);

alter table public.processing_jobs
  add constraint processing_jobs_report_fk foreign key (report_id) references public.reports (id) on delete cascade;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  notification_type text not null,
  title text not null,
  message text not null,
  related_entity_type text,
  related_entity_id uuid,
  link_path text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  company_id uuid references public.companies (id) on delete set null,
  submission_id uuid references public.submissions (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_logs_occurred_idx on public.audit_logs (occurred_at desc);
create index audit_logs_submission_idx on public.audit_logs (submission_id, occurred_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

-- Append-only: block UPDATE/DELETE for every role except when the FK cascade sets ids to null.
create or replace function public.audit_logs_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'audit_logs is append-only';
  end if;
  if new.action is distinct from old.action or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id or new.metadata is distinct from old.metadata
     or new.occurred_at is distinct from old.occurred_at then
    raise exception 'audit_logs is append-only';
  end if;
  return new;
end $$;
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.audit_logs_append_only();

-- Published reports are immutable; only the transition to 'superseded' is allowed.
create or replace function public.reports_immutable_when_published() returns trigger
language plpgsql as $$
begin
  if old.status = 'published' then
    if tg_op = 'DELETE' then
      raise exception 'published reports cannot be deleted';
    end if;
    if new.status <> 'superseded' or new.storage_path is distinct from old.storage_path
       or new.config is distinct from old.config or new.content_checksum is distinct from old.content_checksum then
      raise exception 'published reports are immutable; create a new version instead';
    end if;
  elsif old.status = 'superseded' and tg_op = 'UPDATE' then
    raise exception 'superseded reports are immutable';
  end if;
  return coalesce(new, old);
end $$;
create trigger reports_immutable before update or delete on public.reports
  for each row execute function public.reports_immutable_when_published();

-- Generic updated_at maintenance.
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','companies','company_memberships','access_requests','deal_projects','submissions',
    'documents','processing_jobs','financial_line_items','data_quality_issues','red_flags','ebitda_adjustments',
    'findings','finding_comments','valuation_models','reports']
  loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;
