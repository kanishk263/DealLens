"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { DocumentUploader } from "@/components/documents/document-uploader";
import { createSubmission, submitSubmission } from "../actions";

const schema = z.object({
  companyId: z.string().uuid("Select a company"),
  name: z.string().trim().min(2, "At least 2 characters").max(200),
  dealType: z.enum(["acquisition", "divestiture", "financial_due_diligence", "valuation", "strategic_review", "other"]),
  dealProjectId: z.string().optional(),
  periodStart: z.string().min(1, "Required"),
  periodEnd: z.string().min(1, "Required"),
  currency: z.string().regex(/^[A-Za-z]{3}$/, "3-letter ISO code"),
  unit: z.enum(["units", "thousands", "millions"]),
  notes: z.string().max(5000).optional(),
}).refine((d) => d.periodEnd > d.periodStart, { message: "End must be after start", path: ["periodEnd"] });
type Values = z.infer<typeof schema>;

export function NewSubmissionForm({ companies, deals, maxMb }: {
  companies: { id: string; name: string; currency: string; unit: string }[];
  deals: { id: string; company_id: string; name: string }[]; maxMb: number;
}) {
  const router = useRouter();
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const first = companies[0];
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { companyId: first?.id ?? "", dealType: "financial_due_diligence", currency: first?.currency ?? "USD", unit: (first?.unit as Values["unit"]) ?? "thousands",
      periodStart: "2022-01-01", periodEnd: "2024-12-31", name: "", notes: "", dealProjectId: "" },
  });
  const companyId = form.watch("companyId");
  const errors = form.formState.errors;

  async function onCreate(values: Values) {
    const res = await createSubmission(values);
    if (!res.ok) { toast.error(res.error); return; }
    setSubmissionId(res.data!.id);
    toast.success("Draft created. Now upload your documents.");
  }

  async function onSubmitPackage() {
    if (!submissionId) return;
    setSubmitting(true);
    const fd = new FormData();
    fd.set("submissionId", submissionId);
    const res = await submitSubmission(null, fd);
    setSubmitting(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success("Submission received. Processing has started.");
    router.push(`/submissions/${submissionId}`);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="1. Submission details" description={submissionId ? "Draft created." : "Describe the package you are submitting."} />
        <CardBody>
          <form onSubmit={form.handleSubmit(onCreate)} className="grid gap-4 sm:grid-cols-2">
            <fieldset disabled={!!submissionId || form.formState.isSubmitting} className="contents">
              <Field label="Company" htmlFor="companyId" error={errors.companyId?.message}>
                <Select id="companyId" {...form.register("companyId", {
                  onChange: (e) => { const c = companies.find((x) => x.id === e.target.value); if (c) { form.setValue("currency", c.currency); form.setValue("unit", c.unit as Values["unit"]); } },
                })}>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Submission name" htmlFor="name" error={errors.name?.message}><Input id="name" placeholder="e.g. FY2022–FY2024 financial statements" {...form.register("name")} /></Field>
              <Field label="Deal type" htmlFor="dealType">
                <Select id="dealType" {...form.register("dealType")}>
                  <option value="financial_due_diligence">Financial due diligence</option><option value="acquisition">Acquisition</option>
                  <option value="divestiture">Divestiture</option><option value="valuation">Valuation</option>
                  <option value="strategic_review">Strategic review</option><option value="other">Other</option>
                </Select>
              </Field>
              <Field label="Deal project (optional)" htmlFor="dealProjectId">
                <Select id="dealProjectId" {...form.register("dealProjectId")}>
                  <option value="">None</option>
                  {deals.filter((d) => d.company_id === companyId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </Field>
              <Field label="Reporting period start" htmlFor="periodStart" error={errors.periodStart?.message}><Input id="periodStart" type="date" {...form.register("periodStart")} /></Field>
              <Field label="Reporting period end" htmlFor="periodEnd" error={errors.periodEnd?.message} hint="Also sets the fiscal year-end used to date FY columns.">
                <Input id="periodEnd" type="date" {...form.register("periodEnd")} />
              </Field>
              <Field label="Reporting currency" htmlFor="currency" error={errors.currency?.message}><Input id="currency" maxLength={3} {...form.register("currency")} /></Field>
              <Field label="Units" htmlFor="unit">
                <Select id="unit" {...form.register("unit")}><option value="units">Units</option><option value="thousands">Thousands</option><option value="millions">Millions</option></Select>
              </Field>
              <Field label="Notes (optional)" htmlFor="notes" className="sm:col-span-2"><Textarea id="notes" {...form.register("notes")} /></Field>
              {!submissionId ? <div className="sm:col-span-2"><Button type="submit">{form.formState.isSubmitting ? "Creating…" : "Create draft"}</Button></div> : null}
            </fieldset>
          </form>
        </CardBody>
      </Card>
      <Card className={submissionId ? "" : "opacity-60"}>
        <CardHeader title="2. Upload documents" description="Files are stored privately and validated by content, not just extension." />
        <CardBody>
          {submissionId ? <DocumentUploader submissionId={submissionId} maxMb={maxMb} onUploaded={() => setUploaded(true)} /> : <p className="text-sm text-muted">Create the draft first.</p>}
        </CardBody>
      </Card>
      <Card className={uploaded ? "" : "opacity-60"}>
        <CardHeader title="3. Submit for processing" description="After submission, documents are locked and processed automatically." />
        <CardBody className="flex flex-wrap items-center gap-3">
          <Button onClick={onSubmitPackage} disabled={!uploaded || submitting}>{submitting ? "Submitting…" : "Submit package"}</Button>
          {submissionId ? <Link href={`/submissions/${submissionId}`} className="text-sm text-muted underline">Save as draft and continue later</Link> : null}
        </CardBody>
      </Card>
    </div>
  );
}
