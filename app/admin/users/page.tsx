import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { UserManager } from "@/app/admin/users/user-manager";
import { getCurrentStaffUser } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/permissions";
import { getEnvironmentAdmin, listStaffUsers } from "@/lib/services/staff-users";

export const metadata: Metadata = { title: "Staff accounts" };

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const user = await getCurrentStaffUser();

  if (!user) {
    redirect("/admin/login");
  }

  if (!hasPermission(user, "users:manage")) {
    redirect("/admin");
  }

  // The environment owner account is listed too, so the panel shows every way
  // into the system rather than only the editable ones.
  const users = [getEnvironmentAdmin(), ...(await listStaffUsers())];

  return (
    <PageShell width="xl" headerHref="/admin">
      <UserManager
        initialUsers={users}
        currentUserId={user.id}
        currentUserIsAdmin={user.role === "admin"}
      />
    </PageShell>
  );
}
