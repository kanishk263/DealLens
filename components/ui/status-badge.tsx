import { Badge, type Tone } from "./badge";
import { humanize } from "@/lib/utilities/format";

const TONE_BY_STATUS: Record<string, Tone> = {
  // submissions
  draft: "neutral", uploaded: "info", processing: "info", processing_failed: "danger", awaiting_review: "warning",
  in_analysis: "accent", clarification_required: "warning", under_review: "accent", reviewed: "positive", published: "positive", archived: "neutral",
  // documents / jobs
  uploading: "neutral", queued: "info", processed: "positive", failed: "danger", unsupported: "danger", running: "info", succeeded: "positive", cancelled: "neutral",
  // accounts / requests
  pending_approval: "warning", active: "positive", suspended: "danger", rejected: "danger", pending: "warning", approved: "positive", withdrawn: "neutral",
  invited: "info", revoked: "neutral",
  // issues / flags / findings
  open: "warning", acknowledged: "info", resolved: "positive", dismissed: "neutral", escalated: "danger", answered: "info",
  in_review: "accent", closed: "neutral", proposed: "warning",
  // reports / valuation
  pending_review: "warning", changes_requested: "danger", superseded: "neutral",
  // severity
  critical: "danger", high: "danger", medium: "warning", low: "info", informational: "neutral",
  // mapping
  auto_mapped: "positive", needs_review: "warning", unmapped: "danger", analyst_mapped: "accent", analyst_confirmed: "positive", excluded: "neutral",
  // metric status
  calculated: "positive", reported: "info", warning: "warning", unavailable: "neutral",
  // visibility
  internal: "neutral", client_visible: "info",
  reconciled: "positive", variance: "danger", not_tested: "neutral",
};

const LABELS: Record<string, string> = {
  client_visible: "Client visible",
  processing_failed: "Processing failed",
  pending_approval: "Pending approval",
};

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return <Badge>—</Badge>;
  return <Badge tone={TONE_BY_STATUS[status] ?? "neutral"}>{label ?? LABELS[status] ?? humanize(status)}</Badge>;
}

export function SyntheticBadge() {
  return <Badge tone="info" title="Fictional company and data created for demonstration">Synthetic data</Badge>;
}

export function PreliminaryBadge() {
  return <Badge tone="warning" title="Automatically calculated and not yet reviewed by an analyst">Preliminary · unreviewed</Badge>;
}
