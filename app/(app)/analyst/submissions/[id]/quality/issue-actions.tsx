"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form-controls";
import { reviewQualityIssue } from "../../../actions";

export function IssueActions({ issueId, status }: { issueId: string; status: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Modal open={open} onOpenChange={setOpen} title="Update data-quality issue" trigger={<Button variant="secondary" size="sm">Update</Button>}>
      <ActionForm action={reviewQualityIssue} onSuccess={() => setOpen(false)} className="space-y-3">
        {(pending) => (
          <>
            <input type="hidden" name="issueId" value={issueId} />
            <Field label="Status" htmlFor="status">
              <Select id="status" name="status" defaultValue={status === "open" ? "resolved" : status}>
                <option value="acknowledged">Acknowledged (under investigation)</option>
                <option value="resolved">Resolved</option>
                <option value="dismissed">Dismissed (not an issue)</option>
                <option value="open">Re-open</option>
              </Select>
            </Field>
            <Field label="Resolution notes" htmlFor="notes" hint="Required when resolving or dismissing. Visible to the company for client-visible issues.">
              <Textarea id="notes" name="notes" />
            </Field>
            <SubmitButton pending={pending}>Save</SubmitButton>
          </>
        )}
      </ActionForm>
    </Modal>
  );
}
