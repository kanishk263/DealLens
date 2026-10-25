export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 text-sm leading-6">
      <h1 className="text-2xl font-semibold">Terms of use (placeholder)</h1>
      <p className="mt-3 text-muted">These placeholder terms must be replaced with reviewed terms before production use.</p>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-muted">
        <li>DealLens outputs are analytical estimates and do not constitute investment, legal, tax or accounting advice.</li>
        <li>Valuations are not guarantees of transaction price or investment return.</li>
        <li>Red flags indicate matters requiring investigation, not evidence of misconduct.</li>
        <li>DealLens is an independent project and is not affiliated with or endorsed by any professional services firm.</li>
      </ul>
    </div>
  );
}
