"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { BookingSteps } from "@/components/booking-steps";
import { Brand } from "@/components/brand";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/feedback";
import { useBookingSession, writeBookingSession } from "@/hooks/use-booking-session";
import { isValidRoomNumber } from "@/lib/booking-session";
import { PASS_KEY_PREFIX, formatPassKey, isValidPassKeyFormat, normalizePassKey } from "@/lib/pass-key";
import { formatLongDate } from "@/lib/date";

/**
 * The prefix every key carries. Kept in the field so the guest only ever types
 * the part that varies, and cannot delete it by accident.
 */
const PREFIX = `${PASS_KEY_PREFIX}-`;

type Checked = {
  kind: "standard" | "premium";
  expiresOn: string | null;
  usesRemaining: number;
  bookedDates: string[];
};

/**
 * One door for everybody.
 *
 * The key decides which flow the guest belongs in: an invitation key goes to
 * the invitation page, an in-house key asks for a room and carries on here.
 * There is deliberately no separate address to guess at — the old open
 * `/premium` page showed the menu and the evenings to anyone who found it.
 */
function BookingEntry() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useBookingSession();

  // A key can arrive in the link — from the QR code on the printed card.
  const fromLink = searchParams.get("k");

  const [passKey, setPassKey] = useState<string | null>(
    fromLink && isValidPassKeyFormat(fromLink) ? formatPassKey(fromLink) : null,
  );
  const [roomNumber, setRoomNumber] = useState<string | null>(null);
  const [passKeyError, setPassKeyError] = useState("");
  const [roomError, setRoomError] = useState("");
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<Checked | null>(null);

  const roomValue = roomNumber ?? session.roomNumber;
  const passKeyValue = passKey ?? (session.passKey ? formatPassKey(session.passKey) : PREFIX);

  /** Step one: is this key real, and whose flow does it belong to? */
  const checkKey = async () => {
    const normalizedKey = normalizePassKey(passKeyValue);

    if (!isValidPassKeyFormat(normalizedKey)) {
      setPassKeyError("Please enter the pass-key from your card.");
      return;
    }

    setChecking(true);
    setPassKeyError("");

    try {
      const response = await fetch("/api/booking/pass-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passKey: normalizedKey }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        setPassKeyError(data.error ?? "That pass-key is not valid. Please check it and try again.");
        setChecking(false);
        return;
      }

      // An invitation has no room to give, and its own menu and evenings.
      if (data.kind === "premium") {
        router.push(`/premium/${encodeURIComponent(normalizedKey)}`);
        return;
      }

      writeBookingSession({
        passKey: normalizedKey,
        passKeyExpiresOn: data.expiresOn ?? "",
        passKeyBookedDates: data.bookedDates ?? [],
        passKeyMaxGuests: data.maxGuests ?? 0,
      });
      setChecked({
        kind: data.kind,
        expiresOn: data.expiresOn ?? null,
        usesRemaining: data.usesRemaining ?? 0,
        bookedDates: data.bookedDates ?? [],
      });
      setChecking(false);
    } catch {
      setPassKeyError("We could not reach the restaurant. Please check your connection and try again.");
      setChecking(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (checking) {
      return;
    }

    if (!checked) {
      await checkKey();
      return;
    }

    const trimmedRoom = roomValue.trim();
    if (!isValidRoomNumber(trimmedRoom)) {
      setRoomError("Please enter your room number, for example 402 or L10.");
      return;
    }

    writeBookingSession({ roomNumber: trimmedRoom });
    router.push("/booking/guests");
  };

  return (
    <PageShell width="sm">
      <BookingSteps current="room" />
      <Card className="p-6 sm:p-8">
        <Brand stacked className="mb-6" />

        <CardHeader
          as="h1"
          align="center"
          flourish
          eyebrow="Reservations"
          title="Reserve your dinner"
          description="Your pass-key is on the card you were given — scan it, or type it below."
        />

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-6">
          <Field
            label="Pass-key"
            error={passKeyError}
            hint="From your card. Capitals and dashes do not matter."
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                name="passKey"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoFocus={!fromLink}
                maxLength={24}
                placeholder={`${PREFIX}XXXXX-XXXXX`}
                value={passKeyValue}
                readOnly={Boolean(checked)}
                onChange={(event) => {
                  // The prefix is part of every key, so it is put back if the
                  // guest deletes it while editing.
                  const typed = event.target.value.toUpperCase();
                  setPassKey(typed.startsWith(PREFIX) ? typed : PREFIX + normalizePassKey(typed));
                  setPassKeyError("");
                }}
                onFocus={(event) => {
                  // Never leave the caret in front of the prefix.
                  if (event.target.selectionStart !== null && event.target.selectionStart < PREFIX.length) {
                    event.target.setSelectionRange(event.target.value.length, event.target.value.length);
                  }
                }}
                onBlur={(event) => {
                  const normalized = normalizePassKey(event.target.value);
                  setPassKey(isValidPassKeyFormat(normalized) ? formatPassKey(normalized) : event.target.value);
                }}
                className="text-xl tracking-wider"
              />
            )}
          </Field>

          {/* The room is only asked for once the key is known to be in-house. */}
          {checked ? (
            <>
              <Alert tone="success">
                Pass-key accepted.{" "}
                {checked.usesRemaining === 1
                  ? "One dinner left on it"
                  : `${checked.usesRemaining} dinners left on it`}
                {checked.expiresOn ? `, up to ${formatLongDate(checked.expiresOn)}` : ""}.
              </Alert>

              <Field
                label="Your room number"
                error={roomError}
                hint="The room you are in now — tell us if you have moved since checking in."
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    name="roomNumber"
                    autoComplete="off"
                    autoFocus
                    maxLength={10}
                    placeholder="e.g. 402 or L10"
                    value={roomValue}
                    onChange={(event) => {
                      setRoomNumber(event.target.value.replace(/[^A-Za-z0-9-]/g, "").toUpperCase());
                      setRoomError("");
                    }}
                    className="text-xl"
                  />
                )}
              </Field>

              {/*
                Booking a second table on a night they already have is allowed
                — a guest with dinners to spare often books for another room —
                but it is far more often a guest meaning to change what they
                already booked.
              */}
              {checked.bookedDates.length > 0 ? (
                <Alert tone="warning">
                  You already have a reservation on{" "}
                  {checked.bookedDates.map((date) => formatLongDate(date)).join(", ")}. To change it,{" "}
                  <Link href="/booking/manage" className="font-semibold underline underline-offset-2">
                    manage your reservation
                  </Link>{" "}
                  instead. Carry on only if you are booking a second table.
                </Alert>
              ) : null}
            </>
          ) : null}

          <Button type="submit" size="lg" className="w-full" loading={checking} loadingLabel="Checking…">
            {checked ? "Continue" : "Check my pass-key"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-muted">
          Already booked?{" "}
          <Link href="/booking/manage" className="font-medium text-accent underline underline-offset-2">
            Change or cancel your reservation
          </Link>
        </p>

        <p className="mt-4 rounded-control border border-line bg-surface-muted p-3 text-sm text-ink-muted">
          No pass-key, or it is not working? Dial <span className="font-semibold text-ink">9</span> from your room to
          reach guest services.
        </p>
      </Card>
    </PageShell>
  );
}

export default function BookingPage() {
  return (
    <Suspense fallback={null}>
      <BookingEntry />
    </Suspense>
  );
}
