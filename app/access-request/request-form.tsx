"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { submitAccessRequest } from "./actions";

export function AccessRequestForm() {
  const [state, action, pending] = useActionState(submitAccessRequest, null);
  return (
    <form action={action} className="space-y-4">
      <Field label="Organisation" htmlFor="companyName" hint="The company you represent, or the finance team you belong to.">
        <Input id="companyName" name="companyName" required minLength={2} maxLength={200} />
      </Field>
      <Field label="Requested access" htmlFor="requestedRole">
        <Select id="requestedRole" name="requestedRole" defaultValue="company_user">
          <option value="company_user">Company user — submit documents for my company</option>
          <option value="finance_analyst">Finance team — analyse submissions</option>
        </Select>
      </Field>
      <Field label="Business justification" htmlFor="justification">
        <Textarea id="justification" name="justification" required minLength={10} maxLength={2000} />
      </Field>
      {state && !state.ok ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Submitting…" : "Submit request"}</Button>
    </form>
  );
}
