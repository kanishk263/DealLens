"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { REPORT_SECTIONS, type ReportConfig } from "@/lib/reporting/config";
import { saveReportDraft } from "./actions";

export function ReportForm({ submissionId, report }: { submissionId: string; report?: { id: string; title: string; type: string; config: ReportConfig } }) {
  const [open, setOpen] = useState(false);
  const selected = new Set(report?.config.sections ?? REPORT_SECTIONS.map(([k]) => k));
  return (
    <Modal open={open} onOpenChange={setOpen} wide title={report ? "Edit report draft" : "New report draft"} description="Saving queues a server-side PDF render from a snapshot of approved, client-visible content."
      trigger={<Button size="sm" variant={report ? "secondary" : "primary"}>{report ? "Edit draft" : "New report draft"}</Button>}>
      <ActionForm action={saveReportDraft} onSuccess={() => setOpen(false)} className="space-y-4">
        {(pending) => (
          <>
            <input type="hidden" name="submissionId" value={submissionId} />
            <input type="hidden" name="reportId" value={report?.id ?? ""} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title" htmlFor="title"><Input id="title" name="title" required defaultValue={report?.title ?? "Financial Due Diligence Report"} /></Field>
              <Field label="Type" htmlFor="type">
                <Select id="type" name="type" defaultValue={report?.type ?? "financial_due_diligence"} disabled={!!report}>
                  <option value="financial_due_diligence">Financial due diligence</option><option value="valuation_summary">Valuation summary</option><option value="data_quality">Data quality</option>
                </Select>
              </Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Sections</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {REPORT_SECTIONS.map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name="sections" value={k} defaultChecked={selected.has(k)} />{label}</label>
                ))}
              </div>
            </fieldset>
            <Field label="Executive summary" htmlFor="executive_summary"><Textarea id="executive_summary" name="executive_summary" className="min-h-32" defaultValue={report?.config.executive_summary ?? ""} /></Field>
            <Field label="Additional limitations (optional)" htmlFor="limitations"><Textarea id="limitations" name="limitations" className="min-h-16" defaultValue={report?.config.limitations ?? ""} /></Field>
            <SubmitButton pending={pending}>{report ? "Save and regenerate" : "Create draft"}</SubmitButton>
          </>
        )}
      </ActionForm>
    </Modal>
  );
}
