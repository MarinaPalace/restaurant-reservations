"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { formatPassKey } from "@/lib/pass-key";
import { formatShortDate, todayKey } from "@/lib/date";
import { MINIMUM_STAY_NIGHTS, type PassKeyRecord } from "@/types/booking";

/**
 * Reception's screen: issue a key to an arriving guest, print the slip, and
 * see what has been handed out.
 *
 * The key is shown once, large, immediately after it is created — that is the
 * moment it gets written on a slip and given to the guest. It stays in the
 * list afterwards, because guests lose slips and reception has to be able to
 * read it back to them.
 */

type Props = {
  initialPassKeys: PassKeyRecord[];
  /** Where guests go to redeem one. Printed on the slip. */
  bookingUrl: string;
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

export function PassKeyManager({ initialPassKeys, bookingUrl }: Props) {
  const [passKeys, setPassKeys] = useState(initialPassKeys);
  const [roomNumber, setRoomNumber] = useState("");
  const [guestName, setGuestName] = useState("");
  const [nights, setNights] = useState("");
  const [note, setNote] = useState("");
  const [allowShortStay, setAllowShortStay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<PassKeyRecord | null>(null);
  const [filter, setFilter] = useState<Status>("all");

  const today = todayKey();
  const nightCount = Number(nights);
  const isShortStay = Number.isInteger(nightCount) && nightCount > 0 && nightCount < MINIMUM_STAY_NIGHTS;

  const visible = useMemo(
    () => (filter === "all" ? passKeys : passKeys.filter((key) => key.status === filter)),
    [passKeys, filter],
  );

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
          roomNumber: roomNumber.trim() || undefined,
          guestName: guestName.trim() || undefined,
          nights: Number.isInteger(nightCount) && nightCount > 0 ? nightCount : undefined,
          // The key stops working when the guest checks out, so a dinner
          // cannot be booked for an evening after they have gone.
          expiresOn:
            Number.isInteger(nightCount) && nightCount > 0 ? checkoutFrom(nightCount) : undefined,
          note: note.trim() || undefined,
          allowShortStay: allowShortStay || undefined,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "Unable to issue a pass-key.");
        return;
      }

      setPassKeys((current) => [data.passKey, ...current]);
      setIssued(data.passKey);
      setRoomNumber("");
      setGuestName("");
      setNights("");
      setNote("");
      setAllowShortStay(false);
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

    const confirmed = window.confirm(
      `Revoke ${formatPassKey(key.code)}? It will stop working immediately. ` +
        (key.reservationNumber
          ? `Reservation ${key.reservationNumber} is NOT cancelled — cancel it separately if that is what you want.`
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
      if (issued?.id === key.id) {
        setIssued(data.passKey);
      }
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
          eyebrow="Front desk"
          title="Pass-keys"
          description={`Issued at check-in. One key books one dinner, and only for a stay of ${MINIMUM_STAY_NIGHTS} nights or more.`}
          actions={
            <div className="flex flex-wrap gap-3" data-print="hide">
              <ButtonLink href="/admin">Dashboard</ButtonLink>
            </div>
          }
        />

        {/* The slip. Printing the page gives reception something to hand over. */}
        {issued ? (
          <div className="mt-6 rounded-card border-2 border-accent bg-surface-muted p-6 text-center print:border-black">
            <p className="eyebrow">
              {issued.roomNumber ? `Room ${issued.roomNumber}` : (issued.guestName ?? "Pass-key")}
            </p>
            <p className="mt-3 select-all font-mono text-3xl font-bold tracking-widest text-ink sm:text-4xl">
              {formatPassKey(issued.code)}
            </p>
            <p className="mt-4 text-sm text-ink-muted">
              Book your dinner at <span className="font-semibold text-ink">{bookingUrl}</span>
            </p>
            {issued.expiresOn ? (
              <p className="mt-1 text-sm text-ink-muted">
                Valid until {formatShortDate(issued.expiresOn)} · one reservation
              </p>
            ) : (
              <p className="mt-1 text-sm text-ink-muted">One reservation</p>
            )}

            <div className="mt-5 flex flex-wrap justify-center gap-3" data-print="hide">
              <Button variant="secondary" onClick={() => window.print()}>
                Print this slip
              </Button>
              <Button
                variant="secondary"
                onClick={() => navigator.clipboard?.writeText(formatPassKey(issued.code))}
              >
                Copy the key
              </Button>
              <Button variant="ghost" onClick={() => setIssued(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : null}

        <form onSubmit={issue} className="mt-6 grid gap-4 sm:grid-cols-2" data-print="hide">
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

          <Field label="Nights staying" hint="Sets when the key expires, so it cannot outlive the stay.">
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
                    This stay is under {MINIMUM_STAY_NIGHTS} nights. Tick to issue a key anyway — the exception is
                    recorded against your account in the log.
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
              Issue a pass-key
            </Button>
          </div>
        </form>
      </Card>

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
                filter === "all"
                  ? "Issue one above when a guest checks in."
                  : "Nothing with that status yet."
              }
            />
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th scope="col" className="py-2 pr-4">Key</th>
                  <th scope="col" className="py-2 pr-4">Room / guest</th>
                  <th scope="col" className="py-2 pr-4">Valid until</th>
                  <th scope="col" className="py-2 pr-4">Status</th>
                  <th scope="col" className="py-2 pr-4">Booking</th>
                  <th scope="col" className="py-2 pr-4">Issued by</th>
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
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {key.expiresOn ? formatShortDate(key.expiresOn) : "no expiry"}
                      {key.nights ? <span className="block text-xs">{key.nights} night(s)</span> : null}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge tone={statusTone(key, today)}>{statusLabel(key, today)}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">{key.reservationNumber ?? "—"}</td>
                    <td className="py-3 pr-4 text-ink-muted">{key.issuedByName ?? "—"}</td>
                    <td className="py-3 text-right">
                      {key.status === "revoked" ? null : (
                        <Button variant="danger" onClick={() => revoke(key)} disabled={busy}>
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
