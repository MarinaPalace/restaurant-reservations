import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { StaffUserError, deleteStaffUser, updateStaffUser } from "@/lib/services/staff-users";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { updateStaffUserSchema } from "@/lib/validation/booking";

function describe(error: unknown) {
  if (!(error instanceof StaffUserError)) {
    return null;
  }

  switch (error.code) {
    case "NOT_FOUND":
      return { message: "That account no longer exists.", status: 404 };
    case "IMMUTABLE":
      return {
        message:
          "The owner account is configured in the environment, not here. " +
          "Change ADMIN_USERNAME and ADMIN_PASSWORD_HASH on the server to edit it.",
        status: 400,
      };
    case "LAST_ADMIN":
      return {
        message:
          "This is the last administrator. Promote somebody else first, " +
          "or the panel could only be reached with the owner password.",
        status: 409,
      };
    default:
      return null;
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff("users:manage");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const { id } = await params;
    const parsed = updateStaffUserSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Please check the account details." },
        { status: 400 },
      );
    }

    // Same reasoning as creating one: without this, `users:manage` would be a
    // path to full administration.
    if (parsed.data.role === "admin" && auth.user.role !== "admin") {
      return NextResponse.json(
        { error: "Only an administrator can promote an account to administrator." },
        { status: 403 },
      );
    }

    /**
     * Nobody edits their own account here. Locking yourself out mid-service is
     * the obvious risk, but the real one is quieter: an account could keep its
     * `users:manage` permission and quietly grant itself the rest.
     */
    if (id === auth.user.id) {
      return NextResponse.json(
        { error: "You cannot change your own account. Ask another administrator." },
        { status: 409 },
      );
    }

    const user = await updateStaffUser(id, parsed.data);

    const changes: string[] = [];
    if (parsed.data.name !== undefined) changes.push("name");
    if (parsed.data.role !== undefined) changes.push(`role to ${user.role}`);
    if (parsed.data.permissions !== undefined) changes.push("permissions");
    if (parsed.data.active !== undefined) changes.push(user.active ? "re-enabled" : "disabled");
    if (parsed.data.password) changes.push("password reset");

    await recordAuditEntry({
      action: "user:update",
      actor: auth.actor,
      summary: `Updated "${user.username}": ${changes.join(", ") || "no visible change"}.`,
    });

    return NextResponse.json({ user });
  } catch (error) {
    const described = describe(error);
    if (described) {
      return NextResponse.json({ error: described.message }, { status: described.status });
    }

    console.error("[admin] failed to update staff account", error);
    return NextResponse.json({ error: "Unable to update this account." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff("users:manage");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const { id } = await params;

    if (id === auth.user.id) {
      return NextResponse.json({ error: "You cannot delete your own account." }, { status: 409 });
    }

    const user = await deleteStaffUser(id);

    await recordAuditEntry({
      action: "user:delete",
      actor: auth.actor,
      summary: `Deleted the account "${user.username}" (${user.name}).`,
    });

    return NextResponse.json({ user });
  } catch (error) {
    const described = describe(error);
    if (described) {
      return NextResponse.json({ error: described.message }, { status: described.status });
    }

    console.error("[admin] failed to delete staff account", error);
    return NextResponse.json({ error: "Unable to delete this account." }, { status: 500 });
  }
}
