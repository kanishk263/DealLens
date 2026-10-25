import "server-only";
import type { User } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * First-superadmin provisioning. Runs only on the server after Supabase has verified the session.
 * The verified email must equal SUPERADMIN_BOOTSTRAP_EMAIL and be confirmed by the identity provider;
 * the database function re-checks both against auth.users and is executable only by service_role.
 * Nothing the browser sends can trigger a promotion.
 */
export async function maybeBootstrapSuperadmin(user: User): Promise<boolean> {
  const { SUPERADMIN_BOOTSTRAP_EMAIL, SUPABASE_SERVICE_ROLE_KEY } = serverEnv();
  if (!SUPERADMIN_BOOTSTRAP_EMAIL || !SUPABASE_SERVICE_ROLE_KEY) return false;
  if (!user.email || !user.email_confirmed_at) return false;
  if (user.email.toLowerCase() !== SUPERADMIN_BOOTSTRAP_EMAIL.toLowerCase()) return false;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("bootstrap_superadmin", { p_user: user.id, p_expected_email: SUPERADMIN_BOOTSTRAP_EMAIL });
  if (error) {
    console.error("[deallens] superadmin bootstrap failed", { code: error.code });
    return false;
  }
  return data === true;
}
