/**
 * Local visual check: sets up a processed, claimed synthetic submission and screenshots pages with a
 * real analyst/company session. Usage: BASE=http://localhost:3100 npm run screenshot -- <sample.xlsx> <paths…>
 * Paths may contain {sub}. Output: test-results/screens/*.png
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { analyst, cleanup, companyUser, createCompany, drainWorker, makeSuperadmin, newSubmission, sampleFile, XLSX } from "../tests/integration/helpers";
import { sessionCookies } from "../tests/support/session-cookies";
import { uploadDocument } from "../lib/storage/documents";

const BASE = process.env.BASE ?? "http://localhost:3100";
(async () => {
  const [sample = "meridian-financial-statements.xlsx", ...paths] = process.argv.slice(2);
  const admin = await makeSuperadmin();
  const company = await createCompany(admin, "Screens Co");
  const user = await companyUser(admin, company, "screens");
  const fin = await analyst(admin, "screensanalyst");
  const sub = await newSubmission(user, company, "FY2022–FY2024 statements");
  const up = await uploadDocument(user.client, sub, sampleFile(sample, sample.endsWith(".csv") ? "text/csv" : XLSX), "income_statement", 25 * 1024 * 1024, null);
  if (!up.ok) throw new Error(up.error);
  await user.client.rpc("submit_submission", { p_submission: sub });
  drainWorker();
  await fin.client.rpc("claim_submission", { p_submission: sub });
  const browser = await chromium.launch();
  mkdirSync("test-results/screens", { recursive: true });
  for (const [who, u] of [["analyst", fin], ["company", user]] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const host = new URL(BASE).hostname;
    await ctx.addCookies((await sessionCookies(u.email, u.password)).map((c) => ({ ...c, domain: host, path: "/" })));
    const page = await ctx.newPage();
    for (const p of paths.filter((x) => x.startsWith(who + ":"))) {
      const target = p.slice(who.length + 1).replace("{sub}", sub);
      await page.goto(BASE + target, { waitUntil: "load" }); await page.waitForTimeout(1200);
      const name = `${who}-${target.replace(/[^a-z0-9]+/gi, "-").replace(sub, "sub").slice(0, 80)}.png`;
      await page.screenshot({ path: `test-results/screens/${name}`, fullPage: true });
      console.log("saved", name);
    }
    await ctx.close();
  }
  await browser.close();
  await cleanup();
})();
