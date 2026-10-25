import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, SyntheticBadge } from "@/components/ui/status-badge";
import { Notice } from "@/components/ui/states";
import { ActionButton } from "@/components/forms/action-form";
import { RouteTabs } from "@/components/navigation/route-tabs";
import { loadAnalystSubmission } from "@/lib/database/submission-context";
import { STATUS_DESCRIPTIONS, type SubmissionStatus } from "@/lib/submissions/workflow";
import { claimSubmission } from "../../actions";

export default async function AnalystSubmissionLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sub, canWork, ctx } = await loadAnalystSubmission(id);
  const company = sub.companies as { display_name: string; is_synthetic: boolean } | null;
  const base = `/analyst/submissions/${id}`;
  const status = sub.submission_status as SubmissionStatus;
  const claimable = status === "awaiting_review" && !sub.assigned_analyst_id && ctx.roles.includes("finance_analyst");
  return (
    <>
      <PageHeader
        title={sub.submission_name}
        description={`${company?.display_name ?? ""} · ${STATUS_DESCRIPTIONS[status]}`}
        breadcrumbs={[{ label: "Work queue", href: "/analyst/queue" }, { label: sub.submission_name }]}
        badges={<><StatusBadge status={status} />{company?.is_synthetic || sub.is_synthetic ? <SyntheticBadge /> : null}</>}
        actions={claimable ? <ActionButton action={claimSubmission} fields={{ submissionId: id }} label="Claim submission" variant="primary" size="md" /> : null}
      />
      {!canWork ? <div className="mb-4"><Notice tone="warning">Read-only: {claimable ? "claim this submission to start analysis." : "only the assigned analyst or a reviewer can make changes."}</Notice></div> : null}
      <RouteTabs tabs={[
        { href: base, label: "Overview" },
        { href: `${base}/data`, label: "Financial data" },
        { href: `${base}/quality`, label: "Data quality" },
        { href: `${base}/analysis`, label: "Analysis studio" },
        { href: `${base}/red-flags`, label: "Red flags" },
        { href: `${base}/valuation`, label: "Valuation" },
        { href: `${base}/findings`, label: "Findings" },
        { href: `${base}/clarifications`, label: "Clarifications" },
        { href: `${base}/reports`, label: "Reports" },
        { href: `${base}/audit`, label: "Audit trail" },
      ]} />
      {children}
    </>
  );
}
