import Link from "next/link";
import { Logo } from "./logo";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" aria-label="DealLens home"><Logo /></Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/product" className="text-muted hover:text-ink">Product</Link>
            <Link href="/login" className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-hover">Sign in</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted">
          <p>DealLens is an independent portfolio project. It is not affiliated with or endorsed by any professional services firm.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
