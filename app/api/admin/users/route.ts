import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { StaffUserError, createStaffUser, getEnvironmentAdmin, listStaffUsers } from "@/lib/services/staff-users";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { createStaffUserSchema } from "@/lib/validation/booking";

export async function GET() {
  const auth = await requireStaff("users:manage");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    // The environment owner account is listed alongside the real ones so the
    // panel shows every way into the system, not just the editable ones.
    return NextResponse.json({ users: [getEnvironmentAdmin(), ...(await listStaffUsers())] });
  } catch (error) {
    console.error("[admin] failed to list staff accounts", error);
    return NextResponse.json({ error: "Unable to load staff accounts." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireStaff("users:manage");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const parsed = createStaffUserSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Please check the account details." },
        { status: 400 },
      );
    }

    /**
     * Only an administrator may create another administrator. Otherwise an
     * account with `users:manage` could promote itself to everything by
     * creating a second account and signing in as it.
     */
    if (parsed.data.role === "admin" && auth.user.role !== "admin") {
      return NextResponse.json(
        { error: "Only an administrator can create another administrator." },
        { status: 403 },
      );
    }

    const user = await createStaffUser({
      username: parsed.data.username,
      name: parsed.data.name,
      password: parsed.data.password,
      role: parsed.data.role,
      permissions: parsed.data.permissions,
      createdByName: auth.user.name,
    });

    await recordAuditEntry({
      action: "user:create",
      actor: auth.actor,
      summary: `Created the ${user.role} account "${user.username}" (${user.name}).`,
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof StaffUserError && error.code === "USERNAME_TAKEN") {
      return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
    }

    console.error("[admin] failed to create staff account", error);
    return NextResponse.json({ error: "Unable to create this account." }, { status: 500 });
  }
}
