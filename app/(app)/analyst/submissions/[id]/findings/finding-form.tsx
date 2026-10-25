"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { saveFinding } from "../../../actions";

export interface FindingRecord {
  id: string; category: string; title: string; description: string; severity: string; quantified_impact: number | null;
  recommendation: string | null; visibility: string; source_references: { reference?: string }[]; status: string;
}

export function FindingForm({ submissionId, finding, currency, suggestions }: { submissionId: string; finding?: FindingRecord; currency: string; suggestions?: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Modal open={open} onOpenChange={setOpen} wide title={finding ? "Edit finding" : "New finding"}
      description={finding?.status === "approved" ? "Editing an approved finding returns it to draft for re-approval." : undefined}
      trigger={<Button size="sm" variant={finding ? "ghost" : "primary"}>{finding ? "Edit" : "New finding"}</Button>}>
      <ActionForm action={saveFinding} onSuccess={() => setOpen(false)} className="grid gap-3 sm:grid-cols-2">
        {(pending) => (
          <>
            <input type="hidden" name="submissionId" value={submissionId} />
            <input type="hidden" name="id" value={finding?.id ?? ""} />
            <Field label="Title" htmlFor="title" className="sm:col-span-2"><Input id="title" name="title" required defaultValue={finding?.title} /></Field>
            <Field label="Category" htmlFor="category">
              <Select id="category" name="category" defaultValue={finding?.category ?? "profitability"}>
                {["revenue", "profitability", "ebitda", "working_capital", "debt", "cash_flow", "data_quality", "valuation", "other"].map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
              </Select>
            </Field>
            <Field label="Severity" htmlFor="severity">
              <Select id="severity" name="severity" defaultValue={finding?.severity ?? "medium"}>
                {["critical", "high", "medium", "low", "informational"].map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Description" htmlFor="description" className="sm:col-span-2"><Textarea id="description" name="description" required defaultValue={finding?.description} /></Field>
            <Field label={`Quantified impact (${currency}, optional)`} htmlFor="impact" hint="Only where it can be supported by the data"><Input id="impact" name="impact" defaultValue={finding?.quantified_impact ?? ""} /></Field>
            <Field label="Visibility" htmlFor="visibility" hint="Client-visible findings appear in reports only once approved">
              <Select id="visibility" name="visibility" defaultValue={finding?.visibility ?? "internal"}>
                <option value="internal">Internal only</option><option value="client_visible">Client visible</option>
              </Select>
            </Field>
            <Field label="Recommendation" htmlFor="recommendation" className="sm:col-span-2"><Textarea id="recommendation" name="recommendation" defaultValue={finding?.recommendation ?? ""} className="min-h-16" /></Field>
            <Field label="Source references (one per line)" htmlFor="references" className="sm:col-span-2" hint={suggestions?.length ? `e.g. ${suggestions.slice(0, 2).join(" · ")}` : undefined}>
              <Textarea id="references" name="references" className="min-h-16 font-mono text-xs" defaultValue={(finding?.source_references ?? []).map((r) => r.reference).join("\n")} />
            </Field>
            <div className="sm:col-span-2"><SubmitButton pending={pending}>{finding ? "Save changes" : "Create finding"}</SubmitButton></div>
          </>
        )}
      </ActionForm>
    </Modal>
  );
}
