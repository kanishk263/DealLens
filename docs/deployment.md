# Deployment guide

Target topology (simplest architecture that meets the requirements):

| Piece | Recommended host | Notes |
|---|---|---|
| Next.js app | Vercel (or any Node 20.9+ host) | Node runtime (not Edge) for upload/download routes |
| Database, Auth, Storage | Supabase (hosted project) | Enable Point-in-Time Recovery for production |
| Processing worker | Render / Railway / Fly.io background worker (Docker) | No public port; needs outbound access to Postgres and Supabase Storage |

Nothing here has been deployed by the author of this repository yet; the steps below are the procedure to follow once
accounts and credentials exist.

## 1. Supabase project

1. Create a project; note the **Project URL**, **anon key**, **service-role key** and the **database connection string**
   (Settings → Database; use the *session* pooler or direct connection for the worker — it holds row locks).
2. Link and push migrations from your machine:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
   This creates the schema, RLS policies, functions and the private `documents`/`reports` buckets.
3. (Optional) Load synthetic companies: run `supabase/seed.sql` in the SQL editor. It creates no users or grants.
4. Authentication:
   - Providers → **Google**: enable, paste client ID/secret (see [authentication.md](authentication.md)).
   - Providers → **Email**: **disable** (DealLens is Google-only in production).
   - URL configuration: Site URL `https://<your-domain>`; Redirect URLs `https://<your-domain>/auth/callback`.
5. Storage: confirm both buckets are **private** (Storage → Buckets). Do not create public buckets.

## 2. Next.js on Vercel

1. Import the GitHub repository; framework preset **Next.js**; Node.js version **22**.
2. Environment variables (Production and Preview):

| Variable | Required | Value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | for bootstrap | service-role key (**server only**, never `NEXT_PUBLIC_`) |
| `SUPERADMIN_BOOTSTRAP_EMAIL` | first deploy only | your verified Google email; remove after bootstrap |
| `APP_BASE_URL` | yes | `https://<your-domain>` (used for invitation links) |

3. Deploy. Add your custom domain (Vercel → Domains) and update the Supabase Site URL / Redirect URLs and the Google
   OAuth *authorised JavaScript origins* to match.
4. Preview deployments get different URLs; either add a wildcard redirect (`https://*-<team>.vercel.app/auth/callback`) in
   Supabase or test OAuth only on the production domain.

## 3. Worker

`processing/Dockerfile` builds a small image running `python -m deallens_worker run`.

```bash
docker build -t deallens-worker processing
docker run --env-file processing/.env deallens-worker
```

On Render: *New → Background Worker → Docker*, root directory `processing`. Environment:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase Postgres connection string (session mode / direct, with SSL) |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key |
| `WORKER_ID` | optional, e.g. `render-1` |
| `JOB_TIMEOUT_SECONDS` | optional (default 300) |

Multiple workers can run concurrently: jobs are claimed with `FOR UPDATE SKIP LOCKED` and are idempotent. Stale jobs
from a crashed worker are re-queued after `2 × JOB_TIMEOUT_SECONDS`.

## 4. First superadmin

1. Deploy with `SUPERADMIN_BOOTSTRAP_EMAIL` set.
2. Sign in with that Google account → you land in the admin workspace.
3. Remove the variable and redeploy. Grant further roles from Admin → Users & roles.

## 5. Production smoke tests (manual)

1. `https://<domain>/` loads; response headers include `Content-Security-Policy` and `Strict-Transport-Security`.
2. Sign in with Google → bootstrap admin lands on `/admin`.
3. A second Google account signs in → `/access-request` → submit; admin approves into a synthetic company.
4. Upload `samples/northstar-financial-statements.xlsx` → status moves to *Awaiting review* within a minute (worker running).
5. A finance account claims it, creates a finding and report draft; a reviewer approves and publishes; the company user
   downloads the PDF.
6. Confirm a user from another company receives 404 for that report URL.
7. Admin → Processing jobs shows no failures; Admin → Audit log shows the actions above.

## 6. Rollback

- **App**: Vercel → Deployments → *Promote* a previous deployment (instant).
- **Worker**: redeploy the previous image tag.
- **Database**: migrations are forward-only. Write a new corrective migration rather than editing applied ones. For a
  destructive mistake use Point-in-Time Recovery into a new project, verify, then switch the app's environment variables.
- Storage objects are not covered by database PITR; keep bucket backups (see database.md).

## 7. Operational notes

- Logs: Vercel function logs (server errors are logged with codes only, never document contents); worker stdout.
- Error monitoring hook: wire `console.error` / Python `logging` to Sentry or similar (not configured by default).
- The in-memory rate limiter is per instance; for multi-region production back it with a shared store.
