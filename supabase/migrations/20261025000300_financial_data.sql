-- DealLens core schema, part 3: extracted financial data, metrics, quality, red flags, EBITDA adjustments.

create type public.mapping_status as enum ('auto_mapped', 'needs_review', 'unmapped', 'analyst_mapped', 'analyst_confirmed', 'excluded');
create type public.severity as enum ('critical', 'high', 'medium', 'low', 'informational');
create type public.issue_status as enum ('open', 'acknowledged', 'resolved', 'dismissed');

create table public.financial_periods (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  period_label text not null,
  period_start date,
  period_end date,
  period_type text not null check (period_type in ('annual', 'quarterly', 'monthly', 'ytd', 'unknown')),
  scenario text not null default 'actual' check (scenario in ('actual', 'budget', 'forecast')),
  currency char(3) not null,
  reporting_unit text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (submission_id, period_label, scenario)
);
create index financial_periods_submission_idx on public.financial_periods (submission_id, sort_order);

create table public.financial_line_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  financial_period_id uuid not null references public.financial_periods (id) on delete cascade,
  source_document_id uuid not null references public.documents (id) on delete cascade,
  statement_type text not null default 'unknown' check (statement_type in ('income_statement', 'balance_sheet', 'cash_flow', 'supporting', 'unknown')),
  source_sheet text,
  source_cell_reference text,
  source_page_number integer,
  source_table_reference text,
  source_row integer,
  source_column integer,
  original_label text not null,
  normalized_category text,
  raw_value text,
  parsed_value numeric,
  normalized_value numeric,
  currency char(3),
  unit text,
  is_subtotal boolean not null default false,
  mapping_status public.mapping_status not null default 'unmapped',
  extraction_method text not null,
  confidence_score numeric(4, 3) check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index financial_line_items_submission_idx on public.financial_line_items (submission_id, financial_period_id);
create index financial_line_items_category_idx on public.financial_line_items (submission_id, normalized_category);
create index financial_line_items_doc_idx on public.financial_line_items (source_document_id);

-- Every analyst correction is preserved as a revision; extracted raw values are never overwritten.
create table public.line_item_revisions (
  id uuid primary key default gen_random_uuid(),
  line_item_id uuid not null references public.financial_line_items (id) on delete cascade,
  changed_by uuid references public.profiles (id) on delete set null,
  previous jsonb not null,
  next jsonb not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index line_item_revisions_item_idx on public.line_item_revisions (line_item_id, created_at);

create table public.financial_metrics (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  financial_period_id uuid references public.financial_periods (id) on delete cascade,
  analysis_version integer not null,
  metric_key text not null,
  metric_value numeric,
  currency char(3),
  unit text,
  formula_version text not null,
  calculation_inputs jsonb not null default '{}'::jsonb,
  source_line_item_ids uuid[] not null default '{}',
  metric_status text not null check (metric_status in ('calculated', 'reported', 'warning', 'unavailable')),
  status_reason text,
  calculated_at timestamptz not null default now()
);
create index financial_metrics_lookup_idx on public.financial_metrics (submission_id, analysis_version, metric_key);

create table public.reconciliations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  financial_period_id uuid references public.financial_periods (id) on delete cascade,
  analysis_version integer not null,
  check_key text not null check (check_key in ('balance_sheet', 'cash_roll_forward')),
  status text not null check (status in ('reconciled', 'variance', 'not_tested')),
  lhs numeric,
  rhs numeric,
  variance numeric,
  tolerance numeric,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index reconciliations_submission_idx on public.reconciliations (submission_id, analysis_version);

create table public.data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  financial_period_id uuid references public.financial_periods (id) on delete set null,
  issue_key text not null,
  issue_type text not null,
  severity public.severity not null,
  title text not null,
  description text not null,
  suggested_resolution text not null,
  source_references jsonb not null default '[]'::jsonb,
  client_visible boolean not null default true,
  status public.issue_status not null default 'open',
  resolution_notes text,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, issue_key)
);
create index data_quality_issues_submission_idx on public.data_quality_issues (submission_id, status);

create table public.red_flags (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  rule_key text not null,
  title text not null,
  category text not null,
  severity public.severity not null,
  triggering_rule text not null,
  observed_value numeric,
  comparison_value numeric,
  threshold jsonb not null,
  source_period text,
  source_references jsonb not null default '[]'::jsonb,
  explanation text not null,
  recommended_follow_up text not null,
  analysis_version integer not null,
  is_active boolean not null default true,
  review_status text not null default 'open' check (review_status in ('open', 'dismissed', 'resolved', 'escalated')),
  review_notes text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, rule_key, source_period)
);

create table public.ebitda_adjustments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  financial_period_id uuid not null references public.financial_periods (id) on delete cascade,
  adjustment_type text not null check (adjustment_type in ('restructuring', 'transaction_costs', 'legal_non_recurring', 'owner_related', 'other_non_recurring')),
  description text not null check (length(description) between 3 and 500),
  amount numeric not null check (amount > 0),
  sign smallint not null check (sign in (-1, 1)),
  currency char(3) not null,
  supporting_evidence text not null,
  rationale text not null,
  proposed_by uuid references public.profiles (id) on delete set null,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  review_notes text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ebitda_adjustments_submission_idx on public.ebitda_adjustments (submission_id);
