"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireActive } from "@/lib/auth/session";
import { fail, type ActionResult } from "@/lib/errors";

export async function markRead(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireActive();
  const id = fd.get("id");
  const parsed = id ? z.string().uuid().safeParse(id) : null;
  if (parsed && !parsed.success) return { ok: false, error: "Invalid notification" };
  const supabase = await createClient();
  // The function only ever touches the caller's own notifications.
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: parsed ? [parsed.data] : null });
  if (error) return fail(error);
  return { ok: true, message: parsed ? "Marked as read." : "All notifications marked as read." };
}
