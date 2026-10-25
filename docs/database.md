# Database guide

DealLens uses Supabase PostgreSQL. The schema is created **only** by version-controlled migrations in
`supabase/migrations/`, applied in filename order.

| Migration | Contents |
|---|---|
| `…0100_core_identity` | enums; `profiles`, `roles` (+ seed of 4 role keys), `user_roles`, `companies`, `company_memberships`, `access_requests`, `invitations`, `platform_settings` |
| `…0200_submissions_documents` | `deal_projects`, `submissions`, `submission_transitions` (+ allowed transitions), `submission_status_history`, `documents`, `processing_jobs` |
| `…0300_financial_data` | `financial_periods`, `financial_line_items`, `line_item_revisions`, `financial_metrics`, `reconciliations`, `data_quality_issues`, `red_flags`, `ebitda_adjustments` |
| `…0400_collaboration_reporting` | `analysis_assignments`, `findings`, `finding_comments`, `clarification_requests`, `clarification_attachments`, `valuation_models`, `reports`, `notifications`, `audit_logs`; append-only and immutability triggers; `updated_at` triggers |
| `…0500_authorization_rls` | `private` helper predicates, privileges, RLS enablement and read policies |
| `…0600_account_admin_functions` | profile trigger, bootstrap, access requests, user/role/company/invitation administration |
| `…0700_submission_workflow_functions` | transition engine, submissions, documents, processing queue, claiming/assignment, clarifications |
| `…0800_analysis_report_functions` | line-item review, data quality, red flags, EBITDA adjustments, findings, valuation, report lifecycle, download audit |
| `…0900_storage` | private `documents` and `reports` buckets and object policies |
| later migrations | incremental changes (see files) |

## Key relationships

```
auth.users 1─1 profiles 1─* user_roles *─1 roles
profiles *─* companies            (company_memberships)
companies 1─* deal_projects
companies 1─* submissions *─1 deal_projects (optional)
submissions 1─* documents 1─* processing_jobs
submissions 1─* financial_periods 1─* financial_line_items *─1 documents
financial_line_items 1─* line_item_revisions
submissions 1─* financial_metrics / reconciliations / data_quality_issues / red_flags / ebitda_adjustments
submissions 1─* findings 1─* finding_comments
submissions 1─* clarification_requests *─* documents (clarification_attachments)
submissions 1─* valuation_models (versioned)
submissions 1─* reports (versioned) ; submissions 1─* analysis_assignments
```

Deletion behaviour: business children cascade from `submissions`; `reports.submission_id` is `ON DELETE RESTRICT`
and published/superseded reports cannot be updated or deleted (trigger), so a submission with report history cannot be
deleted accidentally. `companies → submissions` is `RESTRICT`. Actor columns use `ON DELETE SET NULL` so history survives
user deletion.

## Provenance and versioning

- `financial_line_items` keeps `original_label`, `raw_value` (exact source text) and `parsed_value`. Normalisation writes
  only `normalized_category`, `normalized_value`, `mapping_status`; analyst corrections write a `line_item_revisions` row
  with previous/next values and a mandatory reason.
- `financial_metrics` rows carry `analysis_version`, `formula_version`, `calculation_inputs` (JSON of every input and the
  derivation path) and `source_line_item_ids`. Each re-analysis writes a new version; old versions are retained.
- `valuation_models`: every save is a new `model_version` row with inputs, assumptions, outputs and `engine_version`.
- `reports`: `report_version` per submission; published versions are immutable; a change creates a new version and the old
  published one becomes `superseded`.

## Constraints and indexes (selected)

- One pending access request per user; one live membership per company/user; one active role grant per user/role.
- One active `analysis_assignments` row per submission (race-safe claiming).
- One queued/running job per document, per submission-level job type, and per report (idempotent processing).
- Submissions indexed by company, status, period end, assigned analyst, creation date.
- Check constraints on currencies (`^[A-Z]{3}$`), units, checksums (SHA-256 hex), periods (end after start), etc.

## Row Level Security

See [authorization.md](authorization.md). RLS is enabled on every `public` table; client roles have read-only privileges
and write through SECURITY DEFINER functions. Policies are tested in `tests/integration/`.

## Commands

```bash
npm run db:start      # start local stack (Docker) and apply migrations
npm run db:reset      # drop, re-apply all migrations, then supabase/seed.sql
npm run db:status     # print local URLs and keys
npx supabase migration new <name>   # create a new migration file
npx supabase db push  # apply migrations to the linked hosted project (see deployment.md)
```

## Synthetic demo data

`supabase/seed.sql` inserts three **fictional** companies (flagged `is_synthetic = true`, names suffixed "(Synthetic)")
and one deal project each. It creates **no** users, sessions, passwords or role grants.

Synthetic financial statements are generated by `npm run samples` into `samples/` and are submitted through the real
upload pipeline (see `docs/testing.md` → demo walkthrough and `scripts/seed-demo.ts`), so demo dashboards are produced by
the same extraction and analytics code as real submissions.

## Backups

Hosted Supabase projects include daily backups on paid plans; enable Point-in-Time Recovery for production. Storage
objects are **not** included in database backups — back up the `documents` and `reports` buckets separately (e.g. via
the S3-compatible API). Test restores periodically into a non-production project.
