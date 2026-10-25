"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Browser client used only to start the OAuth redirect and sign out; data access happens server-side. */
export function createBrowserSupabase() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
