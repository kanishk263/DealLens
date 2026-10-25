"use client";
import { ActionForm } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-controls";
import { reviewAccessRequest } from "../actions";

export function ReviewRequestForm({ requestId, role, companies }: { requestId: string; role: string; companies: { id: string; display_name: string }[] }) {
  return (
    <ActionForm action={reviewAccessRequest} className="space-y-2">
      {(pending) => (
        <>
          <input type="hidden" name="requestId" value={requestId} />
          {role === "company_user" ? (
            <Select name="companyId" aria-label="Company to join" defaultValue="">
              <option value="">Select company…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </Select>
          ) : null}
          <Input name="notes" placeholder="Review notes (optional)" aria-label="Review notes" />
          <div className="flex gap-2">
            <Button type="submit" name="decision" value="approved" size="sm" disabled={pending}>Approve</Button>
            <button name="decision" value="rejected" type="submit" disabled={pending} className="rounded-md border border-border px-3 text-sm text-danger hover:bg-danger-soft">Reject</button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
