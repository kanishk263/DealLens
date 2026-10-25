import { requireRole } from "@/lib/auth/session";

/** Section guard (defense in depth): every admin page also checks the role itself, and the database enforces RLS. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole("superadmin");
  return children;
}
