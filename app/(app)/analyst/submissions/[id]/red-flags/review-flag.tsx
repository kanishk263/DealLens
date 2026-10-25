"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form-controls";
import { reviewRedFlag } from "../../../actions";

export function ReviewFlag({ flagId, status }: { flagId: string; status: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Modal open={open} onOpenChange={setOpen} title="Review red flag" description="Record what you found. The explanation is kept in the audit trail." trigger={<Button variant="secondary" size="sm">Review</Button>}>
      <ActionForm action={reviewRedFlag} onSuccess={() => setOpen(false)} className="space-y-3">
        {(pending) => (
          <>
            <input type="hidden" name="flagId" value={flagId} />
            <Field label="Outcome" htmlFor="status">
              <Select id="status" name="status" defaultValue={status === "open" ? "resolved" : status}>
                <option value="resolved">Resolved — explained by evidence</option><option value="escalated">Escalated — raise as a finding</option>
                <option value="dismissed">Dismissed — not relevant</option><option value="open">Re-open</option>
              </Select>
            </Field>
            <Field label="Explanation" htmlFor="notes"><Textarea id="notes" name="notes" required minLength={3} /></Field>
            <SubmitButton pending={pending}>Save</SubmitButton>
          </>
        )}
      </ActionForm>
    </Modal>
  );
}
