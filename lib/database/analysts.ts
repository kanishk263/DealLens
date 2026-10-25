import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Active finance analysts (readable by superadmins and finance reviewers under RLS). */
export async function listAnalysts(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("user_roles")
    .select("user_id, roles!inner(role_key), profiles!user_roles_user_id_fkey!inner(full_name, email, account_status)")
    .eq("roles.role_key", "finance_analyst")
    .is("revoked_at", null);
  return (data ?? [])
    .map((r) => {
      const p = r.profiles as unknown as { full_name: string | null; email: string; account_status: string };
      return { id: r.user_id as string, name: p.full_name ?? p.email, status: p.account_status };
    })
    .filter((a) => a.status === "active");
}
