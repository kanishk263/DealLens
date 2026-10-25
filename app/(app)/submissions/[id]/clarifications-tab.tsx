import { createClient } from "@/lib/supabase/server";
import { ClarificationList } from "@/components/financial/clarification-list";
import { ActionForm, FormSubmit } from "@/components/forms/action-form";
import { Textarea } from "@/components/ui/form-controls";
import { DocumentUploader } from "@/components/documents/document-uploader";
import { loadClarifications } from "@/lib/database/clarifications";
import { respondClarification } from "../actions";

export async function CompanyClarificationsTab({ submissionId, status, maxMb }: { submissionId: string; status: string; maxMb: number }) {
  const supabase = await createClient();
  const items = await loadClarifications(supabase, submissionId);
  return (
    <ClarificationList items={items} renderActions={(c) => c.status === "open" ? (
      <div className="space-y-3 border-t border-border pt-3">
        <ActionForm action={respondClarification} className="space-y-2">
          <>
              <input type="hidden" name="clarificationId" value={c.id} />
              <Textarea name="response" required placeholder="Your response" aria-label="Response" />
              <FormSubmit size="sm">Send response</FormSubmit>
            </>
        </ActionForm>
        {status === "clarification_required" ? (
          <details>
            <summary className="cursor-pointer text-xs text-accent">Attach supporting documents</summary>
            <div className="mt-2"><DocumentUploader submissionId={submissionId} maxMb={maxMb} clarificationId={c.id} /></div>
          </details>
        ) : null}
      </div>
    ) : null} />
  );
}
