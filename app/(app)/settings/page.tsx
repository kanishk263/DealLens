import { requireActive } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { ROLE_LABELS } from "@/lib/authorization/roles";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const ctx = await requireActive();
  return (
    <>
      <PageHeader title="Profile" description="Your identity comes from your Google account. Roles and memberships are managed by administrators." />
      <Card className="max-w-2xl">
        <CardHeader title="Account" />
        <CardBody>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Name</dt><dd>{ctx.fullName ?? "—"}</dd></div>
            <div><dt className="text-muted">Email</dt><dd>{ctx.email}</dd></div>
            <div><dt className="text-muted">Status</dt><dd><StatusBadge status={ctx.status} /></dd></div>
            <div><dt className="text-muted">Roles</dt><dd className="flex flex-wrap gap-1">{ctx.roles.map((r) => <Badge key={r} tone="accent">{ROLE_LABELS[r]}</Badge>)}</dd></div>
            <div className="sm:col-span-2"><dt className="text-muted">Companies</dt><dd>{ctx.companies.map((c) => c.displayName).join(", ") || "—"}</dd></div>
          </dl>
        </CardBody>
      </Card>
    </>
  );
}
