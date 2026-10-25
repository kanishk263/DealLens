import * as React from "react";
import { Card } from "@/components/ui/card";

/** Chart frame: title, units subtitle, the chart, an accessible data table and an optional note. */
export function ChartCard({ title, subtitle, children, table, note, className }: {
  title: string; subtitle?: string; children: React.ReactNode; table?: { headers: string[]; rows: (string | number)[][] }; note?: string; className?: string;
}) {
  return (
    <Card className={`p-4 ${className ?? ""}`}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}
      </div>
      {children}
      {note ? <p className="mt-2 text-xs text-muted">{note}</p> : null}
      {table ? (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted">View data table</summary>
          <table className="mt-2 w-full text-left">
            <thead><tr>{table.headers.map((h) => <th key={h} className="py-1 pr-3 font-medium text-muted">{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i} className="border-t border-border">{r.map((c, j) => <td key={j} className="tabular py-1 pr-3">{c}</td>)}</tr>)}</tbody>
          </table>
        </details>
      ) : null}
    </Card>
  );
}
