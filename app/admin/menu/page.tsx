import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { MenuEditor } from "@/app/admin/menu/menu-editor";
import { isAdminAuthenticated } from "@/lib/auth/session";
import { getFullMenuCatalog } from "@/lib/services/restaurant";

export const metadata: Metadata = { title: "Menu editor" };

export const dynamic = "force-dynamic";

export default async function AdminMenuPage() {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  const courses = await getFullMenuCatalog();

  return (
    <PageShell width="xl" headerHref="/admin">
      <MenuEditor initialCourses={courses} />
    </PageShell>
  );
}
