export const metadata = { title: "Product overview" };

const STEPS = [
  ["1. Submit", "Approved company users create a submission, choose period, currency and units, and upload statements to private storage."],
  ["2. Extract", "A background worker validates file signatures, extracts tables and line items, and keeps source labels and raw values untouched."],
  ["3. Validate", "Deterministic checks flag missing periods, mixed units or currencies, unmapped items and reconciliation variances."],
  ["4. Analyse", "Analysts confirm mappings, propose EBITDA adjustments, review red flags, and build comparable-company and DCF valuations."],
  ["5. Collaborate", "Clarification requests go to the company; internal notes stay internal by design and by database policy."],
  ["6. Report", "Server-generated PDF reports pass a four-eyes review before publication. Published versions are immutable."],
];

export default function ProductPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-14">
      <h1 className="text-2xl font-semibold tracking-tight">How DealLens works</h1>
      <p className="mt-2 text-muted">A controlled workflow from raw statements to an approved financial due diligence report.</p>
      <ol className="mt-8 space-y-4">
        {STEPS.map(([t, b]) => (
          <li key={t} className="rounded-lg border border-border p-4">
            <p className="text-sm font-semibold">{t}</p>
            <p className="mt-1 text-sm text-muted">{b}</p>
          </li>
        ))}
      </ol>
      <h2 className="mt-10 text-lg font-semibold">Roles</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
        <li><b className="text-ink">Company users</b> submit documents, answer clarifications and download published reports for their own company only.</li>
        <li><b className="text-ink">Finance analysts</b> review extracted data, analyse, value and draft reports for submissions in their scope.</li>
        <li><b className="text-ink">Finance reviewers</b> approve and publish reports authored by someone else.</li>
        <li><b className="text-ink">Superadmins</b> manage access, companies and assignments without implicit access to document contents.</li>
      </ul>
      <h2 className="mt-10 text-lg font-semibold">Current limitations</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
        <li>Scanned (image-only) PDFs are rejected with an explanation; OCR is not part of this release.</li>
        <li>Extraction targets common statement layouts; unusual layouts require analyst mapping.</li>
        <li>Comparable-company data is entered manually and is not verified market data.</li>
      </ul>
    </div>
  );
}
