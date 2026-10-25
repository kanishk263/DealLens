"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";

const schema = z.object({
  companyName: z.string().trim().min(2, "Enter the organisation name").max(200),
  requestedRole: z.enum(["company_user", "finance_analyst"]),
  justification: z.string().trim().min(10, "Explain briefly why you need access (10+ characters)").max(2000),
});

export async function submitAccessRequest(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_access_request", {
    p_company_name: parsed.data.companyName,
    p_justification: parsed.data.justification,
    p_requested_role: parsed.data.requestedRole,
  });
  if (error) return fail(error);
  revalidatePath("/access-request");
  return { ok: true, message: "Access request submitted." };
}
