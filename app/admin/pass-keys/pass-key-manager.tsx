"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PassKeyCard } from "@/app/admin/pass-keys/pass-key-card";
import { formatPassKey } from "@/lib/pass-key";
import { formatShortDate, todayKey } from "@/lib/date";
import {
  MAX_USES_CAP,
  MINIMUM_STAY_NIGHTS,
  suggestedUsesForNights,
  type PassKeyRecord,
} from "@/types/booking";

/**
 * Reception's screen: issue keys to arriving guests, print them as cards, and
 * see what has been handed out.
 *
 * Freshly issued keys are shown as the cards they will be printed as — that is
 * the moment they get handed over. They stay in the list afterwards, because
 * guests lose cards and reception has to be able to read one back.
 */

type Props = {
  initialPassKeys: PassKeyRecord[];
  /** Where in-house guests go to redeem one. Printed on the card. */
  bookingUrl: string;
  /** The invitation address; the key is appended so the link opens directly. */
  invitationUrl: string;
  restaurantName: string;
};

type Status = "all" | "active" | "used" | "revoked";

/** Check-out, worked out from tonight plus the number of nights booked. */
function checkoutFrom(nights: number, from = new Date()) {
  const checkout = new Date(from.getFullYear(), from.getMonth(), from.getDate() + nights, 12);
  return `${checkout.getFullYear()}-${String(checkout.getMonth() + 1).padStart(2, "0")}-${String(
    checkout.getDate(),
  ).padStart(2, "0")}`;
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

export function PassKeyManager({ initialPassKeys, bookingUrl, invitationUrl, restaurantName }: Props) {
  const [passKeys, setPassKeys] = useState(initialPassKeys);
  const [kind, setKind] = useState<"standard" | "premium">("standard");
  const [roomNumber, setRoomNumber] = useState("");
  const [guestName, setGuestName] = useState("");
  const [nights, setNights] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [allowShortStay, setAllowShortStay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<PassKeyRecord[]>([]);
  const [editing, setEditing] = useState<PassKeyRecord | null>(null);
  const [filter, setFilter] = useState<Status>("all");

  const today = todayKey();
  const nightCount = Number(nights);
  const hasNights = Number.isInteger(nightCount) && nightCount > 0;
  const isShortStay = hasNights && nightCount < MINIMUM_STAY_NIGHTS;

  // Both fields follow the stay until reception overrides them.
  const effectiveExpiry = expiresOn || (hasNights ? checkoutFrom(nightCount) : "");
  const effectiveUses = maxUses || String(suggestedUsesForNights(hasNights ? nightCount : undefined));

  const visible = useMemo(
    () => (filter === "all" ? passKeys : passKeys.filter((key) => key.status === filter)),
    [passKeys, filter],
  );

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

  const issue = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/admin/pass-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          roomNumber: roomNumber.trim() || undefined,
          guestName: guestName.trim() || undefined,
          nights: hasNights ? nightCount : undefined,
          expiresOn: effectiveExpiry || undefined,
          maxUses: Number(effectiveUses) || undefined,
          quantity: Number(quantity) || 1,
          note: note.trim() || undefined,
          allowShortStay: allowShortStay || undefined,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "Unable to issue a pass-key.");
        return;
      }

      const created: PassKeyRecord[] = data.passKeys ?? [data.passKey];
      setPassKeys((current) => [...created, ...current]);
      setIssued(created);
      setKind("standard");
      setRoomNumber("");
      setGuestName("");
      setNights("");
      setExpiresOn("");
      setMaxUses("");
      setQuantity("1");
      setNote("");
      setAllowShortStay(false);
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

  const revoke = async (key: PassKeyRecord) => {
    if (busy) {
      return;
    }

    const booked = key.reservationNumbers ?? [];
    const confirmed = window.confirm(
      `Revoke ${formatPassKey(key.code)}? It will stop working immediately. ` +
        (booked.length
          ? `${booked.length === 1 ? "Reservation" : "Reservations"} ${booked.join(", ")} ` +
            `${booked.length === 1 ? "is" : "are"} NOT cancelled — cancel separately if that is what you want.`
          : "No reservation has been made with it."),
    );
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/pass-keys/${encodeURIComponent(key.id)}/revoke`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "Unable to revoke this pass-key.");
        return;
      }

      setPassKeys((current) => current.map((entry) => (entry.id === key.id ? data.passKey : entry)));
    } catch {
      setError("We could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="p-5 sm:p-6" data-print="hide">
        <CardHeader
          as="h1"
          eyebrow="Front desk"
          title="Pass-keys"
          description={`Issued at check-in for a stay of ${MINIMUM_STAY_NIGHTS} nights or more. A stay earns one dinner per ${MINIMUM_STAY_NIGHTS} nights, up to ${MAX_USES_CAP}.`}
          actions={<ButtonLink href="/admin">Dashboard</ButtonLink>}
        />

        <form onSubmit={issue} className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p id="key-kind-label" className="text-sm font-medium text-ink">
              What kind of key
            </p>
            <div role="group" aria-labelledby="key-kind-label" className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  { id: "standard", label: "In-house guest", hint: "Staying with us now" },
                  { id: "premium", label: "Invitation", hint: "Not staying — booking from the premium menu" },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={kind === option.id}
                  onClick={() => setKind(option.id)}
                  className={
                    kind === option.id
                      ? "rounded-control border border-primary bg-primary px-4 py-2 text-sm font-semibold text-primary-fg"
                      : "rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-ink hover:border-accent"
                  }
                >
                  {option.label}
                  <span className="block text-xs font-normal opacity-80">{option.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <Field label="Room number" hint="For your own reference — guests confirm their room when booking.">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                maxLength={10}
                placeholder="402 or L10"
                value={roomNumber}
                onChange={(event) =>
                  setRoomNumber(event.target.value.replace(/[^A-Za-z0-9-]/g, "").toUpperCase())
                }
              />
            )}
          </Field>

          <Field label="Guest name (optional)">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                maxLength={120}
                placeholder="e.g. Petrova"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
              />
            )}
          </Field>

          <Field label="Nights staying" hint="Sets the suggested expiry and number of dinners.">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                inputMode="numeric"
                maxLength={3}
                placeholder={String(MINIMUM_STAY_NIGHTS)}
                value={nights}
                onChange={(event) => {
                  setNights(event.target.value.replace(/[^0-9]/g, ""));
                  setError("");
                }}
              />
            )}
          </Field>

          <Field label="Valid until" hint="Check-out. The key stops working after this date.">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="date"
                min={today}
                value={effectiveExpiry}
                onChange={(event) => setExpiresOn(event.target.value)}
              />
            )}
          </Field>

          <Field label="Dinners on this key" hint={`One per ${MINIMUM_STAY_NIGHTS} nights, up to ${MAX_USES_CAP}.`}>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                inputMode="numeric"
                maxLength={1}
                value={effectiveUses}
                onChange={(event) =>
                  setMaxUses(event.target.value.replace(/[^1-9]/g, "").slice(0, 1))
                }
              />
            )}
          </Field>

          <Field label="How many keys" hint="For a family or a group arriving together.">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                inputMode="numeric"
                maxLength={2}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value.replace(/[^0-9]/g, ""))}
              />
            )}
          </Field>

          <div className="sm:col-span-2">
            <Field label="Note (optional)">
              {(fieldProps) => (
                <Textarea
                  {...fieldProps}
                  rows={2}
                  maxLength={200}
                  placeholder="Anything worth recording"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              )}
            </Field>
          </div>

          {isShortStay ? (
            <div className="sm:col-span-2">
              <Alert tone="warning">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4"
                    checked={allowShortStay}
                    onChange={(event) => setAllowShortStay(event.target.checked)}
                  />
                  <span>
                    This stay is under {MINIMUM_STAY_NIGHTS} nights. Tick to issue anyway — the exception is recorded
                    against your account in the log.
                  </span>
                </label>
              </Alert>
            </div>
          ) : null}

          {error ? (
            <div className="sm:col-span-2">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}

          <div className="sm:col-span-2">
            <Button type="submit" size="lg" loading={busy} loadingLabel="Issuing…">
              {Number(quantity) > 1 ? `Issue ${quantity} pass-keys` : "Issue a pass-key"}
            </Button>
          </div>
        </form>
      </Card>

      {/* The cards themselves — what gets printed and handed over. */}
      {issued.length > 0 ? (
        <Card className="mt-6 p-5 sm:p-6" data-print="hide">
          <CardHeader
            as="h2"
            title={issued.length > 1 ? `${issued.length} pass-keys ready` : "Pass-key ready"}
            description="Print, cut along the dashed lines, and hand them over. Nine to a sheet."
            actions={
              <div className="flex flex-wrap gap-3">
                <Button onClick={printCards}>Print the cards</Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    navigator.clipboard?.writeText(issued.map((key) => formatPassKey(key.code)).join("\n"))
                  }
                >
                  Copy the codes
                </Button>
                <Button variant="ghost" onClick={() => setIssued([])}>
                  Done
                </Button>
              </div>
            }
          />

          <div data-print-cards="" className="mt-6 flex flex-wrap gap-4">
            {issued.map((key) => (
              <PassKeyCard
                key={key.id}
                passKey={key}
                bookingUrl={
                  key.kind === "premium" ? `${invitationUrl}/${formatPassKey(key.code)}` : bookingUrl
                }
                restaurantName={restaurantName}
              />
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="mt-6 p-5 sm:p-6" data-print="hide">
        <CardHeader
          as="h2"
          title="Issued keys"
          description={`${passKeys.length} in total.`}
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
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th scope="col" className="py-2 pr-4">Key</th>
                  <th scope="col" className="py-2 pr-4">Room / guest</th>
                  <th scope="col" className="py-2 pr-4">Valid until</th>
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
                    <td className="py-3 pr-4 font-mono font-semibold text-ink">{formatPassKey(key.code)}</td>
                    <td className="py-3 pr-4 text-ink">
                      {key.roomNumber || "—"}
                      {key.guestName ? <span className="block text-ink-muted">{key.guestName}</span> : null}
                      {key.kind === "premium" ? (
                        <span className="block text-xs font-medium text-accent-ink">invitation</span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {key.expiresOn ? formatShortDate(key.expiresOn) : "no expiry"}
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
                          <Button variant="danger" onClick={() => revoke(key)} disabled={busy}>
                            Revoke
                          </Button>
                        )}
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
 * Extending a stay: move the expiry, and add a dinner if the longer stay now
 * earns one. The guest keeps the card they were given.
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

  return (
    <div className="mt-6 rounded-control border border-accent bg-surface-muted p-4">
      <h3 className="font-semibold text-ink">
        Editing <span className="font-mono">{formatPassKey(passKey.code)}</span>
      </h3>
      <p className="mt-1 text-sm text-ink-muted">
        {passKey.usedCount} dinner(s) already booked with this key.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Valid until">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="date"
              min={today}
              value={expiresOn}
              onChange={(event) => setExpiresOn(event.target.value)}
            />
          )}
        </Field>

        <Field
          label="Dinners on this key"
          hint={`Cannot go below the ${passKey.usedCount} already booked.`}
        >
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
