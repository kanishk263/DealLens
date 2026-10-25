"use client";
import { useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { EmptyState, Notice } from "@/components/ui/states";
import type { BridgeRow } from "@/lib/financial/ebitda";
import { formatAmount, formatDateTime, humanize } from "@/lib/utilities/format";
import { proposeAdjustment, reviewAdjustment } from "../../../actions";

export interface AdjustmentView {
  id: string; financial_period_id: string; adjustment_type: string; description: string; amount: number; sign: 1 | -1; status: string;
  supporting_evidence: string; rationale: string; proposed_by: string; proposer: string | null; reviewerName: string | null; review_notes: string | null; created_at: string;
}

export function AdjustmentsPanel({ submissionId, canWork, currentUserId, currency, unit, periods, bridge, adjustments }: {
  submissionId: string; canWork: boolean; currentUserId: string; currency: string; unit: string;
  periods: { id: string; label: string }[]; bridge: BridgeRow[]; adjustments: AdjustmentView[];
}) {
  const [open, setOpen] = useState(false);
  const label = (pid: string) => periods.find((p) => p.id === pid)?.label ?? "—";
  const amt = (v: number | null) => formatAmount(v, currency, unit);
  return (
    <div className="space-y-6">
      <Notice>DealLens never classifies an expense as non-recurring automatically. Every adjustment is proposed by an analyst with evidence and a rationale, and is included in Adjusted EBITDA only after review by a different finance-team member.</Notice>
      <Card>
        <CardHeader title="EBITDA bridge" description="Base EBITDA + approved adjustments = Adjusted EBITDA. Proposed and rejected items are shown for transparency only." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-subtle text-xs uppercase text-muted"><tr><th className="px-4 py-2 text-left">Line</th>{bridge.map((b) => <th key={b.periodId} className="px-4 py-2 text-right">{b.periodLabel}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              <tr><th scope="row" className="px-4 py-2 text-left font-normal">EBITDA (base)</th>{bridge.map((b) => <td key={b.periodId} className="tabular px-4 py-2 text-right">{amt(b.baseEbitda)}<span className="block text-[11px] text-faint">{b.baseBasis ?? ""}</span></td>)}</tr>
              <tr><th scope="row" className="px-4 py-2 text-left font-normal">+ Approved adjustments</th>{bridge.map((b) => <td key={b.periodId} className="tabular px-4 py-2 text-right">{amt(b.approved)}</td>)}</tr>
              <tr className="bg-accent-soft/40 font-semibold"><th scope="row" className="px-4 py-2 text-left">Adjusted EBITDA</th>{bridge.map((b) => <td key={b.periodId} className="tabular px-4 py-2 text-right" title={b.unavailableReason}>{b.adjustedEbitda === null ? <span className="text-xs font-normal text-faint">n/a</span> : amt(b.adjustedEbitda)}</td>)}</tr>
              <tr className="text-muted"><th scope="row" className="px-4 py-2 text-left font-normal">Proposed (not included)</th>{bridge.map((b) => <td key={b.periodId} className="tabular px-4 py-2 text-right">{amt(b.proposed)}</td>)}</tr>
              <tr className="text-muted"><th scope="row" className="px-4 py-2 text-left font-normal">Rejected (not included)</th>{bridge.map((b) => <td key={b.periodId} className="tabular px-4 py-2 text-right">{amt(b.rejected)}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <CardHeader title="Adjustments register" actions={canWork ? (
          <Modal open={open} onOpenChange={setOpen} wide title="Propose an EBITDA adjustment" trigger={<Button size="sm">Propose adjustment</Button>}>
            <ActionForm action={proposeAdjustment} onSuccess={() => setOpen(false)} className="grid gap-3 sm:grid-cols-2">
              {(pending) => (
                <>
                  <input type="hidden" name="submissionId" value={submissionId} />
                  <Field label="Period" htmlFor="periodId"><Select id="periodId" name="periodId">{periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
                  <Field label="Type" htmlFor="type">
                    <Select id="type" name="type">
                      <option value="restructuring">One-time restructuring</option><option value="transaction_costs">Transaction expenses</option>
                      <option value="legal_non_recurring">Non-recurring legal</option><option value="owner_related">Owner-related</option>
                      <option value="other_non_recurring">Other documented non-recurring item</option>
                    </Select>
                  </Field>
                  <Field label="Description" htmlFor="description" className="sm:col-span-2"><Input id="description" name="description" required /></Field>
                  <Field label={`Amount (${currency} ${unit})`} htmlFor="amount" hint="Positive magnitude"><Input id="amount" name="amount" type="number" step="any" min="0" required /></Field>
                  <Field label="Direction" htmlFor="sign"><Select id="sign" name="sign"><option value="1">Add back (increases EBITDA)</option><option value="-1">Deduct (decreases EBITDA)</option></Select></Field>
                  <Field label="Supporting evidence" htmlFor="evidence" className="sm:col-span-2" hint="e.g. invoice reference, board minute, ledger account"><Input id="evidence" name="evidence" required /></Field>
                  <Field label="Rationale" htmlFor="rationale" className="sm:col-span-2"><Textarea id="rationale" name="rationale" required minLength={10} /></Field>
                  <div className="sm:col-span-2"><SubmitButton pending={pending}>Propose</SubmitButton></div>
                </>
              )}
            </ActionForm>
          </Modal>) : null} />
        {adjustments.length === 0 ? <CardBody><EmptyState title="No adjustments proposed" /></CardBody> : (
          <ul className="divide-y divide-border">
            {adjustments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 max-w-2xl">
                  <p className="font-medium">{a.description} <span className="text-muted">· {label(a.financial_period_id)} · {humanize(a.adjustment_type)}</span></p>
                  <p className="tabular">{a.sign === 1 ? "+" : "−"}{formatAmount(Number(a.amount), currency, unit)}</p>
                  <p className="text-xs text-muted">Evidence: {a.supporting_evidence}</p>
                  <p className="text-xs text-muted">Rationale: {a.rationale}</p>
                  <p className="text-xs text-faint">Proposed by {a.proposer ?? "—"} · {formatDateTime(a.created_at)}{a.reviewerName ? ` · reviewed by ${a.reviewerName}` : ""}{a.review_notes ? ` — ${a.review_notes}` : ""}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusBadge status={a.status} />
                  {canWork && a.proposed_by !== currentUserId && a.status === "proposed" ? <ReviewForm id={a.id} /> : null}
                  {canWork && a.proposed_by === currentUserId && a.status === "proposed" ? <span className="text-xs text-muted">Awaiting review by a colleague</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ReviewForm({ id }: { id: string }) {
  return (
    <ActionForm action={reviewAdjustment} className="flex flex-wrap items-center gap-2">
      {(pending) => (
        <>
          <input type="hidden" name="adjustmentId" value={id} />
          <Input name="notes" placeholder="Review notes" required className="h-8 w-48" aria-label="Review notes" />
          <Button type="submit" name="decision" value="approved" size="sm" disabled={pending}>Approve</Button>
          <Button type="submit" name="decision" value="rejected" size="sm" variant="secondary" disabled={pending}>Reject</Button>
        </>
      )}
    </ActionForm>
  );
}
