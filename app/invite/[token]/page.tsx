import { PublicShell } from "@/components/layout/public-shell";
import { Card, CardBody } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { AcceptInvitation } from "./accept";

export const metadata = { title: "Accept invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await requireUser();
  return (
    <PublicShell>
      <div className="mx-auto max-w-md px-4 py-16">
        <h1 className="text-xl font-semibold">Company invitation</h1>
        <Card className="mt-4">
          <CardBody className="space-y-3 text-sm">
            <p>You are signed in as <b>{ctx.email}</b>. Invitations are bound to the email address they were sent to and are validated on the server.</p>
            <AcceptInvitation token={token} />
          </CardBody>
        </Card>
      </div>
    </PublicShell>
  );
}
