import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, requireServiceRoleKey } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS, so it is used for exactly one purpose: the superadmin
 * bootstrap call (whose database function is executable only by service_role). Never import this
 * from client components; the "server-only" guard fails the build if that happens.
 */
export function createAdminClient() {
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, requireServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
