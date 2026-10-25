-- DealLens core schema, part 1: identity, roles, companies, access.
-- All business tables live in the public schema with RLS enabled (see 0005 migration).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type public.account_status as enum ('pending_approval', 'active', 'suspended', 'rejected');
create type public.record_status as enum ('active', 'inactive', 'archived');
create type public.membership_status as enum ('invited', 'active', 'suspended', 'revoked');
create type public.request_status as enum ('pending', 'approved', 'rejected', 'withdrawn');

-- ---------------------------------------------------------------------------
-- profiles: one row per authenticated Supabase user. Identity comes from auth.users.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text not null,
  avatar_url text,
  account_status public.account_status not null default 'pending_approval',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_status_idx on public.profiles (account_status);

-- ---------------------------------------------------------------------------
-- roles & user_roles
-- ---------------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique check (role_key in ('superadmin', 'company_user', 'finance_analyst', 'finance_reviewer')),
  display_name text not null,
  description text not null,
  created_at timestamptz not null default now()
);

insert into public.roles (role_key, display_name, description) values
  ('superadmin', 'Superadmin', 'Manages platform operations, users, companies and assignments. No implicit access to financial document contents.'),
  ('company_user', 'Company User', 'Submits financial documents for an approved company and views published results.'),
  ('finance_analyst', 'Finance Analyst', 'Reviews, analyses and drafts reports for submissions in scope.'),
  ('finance_reviewer', 'Finance Reviewer', 'Senior finance-team member authorised to approve and publish reports (four-eyes control).');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete restrict,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
-- Only one active grant per user/role.
create unique index user_roles_active_key on public.user_roles (user_id, role_id) where revoked_at is null;
create index user_roles_user_idx on public.user_roles (user_id);

-- ---------------------------------------------------------------------------
-- companies & memberships
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  display_name text not null,
  industry text,
  country text,
  reporting_currency char(3) not null default 'USD' check (reporting_currency ~ '^[A-Z]{3}$'),
  reporting_unit text not null default 'thousands' check (reporting_unit in ('units', 'thousands', 'millions')),
  description text,
  is_synthetic boolean not null default false,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index companies_legal_name_key on public.companies (lower(legal_name));

create table public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  membership_role text not null default 'member' check (membership_role in ('owner', 'member')),
  status public.membership_status not null default 'active',
  invited_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index company_memberships_live_key on public.company_memberships (company_id, user_id)
  where status in ('invited', 'active');
create index company_memberships_user_idx on public.company_memberships (user_id, status);

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  requested_company_name text not null check (length(requested_company_name) between 2 and 200),
  requested_company_id uuid references public.companies (id) on delete set null,
  requested_role text not null default 'company_user' check (requested_role in ('company_user', 'finance_analyst')),
  business_justification text not null check (length(business_justification) between 10 and 2000),
  status public.request_status not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  review_notes text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index access_requests_one_pending on public.access_requests (user_id) where status = 'pending';
create index access_requests_status_idx on public.access_requests (status, created_at desc);

-- Invitations: the raw token is only ever shown once to the inviting admin; we store a SHA-256 hash.
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  invited_by uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invitations_company_idx on public.invitations (company_id);

-- Platform settings exposed to superadmins (never secrets).
create table public.platform_settings (
  key text primary key check (key ~ '^[a-z_]+$'),
  value jsonb not null,
  description text not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (key, value, description) values
  ('max_upload_mb', '25', 'Maximum size of a single uploaded document in megabytes.'),
  ('invitation_ttl_hours', '168', 'Validity period of company invitation links.'),
  ('require_four_eyes_approval', 'true', 'Reports must be approved by a reviewer other than their author.'),
  ('max_processing_attempts', '3', 'Maximum attempts for a processing job before it is marked failed.');
