import { requireActive } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/navigation/sidebar";
import { navFor } from "@/components/navigation/nav-config";
import { AppHeader } from "@/components/layout/header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireActive();
  const supabase = await createClient();
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return (
    <div className="flex min-h-screen">
      <Sidebar sections={navFor(ctx.roles)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader name={ctx.fullName} email={ctx.email} roles={ctx.roles} unread={count ?? 0} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
