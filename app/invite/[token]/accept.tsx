"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { acceptInvitation } from "./actions";

export function AcceptInvitation({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvitation, null);
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      {state && !state.ok ? <p role="alert" className="mb-3 text-danger">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Accepting…" : "Accept invitation"}</Button>
    </form>
  );
}
