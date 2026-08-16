"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

export default function BookingPage() {
  const router = useRouter();
  const session = useBookingSession();
  const [passKey, setPassKey] = useState<string | null>(null);
  const [roomNumber, setRoomNumber] = useState<string | null>(null);
  const [passKeyError, setPassKeyError] = useState("");
  const [roomError, setRoomError] = useState("");
  const [checking, setChecking] = useState(false);

  // Falls back to whatever is already in the session until the guest types.
  const roomValue = roomNumber ?? session.roomNumber;
  const passKeyValue = passKey ?? (session.passKey ? formatPassKey(session.passKey) : PREFIX);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (checking) {
      return;
    }

    const normalizedKey = normalizePassKey(passKeyValue);
    const trimmedRoom = roomValue.trim();

    const keyProblem = isValidPassKeyFormat(normalizedKey)
      ? ""
      : "Please enter the pass-key from your check-in card.";
    const roomProblem = isValidRoomNumber(trimmedRoom)
      ? ""
      : "Please enter your room number, for example 402 or L10.";

    setPassKeyError(keyProblem);
    setRoomError(roomProblem);

    if (keyProblem || roomProblem) {
      return;
    }

    setChecking(true);

    /**
     * The key is checked here, before the guest chooses anything.
     *
     * It used to be judged only when the finished booking was submitted, so a
     * guest with a spent or expired key picked a date and a full menu for
     * everyone at the table before being told it was never going to work.
     */
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

      writeBookingSession({
        passKey: normalizedKey,
        passKeyExpiresOn: data.expiresOn ?? "",
        roomNumber: trimmedRoom,
      });
      router.push("/booking/guests");
    } catch {
      setPassKeyError("We could not reach the restaurant. Please check your connection and try again.");
      setChecking(false);
    }
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
          description="Dinner is part of your stay with us. Your pass-key is on the card you were given at check-in."
        />

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-6">
          <Field
            label="Pass-key"
            error={passKeyError}
            hint="From your check-in card. Capitals and dashes do not matter."
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                name="passKey"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                maxLength={24}
                placeholder={`${PREFIX}XXXXX-XXXXX`}
                value={passKeyValue}
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

          {/* Reassurance that the key is live, once we have checked it. */}
          {session.passKeyExpiresOn && !passKeyError ? (
            <Alert tone="info">
              This pass-key can book dinner up to {formatLongDate(session.passKeyExpiresOn)}.
            </Alert>
          ) : null}

          <Button type="submit" size="lg" className="w-full" loading={checking} loadingLabel="Checking…">
            Continue
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
