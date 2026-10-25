"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utilities/cn";

/** Tab bar for nested routes; the active tab is the longest matching href. */
export function RouteTabs({ tabs }: { tabs: { href: string; label: string; count?: number }[] }) {
  const pathname = usePathname();
  const active = [...tabs].sort((a, b) => b.href.length - a.href.length).find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))?.href;
  return (
    <div className="mb-5 overflow-x-auto border-b border-border">
      <nav className="-mb-px flex min-w-max gap-1" aria-label="Workspace sections">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.href === active ? "page" : undefined}
            className={cn("border-b-2 px-3 py-2 text-sm whitespace-nowrap", t.href === active ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-ink")}>
            {t.label}{typeof t.count === "number" && t.count > 0 ? <span className="ml-1.5 rounded-full bg-subtle px-1.5 text-xs text-muted">{t.count}</span> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}
