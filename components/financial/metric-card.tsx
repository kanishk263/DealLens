import { Card } from "@/components/ui/card";
import { UnavailableNote } from "@/components/ui/states";
import { cn } from "@/lib/utilities/cn";

/** Displays a metric only when it was validly calculated; otherwise explains why it is unavailable. */
export function MetricCard({ label, value, sublabel, unavailableReason, status, formula, className }: {
  label: string; value: string | null; sublabel?: string; unavailableReason?: string | null;
  status?: "calculated" | "reported" | "warning" | "unavailable"; formula?: string; className?: string;
}) {
  const unavailable = value === null || status === "unavailable";
  return (
    <Card className={cn("p-4", className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      {unavailable ? (
        <div className="mt-2 space-y-1">
          <p className="text-lg font-semibold text-faint">Not available</p>
          <UnavailableNote reason={unavailableReason ?? "Required inputs are missing."} />
        </div>
      ) : (
        <>
          <p className="tabular mt-1 text-2xl font-semibold text-ink">{value}</p>
          {sublabel ? <p className="mt-0.5 text-xs text-muted">{sublabel}</p> : null}
          {status === "warning" && unavailableReason ? <p className="mt-1 text-xs text-warning">{unavailableReason}</p> : null}
          {status === "reported" ? <p className="mt-1 text-xs text-info">As reported in source</p> : null}
        </>
      )}
      {formula ? <p className="mt-2 border-t border-border pt-2 font-mono text-[11px] text-faint">{formula}</p> : null}
    </Card>
  );
}
