/**
 * Submission state machine (client-side mirror for display and UI affordances).
 * The authority is the `submission_transitions` table enforced by `private.apply_transition`;
 * `tests/integration/workflow.test.ts` asserts this mirror matches the database exactly.
 */
export const SUBMISSION_STATUSES = [
  "draft", "uploaded", "processing", "processing_failed", "awaiting_review", "in_analysis",
  "clarification_required", "under_review", "reviewed", "published", "archived",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export type Actor = "company_user" | "finance_analyst" | "finance_reviewer" | "superadmin" | "system";

export interface Transition { from: SubmissionStatus; to: SubmissionStatus; actor: Actor }

export const TRANSITIONS: readonly Transition[] = [
  { from: "draft", to: "uploaded", actor: "company_user" },
  { from: "uploaded", to: "processing", actor: "system" },
  { from: "processing", to: "awaiting_review", actor: "system" },
  { from: "processing", to: "processing_failed", actor: "system" },
  { from: "processing_failed", to: "uploaded", actor: "company_user" },
  { from: "processing_failed", to: "uploaded", actor: "superadmin" },
  { from: "processing_failed", to: "uploaded", actor: "finance_analyst" },
  { from: "awaiting_review", to: "in_analysis", actor: "finance_analyst" },
  { from: "awaiting_review", to: "in_analysis", actor: "superadmin" },
  { from: "in_analysis", to: "clarification_required", actor: "finance_analyst" },
  { from: "clarification_required", to: "in_analysis", actor: "finance_analyst" },
  { from: "clarification_required", to: "uploaded", actor: "company_user" },
  { from: "in_analysis", to: "uploaded", actor: "finance_analyst" },
  { from: "in_analysis", to: "under_review", actor: "finance_analyst" },
  { from: "under_review", to: "in_analysis", actor: "finance_reviewer" },
  { from: "under_review", to: "reviewed", actor: "finance_reviewer" },
  { from: "reviewed", to: "published", actor: "finance_reviewer" },
  { from: "reviewed", to: "published", actor: "finance_analyst" },
  { from: "published", to: "in_analysis", actor: "finance_analyst" },
  { from: "draft", to: "archived", actor: "superadmin" },
  { from: "awaiting_review", to: "archived", actor: "superadmin" },
  { from: "in_analysis", to: "archived", actor: "superadmin" },
  { from: "processing_failed", to: "archived", actor: "superadmin" },
  { from: "published", to: "archived", actor: "superadmin" },
];

/** States that can only be entered through dedicated workflow operations, never via a generic request. */
export const PROTECTED_TARGETS: ReadonlySet<SubmissionStatus> = new Set([
  "published", "reviewed", "under_review", "processing", "awaiting_review", "processing_failed",
]);

export function canTransition(from: SubmissionStatus, to: SubmissionStatus, actor: Actor): boolean {
  return TRANSITIONS.some((t) => t.from === from && t.to === to && t.actor === actor);
}

export function nextStates(from: SubmissionStatus, actor: Actor): SubmissionStatus[] {
  return TRANSITIONS.filter((t) => t.from === from && t.actor === actor).map((t) => t.to);
}

export const STATUS_DESCRIPTIONS: Record<SubmissionStatus, string> = {
  draft: "Being prepared by the company. Documents can be added or removed.",
  uploaded: "Submitted and queued for automated processing.",
  processing: "Documents are being extracted and validated.",
  processing_failed: "Automated processing could not complete. See document errors and resubmit.",
  awaiting_review: "Processed; waiting for a finance analyst to pick it up.",
  in_analysis: "A finance analyst is reviewing data and preparing analysis.",
  clarification_required: "The finance team is waiting for answers from the company.",
  under_review: "A report draft is with a reviewer for approval.",
  reviewed: "The report has been approved and is ready to publish.",
  published: "An approved report has been published to the company.",
  archived: "Closed and removed from active work queues.",
};

/** Company users may edit documents only in these states. */
export const COMPANY_EDITABLE: ReadonlySet<SubmissionStatus> = new Set(["draft", "processing_failed", "clarification_required"]);
