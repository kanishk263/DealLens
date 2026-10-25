import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/redirect";
import { homePathFor } from "@/lib/authorization/roles";
import { GoogleSignInButton } from "./google-button";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const ctx = await getSessionContext();
  if (ctx) redirect(ctx.status === "active" ? safeNextPath(next, homePathFor(ctx.roles)) : "/access-request");

  return (
    <div className="mx-auto flex max-w-sm flex-col px-4 py-20">
      <h1 className="text-xl font-semibold tracking-tight">Sign in to DealLens</h1>
      <p className="mt-1 text-sm text-muted">Use your Google account. New accounts start in a pending state until an administrator approves access.</p>
      {error ? (
        <p role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          Sign-in did not complete. Please try again.
        </p>
      ) : null}
      <div className="mt-6"><GoogleSignInButton next={safeNextPath(next, "/dashboard")} /></div>
      <p className="mt-6 text-xs text-muted">DealLens never sees or stores your Google password. Authentication is handled by Google and Supabase Auth.</p>
    </div>
  );
}
