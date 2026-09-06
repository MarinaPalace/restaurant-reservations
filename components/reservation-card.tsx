"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { useI18n } from "@/components/i18n-provider";
import { localeOf } from "@/lib/i18n";
import { buildReservationCard, reservationCardFileName } from "@/lib/reservation-card";
import { drawReservationCard } from "@/lib/reservation-card-image";
import type { ReservationRecord } from "@/types/booking";

/**
 * The confirmation card, on screen and on the way to the guest's phone.
 *
 * The reservation number was already on this page, in a box, and it was
 * enough to read out. What it was not was a thing to *show*: staff had nothing
 * to scan, and a guest whose phone had no signal at the door had nothing at
 * all. So the same booking is drawn once more as a card with a code on it, and
 * offered as an image to keep.
 *
 * ## The code is fetched, not drawn here
 *
 * `lib/qr.ts` is emphatic about this, from three failures: a code drawn in the
 * browser is a code that can silently come out blank. It is drawn on the
 * server and arrives as a data URI. The card renders without it in the
 * meantime and stays perfectly usable if it never arrives — the number on it is
 * legible from across a room, which is more than a broken code manages.
 */
export function ReservationCard({
  reservation,
  passKey,
  timeZoneLabel,
}: {
  reservation: ReservationRecord;
  passKey: string;
  timeZoneLabel: string;
}) {
  const { t, language } = useI18n();
  const locale = localeOf(language);

  const [qr, setQr] = useState<string | null>(null);
  /** Whether the code is still coming, so the square stops saying "loading". */
  const [qrPending, setQrPending] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const card = buildReservationCard(
    reservation,
    {
      numberLabel: t.confirmation.number,
      room: t.common.room,
      date: t.common.date,
      arrivalTime: t.confirmation.arrivalTime,
      guests: t.common.guests,
      table: t.common.table,
      footnote: t.card.footnote,
    },
    { locale, timeZoneLabel },
  );

  const reservationNumber = reservation.reservationNumber;

  useEffect(() => {
    if (!passKey) {
      return;
    }

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/booking/card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The key travels in the body, never the URL, so it does not end up
          // in history, a proxy log or a Referer header.
          body: JSON.stringify({ passKey, reservationNumber }),
          signal: controller.signal,
        });

        if (response.ok) {
          const data = await response.json();

          if (typeof data.qr === "string") {
            setQr(data.qr);
          }
        }
      } catch {
        // The card is drawn either way. A guest who cannot reach us at this
        // moment still has the number, which is the part staff can act on.
      } finally {
        // Whatever happened, stop saying the code is on its way. A square that
        // reads "Loading…" for ever is worse than one that admits there is no
        // code — the guest waits for something that is not coming.
        setQrPending(false);
      }
    })();

    return () => controller.abort();
  }, [passKey, reservationNumber]);

  const saveImage = async () => {
    if (saving) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const blob = await drawReservationCard(card, qr);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = reservationCardFileName(reservationNumber, "png");
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      // The guest's language, not the thrown message: everything
      // `drawReservationCard` raises is an Error, so reading `.message` meant a
      // guest booking in Bulgarian was shown an English sentence.
      setError(t.card.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-6" aria-labelledby="reservation-card-heading">
      <h2 id="reservation-card-heading" className="sr-only">
        {t.card.title}
      </h2>

      {/*
        Deliberately its own object rather than another panel inside the
        confirmation: this is the thing the guest shows at the door, and it
        should look like something that could be torn off and carried.

        No `data-print` attribute, which is rarer here than it looks: this
        belongs on screen *and* on paper. `only` would hide it from the guest
        reading it now, and `hide` would drop it from the printout, which is
        the copy they carry down.
      */}
      <div className="overflow-hidden rounded-control border border-line-strong bg-surface">
        <div className="h-1.5 bg-gradient-to-r from-accent to-gold" aria-hidden="true" />

        <div className="p-5 text-center">
          <p className="eyebrow">{card.tagline}</p>
          <p className="mt-1 text-xl font-semibold text-ink">{card.restaurantName}</p>

          <div className="mt-4 rounded-control border border-line bg-surface-muted px-4 py-3">
            <p className="eyebrow">{card.numberLabel}</p>
            <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.18em] text-ink">
              {card.reservationNumber}
            </p>
          </div>

          <dl className="mt-4 space-y-2 text-left text-sm">
            {card.rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
                <dt className="text-ink-subtle">{row.label}</dt>
                <dd className="text-right font-semibold text-ink">
                  {row.value}
                  {row.note ? (
                    <span className="block text-xs font-normal text-ink-muted">{row.note}</span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>

          {/*
            A fixed square whether or not the code has arrived, so the card does
            not jump when it does — the guest may already be reading it.
          */}
          <div className="mx-auto mt-4 flex size-[9.5rem] items-center justify-center rounded-control border border-line bg-white p-2">
            {qr ? (
              <Image
                src={qr}
                alt={t.card.qrAlt}
                width={160}
                height={160}
                unoptimized
                className="size-full"
              />
            ) : (
              <span className="px-2 text-center text-xs text-ink-subtle">
                {qrPending ? t.common.loading : t.card.noCode}
              </span>
            )}
          </div>

          <p className="mt-3 text-xs text-ink-muted">{card.footnote}</p>
        </div>
      </div>

      {error ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : null}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row" data-print="hide">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={saveImage}
          loading={saving}
          loadingLabel={t.card.saving}
        >
          {t.card.saveImage}
        </Button>
      </div>
    </section>
  );
}
