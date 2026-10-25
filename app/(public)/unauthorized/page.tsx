import Link from "next/link";

export const metadata = { title: "Not authorised" };

export default function UnauthorizedPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-20">
      <h1 className="text-xl font-semibold">You do not have access to this page</h1>
      <p className="mt-2 text-sm text-muted">Your account does not have the role or company membership required. If you believe this is wrong, contact your DealLens administrator.</p>
      <Link href="/dashboard" className="mt-6 inline-block rounded-md border border-border px-4 py-2 text-sm font-medium">Back to dashboard</Link>
    </div>
  );
}
