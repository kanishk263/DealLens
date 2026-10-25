"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { saveCompany } from "../actions";

export interface CompanyRecord {
  id: string; legal_name: string; display_name: string; industry: string | null; country: string | null;
  reporting_currency: string; reporting_unit: string; description: string | null; status: string;
}

export function CompanyFormModal({ company }: { company?: CompanyRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <Modal open={open} onOpenChange={setOpen} wide title={company ? "Edit company" : "New company"}
      trigger={<Button variant={company ? "secondary" : "primary"} size="sm">{company ? "Edit" : "New company"}</Button>}>
      <ActionForm action={saveCompany} onSuccess={() => setOpen(false)} className="grid gap-4 sm:grid-cols-2">
        {(pending) => (
          <>
            <input type="hidden" name="id" value={company?.id ?? ""} />
            <Field label="Legal name" htmlFor="legalName"><Input id="legalName" name="legalName" required defaultValue={company?.legal_name} /></Field>
            <Field label="Display name" htmlFor="displayName"><Input id="displayName" name="displayName" required defaultValue={company?.display_name} /></Field>
            <Field label="Industry" htmlFor="industry"><Input id="industry" name="industry" defaultValue={company?.industry ?? ""} /></Field>
            <Field label="Country" htmlFor="country"><Input id="country" name="country" defaultValue={company?.country ?? ""} /></Field>
            <Field label="Reporting currency" htmlFor="currency" hint="ISO 4217, e.g. USD"><Input id="currency" name="currency" required maxLength={3} defaultValue={company?.reporting_currency ?? "USD"} /></Field>
            <Field label="Reporting unit" htmlFor="unit">
              <Select id="unit" name="unit" defaultValue={company?.reporting_unit ?? "thousands"}>
                <option value="units">Units</option><option value="thousands">Thousands</option><option value="millions">Millions</option>
              </Select>
            </Field>
            <Field label="Status" htmlFor="status">
              <Select id="status" name="status" defaultValue={company?.status ?? "active"}>
                <option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option>
              </Select>
            </Field>
            <Field label="Description" htmlFor="description" className="sm:col-span-2"><Textarea id="description" name="description" defaultValue={company?.description ?? ""} /></Field>
            <div className="sm:col-span-2"><SubmitButton pending={pending}>{company ? "Save changes" : "Create company"}</SubmitButton></div>
          </>
        )}
      </ActionForm>
    </Modal>
  );
}
