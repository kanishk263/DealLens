import Link from "next/link";
import { FileSpreadsheet, ShieldCheck, LineChart, ClipboardCheck } from "lucide-react";

const PILLARS = [
  { icon: FileSpreadsheet, title: "Traceable ingestion", body: "Excel, CSV and text-based PDF statements are extracted with sheet, cell, row or page references preserved for every figure." },
  { icon: ClipboardCheck, title: "Data quality first", body: "Balance-sheet and cash roll-forward reconciliations, unit and currency checks, and unmapped items are surfaced before analysis." },
  { icon: LineChart, title: "Deal analytics", body: "Profitability, EBITDA normalisation, working capital, leverage, cash conversion, red flags, comparables and DCF." },
  { icon: ShieldCheck, title: "Reviewed, not automatic", body: "Preliminary metrics stay preliminary. Findings and reports are published only after an independent reviewer approves them." },
];

export default function LandingPage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <p className="text-sm font-medium text-accent">Financial intelligence & deal analytics</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Financial clarity. Deal confidence.</h1>
        <p className="mt-4 max-w-2xl text-base text-muted">
          DealLens brings company submissions, automated extraction, analyst review and approved reporting into one controlled
          workflow, with every number traceable to its source or to a stated assumption.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/login" className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">Continue with Google</Link>
          <Link href="/product" className="rounded-md border border-border px-5 py-2.5 text-sm font-medium text-ink hover:bg-subtle">How it works</Link>
        </div>
      </section>
      <section className="border-t border-border bg-canvas">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:grid-cols-2">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-border bg-surface p-5">
              <Icon className="h-5 w-5 text-accent" aria-hidden />
              <h2 className="mt-3 text-sm font-semibold text-ink">{title}</h2>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-xs text-muted">
          Demonstration environments use clearly labelled synthetic companies and financial statements. Analytical outputs,
          including valuations, are estimates and not guarantees of transaction price or investment return.
        </p>
      </section>
    </>
  );
}
