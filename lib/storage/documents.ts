import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STORAGE_CONTENT_TYPE, validateUpload } from "@/lib/validation/file-signature";
import { safeErrorMessage } from "@/lib/errors";

export const DOCUMENT_CATEGORIES = [
  "income_statement", "balance_sheet", "cash_flow_statement", "trial_balance", "general_ledger",
  "accounts_receivable", "accounts_payable", "debt_schedule", "revenue_schedule", "other_supporting",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export type UploadOutcome =
  | { ok: true; documentId: string; possibleDuplicateOf: string | null }
  | { ok: false; status: number; error: string };

/**
 * Coordinates metadata and object storage for one upload:
 *   1. validate (size, extension, MIME, magic bytes) and hash the file
 *   2. register_document → metadata row in 'uploading' state with a server-generated object path
 *   3. upload the object with the caller's own session (storage policy binds it to that row)
 *   4. finalize_document → verifies the object exists, marks 'uploaded', audits
 * Any failure after step 2 rolls back: the partial object is removed and the row deleted. Rows that
 * survive a crash in 'uploading' are swept by the worker's maintenance task.
 */
export async function uploadDocument(
  supabase: SupabaseClient, submissionId: string, file: File, category: DocumentCategory, maxBytes: number, clarificationId: string | null,
): Promise<UploadOutcome> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateUpload(file.name, file.type, file.size, bytes, maxBytes);
  if (!check.ok) return { ok: false, status: 422, error: check.error };
  const checksum = createHash("sha256").update(bytes).digest("hex");

  const { data: reg, error: regError } = await supabase.rpc("register_document", {
    p_submission: submissionId, p_filename: file.name, p_file_type: check.type, p_size: file.size, p_checksum: checksum,
    p_category: category, p_clarification: clarificationId,
  });
  if (regError) return { ok: false, status: regError.code === "P0002" ? 404 : regError.code === "42501" ? 403 : 422, error: safeErrorMessage(regError) };
  const { document_id: documentId, storage_path: path, possible_duplicate_of } = reg as { document_id: string; storage_path: string; possible_duplicate_of: string | null };

  const { error: upError } = await supabase.storage.from("documents").upload(path, bytes, { contentType: STORAGE_CONTENT_TYPE[check.type], upsert: false });
  if (upError) {
    await supabase.rpc("abandon_document", { p_document: documentId });
    return { ok: false, status: 502, error: "The file could not be stored. Please try again." };
  }
  const { error: finError } = await supabase.rpc("finalize_document", { p_document: documentId });
  if (finError) {
    await supabase.storage.from("documents").remove([path]);
    await supabase.rpc("abandon_document", { p_document: documentId });
    return { ok: false, status: 500, error: safeErrorMessage(finError, "The upload could not be completed.") };
  }
  return { ok: true, documentId, possibleDuplicateOf: possible_duplicate_of };
}
