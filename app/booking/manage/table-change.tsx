"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/feedback";
import { TableChooser, findOffer } from "@/components/table-chooser";
import type { ZoneOffer } from "@/lib/floor-plan-availability";
import type { ReservationRecord } from "@/types/booking";

/**
 * The table on a booking a guest already has, and changing it.
 *
 * ## Why this exists
 *
 * A table could be chosen once, when the booking was made, and never again — a
 * guest who wanted a different one telephoned reception, which is the answer
 * this app exists to stop giving. Everything needed was already built: the
 * plan, the claim rules, the pass-key that authorises every other self-service
 * change, and now one chooser shared with the booking flow.
 *
 * ## The room is fetched when it is asked for
 *
 * Not with the booking. Most guests open this screen to check what they
 * ordered, and loading a floor plan and every claim on the evening for all of
 * them is work nobody asked for. It also means the room is read at the moment
 * the guest looks at it, which is exactly when it is most likely to be right.
 *
 * ## What it does not decide
 *
 * Whether the change is allowed at all. The route checks the deadline, the
 * evening's switch and the shared-table rule, and refuses with a sentence this
 * screen shows as it is. Hiding a button is presentation; the write path is
 * where the answer lives (rule 2.5).
 */
export function TableChange({
  passKey,
  reservation,
  canModify,
  label,
  onSaved,
}: {
  passKey: string;
  reservation: ReservationRecord;
  canModify: boolean;
  /** "Table", in the guest's own language. */
  label: string;
  onSaved: (updated: ReservationRecord) => void;
}) {
  const [zones, setZones] = useState<ZoneOffer[] | null>(null);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(reservation.tableId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** Nothing to offer tonight, so the button is not worth drawing. */
  const [offered, setOffered] = useState(true);

  const openChooser = async () => {
    setOpen(true);
    setError("");
    setChosen(reservation.tableId ?? null);

    if (zones) {
      return;
    }

    try {
      const response = await fetch(
        `/api/restaurant/tables?date=${encodeURIComponent(reservation.date)}&guests=${reservation.guestCount}`,
      );
      const body = await response.json();

      if (!response.ok) {
        setError(body?.error ?? "Unable to load the room.");
        return;
      }

      if (body.mode === "off") {
        // The evening stopped offering the choice after this booking was made.
        setOffered(false);
        setOpen(false);
        return;
      }

      setZones(body.zones);
    } catch {
      setError("Unable to load the room.");
    }
  };

  const save = async () => {
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/booking/manage/table", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passKey,
          reservationNumber: reservation.reservationNumber,
          tableId: chosen ?? "",
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        setError(body?.error ?? "Unable to change your table.");
        // The room has moved on since it was drawn — somebody took a table, or
        // the evening changed. Fetch it again so the guest is choosing from
        // what is actually free rather than from what was.
        setZones(null);
        void openChooser();
        return;
      }

      onSaved(body.reservation);
      setOpen(false);
    } catch {
      setError("Unable to change your table.");
    } finally {
      setBusy(false);
    }
  };

  const current = reservation.tableNumber;
  const pending = zones ? findOffer(zones, chosen) : null;

  return (
    <section className="mt-4 rounded-control border border-line bg-surface-muted p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="eyebrow">{label}</h2>
          <p className="mt-1 text-lg font-semibold text-ink">
            {current || <span className="text-base font-normal text-ink-muted">We will seat you</span>}
          </p>
        </div>

        {canModify && offered && !open ? (
          <Button variant="secondary" onClick={openChooser}>
            {current ? "Change table" : "Choose a table"}
          </Button>
        ) : null}
      </div>

      {/*
        Shared tables are refused by the route, and saying so before the guest
        has picked one is kinder than refusing afterwards. The route still
        refuses — this is the explanation, not the rule.
      */}
      {reservation.tableGroupId ? (
        <p className="mt-2 text-sm text-ink-muted">
          You are sharing this table with another room, so it is changed by reception rather than here.
        </p>
      ) : null}

      {error ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : null}

      {open ? (
        zones === null ? (
          <Skeleton className="mt-4 h-72 w-full" />
        ) : (
          <>
            <TableChooser
              zones={zones}
              guestCount={reservation.guestCount}
              chosen={chosen}
              onChoose={setChosen}
            />

            <div className="mt-4 rounded-control border border-line bg-surface px-4 py-3 text-center text-sm">
              {pending ? (
                <span className="text-ink">
                  Moving to <strong>table {pending.label}</strong>, which seats {pending.seats}.
                </span>
              ) : (
                <span className="text-ink-muted">No table chosen — we will seat you.</span>
              )}
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={save} disabled={busy || chosen === (reservation.tableId ?? null)}>
                {busy ? "Saving…" : "Save this table"}
              </Button>
            </div>
          </>
        )
      ) : null}
    </section>
  );
}
