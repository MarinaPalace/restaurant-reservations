"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PassKeyCard } from "@/app/admin/pass-keys/pass-key-card";
import { formatPassKey } from "@/lib/pass-key";
import { formatShortDate, todayKey } from "@/lib/date";
import { cx } from "@/components/ui/utils";
import {
  MAX_USES_CAP,
  MINIMUM_STAY_NIGHTS,
  nightsBetween,
  suggestedUsesForNights,
  type PassKeyRecord,
} from "@/types/booking";

/**
 * Reception's screen.
 *
 * The shape follows the morning's work: a list of arrivals goes into a table,
 * one row per guest, and one press issues the lot and puts the cards on screen
 * ready to print. Issuing twenty copies of the same room was never the job.
 */

type Props = {
  initialPassKeys: PassKeyRecord[];
  /** Where in-house guests go. The QR points here with the key attached. */
  bookingUrl: string;
  /** The invitation address; the key is appended so the link opens directly. */
  invitationUrl: string;
  restaurantName: string;
  /** Deleting a key outright is an administrator's action. */
  canDelete: boolean;
};

type Status = "all" | "active" | "used" | "revoked";

/** One arrival, as reception types it. */
type Row = {
  id: string;
  reservationRef: string;
  guestName: string;
  roomNumber: string;
  checkInOn: string;
  checkOutOn: string;
  maxUses: string;
  allowShortStay: boolean;
};

