import { redirect } from "next/navigation";
import { PublicShell } from "@/components/layout/public-shell";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUser } from "@/lib/auth/session";
import { homePathFor } from "@/lib/authorization/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utilities/format";
import { AccessRequestForm } from "./request-form";

export const metadata = { title: "Request access" };

export default async function AccessRequestPage() {
  const ctx = await requireUser();
  if (ctx.status === "active" && ctx.roles.length > 0) redirect(homePathFor(ctx.roles));

  const supabase = await createClient();
  const { data: requests } = await supabase
    .from("access_requests")
    .select("id, requested_company_name, requested_role, status, review_notes, created_at, reviewed_at")
    .order("created_at", { ascending: false })
    .limit(5);
  const pending = requests?.find((r) => r.status === "pending");

  return (
    <PublicShell>
      <div className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-xl font-semibold">Access to DealLens</h1>
        <p className="mt-1 text-sm text-muted">Signed in as {ctx.email}. <StatusBadge status={ctx.status} /></p>
        {ctx.status === "suspended" ? (
          <Card className="mt-6"><CardBody><p className="text-sm">Your account is suspended. Contact your DealLens administrator.</p></CardBody></Card>
        ) : pending ? (
          <Card className="mt-6">
            <CardBody className="space-y-2 text-sm">
              <p className="font-medium">Your request is awaiting administrator review.</p>
              <p className="text-muted">Organisation: {pending.requested_company_name} · Submitted {formatDateTime(pending.created_at)}</p>
              <p className="text-muted">You will be able to use DealLens once your request is approved and a company membership is assigned.</p>
            </CardBody>
          </Card>
        ) : (
          <Card className="mt-6">
            <CardBody>
              {ctx.status === "rejected" ? <p className="mb-4 text-sm text-muted">A previous request was not approved. You may submit a new request.</p> : null}
              <AccessRequestForm />
            </CardBody>
          </Card>
        )}
        {requests && requests.length > 0 ? (
          <div className="mt-6">
            <h2 className="text-sm font-semibold">Request history</h2>
            <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-surface text-sm">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>{r.requested_company_name} · {formatDateTime(r.created_at)}</span>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <form action="/auth/signout" method="post" className="mt-8"><button className="text-sm text-muted underline">Sign out</button></form>
      </div>
    </PublicShell>
  );
}
