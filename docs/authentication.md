# Authentication guide

DealLens uses **Supabase Auth with Google OAuth** (authorization-code flow with PKCE). DealLens never receives
or stores Google passwords. Sessions are held in HTTP-only cookies managed by `@supabase/ssr`; the server
verifies the user on every request with `supabase.auth.getUser()`, which validates the session with the
Supabase Auth server instead of trusting the cookie contents.

## Flow

1. The visitor opens `/login` and selects **Continue with Google**.
2. `supabase.auth.signInWithOAuth({ provider: "google" })` redirects to Google's consent screen.
3. Google redirects to Supabase (`https://<project-ref>.supabase.co/auth/v1/callback`), which validates the response.
4. Supabase redirects to DealLens `/auth/callback?code=…`.
5. `app/auth/callback/route.ts` exchanges the code for a session, re-reads the verified user, applies the
   superadmin bootstrap (if configured), records the login and routes by account status.
6. A database trigger on `auth.users` creates a `profiles` row with status `pending_approval`.
   Signing in grants **no** access to business data until an administrator approves an access request
   (or the user accepts an invitation).

## 1. Create the Google OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) → select or create a project.
2. **APIs & Services → OAuth consent screen**: choose *External*, set the app name ("DealLens"), support
   email and authorised domain (your production domain). Add the scopes `openid`, `email`, `profile`.
   While the app is in *Testing* status, add the Google accounts that may sign in as test users.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → *Web application*.
4. **Authorised JavaScript origins**: `http://localhost:3000` and your production origin, e.g. `https://deallens.example.com`.
5. **Authorised redirect URIs** — these point at **Supabase**, not at DealLens:
   - Hosted project: `https://<project-ref>.supabase.co/auth/v1/callback`
   - Local Supabase stack: `http://127.0.0.1:54321/auth/v1/callback`
6. Copy the **Client ID** and **Client secret**. Do not commit them.

## 2. Configure Supabase

### Hosted project
1. Supabase Dashboard → **Authentication → Sign In / Providers → Google** → enable, paste the Client ID and secret.
2. **Authentication → URL Configuration**:
   - *Site URL*: your production URL (e.g. `https://deallens.example.com`).
   - *Redirect URLs*: `https://deallens.example.com/auth/callback`, and `http://localhost:3000/auth/callback` if you
     develop against the hosted project.
3. **Disable the Email provider** (Authentication → Providers → Email) in production. DealLens offers Google only;
   email/password is enabled solely on the local stack so automated tests can obtain real JWTs.

### Local stack
Copy `supabase/.env.example` to `supabase/.env` and set:
```
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=...
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=...
```
Then restart: `npm run db:stop && npm run db:start`. `supabase/config.toml` already enables the Google provider
with these env-substituted values and allows `http://localhost:3000/auth/callback` as a redirect.

## 3. Configure the first superadmin

The first superadmin is provisioned by a trusted server-side check, never by a client request:

1. Set `SUPERADMIN_BOOTSTRAP_EMAIL=<your Google email>` and `SUPABASE_SERVICE_ROLE_KEY` in the server
   environment (`.env.local` locally; hosting provider secrets in production).
2. Sign in with that Google account. In `/auth/callback` the server:
   - verifies the session with Supabase Auth,
   - requires the verified email to equal `SUPERADMIN_BOOTSTRAP_EMAIL` and be confirmed by the provider,
   - calls `public.bootstrap_superadmin(user_id, expected_email)` with the service-role client. That function is
     **executable only by `service_role`** and re-checks the email and confirmation against `auth.users`,
   - activates the profile, grants `superadmin`, and writes `admin.superadmin_bootstrapped` to the audit log.
3. The operation is idempotent; subsequent logins do nothing.

### Rotating the bootstrap configuration
- After the first superadmin exists, **remove `SUPERADMIN_BOOTSTRAP_EMAIL`** (or leave it blank) and redeploy.
  Further superadmins are granted from **Admin → Users & roles** by an existing superadmin (self-grants are blocked).
- To hand over: grant `superadmin` to the new administrator from the UI, have them sign in, then revoke the old
  administrator's role from the new account (superadmins cannot revoke their own role, which prevents lock-out).
- If the bootstrap email's Google account is compromised, remove the variable immediately, suspend the account
  from another superadmin account, and review `audit_logs` for `admin.*` and `role.*` actions.

## 4. Test sign-in and sign-out (manual integration test)

Google's consent screen cannot be automated reliably, so this is a documented **manual** test:

1. `npm run dev`, open `http://localhost:3000/login`, choose **Continue with Google**.
2. Expect redirection to Google, then back to `/access-request` (new user) or your role home page.
3. In Supabase Studio or SQL: `select account_status from profiles where email = '<you>'` → `pending_approval`
   (or `active` for the bootstrap admin).
4. Click **Sign out** → you land on `/login`; visiting `/dashboard` redirects back to `/login`.
5. Sign in again → `profiles.last_login_at` updates and an `auth.login` audit entry is written.

Session and authorization behaviour is tested automatically in `tests/integration/auth-authorization.test.ts`
using real Supabase JWTs for test users on the local stack.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `redirect_uri_mismatch` from Google | The redirect URI in Google Cloud must be the **Supabase** callback (`…/auth/v1/callback`), exactly. |
| Back on `/auth/error?reason=exchange` | The code was already used or expired (refresh/back button). Sign in again. Also check that the site uses the same origin (`localhost` vs `127.0.0.1`) the flow started on, because the PKCE verifier cookie is origin-scoped. |
| Redirected to the Supabase Site URL instead of DealLens | `/auth/callback` for your origin is missing from *Redirect URLs*. |
| "Unsupported provider: provider is not enabled" | Enable Google in Supabase (hosted) or set `supabase/.env` and restart (local). |
| Bootstrap did not grant superadmin | Email mismatch (check case/whitespace), `SUPABASE_SERVICE_ROLE_KEY` missing on the server, or the Google email is unverified. The server logs `superadmin bootstrap failed` with an error code only. |
| Signed in but stuck on "awaiting review" | Expected: an administrator must approve the access request. |