function shiftDate(days: number, from = new Date()) {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function blankRow(checkInOn: string): Row {
  return {
    id: Math.random().toString(36).slice(2),
    reservationRef: "",
    guestName: "",
    roomNumber: "",
    checkInOn,
    checkOutOn: "",
    maxUses: "",
    allowShortStay: false,
  };
}

function statusTone(key: PassKeyRecord, today: string) {
  if (key.status === "revoked") return "danger" as const;
  if (key.status === "used") return "info" as const;
  if (key.expiresOn && key.expiresOn < today) return "warning" as const;
  return "success" as const;
}

function statusLabel(key: PassKeyRecord, today: string) {
  if (key.status === "revoked") return "revoked";
  if (key.status === "used") return "used";
  if (key.expiresOn && key.expiresOn < today) return "expired";
  return "active";
}

export function PassKeyManager({
  initialPassKeys,
  bookingUrl,
  invitationUrl,
  restaurantName,
  canDelete,
}: Props) {
  const today = todayKey();

  const [passKeys, setPassKeys] = useState(initialPassKeys);
  const [kind, setKind] = useState<"standard" | "premium">("standard");
  const [rows, setRows] = useState<Row[]>([blankRow(today)]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<PassKeyRecord[]>([]);
  const [editing, setEditing] = useState<PassKeyRecord | null>(null);
  const [filter, setFilter] = useState<Status>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visible = useMemo(
    () => (filter === "all" ? passKeys : passKeys.filter((key) => key.status === filter)),
    [passKeys, filter],
  );

  const cardUrl = (key: PassKeyRecord) =>
    key.kind === "premium"
      ? `${invitationUrl}/${formatPassKey(key.code)}`
      : // The QR carries the key, so scanning lands on the entry step with it
        // already filled in and only the room left to confirm.
        `${bookingUrl}?k=${formatPassKey(key.code)}`;

  /**
   * Printing cards and printing the list are different page setups, so the
   * root is marked for the duration of the print and unmarked afterwards.
   */
  const printCards = () => {
    document.documentElement.setAttribute("data-printing-cards", "");
    const done = () => {
      document.documentElement.removeAttribute("data-printing-cards");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  };

  const updateRow = (id: string, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setError("");
  };

  const issue = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }

    // A row with nothing in it is somebody who tabbed too far, not an arrival.
    const filled = rows.filter(
      (row) => row.reservationRef.trim() || row.guestName.trim() || row.roomNumber.trim() || row.checkOutOn,
    );

    if (filled.length === 0) {
      setError("Add at least one arrival before issuing.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/admin/pass-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: filled.map((row) => ({
            kind,
            reservationRef: row.reservationRef.trim() || undefined,
            guestName: row.guestName.trim() || undefined,
            roomNumber: row.roomNumber.trim() || undefined,
            checkInOn: row.checkInOn || undefined,
            expiresOn: row.checkOutOn || undefined,
            maxUses: Number(row.maxUses) || undefined,
            note: note.trim() || undefined,
            allowShortStay: row.allowShortStay || undefined,
          })),
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "Unable to issue pass-keys.");
        return;
      }

      const created: PassKeyRecord[] = data.passKeys ?? [data.passKey];
      setPassKeys((current) => [...created, ...current]);
      setIssued(created);
      setRows([blankRow(today)]);
      setNote("");
    } catch {
      setError("We could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (key: PassKeyRecord, patch: { expiresOn?: string | null; maxUses?: number }) => {
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/pass-keys/${encodeURIComponent(key.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "Unable to update this pass-key.");
        return;
      }

      setPassKeys((current) => current.map((entry) => (entry.id === key.id ? data.passKey : entry)));
      setEditing(null);
    } catch {
      setError("We could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const act = async (key: PassKeyRecord, action: "revoke" | "delete") => {
    if (busy) {
      return;
    }

    const booked = key.reservationNumbers ?? [];
    const consequences = booked.length
      ? `${booked.length === 1 ? "Reservation" : "Reservations"} ${booked.join(", ")} ` +
        `${booked.length === 1 ? "is" : "are"} NOT cancelled — cancel separately if that is what you want.`
      : "No reservation has been made with it.";

    const confirmed = window.confirm(
      action === "revoke"
        ? `Revoke ${formatPassKey(key.code)}? It will stop working immediately. ${consequences}`
        : `Delete ${formatPassKey(key.code)} permanently? This cannot be undone — revoke it instead ` +
          `if you want to keep the record. ${consequences}`,
    );
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/pass-keys/${encodeURIComponent(key.id)}/${action}`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? `Unable to ${action} this pass-key.`);
        return;
      }

      setPassKeys((current) =>
        action === "delete"
          ? current.filter((entry) => entry.id !== key.id)
          : current.map((entry) => (entry.id === key.id ? data.passKey : entry)),
      );
    } catch {
      setError("We could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggleSelected = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  // What the print will contain: a fresh batch, or whatever is ticked below.
  const cardsToPrint = issued.length
    ? issued
    : passKeys.filter((key) => selected.has(key.id));

  return (
    <>
      <Card className="p-5 sm:p-6" data-print="hide">
        <CardHeader
          as="h1"
          eyebrow="Front desk"
          title="Pass-keys"
          description={`One row per arrival. A stay earns a dinner per ${MINIMUM_STAY_NIGHTS} nights, up to ${MAX_USES_CAP}.`}
          actions={<ButtonLink href="/admin">Dashboard</ButtonLink>}
        />

        <form onSubmit={issue} className="mt-6">
          <div role="group" aria-label="What kind of key" className="flex flex-wrap gap-2">
            {(
              [
                { id: "standard", label: "In-house guests", hint: "Staying with us" },
                { id: "premium", label: "Invitations", hint: "Not staying — premium menu" },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={kind === option.id}
                onClick={() => setKind(option.id)}
                className={cx(
                  "rounded-control border px-4 py-2 text-left text-sm transition-colors",
                  kind === option.id
                    ? "border-primary bg-primary font-semibold text-primary-fg"
                    : "border-line-strong bg-surface font-medium text-ink hover:border-accent",
                )}
              >
                {option.label}
                <span className="block text-xs font-normal opacity-80">{option.hint}</span>
              </button>
            ))}
          </div>

          <div data-print-scroll="" className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[54rem] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th scope="col" className="py-2 pr-3">Reservation №</th>
                  <th scope="col" className="py-2 pr-3">Guest name</th>
                  <th scope="col" className="py-2 pr-3">Room</th>
                  <th scope="col" className="py-2 pr-3">Check-in</th>
                  <th scope="col" className="py-2 pr-3">Check-out</th>
                  <th scope="col" className="py-2 pr-3">Dinners</th>
                  <th scope="col" className="py-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line align-top">
                {rows.map((row) => {
                  const nights = nightsBetween(row.checkInOn, row.checkOutOn);
                  const suggested = suggestedUsesForNights(nights);
                  const short =
                    kind === "standard" && nights !== undefined && nights < MINIMUM_STAY_NIGHTS;

                  return (
                    <tr key={row.id}>
                      <td className="py-2 pr-3">
                        <Input
                          aria-label="Hotel reservation number"
                          inputMode="numeric"
                          maxLength={20}
                          placeholder="e.g. 40218"
                          value={row.reservationRef}
                          onChange={(event) => updateRow(row.id, { reservationRef: event.target.value })}
                          className="px-2 py-1.5"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          aria-label="Guest name"
                          maxLength={120}
                          placeholder="Petrova"
                          value={row.guestName}
                          onChange={(event) => updateRow(row.id, { guestName: event.target.value })}
                          className="px-2 py-1.5"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          aria-label="Room number"
                          maxLength={10}
                          placeholder="402"
                          value={row.roomNumber}
                          onChange={(event) =>
                            updateRow(row.id, {
                              roomNumber: event.target.value.replace(/[^A-Za-z0-9-]/g, "").toUpperCase(),
                            })
                          }
                          className="px-2 py-1.5"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          aria-label="Check-in date"
                          type="date"
                          value={row.checkInOn}
                          onChange={(event) => updateRow(row.id, { checkInOn: event.target.value })}
                          className="px-2 py-1.5"
                        />
                        {/* Most keys are written for today or tomorrow. */}
                        <div className="mt-1 flex gap-1">
                          {(
                            [
                              { label: "Today", value: shiftDate(0) },
                              { label: "Tomorrow", value: shiftDate(1) },
                            ] as const
                          ).map((quick) => (
                            <button
                              key={quick.label}
                              type="button"
                              aria-pressed={row.checkInOn === quick.value}
                              onClick={() => updateRow(row.id, { checkInOn: quick.value })}
                              className={cx(
                                "rounded-full border px-2 py-0.5 text-xs transition-colors",
                                row.checkInOn === quick.value
                                  ? "border-primary bg-primary text-primary-fg"
                                  : "border-line-strong text-ink-muted hover:border-accent",
                              )}
                            >
                              {quick.label}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          aria-label="Check-out date"
                          type="date"
                          min={row.checkInOn || undefined}
                          value={row.checkOutOn}
                          onChange={(event) => updateRow(row.id, { checkOutOn: event.target.value })}
                          className="px-2 py-1.5"
                        />
                        {/* Nights are shown, never typed — they follow the dates. */}
                        <p className="mt-1 text-xs text-ink-muted">
                          {nights === undefined
                            ? "—"
                            : `${nights} night${nights === 1 ? "" : "s"}${short ? " · short stay" : ""}`}
                        </p>
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          aria-label="Dinners on this key"
                          inputMode="numeric"
                          maxLength={1}
                          value={row.maxUses || String(suggested)}
                          onChange={(event) =>
                            updateRow(row.id, { maxUses: event.target.value.replace(/[^1-9]/g, "").slice(0, 1) })
                          }
                          className="w-16 px-2 py-1.5"
                        />
                        {short ? (
                          <label className="mt-1 flex items-start gap-1 text-xs text-warning">
                            <input
                              type="checkbox"
                              className="mt-0.5 size-3"
                              checked={row.allowShortStay}
                              onChange={(event) =>
                                updateRow(row.id, { allowShortStay: event.target.checked })
                              }
                            />
                            <span>Allow anyway</span>
                          </label>
                        ) : null}
                      </td>
                      <td className="py-2">
                        {rows.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}
                            className="text-xs text-ink-subtle underline underline-offset-2 hover:text-danger"
                          >
                            Remove
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => setRows((current) => [...current, blankRow(today)])}
            >
              Add another arrival
            </Button>
            <span className="text-sm text-ink-muted">{rows.length} row(s)</span>
          </div>

          <div className="mt-4 max-w-md">
            <Field label="Note on every key in this batch (optional)">
              {(fieldProps) => (
                <Textarea
                  {...fieldProps}
                  rows={2}
                  maxLength={200}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              )}
            </Field>
          </div>

          {error ? (
            <Alert tone="danger" className="mt-4">
              {error}
            </Alert>
          ) : null}

          <Button type="submit" size="lg" className="mt-5" loading={busy} loadingLabel="Issuing…">
            Issue and print
          </Button>
        </form>
      </Card>

      {/* The cards themselves — what gets printed and handed over. */}
      {cardsToPrint.length > 0 ? (
        <Card className="mt-6 p-5 sm:p-6" data-print="hide">
          <CardHeader
            as="h2"
            title={
              issued.length
                ? `${issued.length} pass-key${issued.length === 1 ? "" : "s"} ready`
                : `${cardsToPrint.length} selected to print`
            }
            description="Print, cut along the dashed lines, and hand them over."
            actions={
              <div className="flex flex-wrap gap-3">
                <Button onClick={printCards}>Print the cards</Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    navigator.clipboard?.writeText(
                      cardsToPrint.map((key) => formatPassKey(key.code)).join("\n"),
                    )
                  }
                >
                  Copy the codes
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setIssued([]);
                    setSelected(new Set());
                  }}
                >
                  Done
                </Button>
              </div>
            }
          />

          <div data-print-cards="" className="mt-6 flex flex-wrap gap-4">
            {cardsToPrint.map((key) => (
              <div key={key.id} data-card-cut="">
                <PassKeyCard passKey={key} bookingUrl={cardUrl(key)} restaurantName={restaurantName} />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="mt-6 p-5 sm:p-6" data-print="hide">
        <CardHeader
          as="h2"
          title="Issued keys"
          description={`${passKeys.length} in total. Tick any to print them again.`}
          actions={
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
              {(["all", "active", "used", "revoked"] as const).map((option) => (
                <Button
                  key={option}
                  variant={filter === option ? "primary" : "secondary"}
                  aria-pressed={filter === option}
                  onClick={() => setFilter(option)}
                >
                  {option[0].toUpperCase() + option.slice(1)}
                </Button>
              ))}
            </div>
          }
        />

        {visible.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No pass-keys here"
              description={
                filter === "all" ? "Issue one above when a guest checks in." : "Nothing with that status yet."
              }
            />
          </div>
        ) : (
          <div data-print-scroll="" className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[58rem] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th scope="col" className="py-2 pr-3">
                    <span className="sr-only">Print</span>
                  </th>
                  <th scope="col" className="py-2 pr-4">Key</th>
                  <th scope="col" className="py-2 pr-4">Reservation №</th>
                  <th scope="col" className="py-2 pr-4">Room / guest</th>
                  <th scope="col" className="py-2 pr-4">Stay</th>
                  <th scope="col" className="py-2 pr-4">Dinners</th>
                  <th scope="col" className="py-2 pr-4">Status</th>
                  <th scope="col" className="py-2 pr-4">Bookings</th>
                  <th scope="col" className="py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((key) => (
                  <tr key={key.id}>
                    <td className="py-3 pr-3">
                      <input
                        type="checkbox"
                        aria-label={`Print ${formatPassKey(key.code)} again`}
                        className="size-4"
                        checked={selected.has(key.id)}
                        onChange={() => toggleSelected(key.id)}
                      />
                    </td>
                    <td className="py-3 pr-4 font-mono font-semibold text-ink">{formatPassKey(key.code)}</td>
                    <td className="py-3 pr-4 tabular-nums text-ink">{key.reservationRef || "—"}</td>
                    <td className="py-3 pr-4 text-ink">
                      {key.roomNumber || "—"}
                      {key.guestName ? <span className="block text-ink-muted">{key.guestName}</span> : null}
                      {key.kind === "premium" ? (
                        <span className="block text-xs font-medium text-accent-ink">invitation</span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {key.expiresOn ? `to ${formatShortDate(key.expiresOn)}` : "no expiry"}
                      {key.nights ? <span className="block text-xs">{key.nights} night(s)</span> : null}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-ink">
                      {Math.max(key.maxUses - key.usedCount, 0)} of {key.maxUses} left
                    </td>
                    <td className="py-3 pr-4">
                      <Badge tone={statusTone(key, today)}>{statusLabel(key, today)}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {key.reservationNumbers?.length ? key.reservationNumbers.join(", ") : "—"}
                    </td>
                    <td className="py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => setEditing(editing?.id === key.id ? null : key)}
                        >
                          {editing?.id === key.id ? "Close" : "Edit"}
                        </Button>
                        {key.status === "revoked" ? null : (
                          <Button variant="danger" onClick={() => act(key, "revoke")} disabled={busy}>
                            Revoke
                          </Button>
                        )}
                        {canDelete ? (
                          <button
                            type="button"
                            onClick={() => act(key, "delete")}
                            className="text-xs text-ink-subtle underline underline-offset-2 hover:text-danger"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {editing ? (
          <EditPassKey
            key={editing.id}
            passKey={editing}
            busy={busy}
            today={today}
            onSave={(patch) => saveEdit(editing, patch)}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Card>
    </>
  );
}

/**
 * Extending a stay: move the check-out date, and the dinners follow. The guest
 * keeps the card they were already given.
 */
function EditPassKey({
  passKey,
  busy,
  today,
  onSave,
  onCancel,
}: {
  passKey: PassKeyRecord;
  busy: boolean;
  today: string;
  onSave: (patch: { expiresOn?: string | null; maxUses?: number }) => void;
  onCancel: () => void;
}) {
  const [expiresOn, setExpiresOn] = useState(passKey.expiresOn ?? "");
  const [maxUses, setMaxUses] = useState(String(passKey.maxUses));

  const nights = nightsBetween(passKey.checkInOn, expiresOn);

  return (
    <div className="mt-6 rounded-control border border-accent bg-surface-muted p-4">
      <h3 className="font-semibold text-ink">
        Editing <span className="font-mono">{formatPassKey(passKey.code)}</span>
      </h3>
      <p className="mt-1 text-sm text-ink-muted">
        {passKey.usedCount} dinner(s) already booked with this key.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          label="Check-out"
          hint={nights === undefined ? undefined : `${nights} night${nights === 1 ? "" : "s"}`}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="date"
              min={today}
              value={expiresOn}
              onChange={(event) => {
                setExpiresOn(event.target.value);
                // Extending a stay usually earns another dinner; reception can
                // still overrule the suggestion below.
                const next = nightsBetween(passKey.checkInOn, event.target.value);
                if (next !== undefined) {
                  setMaxUses(String(Math.max(suggestedUsesForNights(next), passKey.usedCount || 1)));
                }
              }}
            />
          )}
        </Field>

        <Field label="Dinners on this key" hint={`Cannot go below the ${passKey.usedCount} already booked.`}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              inputMode="numeric"
              maxLength={1}
              value={maxUses}
              onChange={(event) => setMaxUses(event.target.value.replace(/[^1-9]/g, "").slice(0, 1))}
            />
          )}
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          loading={busy}
          loadingLabel="Saving…"
          onClick={() => onSave({ expiresOn: expiresOn || null, maxUses: Number(maxUses) || passKey.maxUses })}
        >
          Save changes
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
