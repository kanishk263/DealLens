"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Input, Select } from "@/components/ui/form-controls";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ROLE_KEYS, ROLE_LABELS, type RoleKey } from "@/lib/authorization/roles";
import { changeRole, setAccountStatus } from "../actions";

export function UserControls({ userId, status, roles }: { userId: string; status: string; roles: RoleKey[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Modal open={open} onOpenChange={setOpen} title="Manage user" description="All changes are recorded in the audit log." trigger={<Button variant="secondary" size="sm">Manage</Button>}>
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Account status</h3>
          <ActionForm action={setAccountStatus} className="space-y-2" onSuccess={() => setOpen(false)}>
            {(pending) => (
              <>
                <input type="hidden" name="userId" value={userId} />
                <Select name="status" defaultValue={status === "active" ? "suspended" : "active"} aria-label="New status">
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="rejected">Rejected</option>
                </Select>
                <Input name="reason" placeholder="Reason (required)" required minLength={3} aria-label="Reason" />
                <SubmitButton pending={pending} size="sm" variant="danger" confirm="Change this user's account status?">Update status</SubmitButton>
              </>
            )}
          </ActionForm>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Roles</h3>
          <ul className="space-y-2">
            {ROLE_KEYS.map((r) => {
              const has = roles.includes(r);
              return (
                <li key={r} className="flex items-center justify-between gap-2 text-sm">
                  <span>{ROLE_LABELS[r]}</span>
                  <ActionForm action={changeRole}>
                    {(pending) => (
                      <>
                        <input type="hidden" name="userId" value={userId} />
                        <input type="hidden" name="role" value={r} />
                        <input type="hidden" name="op" value={has ? "revoke" : "grant"} />
                        <SubmitButton pending={pending} size="sm" variant={has ? "ghost" : "secondary"}
                          confirm={r === "superadmin" && !has ? "Grant superadmin? This gives full administrative control." : undefined}>
                          {has ? "Revoke" : "Grant"}
                        </SubmitButton>
                      </>
                    )}
                  </ActionForm>
                </li>
              );
            })}
          </ul>
          {status !== "active" ? <p className="mt-2 text-xs text-muted">Roles can only be granted to active accounts.</p> : null}
        </section>
      </div>
    </Modal>
  );
}
