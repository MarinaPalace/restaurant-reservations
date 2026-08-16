"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { DEFAULT_STAFF_PERMISSIONS, PERMISSION_DETAILS } from "@/lib/auth/permissions";
import { cx } from "@/components/ui/utils";
import { STAFF_PERMISSIONS, type StaffPermission, type StaffRole, type StaffUserRecord } from "@/types/booking";

/**
 * Staff accounts and what each one is allowed to do.
 *
 * Everything here is a convenience: the API checks the same permission on
 * every request, so an account that cannot see a button also cannot reach the
 * endpoint behind it.
 */

const PERMISSION_GROUPS = [...new Set(STAFF_PERMISSIONS.map((p) => PERMISSION_DETAILS[p].group))];

function permissionsFor(user: StaffUserRecord): StaffPermission[] {
  return user.role === "admin" ? [...STAFF_PERMISSIONS] : user.permissions;
}

export function UserManager({
  initialUsers,
  currentUserId,
  currentUserIsAdmin,
}: {
  initialUsers: StaffUserRecord[];
  currentUserId: string;
  currentUserIsAdmin: boolean;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = (updated: StaffUserRecord) =>
    setUsers((current) => current.map((user) => (user.id === updated.id ? updated : user)));

  const save = async (id: string, patch: Record<string, unknown>, describe: string) => {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "Unable to update this account.");
        return false;
      }

      refresh(data.user);
      setNotice(describe);
      return true;
    } catch {
      setError("We could not reach the server. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const remove = async (user: StaffUserRecord) => {
    if (!window.confirm(`Delete the account "${user.username}"? Their entries in the log are kept.`)) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "Unable to delete this account.");
        return;
      }

      setUsers((current) => current.filter((entry) => entry.id !== user.id));
      setNotice(`Deleted "${user.username}".`);
    } catch {
      setError("We could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="p-5 sm:p-6">
        <CardHeader
          as="h1"
          eyebrow="Administration"
          title="Staff accounts"
          description="Each person signs in as themselves, so the log names who cancelled a booking or changed the menu."
          actions={
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/admin">Dashboard</ButtonLink>
              <Button onClick={() => setCreating((value) => !value)} variant={creating ? "secondary" : "primary"}>
                {creating ? "Close" : "New account"}
              </Button>
            </div>
          }
        />

        {error ? (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        ) : null}
        {notice ? (
          <Alert tone="success" className="mt-4">
            {notice}
          </Alert>
        ) : null}

        {creating ? (
          <CreateAccountForm
            currentUserIsAdmin={currentUserIsAdmin}
            onCreated={(user) => {
              setUsers((current) => [...current, user]);
              setCreating(false);
              setNotice(`Created "${user.username}". Give them the password in person, not by email.`);
            }}
            onError={setError}
          />
        ) : null}
      </Card>

      <div className="mt-6 space-y-4">
        {users.map((user) => {
          const isSelf = user.id === currentUserId;
          const locked = Boolean(user.isEnvironmentAccount);

          return (
            <Card key={user.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-ink">
                    {user.name}{" "}
                    <span className="font-normal text-ink-muted">({user.username})</span>
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge tone={user.role === "admin" ? "success" : "info"}>{user.role}</Badge>
                    {!user.active ? <Badge tone="warning">disabled</Badge> : null}
                    {locked ? <Badge tone="info">from the environment</Badge> : null}
                    {isSelf ? <Badge tone="info">you</Badge> : null}
                  </div>
                  <p className="mt-2 text-sm text-ink-muted">
                    {user.lastLoginAt
                      ? `Last signed in ${new Date(user.lastLoginAt).toLocaleString("en-GB")}`
                      : "Has not signed in yet"}
                    {user.createdByName ? ` · added by ${user.createdByName}` : ""}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {locked || isSelf ? (
                    <p className="max-w-xs text-sm text-ink-muted">
                      {locked
                        ? "Configured with ADMIN_USERNAME and ADMIN_PASSWORD_HASH on the server."
                        : "You cannot change your own account. Ask another administrator."}
                    </p>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => setEditingId(editingId === user.id ? null : user.id)}
                      >
                        {editingId === user.id ? "Close" : "Edit"}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          save(
                            user.id,
                            { active: !user.active },
                            user.active ? `Disabled "${user.username}".` : `Re-enabled "${user.username}".`,
                          )
                        }
                      >
                        {user.active ? "Disable" : "Enable"}
                      </Button>
                      <Button variant="danger" disabled={busy} onClick={() => remove(user)}>
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {!locked && editingId === user.id ? (
                <EditAccountForm
                  user={user}
                  busy={busy}
                  currentUserIsAdmin={currentUserIsAdmin}
                  onSave={(patch, describe) => save(user.id, patch, describe).then((ok) => ok && setEditingId(null))}
                />
              ) : (
                <PermissionSummary user={user} />
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

function PermissionSummary({ user }: { user: StaffUserRecord }) {
  const held = permissionsFor(user);

  return (
    <div className="mt-4 border-t border-line pt-4">
      {user.role === "admin" ? (
        <p className="text-sm text-ink-muted">
          Administrator — everything, including deleting reservations permanently and managing accounts.
        </p>
      ) : held.length === 0 ? (
        <p className="text-sm text-ink-muted">No permissions yet. They can sign in and look, nothing more.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {held.map((permission) => (
            <li
              key={permission}
              className="rounded-full border border-line bg-surface-muted px-3 py-1 text-xs font-medium text-ink-muted"
            >
              {PERMISSION_DETAILS[permission].label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PermissionPicker({
  role,
  permissions,
  onChange,
}: {
  role: StaffRole;
  permissions: StaffPermission[];
  onChange: (next: StaffPermission[]) => void;
}) {
  if (role === "admin") {
    return (
      <Alert tone="info" className="mt-4">
        An administrator holds every permission, including any added in a future release. Choose{" "}
        <strong>Staff</strong> to pick individual ones.
      </Alert>
    );
  }

  return (
    <div className="mt-4 space-y-5">
      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group}>
          <legend className="text-sm font-semibold text-ink">{group}</legend>
          <div className="mt-2 space-y-2">
            {STAFF_PERMISSIONS.filter((permission) => PERMISSION_DETAILS[permission].group === group).map(
              (permission) => {
                const detail = PERMISSION_DETAILS[permission];
                const checked = permissions.includes(permission);

                return (
                  <label
                    key={permission}
                    className={cx(
                      "flex items-start gap-3 rounded-control border p-3 transition-colors",
                      detail.adminOnly
                        ? "border-dashed border-line bg-surface-muted opacity-70"
                        : checked
                          ? "border-accent bg-surface-muted"
                          : "border-line bg-surface",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      // Reserved for administrators, so it cannot be ticked
                      // here — and the API refuses it regardless.
                      disabled={detail.adminOnly}
                      checked={checked && !detail.adminOnly}
                      onChange={(event) =>
                        onChange(
                          event.target.checked
                            ? [...permissions, permission]
                            : permissions.filter((entry) => entry !== permission),
                        )
                      }
                    />
                    <span>
                      <span className="block text-sm font-medium text-ink">
                        {detail.label}
                        {detail.adminOnly ? " — administrators only" : ""}
                      </span>
                      <span className="block text-sm text-ink-muted">{detail.description}</span>
                    </span>
                  </label>
                );
              },
            )}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function CreateAccountForm({
  currentUserIsAdmin,
  onCreated,
  onError,
}: {
  currentUserIsAdmin: boolean;
  onCreated: (user: StaffUserRecord) => void;
  onError: (message: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("staff");
  const [permissions, setPermissions] = useState<StaffPermission[]>(DEFAULT_STAFF_PERMISSIONS);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }

    setBusy(true);
    onError("");

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, name, password, role, permissions }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        onError(data.error ?? "Unable to create this account.");
        return;
      }

      onCreated(data.user);
    } catch {
      onError("We could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-6 border-t border-line pt-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Username" hint="What they type to sign in. Lower case, no spaces.">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              autoComplete="off"
              maxLength={40}
              placeholder="e.g. maria"
              value={username}
              onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/\s/g, ""))}
            />
          )}
        </Field>

        <Field label="Full name" hint="Shown in the log next to what they did.">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              maxLength={120}
              placeholder="e.g. Maria Petrova"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>

        <Field label="Password" hint="At least 10 characters. Hand it over in person, not by email.">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="password"
              autoComplete="new-password"
              maxLength={200}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>

        <Field label="Role">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={role}
              onChange={(event) => setRole(event.target.value as StaffRole)}
            >
              <option value="staff">Staff — only what you tick below</option>
              {/* Only an administrator can mint another; the API enforces it. */}
              {currentUserIsAdmin ? <option value="admin">Administrator — everything</option> : null}
            </Select>
          )}
        </Field>
      </div>

      <PermissionPicker role={role} permissions={permissions} onChange={setPermissions} />

      <Button type="submit" size="lg" className="mt-6" loading={busy} loadingLabel="Creating…">
        Create the account
      </Button>
    </form>
  );
}

function EditAccountForm({
  user,
  busy,
  currentUserIsAdmin,
  onSave,
}: {
  user: StaffUserRecord;
  busy: boolean;
  currentUserIsAdmin: boolean;
  onSave: (patch: Record<string, unknown>, describe: string) => void;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<StaffRole>(user.role);
  const [permissions, setPermissions] = useState<StaffPermission[]>(user.permissions);
  const [password, setPassword] = useState("");

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name">
          {(fieldProps) => (
            <Input {...fieldProps} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          )}
        </Field>

        <Field label="Role">
          {(fieldProps) => (
            <Select {...fieldProps} value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>
              <option value="staff">Staff</option>
              {currentUserIsAdmin ? <option value="admin">Administrator</option> : null}
            </Select>
          )}
        </Field>

        <Field label="New password" hint="Leave blank to keep the current one.">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="password"
              autoComplete="new-password"
              maxLength={200}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
      </div>

      <PermissionPicker role={role} permissions={permissions} onChange={setPermissions} />

      <Button
        className="mt-6"
        size="lg"
        loading={busy}
        loadingLabel="Saving…"
        onClick={() =>
          onSave(
            { name, role, permissions, ...(password ? { password } : {}) },
            `Updated "${user.username}".`,
          )
        }
      >
        Save changes
      </Button>
    </div>
  );
}
