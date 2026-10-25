import Link from "next/link";
import { PublicShell } from "@/components/layout/public-shell";

const REASONS: Record<string, string> = {
  provider: "Google did not complete the sign-in (it may have been cancelled).",
  missing_code: "The sign-in response was incomplete.",
  exchange: "The sign-in link has expired or was already used.",
  session: "A session could not be established.",
};

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return (
    <PublicShell>
      <div className="mx-auto max-w-md px-4 py-20">
        <h1 className="text-xl font-semibold">Sign-in failed</h1>
        <p className="mt-2 text-sm text-muted">{REASONS[reason ?? ""] ?? "An unexpected authentication error occurred."}</p>
        <Link href="/login" className="mt-6 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">Try again</Link>
      </div>
    </PublicShell>
  );
}
