import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { DOCUMENT_CATEGORIES, uploadDocument } from "@/lib/storage/documents";
import { rateLimit } from "@/lib/utilities/rate-limit";

export const runtime = "nodejs";

const fields = z.object({
  category: z.enum(DOCUMENT_CATEGORIES),
  clarificationId: z.string().uuid().optional().or(z.literal("")),
});

/** POST multipart/form-data { file, category, clarificationId? } — one file per request so the browser can show progress. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid submission" }, { status: 400 });
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (ctx.status !== "active" || !ctx.roles.includes("company_user")) return NextResponse.json({ error: "Not permitted" }, { status: 403 });

  const limit = rateLimit(`upload:${ctx.userId}`, 30, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many uploads; try again shortly." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 52 * 1024 * 1024) return NextResponse.json({ error: "Request too large" }, { status: 413 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Malformed upload" }, { status: 400 });
  }
  const file = form.get("file");
  const parsed = fields.safeParse({ category: form.get("category"), clarificationId: form.get("clarificationId") ?? undefined });
  if (!(file instanceof File) || !parsed.success) return NextResponse.json({ error: "A file and a valid document category are required." }, { status: 400 });

  const supabase = await createClient();
  const { data: setting } = await supabase.from("platform_settings").select("value").eq("key", "max_upload_mb").maybeSingle();
  const maxBytes = Number(setting?.value ?? 25) * 1024 * 1024;
  const result = await uploadDocument(supabase, id, file, parsed.data.category, maxBytes, parsed.data.clarificationId || null);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ documentId: result.documentId, possibleDuplicateOf: result.possibleDuplicateOf }, { status: 201 });
}
