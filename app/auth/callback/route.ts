import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { maybeBootstrapSuperadmin } from "@/lib/auth/bootstrap";

/**
 * OAuth callback: exchanges the PKCE code for a session (validated by Supabase Auth), records the
 * login, applies the superadmin bootstrap if configured, and routes by account status.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"), "/dashboard");
  const origin = url.origin;

  if (url.searchParams.get("error")) {
    return NextResponse.redirect(`${origin}/auth/error?reason=provider`);
  }
  if (!code) return NextResponse.redirect(`${origin}/auth/error?reason=missing_code`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/auth/error?reason=exchange`);

  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.redirect(`${origin}/auth/error?reason=session`);

  await maybeBootstrapSuperadmin(data.user);
  await supabase.rpc("record_login");

  const { data: profile } = await supabase.from("profiles").select("account_status").eq("id", data.user.id).maybeSingle();
  if (profile?.account_status !== "active") return NextResponse.redirect(`${origin}/access-request`);
  return NextResponse.redirect(`${origin}${next}`);
}
