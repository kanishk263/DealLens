-- DealLens core schema, part 2: deals, submissions, documents, processing jobs.

create type public.deal_type as enum ('acquisition', 'divestiture', 'financial_due_diligence', 'valuation', 'strategic_review', 'other');

create type public.submission_status as enum (
  'draft', 'uploaded', 'processing', 'processing_failed', 'awaiting_review', 'in_analysis',
  'clarification_required', 'under_review', 'reviewed', 'published', 'archived'
);

create type public.document_category as enum (
  'income_statement', 'balance_sheet', 'cash_flow_statement', 'trial_balance', 'general_ledger',
  'accounts_receivable', 'accounts_payable', 'debt_schedule', 'revenue_schedule', 'other_supporting'
);

create type public.processing_status as enum ('uploading', 'uploaded', 'queued', 'processing', 'processed', 'failed', 'unsupported');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
create type public.job_type as enum ('extract_document', 'analyze_submission', 'generate_report');

create table public.deal_projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(name) between 2 and 200),
  description text,
  deal_type public.deal_type not null default 'financial_due_diligence',
  status public.record_status not null default 'active',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deal_projects_company_idx on public.deal_projects (company_id);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  deal_project_id uuid references public.deal_projects (id) on delete set null,
  submitted_by uuid references public.profiles (id) on delete set null,
  submission_name text not null check (length(submission_name) between 2 and 200),
  deal_type public.deal_type not null default 'financial_due_diligence',
  notes text check (notes is null or length(notes) <= 5000),
  reporting_period_start date not null,
  reporting_period_end date not null,
  reporting_currency char(3) not null check (reporting_currency ~ '^[A-Z]{3}$'),
  reporting_unit text not null check (reporting_unit in ('units', 'thousands', 'millions')),
  submission_status public.submission_status not null default 'draft',
  assigned_analyst_id uuid references public.profiles (id) on delete set null,
  current_analysis_version integer not null default 0,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint submissions_period_order check (reporting_period_end > reporting_period_start)
);
create index submissions_company_idx on public.submissions (company_id);
create index submissions_status_idx on public.submissions (submission_status);
create index submissions_period_idx on public.submissions (reporting_period_end);
create index submissions_analyst_idx on public.submissions (assigned_analyst_id);
create index submissions_created_idx on public.submissions (created_at desc);

-- Allowed workflow transitions; the transition function consults this table.
create table public.submission_transitions (
  from_status public.submission_status not null,
  to_status public.submission_status not null,
  actor text not null check (actor in ('company_user', 'finance_analyst', 'finance_reviewer', 'superadmin', 'system')),
  description text not null,
  primary key (from_status, to_status, actor)
);

insert into public.submission_transitions (from_status, to_status, actor, description) values
  ('draft', 'uploaded', 'company_user', 'Company user submits the document package'),
  ('uploaded', 'processing', 'system', 'Worker starts processing'),
  ('processing', 'awaiting_review', 'system', 'Processing succeeded'),
  ('processing', 'processing_failed', 'system', 'Processing failed'),
  ('processing_failed', 'uploaded', 'company_user', 'Company user resubmits after fixing documents'),
  ('processing_failed', 'uploaded', 'superadmin', 'Superadmin retries processing'),
  ('processing_failed', 'uploaded', 'finance_analyst', 'Assigned analyst retries processing'),
  ('awaiting_review', 'in_analysis', 'finance_analyst', 'Analyst claims or is assigned the submission'),
  ('awaiting_review', 'in_analysis', 'superadmin', 'Superadmin assigns an analyst'),
  ('in_analysis', 'clarification_required', 'finance_analyst', 'Analyst requests clarification'),
  ('clarification_required', 'in_analysis', 'finance_analyst', 'Analyst resumes after clarification'),
  ('clarification_required', 'uploaded', 'company_user', 'Company user uploads additional documents for reprocessing'),
  ('in_analysis', 'uploaded', 'finance_analyst', 'Analyst requests reprocessing of documents'),
  ('in_analysis', 'under_review', 'finance_analyst', 'Analyst submits report draft for review'),
  ('under_review', 'in_analysis', 'finance_reviewer', 'Reviewer requests changes'),
  ('under_review', 'reviewed', 'finance_reviewer', 'Reviewer approves the report'),
  ('reviewed', 'published', 'finance_reviewer', 'Reviewer publishes the approved report'),
  ('reviewed', 'published', 'finance_analyst', 'Assigned analyst publishes the approved report'),
  ('published', 'in_analysis', 'finance_analyst', 'Analyst reopens to prepare a new report version'),
  ('draft', 'archived', 'superadmin', 'Archive'),
  ('awaiting_review', 'archived', 'superadmin', 'Archive'),
  ('in_analysis', 'archived', 'superadmin', 'Archive'),
  ('processing_failed', 'archived', 'superadmin', 'Archive'),
  ('published', 'archived', 'superadmin', 'Archive');

create table public.submission_status_history (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  from_status public.submission_status,
  to_status public.submission_status not null,
  actor_user_id uuid references public.profiles (id) on delete set null,
  actor_kind text not null,
  reason text,
  occurred_at timestamptz not null default now()
);
create index submission_status_history_idx on public.submission_status_history (submission_id, occurred_at);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  uploaded_by uuid references public.profiles (id) on delete set null,
  original_filename text not null check (length(original_filename) between 1 and 255),
  storage_path text not null unique,
  file_type text not null check (file_type in ('xlsx', 'xls', 'csv', 'pdf')),
  file_size_bytes bigint not null check (file_size_bytes > 0),
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  document_category public.document_category not null,
  document_version integer not null default 1,
  processing_status public.processing_status not null default 'uploading',
  extraction_metadata jsonb not null default '{}'::jsonb,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index documents_submission_idx on public.documents (submission_id);
create index documents_checksum_idx on public.documents (checksum);

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  document_id uuid references public.documents (id) on delete cascade,
  report_id uuid,
  job_type public.job_type not null,
  job_status public.job_status not null default 'queued',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  safe_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index processing_jobs_queue_idx on public.processing_jobs (job_status, run_after) where job_status = 'queued';
create index processing_jobs_submission_idx on public.processing_jobs (submission_id);
-- Idempotency: only one live job of a given type per document / submission / report.
create unique index processing_jobs_live_doc on public.processing_jobs (document_id, job_type)
  where job_status in ('queued', 'running') and document_id is not null;
create unique index processing_jobs_live_sub on public.processing_jobs (submission_id, job_type)
  where job_status in ('queued', 'running') and document_id is null and report_id is null;
create unique index processing_jobs_live_report on public.processing_jobs (report_id, job_type)
  where job_status in ('queued', 'running') and report_id is not null;
