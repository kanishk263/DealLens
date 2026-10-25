import { formatAmount } from "@/lib/utilities/format";

/** WACC × terminal growth grid of enterprise values; invalid combinations (WACC ≤ g) are shown as such. */
export function SensitivityTable({ waccs, growths, values, currency, unit, baseWacc, baseG }: {
  waccs: number[]; growths: number[]; values: (number | null)[][]; currency: string; unit: string; baseWacc: number; baseG: number;
}) {
  if (!waccs.length) return null;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="mb-2 text-left text-muted">Enterprise value ({currency} {unit}) · rows: WACC · columns: terminal growth</caption>
        <thead><tr><th className="px-2 py-1 text-left text-muted">WACC \ g</th>{growths.map((g) => <th key={g} className={`px-2 py-1 text-right ${Math.abs(g - baseG) < 1e-9 ? "text-accent" : "text-muted"}`}>{pct(g)}</th>)}</tr></thead>
        <tbody>
          {waccs.map((w, i) => (
            <tr key={w} className="border-t border-border">
              <th scope="row" className={`px-2 py-1 text-left ${Math.abs(w - baseWacc) < 1e-9 ? "text-accent" : "text-muted"}`}>{pct(w)}</th>
              {growths.map((g, j) => {
                const v = values[i][j];
                const isBase = Math.abs(w - baseWacc) < 1e-9 && Math.abs(g - baseG) < 1e-9;
                return <td key={g} className={`tabular px-2 py-1 text-right ${isBase ? "bg-accent-soft font-semibold" : ""}`}>{v === null ? <span className="text-faint" title="WACC must exceed growth">invalid</span> : formatAmount(v, undefined, unit)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
