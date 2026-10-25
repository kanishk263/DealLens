import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { rateLimit } from "@/lib/utilities/rate-limit";

/**
 * Issues a 60-second signed URL for a document. The signed URL is created with the caller's session,
 * so the storage RLS policy (company member or in-scope finance team; not superadmin) decides access.
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await getSessionContext();
  if (!ctx || ctx.status !== "active") return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!rateLimit(`download:${ctx.userId}`, 60, 60_000).allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("storage_path, original_filename").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60, { download: doc.original_filename });
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await supabase.rpc("log_download", { p_entity_type: "document", p_entity_id: id });
  return NextResponse.redirect(data.signedUrl, { status: 303, headers: { "Cache-Control": "no-store" } });
}
