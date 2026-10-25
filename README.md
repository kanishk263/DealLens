# DealLens

**Financial clarity. Deal confidence.**

DealLens is a multi-user financial intelligence and deal analytics platform. Company users submit financial statements;
a processing worker extracts, normalises and validates them with source traceability; finance analysts review the data,
analyse performance, propose EBITDA adjustments, investigate red flags, build valuations and draft reports; an independent
reviewer approves; and the approved report is published to the company as an immutable, server-generated PDF.

> Independent portfolio project. Not affiliated with, endorsed by, or associated with any professional services firm.
> Demo environments use **clearly labelled synthetic companies and data**. Outputs are analytical estimates, not advice.

## Features

- **Real Google OAuth** via Supabase Auth (PKCE), account approval workflow, invitations, suspension, secure first-superadmin bootstrap.
- **Authorization in the database**: RLS on every table, no direct writes for client roles, audited SECURITY DEFINER operations, four roles (superadmin, company user, finance analyst, finance reviewer).
- **Private document storage** with path-bound policies, signed short-lived downloads, magic-byte validation, checksums, duplicate detection, retention sweep.
- **Extraction** of XLSX / XLS / CSV / text-based PDF with sheet-cell / row-column / page references; scanned PDFs rejected explicitly.
- **Normalisation** to standard categories with confidence scores, review queue, analyst overrides with revision history.
- **Data quality**: reconciliations (balance sheet, cash roll-forward), currency/unit/period checks, conflicts, unusual movements.
- **Analytics** with provenance: revenue, profitability, EBITDA (reported vs calculated), EBITDA normalisation bridge, working capital, leverage, cash flow.
- **Red-flag engine**: deterministic, explainable, configurable thresholds with rationale; analyst review.
- **Valuation studio**: comparable companies and DCF with sensitivity analysis, versioned and reproducible models, reviewer approval.
- **Collaboration**: findings register (internal vs client-visible), comments, clarification requests with attachments, notifications.
- **Reports**: snapshot-based PDF generation (ReportLab), four-eyes approval, immutable publication and versioning.
- **Admin workspace**: users & roles, companies, access requests, submission oversight, job monitoring, audit log, settings.

## Architecture

Next.js 15 (App Router, TypeScript strict, Tailwind) ⟷ Supabase (Auth, PostgreSQL with RLS, private Storage) ⟷ Python
worker (pandas/openpyxl/xlrd/pdfplumber/ReportLab) using a Postgres job queue. See [docs/architecture.md](docs/architecture.md).

| Doc | |
|---|---|
| [architecture.md](docs/architecture.md) | components, flows, module map |
| [authentication.md](docs/authentication.md) | Google OAuth, Supabase config, superadmin bootstrap, troubleshooting |
| [authorization.md](docs/authorization.md) | roles, RLS, write functions, storage policies |
| [database.md](docs/database.md) | schema, migrations, provenance, seed data, backups |
| [financial-methodology.md](docs/financial-methodology.md) | every formula, convention, threshold and valuation method |
| [testing.md](docs/testing.md) | suites, automated vs manual, security and accuracy cases |
| [deployment.md](docs/deployment.md) | Vercel + Supabase + worker, env vars, smoke tests, rollback |
| [troubleshooting.md](docs/troubleshooting.md) | common problems |
| [implementation-log.md](docs/implementation-log.md) | phase-by-phase build log |

## Prerequisites

- Node.js **≥ 20.9** (22 recommended, see `.nvmrc`), npm
- Python **3.11+**
- Docker Desktop (for the local Supabase stack)

## Local setup

```bash
npm install
python3 -m venv processing/.venv
processing/.venv/bin/pip install -r processing/requirements-dev.txt
cp supabase/.env.example supabase/.env          # add Google OAuth client ID/secret for local sign-in
npm run db:start                                  # starts Supabase locally and applies all migrations
npm run db:status                                 # prints local URL and keys
cp .env.example .env.local                        # fill NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY from db:status
cp processing/.env.example processing/.env        # fill SUPABASE_SERVICE_ROLE_KEY (local)
```

Set `SUPERADMIN_BOOTSTRAP_EMAIL` in `.env.local` to your Google address, then run, in two terminals:

```bash
npm run dev       # http://localhost:3000
npm run worker    # processing worker
```

### Database and synthetic data

```bash
npm run db:reset    # re-apply migrations + supabase/seed.sql (three synthetic companies, no users)
npm run samples     # regenerate synthetic statements in samples/ (already committed)
npm run seed:demo   # local only: process the samples through the real pipeline (worker run in drain mode)
```

## Environment variables

| Variable | Where | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app | always |
| `SUPABASE_SERVICE_ROLE_KEY` | app (server only) | for superadmin bootstrap |
| `SUPERADMIN_BOOTSTRAP_EMAIL` | app | first sign-in only |
| `APP_BASE_URL` | app | production (invitation links) |
| `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | worker | always |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET` | `supabase/.env` (local stack) | local Google sign-in |

Google credentials for hosted projects are configured in the Supabase dashboard, not in the app. No real secrets are committed.

## Tests and checks

```bash
npm run lint && npm run typecheck
npm test                    # TypeScript unit tests
npm run test:python         # worker tests
npm run test:integration    # needs the local stack
npm run build && npm run test:e2e   # Playwright critical journey (needs the local stack)
```

## Build

```bash
npm run build && npm start
docker build -t deallens-worker processing
```

## Deployment overview

Vercel (Next.js) + Supabase (hosted project, `supabase db push`) + a Docker background worker (Render/Railway/Fly).
Full procedure in [docs/deployment.md](docs/deployment.md).

## Known limitations

- OCR for scanned PDFs is out of scope; such files are rejected with an explanation.
- Extraction targets common statement layouts (periods as column headers); unusual layouts need analyst mapping.
- Comparable-company data is manual; DealLens supplies no market data.
- Red-flag thresholds are illustrative defaults, not industry standards.
- Rate limiting is in-memory per instance; email notifications are not implemented (in-app only).
- The CSP allows inline scripts (required by Next.js without a nonce setup).
- Google's consent screen is tested manually; everything after it is covered by automated tests.
- No compliance certification is claimed; independent security review is recommended before handling real client data.
