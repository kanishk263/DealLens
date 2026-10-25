import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { RoleKey } from "@/lib/authorization/roles";

export type AccountStatus = "pending_approval" | "active" | "suspended" | "rejected";

export interface SessionContext {
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  status: AccountStatus;
  roles: RoleKey[];
  companies: { id: string; displayName: string; isSynthetic: boolean }[];
}

/**
 * Resolves the caller from the Supabase Auth server (getUser verifies the JWT with Supabase rather
 * than trusting the cookie), then loads profile, roles and memberships under RLS.
 * Cached per request.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) return null;

  const [profileRes, rolesRes, membershipsRes] = await Promise.all([
    supabase.from("profiles").select("full_name, email, avatar_url, account_status").eq("id", auth.user.id).maybeSingle(),
    supabase.from("user_roles").select("roles(role_key)").eq("user_id", auth.user.id).is("revoked_at", null),
    supabase
      .from("company_memberships")
      .select("company_id, companies(display_name, is_synthetic)")
      .eq("user_id", auth.user.id)
      .eq("status", "active"),
  ]);

  const profile = profileRes.data;
  if (!profile) return null;
  const status = profile.account_status as AccountStatus;
  const roles =
    status === "active"
      ? (rolesRes.data ?? [])
          .map((r) => (r.roles as unknown as { role_key: RoleKey } | null)?.role_key)
          .filter((r): r is RoleKey => Boolean(r))
      : [];
  const companies = (membershipsRes.data ?? [])
    .map((m) => {
      const c = m.companies as unknown as { display_name: string; is_synthetic: boolean } | null;
      return c ? { id: m.company_id as string, displayName: c.display_name, isSynthetic: c.is_synthetic } : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  return {
    userId: auth.user.id,
    email: profile.email,
    fullName: profile.full_name,
    avatarUrl: profile.avatar_url,
    status,
    roles,
    companies: roles.includes("company_user") ? companies : [],
  };
});

export async function requireUser(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** Signed in AND approved. Pending, suspended and rejected accounts are routed to the status page. */
export async function requireActive(): Promise<SessionContext> {
  const ctx = await requireUser();
  if (ctx.status !== "active") redirect("/access-request");
  return ctx;
}

export async function requireRole(...allowed: RoleKey[]): Promise<SessionContext> {
  const ctx = await requireActive();
  if (!allowed.some((r) => ctx.roles.includes(r))) redirect("/unauthorized");
  return ctx;
}
