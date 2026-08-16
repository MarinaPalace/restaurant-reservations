import { describe, expect, it } from "vitest";
import {
  ADMIN_ONLY_PERMISSIONS,
  PERMISSION_DETAILS,
  hasPermission,
  permissionsOf,
  sanitizePermissions,
} from "@/lib/auth/permissions";
import { STAFF_PERMISSIONS, type StaffPermission } from "@/types/booking";

const staff = (permissions: StaffPermission[]) => ({ role: "staff" as const, permissions });
const admin = { role: "admin" as const, permissions: [] };

describe("hasPermission", () => {
  it("grants an administrator everything", () => {
    for (const permission of STAFF_PERMISSIONS) {
      expect(hasPermission(admin, permission)).toBe(true);
    }
  });

  it("grants a staff account only what it was given", () => {
    const user = staff(["reservations:create", "reservations:cancel"]);

    expect(hasPermission(user, "reservations:create")).toBe(true);
    expect(hasPermission(user, "reservations:cancel")).toBe(true);
    expect(hasPermission(user, "menu:edit")).toBe(false);
    expect(hasPermission(user, "users:manage")).toBe(false);
  });

  /**
   * Deleting destroys the record, so it stays with administrators. A stale
   * database row listing it must not be enough.
   */
  it("refuses an admin-only permission to a staff account that somehow holds it", () => {
    expect(hasPermission(staff(["reservations:delete"]), "reservations:delete")).toBe(false);
  });

  it("refuses everything when nobody is signed in", () => {
    expect(hasPermission(null, "reservations:create")).toBe(false);
    expect(hasPermission(undefined, "menu:edit")).toBe(false);
  });

  it("treats a missing permission list as no permissions", () => {
    expect(hasPermission({ role: "staff", permissions: undefined as never }, "menu:edit")).toBe(false);
  });
});

describe("permissionsOf", () => {
  /**
   * Administrators hold everything implicitly rather than by having the list
   * copied onto them, so a permission added in a later release reaches them
   * without a migration.
   */
  it("expands an administrator to the whole catalogue", () => {
    expect(permissionsOf(admin)).toEqual([...STAFF_PERMISSIONS]);
  });

  it("returns a staff account's own list", () => {
    expect(permissionsOf(staff(["menu:edit"]))).toEqual(["menu:edit"]);
  });

  it("drops anything that is no longer a real permission", () => {
    expect(permissionsOf(staff(["menu:edit", "menu:destroy" as StaffPermission]))).toEqual(["menu:edit"]);
  });
});

describe("sanitizePermissions", () => {
  it("keeps known permissions and drops the rest", () => {
    expect(sanitizePermissions(["menu:edit", "not-a-permission", 42, null], "staff")).toEqual(["menu:edit"]);
  });

  it("refuses admin-only permissions to a staff account", () => {
    expect(sanitizePermissions(["reservations:delete", "reservations:cancel"], "staff")).toEqual([
      "reservations:cancel",
    ]);
  });

  it("removes duplicates and returns a stable order", () => {
    const first = sanitizePermissions(["menu:edit", "reservations:create", "menu:edit"], "staff");
    const second = sanitizePermissions(["reservations:create", "menu:edit"], "staff");

    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
  });

  it("stores nothing for an administrator, who holds everything anyway", () => {
    expect(sanitizePermissions(["menu:edit"], "admin")).toEqual([]);
  });

  it("copes with a request that is not a list at all", () => {
    expect(sanitizePermissions(undefined, "staff")).toEqual([]);
    expect(sanitizePermissions("menu:edit", "staff")).toEqual([]);
  });
});

describe("the permission catalogue", () => {
  it("describes every permission, so the panel can never show a bare id", () => {
    for (const permission of STAFF_PERMISSIONS) {
      const detail = PERMISSION_DETAILS[permission];
      expect(detail?.label).toBeTruthy();
      expect(detail?.description).toBeTruthy();
      expect(detail?.group).toBeTruthy();
    }
  });

  it("reserves deleting reservations for administrators", () => {
    expect(ADMIN_ONLY_PERMISSIONS).toContain("reservations:delete");
  });
});
