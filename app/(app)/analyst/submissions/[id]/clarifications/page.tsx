import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import { Notice } from "@/components/ui/states";
import { ClarificationList } from "@/components/financial/clarification-list";
import { loadAnalystSubmission } from "@/lib/database/submission-context";
import { loadClarifications } from "@/lib/database/clarifications";
import { createClarification, resolveClarification } from "../../../actions";

export default async function AnalystClarifications({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, sub, canWork } = await loadAnalystSubmission(id);
  const items = await loadClarifications(supabase, id);
  const canAsk = canWork && ["in_analysis", "clarification_required"].includes(sub.submission_status);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <ClarificationList items={items} renderActions={(c) => canWork && ["open", "answered"].includes(c.status) ? (
          <div className="flex gap-2">
            <ActionButton action={resolveClarification} fields={{ clarificationId: c.id, status: "resolved" }} label="Mark resolved" variant="primary" />
            <ActionButton action={resolveClarification} fields={{ clarificationId: c.id, status: "cancelled" }} label="Cancel request" variant="ghost" confirm="Cancel this clarification request?" />
          </div>
        ) : null} />
      </div>
      <div className="space-y-4">
        {canAsk ? (
          <Card>
            <CardHeader title="Request clarification" description="The company is notified. While requests are open the submission is marked 'clarification required'." />
            <CardBody>
              <ActionForm action={createClarification} resetOnSuccess className="space-y-3">
                {(pending) => (
                  <>
                    <input type="hidden" name="submissionId" value={id} />
                    <Field label="Question" htmlFor="question"><Textarea id="question" name="question" required minLength={5} /></Field>
                    <Field label="Documents requested (optional)" htmlFor="requestedDocuments"><Input id="requestedDocuments" name="requestedDocuments" placeholder="e.g. FY2024 receivables ageing" /></Field>
                    <SubmitButton pending={pending}>Send to company</SubmitButton>
                  </>
                )}
              </ActionForm>
            </CardBody>
          </Card>
        ) : <Notice>Clarifications can be requested by the assigned analyst while the submission is in analysis.</Notice>}
        <Notice>When the last open request is resolved, the submission returns to analysis automatically. Documents uploaded with a response are queued for extraction on resolution.</Notice>
      </div>
    </div>
  );
}
