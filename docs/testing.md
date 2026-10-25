# Testing guide

| Suite | Command | Needs | What it covers |
|---|---|---|---|
| TypeScript unit | `npm test` | nothing | redirects, error mapping, workflow mirror, file signatures, EBITDA bridge, valuation engine (hand-computed cases), taxonomy sync |
| Python | `npm run test:python` | `processing/.venv` | value/period parsing, mapping rules, normalisation, end-to-end sample known answers, financial edge cases, report PDF rendering, subprocess error propagation |
| Integration | `npm run test:integration` | local Supabase (`npm run db:start`) + worker venv | RLS and authorization with real JWTs, upload → worker → persisted results, storage path guessing, workflow, collaboration, valuation, report lifecycle |
| End-to-end | `npm run build && npm run test:e2e` | as above + Playwright Chromium (`npx playwright install chromium`) | the critical user journey in a real browser |
| Smoke | `npm run smoke` (app on :3100) | as above | every page renders for each role with real sessions |

All integration and E2E tests refuse to run unless `NEXT_PUBLIC_SUPABASE_URL` points to `localhost`/`127.0.0.1`
(`tests/integration/setup-env.ts`). They create users with random, unprinted passwords through the Auth admin API and
delete everything they created afterwards. **Never run them against production.**

## Test identities

Password sign-in exists only on the local stack so tests can obtain genuine Supabase JWTs. Users get roles exclusively
through the real database functions (`submit_access_request` → `review_access_request`, `grant_role`, the
service-role-only `bootstrap_superadmin`), so fixtures exercise the same authorization paths as the UI. Browser tests
receive the exact cookies `@supabase/ssr` sets after a sign-in (`tests/support/session-cookies.ts`); the server still
verifies every request with Supabase Auth.

## What is automated vs manual

| Journey step | Status |
|---|---|
| Visitor opens app; protected routes redirect to sign-in | Automated (E2E) |
| "Continue with Google" initiates OAuth with PKCE to Supabase's Google provider | Automated: the authorize request is intercepted and its parameters asserted (`provider=google`, `redirect_to=/auth/callback`, `code_challenge`) |
| Google consent screen and real callback code exchange | **Manual** — see authentication.md §4. Not automatable reliably against Google. |
| Access request → superadmin approval → company membership | Automated (E2E + integration) |
| Upload → worker → processing result | Automated with the real Python worker |
| Claim, data review, DQ resolution, finding, valuation | Automated (E2E) |
| Draft report, review, approval, final render, publication | Automated (E2E + integration, including PDF text inspection) |
| Company download; other company denied | Automated (E2E + integration) |
| Direct API calls without UI rejected | Automated (E2E route handlers; integration PostgREST/RPC/Storage) |

## Security assertions (data isolation)

| Requirement | Test |
|---|---|
| Company A cannot access Company B's submissions | `company-isolation.test.ts`, `processing.test.ts` |
| Company user cannot access internal analyst comments | `collaboration.test.ts`, `reports.test.ts` |
| Unapproved user cannot access protected records | `auth-authorization.test.ts` |
| Suspended user cannot perform protected actions | `auth-authorization.test.ts` |
| Normal user cannot grant themselves a role | `auth-authorization.test.ts` (RPC and direct table writes) |
| Analyst cannot publish without authorisation | `reports.test.ts` (unassigned analyst, unapproved report, self-approval) |
| Document not accessible by guessing its storage path | `processing.test.ts` (other company, superadmin, anon) |
| Other company's reports not accessible by changing an ID | `reports.test.ts`, E2E step 18 |
| Unauthorised API requests fail without the UI | all integration suites call the API directly; E2E "direct API requests" |

## Financial accuracy cases

Known-answer tests use `samples/manifest.json` (the generating model) and hand calculations:

| Case | Expected |
|---|---|
| Northstar revenue, EBITDA, FCF, net debt for each year | equal to the model values |
| DSO FY2024 | (AR₂₀₂₃ + AR₂₀₂₄)/2 ÷ revenue × 366 |
| Meridian FY2024 balance sheet | variance of exactly 150 (deliberate) |
| Apex reported vs calculated EBITDA | reported = model − 1,100; flag raised |
| Zero revenue | margins and DSO unavailable with reason |
| Negative EBITDA | margin reported (−12%); leverage unavailable |
| Missing / non-comparable prior period | growth unavailable |
| Zero COGS | DIO, DPO, CCC unavailable; DSO calculated |
| Negative working capital | −150 reported, not hidden |
| Missing AR | DSO and trade working capital unavailable |
| Only one debt component / no debt | warning / unavailable |
| Rounding | 1,000.4 vs 1,000 reconciles; 1,010 vs 1,000 does not |
| Incomplete balance sheet | `not_tested`, never `reconciled` |
| Mixed currencies | critical issue; no conversion |
| Conflicting values | not averaged; conflict reported; analyst value wins |
| One-year DCF | UFCF 113.75, TV 1,450.3125, EV 1,421.875, equity 1,121.875 |
| WACC ≤ g | invalid; sensitivity cells marked invalid |
| Comparables 8/10/12/14x | median 11x, P25 9.5x, P75 12.5x, EV 1,100, equity 950 |
