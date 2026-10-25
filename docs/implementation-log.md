# DealLens implementation log

Each phase ends with checks, a commit, and an entry here. Tracking issues: one GitHub issue per phase.

| Phase | Issue | Status |
|---|---|---|
| 1. Repository and foundation | #1 | Done |
| 2. Authentication and authorization | #10 | Done |
| 3. Database and company management | #2 | Done |
| 4. Document upload and processing | #3 | Done |
| 5. Financial data review | #4 | Done |
| 6. Financial analytics | #5 | Done |
| 7. Valuation | #6 | Done |
| 8. Findings and collaboration | #7 | Done |
| 9. Reports | #8 | Done |
| 10. Hardening and deployment | #9 | Done |

---

## Phase 1 — Repository and foundation (2026-10-25)

**Implemented**
- Next.js 15 (App Router) + TypeScript strict + Tailwind CSS v4 scaffold; ESLint (next config) and Prettier.
- Design tokens (neutral surfaces, navy accent, semantic status colours) and an accessible component kit:
  buttons, cards, badges/status badges, form controls, tables, URL-backed tabs, dialogs, empty/error/loading states, metric cards.
- Environment validation (`lib/env.ts`) that names missing variables without printing values; service-role key isolated behind `server-only`.
- Supabase SSR clients (server, browser, middleware session refresh) and the authenticated application shell (role-aware sidebar, header, notifications badge, sign-out).
- Public pages: landing, product overview, sign-in, auth error, unauthorised, privacy and terms placeholders.
- Local Supabase stack configuration (`supabase/config.toml`) with Google provider credentials sourced from environment variables.
- Python processing worker environment (`processing/requirements*.txt`).

**Environment notes**
- The machine's system Node.js was v20.2, below the ≥20.9 required by current Next/ESLint. Node 22 LTS was installed user-locally (`~/.local/node22`); `.nvmrc` pins 22.

**Checks**: `tsc --noEmit` ✅, `eslint .` ✅.

**Known limitations**: authenticated pages beyond the shell arrive in later phases.

**External configuration still required**: Supabase project + Google OAuth client (Phase 2 docs).

---

## Phase 2 — Authentication and authorization (2026-10-25)

**Implemented**
- Real Google OAuth through Supabase Auth (PKCE): `/login` → Google → Supabase → `/auth/callback` (code exchange,
  verified user, login audit), POST-only `/auth/signout`, auth error page, open-redirect-safe `next` handling.
- Complete migration-managed schema (9 migrations): identity, roles, companies, memberships, access requests,
  invitations, deals, submissions + workflow transition table, documents, processing jobs, financial data, quality,
  red flags, EBITDA adjustments, findings, clarifications, valuation, reports, notifications, append-only audit log.
- Authorization: helper predicates in a non-exposed `private` schema, RLS on every table, no direct writes for client
  roles, SECURITY DEFINER operations with identity/role/scope/state checks and audit logging.
- Account approval workflow (pending → active/rejected), suspension, role grant/revoke with self-escalation blocks,
  hashed time-limited invitations bound to the invited email.
- Secure superadmin bootstrap (`SUPERADMIN_BOOTSTRAP_EMAIL` + service-role-only DB function re-checking `auth.users`).
- Access-request and invitation-acceptance pages.
- Private storage buckets with path-bound object policies.

**Tests**
- `tests/integration/auth-authorization.test.ts` — 16 tests against the local Supabase stack with real JWTs:
  pending users blocked, approval/rejection, no self-grant (RPC and direct table writes), service-role-only bootstrap,
  identity mismatch, superadmin self-change blocked, analyst cannot administer, suspended users blocked, invitation
  email binding/expiry/single use, audit append-only. ✅ 16/16
- `tests/unit/auth-utils.test.ts` — redirect safety, role routing, safe error mapping. ✅ 13/13

**Known limitations**
- The Google consent screen itself is verified by a documented manual test (`docs/authentication.md` §4); it cannot be
  automated reliably.
- Email/password sign-in is enabled only on the local stack for test fixtures; it must be disabled on hosted projects.

**External configuration still required**: Google OAuth client ID/secret; hosted Supabase project; bootstrap email.

---

## Phase 3 — Database and company management (2026-10-25)

**Implemented**
- Superadmin workspace: platform overview, access-request queue (approve into a company / reject, self-review blocked),
  users & roles (search, status filter, pagination, suspend/reactivate with reason, grant/revoke roles), companies
  (create/edit, members, membership suspension, one-time invitation links), submission monitoring with analyst
  assignment/archiving/retry, processing-job monitor, audit-log viewer with filters, platform settings (no secrets).
