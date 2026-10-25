/**
 * Local smoke test: signs in real test users and requests every page, failing on server errors
 * or "Could not load" states. Usage: (app running on BASE) npx tsx scripts/smoke-pages.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { analyst, cleanup, companyUser, createCompany, makeSuperadmin } from "../tests/integration/helpers";
import { cookieHeader, sessionCookies } from "../tests/support/session-cookies";

const BASE = process.env.BASE ?? "http://localhost:3100";
const extra = (process.env.SMOKE_PATHS ?? "").split(",").filter(Boolean);

async function check(label: string, email: string, password: string, paths: string[]) {
  const cookie = cookieHeader(await sessionCookies(email, password));
  let failures = 0;
  for (const p of paths) {
    const res = await fetch(BASE + p, { headers: { cookie }, redirect: "manual" });
    const body = res.status === 200 ? await res.text() : "";
    const streamedRedirect = /NEXT_REDIRECT;[a-z]+;([^;"]+)/.exec(body)?.[1];
    const bad = res.status >= 500 || (!streamedRedirect && /Could not load|Unable to load|Application error/.test(body));
    if (bad) failures++;
    const target = res.status >= 300 && res.status < 400 ? res.headers.get("location") : streamedRedirect;
    console.log(`${bad ? "FAIL" : "ok  "} ${label.padEnd(8)} ${res.status} ${p}${target ? " -> " + target : ""}`);
  }
  return failures;
}

(async () => {
  const admin = await makeSuperadmin();
  const company = await createCompany(admin, "Smoke Co");
  const user = await companyUser(admin, company, "smoke");
  const fin = await analyst(admin, "smokeanalyst");
  let f = 0;
  f += await check("admin", admin.email, admin.password, ["/admin", "/admin/access-requests", "/admin/users", "/admin/companies", `/admin/companies/${company}`, "/admin/submissions", "/admin/jobs", "/admin/audit", "/admin/settings", "/notifications", "/settings"]);
  f += await check("company", user.email, user.password, ["/dashboard", "/submissions", "/notifications", "/settings", "/admin", ...extra]);
  f += await check("analyst", fin.email, fin.password, ["/dashboard", "/admin/users"]);
  await cleanup();
  if (f) { console.error(`${f} page(s) failed`); process.exit(1); }
})();
