import Link from "next/link";
import { requireActive } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { ActionButton } from "@/components/forms/action-form";
import { Pager } from "@/components/tables/pager";
import { formatDateTime } from "@/lib/utilities/format";
import { PAGE_SIZE, pageRange, parsePage } from "@/lib/utilities/pagination";
import { markRead } from "./actions";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireActive();
  const page = parsePage((await searchParams).page);
  const supabase = await createClient();
  const { data, count } = await supabase.from("notifications")
    .select("id, title, message, link_path, read_at, created_at", { count: "exact" })
    .order("created_at", { ascending: false }).range(...pageRange(page));
  const unread = (data ?? []).some((n) => !n.read_at);
  return (
    <>
      <PageHeader title="Notifications" actions={unread ? <ActionButton action={markRead} fields={{}} label="Mark all as read" /> : null} />
      <Card>
        {(data ?? []).length === 0 ? <div className="p-4"><EmptyState title="You're all caught up" /></div> : (
          <ul className="divide-y divide-border">
            {(data ?? []).map((n) => (
              <li key={n.id} className={`flex flex-wrap items-start justify-between gap-3 px-5 py-3 ${n.read_at ? "" : "bg-accent-soft/40"}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{!n.read_at ? <span className="mr-2 inline-block h-2 w-2 rounded-full bg-accent" aria-label="Unread" /> : null}{n.title}</p>
                  <p className="text-sm text-muted">{n.message}</p>
                  <p className="mt-0.5 text-xs text-faint">{formatDateTime(n.created_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {n.link_path?.startsWith("/") ? <Link href={n.link_path} className="text-sm text-accent hover:underline">Open</Link> : null}
                  {!n.read_at ? <ActionButton action={markRead} fields={{ id: n.id }} label="Mark read" variant="ghost" /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pager page={page} total={count ?? 0} pageSize={PAGE_SIZE} basePath="/notifications" />
      </Card>
    </>
  );
}