- Company workspace: dashboard (counts scoped by RLS, recent activity), submissions list with search/filter/sort/pagination.
- Notification centre (read/unread, mark read) and profile page.
- Shared: server-action form wrapper with toasts, URL pagination, TanStack data table, assignment form, audit table.
- Submission state machine mirror (`lib/submissions/workflow.ts`) verified against the database transition table.
- `supabase/seed.sql`: three synthetic companies + deal projects (no users or grants).
- Section layout guard for `/admin` (defense in depth).

**Tests**
- `tests/integration/company-isolation.test.ts` (9): A cannot list/fetch/create/attach for B; analysts cannot see drafts;
  superadmin metadata access; claim of draft refused; browser cannot publish (and the attempt is audited);
  TS/DB transition tables identical. ✅
- `tests/unit/workflow.test.ts` (6). ✅ Full suite: 44/44 ✅. `next build` ✅. `eslint` ✅.
- `scripts/smoke-pages.ts`: renders every admin/company page with real local sessions; unauthorised roles are redirected.

**Notes**
- Unauthorised page requests redirect via a streamed RSC redirect (HTTP 200 + redirect instruction) because of the
  route-group loading boundary; the protected page body is never rendered (only its static `<title>`).

---

## Phase 4 — Document upload and processing (2026-10-25)

**Implemented**
- Upload path: client uploader with per-file progress → `POST /api/submissions/[id]/documents` (session + role check,
  rate limit, size/extension/MIME/magic-byte validation, SHA-256) → `register_document` (server-generated, sanitised
  object path) → private Storage upload with the user's session → `finalize_document` (verifies the object exists).
  Failures roll back the object and row; stale `uploading` rows are swept by the worker.
- New Submission wizard (create draft → upload → submit) and company submission detail (overview + timeline,
  documents with versions/download/remove, client-visible data-quality issues).
- Signed, 60-second, audited document downloads created under the caller's session (storage RLS decides).
- Python worker (`processing/deallens_worker`): `SKIP LOCKED` job claiming, retries with exponential backoff for
  transient errors, crash recovery of stale jobs, idempotent re-extraction, extraction in a killable subprocess with a
  timeout, retention/orphan maintenance.
- Extraction engine: signature verification (zip-bomb and macro rejection), XLSX (cached values only, formulas never
  evaluated; hidden sheets skipped and reported), XLS, CSV (dialect sniffing), text-based PDF (tables + text lines,
  page references); scanned PDFs rejected with `SCANNED_PDF_UNSUPPORTED`. Layout detection of period headers
  (FY/years/A-F-B suffixes/quarters/months/dates, fiscal-year-end aware), label column, headings, subtotals, currency
  and unit indicators. Source references: sheet!cell, CSV row/column, PDF page/table/row/column.
- Normalisation: deterministic, statement-aware label rules with confidence; `needs_review` below 0.85 or when
  ambiguous; unit scaling; expense sign normalisation; currency mismatches never converted. Raw labels/values preserved.
- Analysis core (also used in Phase 5/6): value selection with conflict detection, metrics, reconciliations,
  data-quality checks and red-flag rules with thresholds in `processing/config/thresholds.json`.
- Synthetic data generator with a three-statement model and documented deliberate issues (`samples/README.md`).
- Security headers (nosniff, frame deny, referrer policy, permissions policy).

**Tests**
- Python: 94 tests (parsers, rules, normalisation, end-to-end sample known answers, scanned/mismatch rejection,
  subprocess error propagation). ✅
- `tests/integration/processing.test.ts` (14): real upload → real worker → persisted results; checksum/path;
  status only after persistence; raw vs normalised values with cell references; metric provenance; reconciliations;
  signed URL for owner; **other company and superadmin cannot read the object by guessing the path**; anon blocked;
  no uploads after submission; client-visible DQ only; scanned PDF failure + notification + retry; duplicate checksum;
  idempotent re-processing. ✅ Unit: file signatures. ✅ Total TS: 62/62.

**Known limitations**: in-memory rate limiting is per instance; OCR is out of scope.

---

## Phase 5 — Financial data review (2026-10-25)

**Implemented**
- Analyst workspace: dashboard (unassigned, mine, in analysis, clarifications, under review, reports awaiting approval,
  completed), work queue (unassigned / mine / all for reviewers; priority sort by open critical/high issues then age;
  race-safe claim; reviewer assignment).
