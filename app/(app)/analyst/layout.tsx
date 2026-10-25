import { requireRole } from "@/lib/auth/session";

export default async function AnalystLayout({ children }: { children: React.ReactNode }) {
  await requireRole("finance_analyst", "finance_reviewer");
  return children;
}
