# DealLens implementation log

Each phase ends with checks, a commit, and an entry here. Tracking issues: one GitHub issue per phase.

| Phase | Issue | Status |
|---|---|---|
| 1. Repository and foundation | #1 | Done |
| 2. Authentication and authorization | #10 | Done |
| 3. Database and company management | #2 | Done |
| 4. Document upload and processing | #3 | In progress |
| 5. Financial data review | #4 | Pending |
| 6. Financial analytics | #5 | Pending |
| 7. Valuation | #6 | Pending |
| 8. Findings and collaboration | #7 | Pending |
| 9. Reports | #8 | Pending |
| 10. Hardening and deployment | #9 | Pending |

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
