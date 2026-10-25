import * as React from "react";
import { AlertTriangle, Inbox, Lock } from "lucide-react";
import { cn } from "@/lib/utilities/cn";

export function EmptyState({ title, description, action, className }: {
  title: string; description?: string; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center", className)}>
      <Inbox className="mb-3 h-6 w-6 text-faint" aria-hidden />
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "Unable to load this information", description, action }: {
  title?: string; description?: string; action?: React.ReactNode;
}) {
  return (
    <div role="alert" className="flex flex-col items-center rounded-lg border border-danger/30 bg-danger-soft px-6 py-8 text-center">
      <AlertTriangle className="mb-2 h-6 w-6 text-danger" aria-hidden />
      <p className="text-sm font-medium text-danger">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-ink">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function UnavailableNote({ reason }: { reason: string }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted">
      <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>{reason}</span>
    </p>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-subtle", className)} aria-hidden />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warning" | "danger"; title?: string; children: React.ReactNode }) {
  const tones = { info: "border-info/30 bg-info-soft", warning: "border-warning/30 bg-warning-soft", danger: "border-danger/30 bg-danger-soft" };
  return (
    <div className={cn("rounded-md border px-4 py-3 text-sm", tones[tone])}>
      {title ? <p className="font-medium text-ink">{title}</p> : null}
      <div className="text-ink/90">{children}</div>
    </div>
  );
}
