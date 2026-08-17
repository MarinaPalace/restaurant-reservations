"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { BookingSteps } from "@/components/booking-steps";
import { Brand } from "@/components/brand";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/feedback";
import { useBookingSession, writeBookingSession } from "@/hooks/use-booking-session";
import { useI18n } from "@/components/i18n-provider";
import { format, localeOf, plural } from "@/lib/i18n";
import { translateApiError } from "@/lib/i18n/errors";
import { isValidRoomNumber } from "@/lib/booking-session";
import { PASS_KEY_PREFIX, formatPassKey, isValidPassKeyFormat, normalizePassKey } from "@/lib/pass-key";
import { manageHref } from "@/lib/pass-key-links";
import { formatLongDate } from "@/lib/date";

/**
 * The prefix every key carries. Kept in the field so the guest only ever types
 * the part that varies, and cannot delete it by accident.
 */
const PREFIX = `${PASS_KEY_PREFIX}-`;

type Checked = {
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
 *
 * **A key that has already been accepted is never asked for again.** It arrives
 * either in the link — from the QR on the printed card — or from the session,
 * and coming back to this step by the Back button, a reload or browser history
 * restores it rather than presenting an empty box. A guest who scanned a card
 * should never end up typing the code by hand.
 */
function BookingEntry() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useBookingSession();
  const { t, language } = useI18n();
  const locale = localeOf(language);

  // A key can arrive in the link — from the QR code on the printed card.
  const fromLink = searchParams.get("k");

  const [typed, setTyped] = useState<string | null>(null);
  const [roomNumber, setRoomNumber] = useState<string | null>(null);
  const [passKeyError, setPassKeyError] = useState("");
  const [roomError, setRoomError] = useState("");
  const [checking, setChecking] = useState(false);
  const [verified, setVerified] = useState<Checked | null>(null);
  /** Set once the guest starts changing the key, which un-accepts it. */
  const [changingKey, setChangingKey] = useState(false);

  /**
   * A key already accepted earlier in this session. Trusted only to avoid
   * asking for it twice — the booking itself is checked server-side either
   * way, so a tampered value buys nothing.
   */
  const restored = !changingKey && !verified && Boolean(session.passKey);
  const accepted = verified !== null || restored;

  const roomValue = roomNumber ?? session.roomNumber;
  const passKeyValue =
    typed ??
    (fromLink && isValidPassKeyFormat(fromLink)
      ? formatPassKey(fromLink)
      : session.passKey
        ? formatPassKey(session.passKey)
        : PREFIX);

  const checkKey = async () => {
    const normalizedKey = normalizePassKey(passKeyValue);

    if (!isValidPassKeyFormat(normalizedKey)) {
      setPassKeyError(t.entry.passKeyMissing);
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
        setPassKeyError(translateApiError(t, data) ?? t.entry.passKeyInvalid);
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

      /**
       * The key goes into the address too, so a reload still carries it — the
       * same reason the QR code puts it there.
       */
      router.replace(`/booking?k=${encodeURIComponent(formatPassKey(normalizedKey))}`, { scroll: false });

      setVerified({
        expiresOn: data.expiresOn ?? null,
        usesRemaining: data.usesRemaining ?? 0,
        bookedDates: data.bookedDates ?? [],
      });
      setChangingKey(false);
      setChecking(false);
    } catch {
      setPassKeyError(t.common.connectionProblem);
      setChecking(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (checking) {
      return;
    }

    if (!accepted) {
      await checkKey();
      return;
    }

    const trimmedRoom = roomValue.trim();
    if (!isValidRoomNumber(trimmedRoom)) {
      setRoomError(t.entry.roomInvalid);
      return;
    }

    writeBookingSession({ roomNumber: trimmedRoom });
    router.push("/booking/guests");
  };

  const bookedDates = verified?.bookedDates ?? session.passKeyBookedDates;
  const expiresOn = verified?.expiresOn ?? (session.passKeyExpiresOn || null);

  /**
   * Self-service carries the key across, so a guest who has just scanned a
   * card is not asked to type it again. Taken from the box rather than the
   * session, because the session has nothing in it until the key is checked.
   */
  const currentKey = normalizePassKey(passKeyValue);
  const manageLink = manageHref(isValidPassKeyFormat(currentKey) ? currentKey : session.passKey);

  return (
    <PageShell width="sm">
      <BookingSteps current="room" />
      {/* The one hero gesture on this screen: the panel settling into place. */}
      <Card elevated className="aurora sheen p-6 sm:p-8">
        <Brand stacked className="mb-6" />

        {/*
          Set by hand rather than through CardHeader: this is the one screen
          that gets the full editorial scale, and the shared component stays
          moderate because the admin panel uses it too.
        */}
        <div className="text-center">
          <p className="eyebrow">{t.entry.eyebrow}</p>
          <h1 className="display mt-3 text-balance text-[clamp(2.6rem,11vw,4rem)] leading-[0.95] tracking-[-0.025em] text-ink">
            {t.entry.titleLine1}
            <br />
            <span className="italic text-accent">{t.entry.titleLine2}</span>
          </h1>
          <hr className="rule-gold rule-animate mx-auto mt-5 w-28" aria-hidden="true" />
          <p className="mx-auto mt-4 max-w-[22rem] text-pretty text-ink-muted">{t.entry.intro}</p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="stage mt-6 space-y-6">
          <Field label={t.entry.passKeyLabel} error={passKeyError} hint={t.entry.passKeyHint}>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                name="passKey"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoFocus={!fromLink && !session.passKey}
                maxLength={24}
                placeholder={`${PREFIX}XXXXX-XXXXX`}
                value={passKeyValue}
                readOnly={accepted}
                onChange={(event) => {
                  // The prefix is part of every key, so it is put back if the
                  // guest deletes it while editing.
                  const value = event.target.value.toUpperCase();
                  setTyped(value.startsWith(PREFIX) ? value : PREFIX + normalizePassKey(value));
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
                  setTyped(isValidPassKeyFormat(normalized) ? formatPassKey(normalized) : event.target.value);
                }}
                className="text-xl tracking-wider"
              />
            )}
          </Field>

          {accepted ? (
            <>
              <Alert tone="success">
                {verified
                  ? format(
                      plural(
                        language,
                        verified.usesRemaining,
                        expiresOn ? t.entry.acceptedDinnersUntil : t.entry.acceptedDinners,
                      ),
                      { date: expiresOn ? formatLongDate(expiresOn, locale) : "" },
                    )
                  : expiresOn
                    ? format(t.entry.acceptedUntil, { date: formatLongDate(expiresOn, locale) })
                    : t.entry.accepted}
              </Alert>

              {/*
                The only way to change an accepted key — and it keeps whatever
                is already in the box, so a scanned code is never retyped.
              */}
              <button
                type="button"
                onClick={() => {
                  setChangingKey(true);
                  setVerified(null);
                  setTyped(passKeyValue);
                  setRoomError("");
                }}
                className="text-sm font-medium text-accent underline underline-offset-2"
              >
                {t.entry.useAnotherKey}
              </button>

              <Field label={t.entry.roomLabel} error={roomError} hint={t.entry.roomHint}>
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    name="roomNumber"
                    autoComplete="off"
                    autoFocus={!session.roomNumber}
                    maxLength={10}
                    placeholder={t.entry.roomPlaceholder}
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
              {bookedDates.length > 0 ? (
                <Alert tone="warning">
                  {format(t.entry.alreadyBooked, {
                    dates: bookedDates.map((date) => formatLongDate(date, locale)).join(", "),
                  })}{" "}
                  {/* Split around the link, so a translation can put the link
                      where its own grammar wants it rather than at the end. */}
                  {(() => {
                    const [before, after] = t.entry.alreadyBookedManage.split("{link}");
                    return (
                      <>
                        {before}
                        <Link href={manageLink} className="font-semibold underline underline-offset-2">
                          {t.entry.alreadyBookedLink}
                        </Link>
                        {after}
                      </>
                    );
                  })()}
                </Alert>
              ) : null}
            </>
          ) : null}

          <Button type="submit" size="lg" className="w-full" loading={checking} loadingLabel={t.common.checking}>
            {accepted ? t.common.continue : t.entry.checkKey}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-muted">
          {t.entry.manageQuestion}{" "}
          <Link href={manageLink} className="font-medium text-accent underline underline-offset-2">
            {t.entry.manageLink}
          </Link>
        </p>

        <p className="mt-4 rounded-control border border-line bg-surface-muted p-3 text-sm text-ink-muted">
          {format(t.entry.noKey, { number: "9" })}
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
