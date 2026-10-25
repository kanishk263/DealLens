-- DealLens synthetic seed data (applied by `supabase db reset`).
--
-- SYNTHETIC: every company below is fictional and flagged is_synthetic = true. No users, sessions,
-- passwords or role grants are created here: people obtain access only through Google sign-in and
-- the approval workflow. Synthetic financial statements live in samples/ and are uploaded through the
-- real application flow (see docs/database.md → "Synthetic demo data").

insert into public.companies (id, legal_name, display_name, industry, country, reporting_currency, reporting_unit, description, is_synthetic)
values
  ('11111111-1111-4111-8111-111111111111', 'Northstar Components Ltd. (Synthetic)', 'Northstar Components', 'Industrial manufacturing', 'United Kingdom', 'USD', 'thousands',
   'SYNTHETIC. Manufacturer of precision components with moderate revenue growth and stable margins.', true),
  ('22222222-2222-4222-8222-222222222222', 'Meridian Consumer Brands Ltd. (Synthetic)', 'Meridian Consumer Brands', 'Consumer goods', 'United Kingdom', 'USD', 'thousands',
   'SYNTHETIC. Consumer business with rising revenue but deteriorating working capital.', true),
  ('33333333-3333-4333-8333-333333333333', 'Apex Digital Services Ltd. (Synthetic)', 'Apex Digital Services', 'Technology services', 'United Kingdom', 'USD', 'thousands',
   'SYNTHETIC. Technology services business with high gross margins and a distinct cash-flow profile.', true)
on conflict (id) do nothing;

insert into public.deal_projects (id, company_id, name, description, deal_type)
values
  ('a1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Project Polaris (Synthetic)', 'Buy-side financial due diligence.', 'financial_due_diligence'),
  ('a2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'Project Meridian (Synthetic)', 'Working-capital-focused diligence ahead of acquisition.', 'acquisition'),
  ('a3333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333', 'Project Apex (Synthetic)', 'Valuation review.', 'valuation')
on conflict (id) do nothing;
