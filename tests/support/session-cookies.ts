import { createServerClient } from "@supabase/ssr";

/**
 * Produces the exact cookies @supabase/ssr would set after a sign-in, for a LOCAL test user.
 * Used by E2E/smoke tests to obtain a genuine Supabase session without automating Google's
 * consent screen. Every request made with these cookies is still verified by Supabase Auth.
 */
export async function sessionCookies(email: string, password: string) {
  const jar = new Map<string, string>();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (toSet) => toSet.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return [...jar.entries()].map(([name, value]) => ({ name, value }));
}

export function cookieHeader(cookies: { name: string; value: string }[]) {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}
