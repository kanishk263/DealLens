# Authorization model

DealLens enforces access in three layers. The lower layers never trust the upper ones.

| Layer | Purpose | Trusted for security? |
|---|---|---|
| Navigation & middleware | Hide links, redirect anonymous visitors | **No** — usability only |
| Server components / actions (`lib/auth/session.ts`) | Verify session with Supabase Auth, check account status and role before rendering or acting | Yes, but backed by the DB |
| PostgreSQL (RLS + SECURITY DEFINER functions) | Final authority for every read and write | **Yes** |

## Roles

| Role key | Who | Notes |
|---|---|---|
| `superadmin` | Platform operators | Users, companies, access requests, assignments, jobs, audit. **No implicit access to financial content** (line items, metrics, document files, findings). |
| `company_user` | Client organisation staff | Scoped to active company memberships. |
| `finance_analyst` | Finance team | Sees the unassigned queue (`awaiting_review`, `processing_failed`) and submissions assigned to them. |
| `finance_reviewer` | Senior finance team | Sees all non-draft submissions; approves/publishes reports authored by **someone else** (four-eyes, configurable). |

The prompt specifies three principal roles; `finance_reviewer` is an additional role on top of `finance_analyst` that
implements "approve and publish when authorised" as an explicit, auditable permission rather than an informal convention.

## Every protected request checks

1. **Valid session** — `auth.uid()` from a JWT validated by Supabase.
2. **Account active** — `private.is_active()`; `pending_approval`, `suspended`, `rejected` get nothing.
3. **Role** — `private.has_role()` over non-revoked `user_roles`.
4. **Resource scope** — `private.is_company_member()`, `private.is_internal_in_scope()`, `private.can_view_content()`,
   `private.can_work_submission()`.
5. **Workflow state** — mutation functions check status (e.g. documents can only be added in `draft`,
   `processing_failed` or `clarification_required`) and transitions are validated against `submission_transitions`.

## Reads: Row Level Security

RLS is enabled on every table in `public`. `anon` has no privileges at all; `authenticated` has `SELECT` only and
each table has an explicit policy (see `supabase/migrations/20261025000500_authorization_rls.sql`). Highlights:

- Company users see only their companies' submissions; **client-visible** data-quality issues; findings that are
  `client_visible` **and** `approved`/`closed`; comments that are client-visible on such findings; reports only once
  `published` (or `superseded`).
- Red flags, EBITDA adjustments, valuation models, line-item revision history and internal comments are finance-team only.
- Audit logs: superadmins, plus finance team for submissions in scope.

## Writes: SECURITY DEFINER functions

`authenticated` has **no** `INSERT/UPDATE/DELETE` privileges on any table. All mutations are database functions
(`supabase/migrations/2026102500060*`–`0800`) that re-check 1–5 above, run in a single transaction, write
`audit_logs`, and create notifications. Errors use SQLSTATE `42501` (forbidden), `22023` (invalid input),
`P0002` (not found) and `55000` (invalid state); `lib/errors.ts` maps only these to user-visible messages.

Important protections:
- **No self-escalation**: `grant_role`/`revoke_role`/`set_account_status` require `superadmin` and refuse `p_user = auth.uid()`.
  Self-service access requests may only ask for `company_user` or `finance_analyst`.
- **Bootstrap**: `bootstrap_superadmin` is executable only by `service_role` (see `docs/authentication.md`).
- **Race-safe claiming**: `claim_submission` locks the submission row (`FOR UPDATE`); a partial unique index allows one
  active assignment per submission.
- **Publication**: only `publish_report` can set `published`, it requires an `approved` report whose final PDF exists,
  and the actor must be a reviewer or the assigned analyst. `transition_submission` refuses `published`, `reviewed`,
  `under_review` and system-only states, and logs rejected attempts.
- **Four-eyes**: report and valuation approval require a different person from the author; EBITDA adjustments must be
  reviewed by someone other than the proposer.

## Storage

Buckets `documents` and `reports` are private. Object names are generated server-side as
`<company>/<submission>/<entity>/<sanitised-name>`. Storage policies resolve access by joining to the metadata row
that owns the **exact** object name, so guessing a path grants nothing. Downloads use short-lived signed URLs created
with the caller's own session (so the storage policy applies) and are audited via `log_download`.

## Testing

`tests/integration/*.test.ts` sign in real test users against the local stack and call the API directly
(no UI), proving isolation and escalation rules. Run with `npm run test:integration`.
