import Link from "next/link";
import { Bell } from "lucide-react";
import { ROLE_LABELS, type RoleKey } from "@/lib/authorization/roles";

export function AppHeader({ name, email, roles, unread }: { name: string | null; email: string; roles: RoleKey[]; unread: number }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-end gap-4 border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6">
      <Link href="/notifications" className="relative rounded-md p-1.5 text-muted hover:bg-subtle" aria-label={`Notifications (${unread} unread)`}>
        <Bell className="h-4 w-4" />
        {unread > 0 ? <span className="absolute -right-0.5 -top-0.5 rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span> : null}
      </Link>
      <div className="hidden text-right sm:block">
        <p className="text-sm font-medium leading-tight text-ink">{name ?? email}</p>
        <p className="text-xs leading-tight text-muted">{roles.map((r) => ROLE_LABELS[r]).join(" · ")}</p>
      </div>
      <form action="/auth/signout" method="post">
        <button className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:bg-subtle">Sign out</button>
      </form>
    </header>
  );
}
