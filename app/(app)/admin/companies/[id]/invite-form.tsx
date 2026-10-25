"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Field, Input } from "@/components/ui/form-controls";
import { createInvitation } from "../../actions";

export function InviteForm({ companyId }: { companyId: string }) {
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <ActionForm action={createInvitation} resetOnSuccess onSuccess={(r) => setLink((r as { data?: { link: string } }).data?.link ?? null)} className="space-y-3">
        {(pending) => (
          <>
            <input type="hidden" name="companyId" value={companyId} />
            <Field label="Email" htmlFor="invite-email"><Input id="invite-email" name="email" type="email" required /></Field>
            <SubmitButton pending={pending} size="sm">Create invitation link</SubmitButton>
          </>
        )}
      </ActionForm>
      {link ? (
        <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-xs">
          <p className="font-medium">Copy this link now — it is shown only once.</p>
          <p className="mt-1 break-all font-mono">{link}</p>
          <button className="mt-2 text-accent underline" onClick={() => navigator.clipboard.writeText(link)}>Copy</button>
        </div>
      ) : null}
    </div>
  );
}
