import Link from "next/link";

export function Pager({ page, total, pageSize, basePath, params }: {
  page: number; total: number; pageSize: number; basePath: string; params?: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => { if (v) sp.set(k, v); });
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted">
      <span>{total === 0 ? "No records" : `Page ${page} of ${pages} · ${total} records`}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link className="rounded-md border border-border px-3 py-1 hover:bg-subtle" href={href(page - 1)}>Previous</Link> : null}
        {page < pages ? <Link className="rounded-md border border-border px-3 py-1 hover:bg-subtle" href={href(page + 1)}>Next</Link> : null}
      </div>
    </div>
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <form className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3" method="get">{children}</form>;
}
