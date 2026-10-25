import type { RoleKey } from "@/lib/authorization/roles";

export interface NavItem { href: string; label: string; icon: string }
export interface NavSection { title: string; items: NavItem[] }

/** Navigation reflects permissions for usability only; every route re-checks access on the server. */
export function navFor(roles: readonly RoleKey[]): NavSection[] {
  const sections: NavSection[] = [];
  if (roles.includes("company_user")) {
    sections.push({
      title: "Company",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: "layout" },
        { href: "/submissions", label: "Submissions", icon: "folder" },
        { href: "/submissions/new", label: "New submission", icon: "upload" },
        { href: "/reports", label: "Published reports", icon: "file" },
      ],
    });
  }
  if (roles.includes("finance_analyst") || roles.includes("finance_reviewer")) {
    sections.push({
      title: "Finance team",
      items: [
        { href: "/analyst", label: "Analyst dashboard", icon: "layout" },
        { href: "/analyst/queue", label: "Work queue", icon: "list" },
      ],
    });
  }
  if (roles.includes("superadmin")) {
    sections.push({
      title: "Administration",
      items: [
        { href: "/admin", label: "Platform overview", icon: "gauge" },
        { href: "/admin/access-requests", label: "Access requests", icon: "inbox" },
        { href: "/admin/users", label: "Users & roles", icon: "users" },
        { href: "/admin/companies", label: "Companies", icon: "building" },
        { href: "/admin/submissions", label: "Submissions", icon: "folder" },
        { href: "/admin/jobs", label: "Processing jobs", icon: "cpu" },
        { href: "/admin/audit", label: "Audit log", icon: "shield" },
        { href: "/admin/settings", label: "Settings", icon: "settings" },
      ],
    });
  }
  sections.push({ title: "Account", items: [
    { href: "/notifications", label: "Notifications", icon: "bell" },
    { href: "/settings", label: "Profile", icon: "user" },
  ] });
  return sections;
}
