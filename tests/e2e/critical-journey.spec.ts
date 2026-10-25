import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import {
  analyst, cleanup, companyUser, createCompany, createUser, drainWorker, makeSuperadmin, reviewer, type TestUser,
} from "../integration/helpers";
import { signIn } from "./fixtures";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SAMPLE = path.resolve(__dirname, "../../samples/meridian-financial-statements.xlsx");

let admin: TestUser, newUser: TestUser, fin: TestUser, rev: TestUser, outsider: TestUser;
let submissionUrl = "", submissionId = "", reportId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  admin = await makeSuperadmin();
  await createCompany(admin, "E2E Components");
  const otherCompany = await createCompany(admin, "E2E Other");
  outsider = await companyUser(admin, otherCompany, "e2eoutsider");
  newUser = await createUser("e2enew");
  fin = await analyst(admin, "e2eanalyst");
  rev = await reviewer(admin);
});
test.afterAll(cleanup);

async function confirmDialogs(page: Page) {
  page.on("dialog", (d) => d.accept());
}

test("1-2. unauthenticated visitor opens DealLens and initiates Google sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Financial clarity. Deal confidence." })).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  let authorizeUrl = "";
  await page.route("**/auth/v1/authorize**", async (route) => {
    authorizeUrl = route.request().url();
    await route.fulfill({ status: 200, contentType: "text/html", body: "<p>Google consent (stubbed in tests)</p>" });
  });
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Google consent (stubbed in tests)")).toBeVisible();
  const url = new URL(authorizeUrl);
  expect(url.searchParams.get("provider")).toBe("google");
  expect(url.searchParams.get("redirect_to")).toContain("/auth/callback");
  expect(url.searchParams.get("code_challenge")).toBeTruthy(); // PKCE
});

test("3. an authenticated new user requests access", async ({ page, context, baseURL }) => {
  await signIn(context, newUser, baseURL!);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/access-request/);
  await page.getByLabel("Organisation").fill("E2E Components");
  await page.getByLabel("Business justification").fill("I prepare the monthly financial statements for E2E Components.");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText("Your request is awaiting administrator review.")).toBeVisible();
});

test("4-5. a superadmin approves the request into the company", async ({ page, context, baseURL }) => {
  await signIn(context, admin, baseURL!);
  await page.goto("/admin/access-requests");
  const row = page.getByRole("row").filter({ hasText: newUser.email });
  await row.getByLabel("Company to join").selectOption({ label: "E2E Components" });
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Request approved.")).toBeVisible();
  await signIn(context, newUser, baseURL!);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Company dashboard" })).toBeVisible();
  await expect(page.getByText("E2E Components").first()).toBeVisible();
});

test("6-8. the company user uploads a statement and sees the processing result", async ({ page, context, baseURL }) => {
  await confirmDialogs(page);
  await signIn(context, newUser, baseURL!);
  await page.goto("/submissions/new");
  await page.getByLabel("Submission name").fill("FY2022–FY2024 statements");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText("Draft created. Now upload your documents.")).toBeVisible();
  await page.getByLabel("Choose files").setInputFiles(SAMPLE);
  await page.getByRole("button", { name: /Upload 1 file/ }).click();
  await expect(page.getByText("Uploaded", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit package" }).click();
  await page.waitForURL(/\/submissions\/[0-9a-f-]{36}$/);
  submissionUrl = page.url();
  submissionId = submissionUrl.split("/").pop()!;
  await expect(page.getByText("Uploaded").first()).toBeVisible();
  drainWorker();  // the real Python worker executes the queued jobs
  await page.reload();
  await expect(page.getByText("Awaiting review").first()).toBeVisible();
  await page.goto(`${submissionUrl}?tab=analytics`);
  await expect(page.getByText("Preliminary — not a due diligence conclusion")).toBeVisible();
  await page.goto(`${submissionUrl}?tab=quality`);
  await expect(page.getByText("Balance sheet does not balance (FY2024)")).toBeVisible();
});

test("9-11. an analyst claims, reviews data and documents a quality issue", async ({ page, context, baseURL }) => {
  await signIn(context, fin, baseURL!);
  await page.goto("/analyst/queue");
  await page.getByRole("row").filter({ hasText: "FY2022–FY2024 statements" }).getByRole("button", { name: "Claim" }).click();
  await expect(page.getByText("Submission claimed. It is now in analysis.")).toBeVisible();
  await page.goto(`/analyst/submissions/${submissionId}/data?view=all`);
  await expect(page.getByRole("cell", { name: "Cost of sales" }).first()).toBeVisible();
  await page.goto(`/analyst/submissions/${submissionId}/quality`);
  const issue = page.locator("div.rounded-lg").filter({ hasText: "Balance sheet does not balance (FY2024)" }).first();
  await issue.getByRole("button", { name: "Update" }).click();
  await page.getByLabel("Status").selectOption("acknowledged");
  await page.getByLabel("Resolution notes").fill("Total assets overstated by 150; confirmed with management.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Issue updated.")).toBeVisible();
});