- Submission workspace shell with section tabs and read-only mode outside the analyst's write scope.
- Financial data review: line items with raw value, normalised value, category, mapping status, confidence, source
  reference and extraction method; views by statement and "needs review"; search/sort/pagination/column visibility;
  correction modal (category, decision, normalised value, mandatory reason) and per-item revision history; bulk
  confirmation of proposed mappings; recalculation trigger.
- Data-quality review: reconciliation table (reconciled / variance / not tested with reasons), issue list with
  status changes and notes (notes mandatory when resolving/dismissing), client-visible vs internal badges.
- Submission audit trail; category taxonomy mirrored in TypeScript with a sync test against the Python source.

**Tests**: `tests/integration/data-review.test.ts` (6): concurrent claims → exactly one succeeds; out-of-scope analysts
lose visibility; corrections need reasons, keep raw values and write revisions; company users/out-of-scope analysts
cannot correct or read revisions; recalculation creates v2, keeps v1 and auto-resolves issues no longer detected;
DQ resolution rules + audit. ✅ Full TS suite 69/69 ✅; smoke test over all analyst pages ✅.

---

## Phase 6 — Financial analytics (2026-10-25)

**Implemented**
- Analysis Studio with tabs: Overview (KPI cards incl. Adjusted EBITDA, revenue, margins, red-flag severity, cash flow),
  Revenue & growth (CAGR, plan variance, concentration), Profitability (waterfall, EBITDA, margin comparison,
  reported vs calculated EBITDA), EBITDA adjustments (bridge + register with propose/review), Working capital,
  Debt & leverage, Cash flow.
- Provenance-aware metric tables: every value opens its formula, inputs, basis and source line items with references.
- Red-flag review page (rule, observed vs comparison, threshold + rationale, follow-up, review with explanation).
- Company "Preliminary analytics" tab, clearly labelled as automated and unreviewed.
- Charts (Recharts): single value axis each (no dual axes), reference categorical palette in fixed order validated with
  the palette checker (all checks pass; low-contrast slots relieved by a data-table view on every chart), HTML legends in
  series order, tooltips, null values shown as gaps, zero baselines.
- `lib/financial/ebitda.ts` bridge; metric display definitions; percentage-point formatting for margin changes.
- `docs/financial-methodology.md`.

**Bug found by tests**: the analysis job crashed when EBITDA adjustments existed (Decimal ÷ float); fixed with a
regression test.

**Tests**: Python 112 (17 financial edge cases: zero revenue, negative EBITDA, missing/non-comparable periods,
zero COGS, negative working capital, missing AR, partial/missing debt, rounding tolerance, untested reconciliation,
mixed currencies, conflicting values, analyst precedence, adjustment flag). TS 79 incl. `tests/unit/ebitda.test.ts`
and `tests/integration/analytics.test.ts` (four-eyes adjustments, internal-only flags/adjustments, flag review notes,
review status persists across re-analysis). ✅ Visual check of rendered charts with real sessions.

---

## Phase 7 — Valuation (2026-10-25)

**Implemented**
- `lib/valuation`: comparable-company engine (EV/EBITDA, EV/Revenue, validity rules with visible exclusion reasons,
  mean/median/quartiles, P25/median/P75 scenarios, justified override, equity bridge) and DCF engine (per-year
  assumptions, UFCF, end/mid-year discounting, Gordon terminal value with WACC > g, TV share, scenarios, 5×5
  sensitivity grid with invalid cells, validation and warnings).
- Valuation studio: interactive DCF and comparables builders with live preview, inputs pre-filled from the latest
  analysis with stated provenance; saved model versions with server-side recomputation, reproducibility check,
  submit-for-review and reviewer approval (not the author); valuation-range ("football field") chart.
- Methodology section 10.

**Tests**: `tests/unit/valuation.test.ts` (15, incl. a hand-computed DCF: EV = 1,421.875) and
`tests/integration/valuation.test.ts` (4: versioning, reproducibility from stored inputs, scope/visibility, four-eyes
approval). Full TS suite 98/98 ✅. Visual check of the DCF page ✅.

---

## Phase 8 — Findings and collaboration (2026-10-25)

**Implemented**
- Findings register (ID, category, title, severity, quantified impact, sources, status, visibility, owner, updated) with
  create/edit, review workflow (draft → in review → approved → closed; author cannot self-approve unless a reviewer),
  edits to approved findings reset them to draft, threaded comments with internal / client-visible visibility, and
  prompts for escalated red flags.
