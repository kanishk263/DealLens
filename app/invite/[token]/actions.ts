"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";

export async function acceptInvitation(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const token = z.string().regex(/^[a-f0-9]{64}$/).safeParse(formData.get("token"));
  if (!token.success) return { ok: false, error: "Invitation link is malformed." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invitation", { p_token: token.data });
  if (error) return fail(error);
  redirect("/dashboard");
}
