export const ROLE_KEYS = ["superadmin", "company_user", "finance_analyst", "finance_reviewer"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  superadmin: "Superadmin",
  company_user: "Company User",
  finance_analyst: "Finance Analyst",
  finance_reviewer: "Finance Reviewer",
};

export const isInternal = (roles: readonly RoleKey[]) =>
  roles.includes("finance_analyst") || roles.includes("finance_reviewer");

/** Where a user lands after sign-in. Navigation only; the server re-checks on every page. */
export function homePathFor(roles: readonly RoleKey[]): string {
  if (isInternal(roles)) return "/analyst";
  if (roles.includes("company_user")) return "/dashboard";
  if (roles.includes("superadmin")) return "/admin";
  return "/access-request";
}