- Clarification centre for analysts (request with optional document list, resolve/cancel) and a company tab to respond
  and attach supporting documents; the submission moves to `clarification_required` and back to `in_analysis` when the
  last request closes; attachments are queued for extraction on resolution.
- Notifications for clarification requested/answered, assignment, processing, reports — all scoped by company/role.

**Tests**: `tests/integration/collaboration.test.ts` (9): sequential reference codes; nothing visible to the company
before approval; self-approval blocked; company sees only approved client-visible findings and client-visible comments
on them (internal comments and internal findings never); edit resets approval; company cannot write findings;
clarification state transitions; cross-company notifications and responses blocked; attachment upload during
clarification; resolution queues reprocessing. ✅

---

## Phase 9 — Reports (2026-10-25)

**Implemented**
- Migration `…1000_report_snapshots`: reports store an immutable content **snapshot** captured at draft render; the
  reviewed snapshot cannot change; approval queues a **final render of the same snapshot** with approval metadata;
  publication requires the final render; published/superseded reports are immutable (trigger).
- Worker `reporting/`: snapshot builder that queries only client-safe sources (approved client-visible findings,
  approved adjustments and valuations, client-visible DQ issues, metrics, reconciliations) and a ReportLab renderer
  (cover with version/generation/approval metadata, confidentiality notice, executive summary, scope & methodology,
  overview, data quality, revenue and EBITDA charts, metric tables with unavailable reasons, EBITDA bridge, findings,
  valuation, limitations, definitions appendix, page numbers, draft watermark, synthetic-data labelling, generic PDF
  metadata). Neutral filenames; renders discarded if the report state changes mid-render.
- Report builder (sections, executive summary, limitations), regenerate, snapshot preview, PDF download, submit,
  reviewer approve / request changes (not the author), publish (reviewer or assigned analyst, only after final render),
  reopen for a new version. Company report tab and Published Reports page; signed, audited downloads.

**Tests**: Python `test_report_pdf.py` (5). `tests/integration/reports.test.ts` (8): draft render from snapshot with
**internal finding text, internal comments, model comments and review notes absent from the snapshot and the extracted
PDF text**; company cannot see/download unpublished reports; analyst/self approval blocked; publish before approval
blocked; final render keeps the snapshot and carries approval metadata; unassigned analyst cannot publish; company
download works, other company cannot even with ID and path; immutability; v2 supersedes v1. ✅

---

## Phase 10 — Hardening and deployment readiness (2026-10-25)

**Implemented**
- Content Security Policy, HSTS (production), frame denial, nosniff, referrer and permissions policies; server-action
  body limit.
- Playwright end-to-end suite covering the 18-step critical journey with the real worker (Google consent stubbed at
  the authorize request, which is asserted; see testing.md for the manual part) plus direct route-handler probes.
- **Bug found by E2E**: server components passed render-prop children to a client form, crashing the findings,
  clarification, valuation-review and report pages once data existed. Fixed with a `FormSubmit` button that reads
  `useFormStatus`, so server components pass plain children.
- Consolidated agreeing duplicate values into one informational issue (a workbook + PDF of the same statement produced
  33 separate notices).
- `scripts/seed-demo.ts`: local-only synthetic demo through the real pipeline; removes its temporary superadmin.
- Worker Dockerfile (non-root), GitHub Actions CI (lint, type-check, unit, build, Python, integration + E2E against a
  local Supabase stack in CI).
- Documentation: README, architecture, deployment, testing, troubleshooting (plus earlier auth, authorization,
  database, methodology guides).

## Final verification (local, 2026-10-25)

| Check | Result |
|---|---|
| `eslint .` | ✅ 0 errors |
| `tsc --noEmit` | ✅ |
| `next build` | ✅ |
| TypeScript unit tests | ✅ 43/43 |
| Python tests | ✅ 117/117 |
| Integration tests (local Supabase, real worker) | ✅ 72/72 |
| Playwright E2E (critical journey) | ✅ 12/12, two consecutive runs |
| Page smoke test (all roles) | ✅ |
| GitHub Actions CI (all jobs) | ✅ |

**Not verified**: real Google consent and hosted deployment (no Google OAuth client or hosted Supabase/Vercel
credentials were available in this environment).

**GitHub Actions**: first CI run on `main` passed all three jobs — web (lint, type-check, unit, build), worker tests, and integration + Playwright E2E against a fresh local Supabase stack in CI.
