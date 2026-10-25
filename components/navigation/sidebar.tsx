"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell, Building2, Cpu, FileText, FolderOpen, Gauge, Inbox, LayoutDashboard, List, Menu, Settings, ShieldCheck, Upload, User, Users, X,
} from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { cn } from "@/lib/utilities/cn";
import type { NavSection } from "./nav-config";

const ICONS = {
  layout: LayoutDashboard, folder: FolderOpen, upload: Upload, file: FileText, list: List, gauge: Gauge, inbox: Inbox,
  users: Users, building: Building2, cpu: Cpu, shield: ShieldCheck, settings: Settings, bell: Bell, user: User,
} as const;

function isActive(pathname: string, href: string) {
  if (href === "/dashboard" || href === "/analyst" || href === "/admin") return pathname === href;
  if (href === "/submissions") return pathname === "/submissions" || (pathname.startsWith("/submissions/") && pathname !== "/submissions/new");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const nav = (
    <nav className="space-y-6 px-3 py-4" aria-label="Main">
      {sections.map((s) => (
        <div key={s.title}>
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{s.title}</p>
          <ul className="mt-1 space-y-0.5">
            {s.items.map((item) => {
              const Icon = ICONS[item.icon as keyof typeof ICONS] ?? LayoutDashboard;
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm", active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-subtle hover:text-ink")}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
  return (
    <>
      <button className="fixed left-3 top-3 z-40 rounded-md border border-border bg-surface p-1.5 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
        <Menu className="h-4 w-4" />
      </button>
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface lg:block">
        <div className="flex h-14 items-center border-b border-border px-5"><Link href="/"><Logo /></Link></div>
        {nav}
      </aside>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 overflow-y-auto bg-surface shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-border px-5">
              <Logo />
              <button onClick={() => setOpen(false)} aria-label="Close navigation"><X className="h-4 w-4" /></button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}
    </>
  );
}
