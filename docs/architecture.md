# Architecture

```
 Browser ──HTTPS──▶ Next.js 15 (App Router, Node runtime)
                     │  server components / server actions / route handlers
                     │  Supabase client bound to the user's session cookie (RLS always applies)
                     ▼
               Supabase ──────────────────────────────────────────────┐
               ├─ Auth (Google OAuth, PKCE, JWT sessions)              │
               ├─ PostgreSQL  (schema, RLS, SECURITY DEFINER ops,      │
               │               processing_jobs queue, audit log)        │
               └─ Storage     (private buckets: documents, reports)    │
                     ▲                                                  │
                     │ direct Postgres (DATABASE_URL) + service-role    │
                     │ key for Storage only                             │
               Python worker (processing/deallens_worker) ─────────────┘
                 extract → normalise → analyse → data quality → red flags → PDF reports
```

## Responsibilities

| Component | Responsibility | Trust |
|---|---|---|
| Next.js | UI, input validation (Zod), file signature checks, upload orchestration, signed URLs, valuation engine (TypeScript, recomputed server-side on save) | Runs with the **user's** JWT; never uses the service-role key except for the superadmin bootstrap call |
| PostgreSQL | Source of truth; RLS for reads; SECURITY DEFINER functions for every write (identity, role, scope, workflow state, audit, notifications, single transaction) | Final authority |
| Storage | Private objects with policies bound to the owning metadata row | Enforced by Supabase |
| Worker | CPU-heavy, long-running jobs outside request handlers: extraction, normalisation, metrics, reconciliations, data quality, red flags, PDF rendering, retention sweep | Privileged; deployed privately; no public endpoint |

## Why this shape

- **Database-enforced authorization**: the browser can call PostgREST directly, so every rule lives in RLS and in the
  database functions; the Next.js checks are an additional layer. Integration tests call the API directly to prove it.
- **Queue in Postgres** (`processing_jobs` + `FOR UPDATE SKIP LOCKED`): no extra infrastructure, transactional with the
  data it produces, idempotent per document/submission/report through partial unique indexes.
- **Python for documents and finance** (openpyxl, xlrd, pdfplumber, pandas-friendly data, ReportLab) and **TypeScript for
  valuation**: valuation is interactive, so the same engine runs in the browser for preview and on the server for the
  persisted result; persisted metrics are produced once, by the worker, with provenance.
- **Snapshots for reports**: the approved snapshot is what gets published (see financial-methodology §10 and Phase 9).

## Request flows

**Upload**: browser → `POST /api/submissions/:id/documents` → validate & hash → `register_document` (row in
`uploading`, server-generated path) → Storage upload as the user → `finalize_document` (object must exist) →
`submit_submission` → `extract_document` jobs. Failures roll back; stale rows are swept.

**Processing**: worker claims job → `uploaded → processing` → download + checksum check → extraction in a killable
subprocess with timeout → normalised line items (one transaction) → when no extraction jobs remain,
`analyze_submission` → new `analysis_version` of metrics, reconciliations, DQ issues, red flags → `awaiting_review`
or `processing_failed` + notifications. Transient errors retry with exponential backoff; deterministic ones fail fast with
a safe message.

**Review → report**: claim (row lock + unique index) → corrections (versioned) → recalculation → findings / adjustments /
valuations (four-eyes) → report draft (snapshot + draft PDF) → review → final render → publish (immutable) → company
download via signed URL.

## Module map

```
app/                       routes (public, (app) authenticated workspace, api route handlers, auth callback)
components/                ui kit, charts, documents, financial, valuation, reports, navigation, forms, tables
lib/auth, authorization    session context, role helpers, bootstrap, safe redirects
lib/storage, validation    upload orchestration, file signatures
lib/financial, valuation   metric definitions, snapshot loader, EBITDA bridge, valuation engine
lib/submissions, reporting workflow mirror, report config
supabase/migrations        schema, RLS, functions, storage policies
processing/deallens_worker extraction, normalization, validation, financial, reporting, jobs, worker
tests/unit|integration|e2e TypeScript tests; processing/tests Python tests
```
