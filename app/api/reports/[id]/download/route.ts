import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { rateLimit } from "@/lib/utilities/rate-limit";

/**
 * Report download. RLS on public.reports and the storage policy on the reports bucket decide access:
 * company members only for published/superseded versions; finance team in scope for drafts.
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await getSessionContext();
  if (!ctx || ctx.status !== "active") return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!rateLimit(`report:${ctx.userId}`, 60, 60_000).allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const supabase = await createClient();
  const { data: report } = await supabase.from("reports").select("storage_path, report_version, status").eq("id", id).maybeSingle();
  if (!report?.storage_path) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const filename = `deallens-report-v${report.report_version}${report.status === "published" || report.status === "superseded" ? "" : "-draft"}.pdf`;
  const { data, error } = await supabase.storage.from("reports").createSignedUrl(report.storage_path, 60, { download: filename });
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await supabase.rpc("log_download", { p_entity_type: "report", p_entity_id: id });
  return NextResponse.redirect(data.signedUrl, { status: 303, headers: { "Cache-Control": "no-store" } });
}
