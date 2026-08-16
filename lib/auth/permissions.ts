import { STAFF_PERMISSIONS, type StaffPermission, type StaffRole, type StaffUserRecord } from "@/types/booking";

/**
 * What each permission means, in the words the panel shows next to its
 * checkbox. Keeping the descriptions here means the UI and the guard cannot
 * describe the same permission differently.
 */
export const PERMISSION_DETAILS: Record<
  StaffPermission,
  { label: string; description: string; group: string; adminOnly?: boolean }
> = {
  "reservations:create": {
    group: "Reservations",
    label: "Take reservations",
    description: "Book a table for a guest at the desk or over the phone.",
  },
  "reservations:edit": {
    group: "Reservations",
    label: "Edit reservations",
    description: "Change courses, date, party size, table, comments and contact details.",
  },
  "reservations:cancel": {
    group: "Reservations",
    label: "Cancel reservations",
    description: "Cancel a booking and release its seats. The cancellation is logged against the account.",
  },
  "reservations:restore": {
    group: "Reservations",
    label: "Restore cancellations",
    description: "Undo a cancellation, if the evening still has room.",
  },
  "reservations:delete": {
    group: "Reservations",
    label: "Delete reservations permanently",
    description: "Erase a booking and its history. Administrators only.",
    adminOnly: true,
  },
  "menu:edit": {
    group: "Restaurant",
    label: "Edit the menus",
    description: "Change the everyday and premium catalogues.",
  },
  "dates:manage": {
    group: "Restaurant",
    label: "Manage evenings",
    description: "Open and close dates, set capacity and sitting times.",
  },
  "passkeys:issue": {
    group: "Front desk",
    label: "Issue pass-keys",
    description: "Give arriving guests the key that lets them book, and withdraw one.",
  },
  "users:manage": {
    group: "Administration",
    label: "Manage staff accounts",
    description: "Create accounts and decide what they may do. Grant sparingly.",
  },
};

/** Never grantable to a plain staff account, whatever the request says. */
export const ADMIN_ONLY_PERMISSIONS: StaffPermission[] = STAFF_PERMISSIONS.filter(
  (permission) => PERMISSION_DETAILS[permission].adminOnly,
);

/** A sensible starting set for a new front-desk account. */
export const DEFAULT_STAFF_PERMISSIONS: StaffPermission[] = [
  "reservations:create",
  "reservations:edit",
  "reservations:cancel",
  "passkeys:issue",
];

export function isStaffPermission(value: unknown): value is StaffPermission {
  return typeof value === "string" && (STAFF_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * The permissions an account actually holds.
 *
 * An administrator holds everything *implicitly* rather than by having the
 * list copied onto them: a permission added in a later release is then
 * immediately available to the owner, and never silently granted to anybody
 * else.
 */
export function permissionsOf(user: Pick<StaffUserRecord, "role" | "permissions">): StaffPermission[] {
  if (user.role === "admin") {
    return [...STAFF_PERMISSIONS];
  }

  return (user.permissions ?? []).filter(isStaffPermission);
}

export function hasPermission(
  user: Pick<StaffUserRecord, "role" | "permissions"> | null | undefined,
  permission: StaffPermission,
): boolean {
  if (!user) {
    return false;
  }

  if (user.role === "admin") {
    return true;
  }

  // Delete stays with administrators even if a stale record lists it.
  if (ADMIN_ONLY_PERMISSIONS.includes(permission)) {
    return false;
  }

  return (user.permissions ?? []).includes(permission);
}

/**
 * Cleans a requested permission list: unknown entries dropped, duplicates
 * removed, and admin-only permissions refused to non-admins. Applied on the
 * way in, so nothing invalid is ever stored.
 */
export function sanitizePermissions(requested: unknown, role: StaffRole): StaffPermission[] {
  if (role === "admin") {
    // Admins hold everything implicitly; storing a list would only go stale.
    return [];
  }

  const list = Array.isArray(requested) ? requested : [];
  const allowed = new Set<StaffPermission>();

  for (const entry of list) {
    if (isStaffPermission(entry) && !ADMIN_ONLY_PERMISSIONS.includes(entry)) {
      allowed.add(entry);
    }
  }

  return STAFF_PERMISSIONS.filter((permission) => allowed.has(permission));
}

export function describePermission(permission: StaffPermission) {
  return PERMISSION_DETAILS[permission];
}
