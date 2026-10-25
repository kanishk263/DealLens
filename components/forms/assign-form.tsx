"use client";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Select } from "@/components/ui/form-controls";
import type { ActionResult } from "@/lib/errors";

export function AssignForm({ action, submissionId, analysts, current }: {
  action: (p: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;
  submissionId: string; analysts: { id: string; name: string }[]; current?: string | null;
}) {
  return (
    <ActionForm action={action} className="flex items-center gap-2">
      {(pending) => (
        <>
          <input type="hidden" name="submissionId" value={submissionId} />
          <Select name="analystId" defaultValue={current ?? ""} aria-label="Analyst" className="h-8 min-w-36">
            <option value="" disabled>Select analyst…</option>
            {analysts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <SubmitButton pending={pending} size="sm" variant="secondary">Assign</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
