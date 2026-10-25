"use client";
import * as React from "react";
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/errors";
import { Button } from "@/components/ui/button";

type Action = (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;

/**
 * Progressive-enhancement form bound to a server action. Shows a toast with the server's result and
 * refreshes server components on success. The server action performs all validation and authorization.
 */
export function ActionForm({ action, children, className, onSuccess, resetOnSuccess, successMessage }: {
  action: Action; children: React.ReactNode | ((pending: boolean) => React.ReactNode); className?: string;
  onSuccess?: (result: ActionResult<unknown>) => void; resetOnSuccess?: boolean; successMessage?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const handled = useRef<typeof state>(null);

  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) {
      toast.success(state.message ?? successMessage ?? "Saved");
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(state);
      router.refresh();
    } else {
      toast.error(state.error);
    }
  }, [state, router, onSuccess, resetOnSuccess, successMessage]);

  return (
    <form ref={formRef} action={formAction} className={className}>
      {typeof children === "function" ? children(pending) : children}
      {state && !state.ok ? <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p> : null}
    </form>
  );
}

/** A single-button form for simple actions with hidden fields. */
export function ActionButton({ action, fields, label, pendingLabel, variant = "secondary", size = "sm", confirm }: {
  action: Action; fields: Record<string, string>; label: string; pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md"; confirm?: string;
}) {
  return (
    <ActionForm action={action}>
      {(pending) => (
        <>
          {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <SubmitButton pending={pending} variant={variant} size={size} confirm={confirm}>{pending ? pendingLabel ?? "Working…" : label}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function SubmitButton({ pending, children, variant = "primary", size = "md", confirm, className }: {
  pending: boolean; children: React.ReactNode; variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md";
  confirm?: string; className?: string;
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending}
      className={className}
      onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
    >
      {children}
    </Button>
  );
}
