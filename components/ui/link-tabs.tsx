import Link from "next/link";
import { cn } from "@/lib/utilities/cn";

/** Server-rendered tab bar backed by URLs, so every tab is linkable and works without JavaScript. */
export function LinkTabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="mb-5 overflow-x-auto border-b border-border">
      <nav className="-mb-px flex min-w-max gap-1" aria-label="Sections">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === active ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-2 text-sm whitespace-nowrap",
              t.key === active ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
            {typeof t.count === "number" ? <span className="ml-1.5 rounded-full bg-subtle px-1.5 text-xs text-muted">{t.count}</span> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}
