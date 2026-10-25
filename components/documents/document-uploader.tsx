"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form-controls";
import { humanize } from "@/lib/utilities/format";

const CATEGORIES = ["income_statement", "balance_sheet", "cash_flow_statement", "trial_balance", "general_ledger", "accounts_receivable",
  "accounts_payable", "debt_schedule", "revenue_schedule", "other_supporting"];
const ACCEPT = ".xlsx,.xls,.csv,.pdf";
const EXT = /\.(xlsx|xls|csv|pdf)$/i;

interface Pending { file: File; category: string; progress: number; state: "ready" | "uploading" | "done" | "error"; error?: string }

/** Per-file upload with progress (XHR). Server-side validation and authorization are authoritative. */
export function DocumentUploader({ submissionId, maxMb, clarificationId, onUploaded }: {
  submissionId: string; maxMb: number; clarificationId?: string; onUploaded?: () => void;
}) {
  const [items, setItems] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function add(files: FileList | null) {
    if (!files) return;
    const next: Pending[] = [];
    for (const f of Array.from(files)) {
      const error = !EXT.test(f.name) ? "Unsupported type (use XLSX, XLS, CSV or PDF)" : f.size === 0 ? "Empty file" : f.size > maxMb * 1024 * 1024 ? `Larger than ${maxMb} MB` : undefined;
      next.push({ file: f, category: guess(f.name), progress: 0, state: error ? "error" : "ready", error });
    }
    setItems((cur) => [...cur, ...next]);
    if (input.current) input.current.value = "";
  }

  function send(item: Pending, index: number) {
    return new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      const body = new FormData();
      body.append("file", item.file);
      body.append("category", item.category);
      if (clarificationId) body.append("clarificationId", clarificationId);
      xhr.upload.onprogress = (e) => e.lengthComputable && update(index, { progress: Math.round((e.loaded / e.total) * 100) });
      xhr.onload = () => {
        let payload: { error?: string; possibleDuplicateOf?: string | null } = {};
        try { payload = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
        if (xhr.status === 201) {
          update(index, { state: "done", progress: 100 });
          if (payload.possibleDuplicateOf) toast.warning(`${item.file.name}: an identical file was uploaded before.`);
        } else update(index, { state: "error", error: payload.error ?? `Upload failed (${xhr.status})` });
        resolve();
      };
      xhr.onerror = () => { update(index, { state: "error", error: "Network error" }); resolve(); };
      update(index, { state: "uploading" });
      xhr.open("POST", `/api/submissions/${submissionId}/documents`);
      xhr.send(body);
    });
  }

  function update(i: number, patch: Partial<Pending>) {
    setItems((cur) => cur.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }

  async function uploadAll() {
    setBusy(true);
    for (let i = 0; i < items.length; i++) if (items[i].state === "ready") await send(items[i], i);
    setBusy(false);
    onUploaded?.();
    router.refresh();
  }

  const ready = items.filter((i) => i.state === "ready").length;
  return (
    <div className="space-y-3">
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-subtle/50 px-4 py-8 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
      >
        <FileUp className="h-6 w-6 text-faint" aria-hidden />
        <p className="mt-2 text-sm">Drag files here or <button type="button" className="text-accent underline" onClick={() => input.current?.click()}>browse</button></p>
        <p className="mt-1 text-xs text-muted">XLSX, XLS, CSV or text-based PDF · up to {maxMb} MB each · scanned PDFs are not supported</p>
        <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => add(e.target.files)} aria-label="Choose files" />
      </div>
      {items.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border bg-surface">
          {items.map((it, i) => (
            <li key={`${it.file.name}-${i}`} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate" title={it.file.name}>{it.file.name}</span>
              <Select value={it.category} disabled={it.state !== "ready"} onChange={(e) => update(i, { category: e.target.value })} className="h-8 w-48" aria-label={`Category for ${it.file.name}`}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
              </Select>
              <span className="w-40 text-xs">
                {it.state === "uploading" ? <span className="block h-1.5 overflow-hidden rounded bg-subtle"><span className="block h-full bg-accent" style={{ width: `${it.progress}%` }} /></span>
                  : it.state === "done" ? <span className="text-positive">Uploaded</span>
                  : it.state === "error" ? <span className="text-danger">{it.error}</span> : <span className="text-muted">Ready</span>}
              </span>
              {it.state !== "uploading" ? <button type="button" onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remove ${it.file.name}`}><X className="h-4 w-4 text-muted" /></button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted">The category helps interpretation only; it is not treated as proof of the document&apos;s contents.</p>
      <Button type="button" onClick={uploadAll} disabled={busy || ready === 0}>{busy ? "Uploading…" : `Upload ${ready || ""} file${ready === 1 ? "" : "s"}`}</Button>
    </div>
  );
}

function guess(name: string): string {
  const n = name.toLowerCase();
  if (/balance/.test(n)) return "balance_sheet";
  if (/cash ?flow|cashflow/.test(n)) return "cash_flow_statement";
  if (/customer|revenue/.test(n) && /schedule|by|customer/.test(n)) return "revenue_schedule";
  if (/debt|loan/.test(n)) return "debt_schedule";
  if (/receivable|ar[-_ ]/.test(n)) return "accounts_receivable";
  if (/payable|ap[-_ ]/.test(n)) return "accounts_payable";
  if (/trial/.test(n)) return "trial_balance";
  return "income_statement";
}
