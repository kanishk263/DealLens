import Link from "next/link";
export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-muted">The page or record does not exist, or you do not have access to it.</p>
      <Link href="/dashboard" className="mt-6 inline-block text-sm text-accent underline">Go to dashboard</Link>
    </div>
  );
}