test("12-13. the analyst creates a finding and a valuation", async ({ page, context, baseURL }) => {
  await signIn(context, fin, baseURL!);
  await page.goto(`/analyst/submissions/${submissionId}/findings`);
  await page.getByRole("button", { name: "New finding" }).click();
  await page.getByLabel("Title").fill("Working capital absorption");
  await page.getByLabel("Description").fill("Trade working capital increased faster than revenue in FY2023 and FY2024.");
  await page.getByLabel("Visibility").selectOption("client_visible");
  await page.getByRole("button", { name: "Create finding" }).click();
  await expect(page.getByText("Finding created.")).toBeVisible();
  await page.goto(`/analyst/submissions/${submissionId}/valuation?tab=dcf`);
  await expect(page.getByText("Enterprise value (base)")).toBeVisible();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByText("Model version saved.")).toBeVisible();
});

test("reviewer approves the finding and the valuation", async ({ page, context, baseURL }) => {
  await signIn(context, rev, baseURL!);
  await page.goto(`/analyst/submissions/${submissionId}/findings`);
  await page.getByRole("link", { name: "Working capital absorption" }).click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Finding marked approved.")).toBeVisible();
  await page.goto(`/analyst/submissions/${submissionId}/valuation?tab=models`);
  await page.getByLabel("Review notes").first().fill("Assumptions reasonable for illustration");
  await page.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.getByText("Model approved.")).toBeVisible();
});

test("14. the analyst generates a draft report and submits it for review", async ({ page, context, baseURL }) => {
  await signIn(context, fin, baseURL!);
  await page.goto(`/analyst/submissions/${submissionId}/reports`);
  await page.getByRole("button", { name: "New report draft" }).click();
  await page.getByRole("textbox", { name: "Executive summary" }).fill("Revenue grew strongly while margins and working capital deteriorated.");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText("Draft saved. The PDF is being generated.")).toBeVisible();
  drainWorker();
  await page.reload();
  await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
  const href = await page.getByRole("link", { name: "Download PDF" }).getAttribute("href");
  reportId = href!.split("/")[3];
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Submitted for review.")).toBeVisible();
});

test("15-16. a reviewer approves and publishes the report", async ({ page, context, baseURL }) => {
  await confirmDialogs(page);
  await signIn(context, rev, baseURL!);
  await page.goto(`/analyst/submissions/${submissionId}/reports`);
  await page.getByLabel("Review notes").fill("Approved for issue.");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved. The final PDF is being rendered.")).toBeVisible();
  drainWorker();
  await page.reload();
  await page.getByRole("button", { name: "Publish to company" }).click();
  await expect(page.getByText("Report published to the company.")).toBeVisible();
});

test("17. the company user downloads the published report", async ({ page, context, baseURL }) => {
  await signIn(context, newUser, baseURL!);
  await page.goto("/reports");
  await expect(page.getByRole("cell", { name: /Financial Due Diligence Report/ })).toBeVisible();
  const res = await page.request.get(`/api/reports/${reportId}/download`, { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  const pdf = await page.request.get(res.headers()["location"]);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("18. another company's user cannot access that report or submission", async ({ page, context, baseURL }) => {
  await signIn(context, outsider, baseURL!);
  const res = await page.request.get(`/api/reports/${reportId}/download`, { maxRedirects: 0 });
  expect(res.status()).toBe(404);
  await page.goto(`/submissions/${submissionId}?tab=reports`);
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
  await page.goto("/reports");
  await expect(page.getByText("No published reports yet")).toBeVisible();
});

test("direct API requests without the UI are rejected", async ({ request, page, context, baseURL }) => {
  const anon = await request.post(`/api/submissions/${submissionId}/documents`, { multipart: { category: "income_statement", file: { name: "x.csv", mimeType: "text/csv", buffer: Buffer.from("a,b") } } });
  expect(anon.status()).toBe(401);
  await signIn(context, outsider, baseURL!);
  const cross = await page.request.post(`/api/submissions/${submissionId}/documents`, { multipart: { category: "income_statement", file: { name: "x.csv", mimeType: "text/csv", buffer: Buffer.from("Line,FY2024\nRevenue,1\n") } } });
  expect([403, 404]).toContain(cross.status());
  const unauthDownload = await request.get(`/api/reports/${reportId}/download`, { maxRedirects: 0 });
  expect(unauthDownload.status()).toBe(401);
});
