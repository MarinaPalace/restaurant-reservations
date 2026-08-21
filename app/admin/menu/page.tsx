import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { MenuEditor } from "@/app/admin/menu/menu-editor";
import { getCurrentStaffUser } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/permissions";
import { getMenuCatalogForEditing } from "@/lib/services/restaurant";
import { getCurrency } from "@/lib/services/settings";
import { menuCatalogSchema } from "@/lib/validation/booking";

export const metadata: Metadata = { title: "Menu editor" };

export const dynamic = "force-dynamic";

export default async function AdminMenuPage({ searchParams }: PageProps<"/admin/menu">) {
  const user = await getCurrentStaffUser();

  if (!user) {
    redirect("/admin/login");
  }

  // The API refuses the save regardless; this only avoids showing an editor
  // whose Save button could never work.
  if (!hasPermission(user, "menu:edit")) {
    redirect("/admin");
  }

  // Which of the three catalogues is being edited; anything unrecognised is
  // the everyday menu.
  const { menu: requested } = await searchParams;
  const menu = menuCatalogSchema.safeParse(requested).data ?? "standard";

  // An empty premium catalogue opens as an unsaved copy of the everyday menu.
  const [{ courses, isDraft }, currency] = await Promise.all([
    getMenuCatalogForEditing(menu),
    getCurrency(),
  ]);

  return (
    <PageShell width="xl" headerHref="/admin" showLanguage={false}>
      <MenuEditor
        key={menu}
        initialCourses={courses}
        menu={menu}
        startedFromCopy={isDraft}
        initialCurrency={currency}
      />
    </PageShell>
  );
}
