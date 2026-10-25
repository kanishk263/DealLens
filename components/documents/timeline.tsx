import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/utilities/format";

export function StatusTimeline({ events }: { events: { id: string; to_status: string; occurred_at: string; actor_kind: string; reason: string | null }[] }) {
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {events.map((e) => (
        <li key={e.id}>
          <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-surface bg-accent" aria-hidden />
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={e.to_status} /><span className="text-xs text-muted">{formatDateTime(e.occurred_at)}</span></div>
          <p className="mt-0.5 text-xs text-muted">{e.reason ?? ""}{e.actor_kind === "system" ? " · automated" : ""}</p>
        </li>
      ))}
    </ol>
  );
}
