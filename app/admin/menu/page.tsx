import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { MenuEditor } from "@/app/admin/menu/menu-editor";
import { isAdminAuthenticated } from "@/lib/auth/session";
import { getFullMenuCatalog } from "@/lib/services/restaurant";
import { menuKindSchema } from "@/lib/validation/booking";

export const metadata: Metadata = { title: "Menu editor" };

export const dynamic = "force-dynamic";

export default async function AdminMenuPage({ searchParams }: PageProps<"/admin/menu">) {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  // Which of the two menus is being edited; anything unrecognised is the
  // everyday one.
  const { menu: requested } = await searchParams;
  const menu = menuKindSchema.safeParse(requested).data ?? "standard";
  const courses = await getFullMenuCatalog(menu);

  return (
    <PageShell width="xl" headerHref="/admin">
      <MenuEditor key={menu} initialCourses={courses} menu={menu} />
    </PageShell>
  );
}
