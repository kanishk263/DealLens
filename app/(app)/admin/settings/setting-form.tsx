"use client";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Input, Select } from "@/components/ui/form-controls";
import { updateSetting } from "../actions";

export function SettingForm({ settingKey, value }: { settingKey: string; value: number | boolean }) {
  const isBool = typeof value === "boolean";
  return (
    <ActionForm action={updateSetting} className="flex items-center gap-2">
      {(pending) => (
        <>
          <input type="hidden" name="key" value={settingKey} />
          <input type="hidden" name="type" value={isBool ? "boolean" : "number"} />
          {isBool ? (
            <Select name="value" defaultValue={String(value)} className="w-28" aria-label={settingKey}><option value="true">Enabled</option><option value="false">Disabled</option></Select>
          ) : (
            <Input name="value" type="number" defaultValue={String(value)} className="w-28" aria-label={settingKey} />
          )}
          <SubmitButton pending={pending} size="sm" variant="secondary" confirm="Change this platform setting?">Save</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
