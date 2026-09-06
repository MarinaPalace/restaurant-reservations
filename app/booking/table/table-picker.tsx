"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { BookingSteps } from "@/components/booking-steps";
import { PageShell } from "@/components/page-shell";
import { SeatHoldBanner } from "@/components/seat-hold-banner";
import { useBookingGuard, writeBookingSession } from "@/hooks/use-booking-session";
import { hasOffer, type ZoneOffer } from "@/lib/floor-plan-availability";
import { TableChooser, findOffer } from "@/components/table-chooser";

/**
 * Where the guest sits — `docs/floor-plan.md` §6.
 *
 * ## Why it fetches rather than being handed the room
 *
 * Every other step gets its data as a server prop. This one cannot: what is
 * free depends on the **date and the party size**, and both live in
 * `sessionStorage` and are read in the browser. The room is also the one thing
 * on this flow that another guest can change while it is on screen.
 *
 * ## Taken tables stay drawn
 *
 * Rule 2.14, and the reason the plan is not filtered: a room with the taken
 * tables missing is a different room every time it loads, and a guest who has
 * spotted the one by the window would find the whole plan rearranged underneath
 * them. Unavailable tables are drawn, crossed through, and say why when tapped.
 *
 * ## Nothing here says who has a table
 *
 * "Taken" is all a guest may be told, and that is enforced by the shape the
 * route sends rather than by this screen choosing not to render it — there is
 * no room number in a `TableOffer` to leak. See `lib/floor-plan-availability.ts`.
 *
 * ## The plan is never the only way to choose
 *
 * The list under the drawing picks the same tables. It is the path for a guest
 * on a small screen, for a guest using a keyboard or a screen reader, and for
 * anybody who simply wants the smallest table that fits without studying a
 * floor plan. The drawing being cut off on a phone once made this screen
 * unusable (`plan-view.tsx`); a screen with two ways through it cannot fail
 * like that again.
 */
type ShareTarget = {
  number: string;
  tables: string[];
  tableNumber: string | null;
  seats?: number;
  fits: boolean;
  /** What the row must seat for both parties together. */
  seatsNeeded: number;
};

/**
 * "We are sitting with another booking", asked before any table is chosen.
 *
 * The number is the credential, as it has always been for sharing a table: a
 * guest who has it was given it by the party they are joining. What comes back
 * is the table they are at and whether this party fits beside them — never a
 * name, a room, or how many are already seated.
 */
function ShareWith({
  date,
  guestCount,
  sharing,
  onShare,
}: {
  date: string;
  guestCount: number;
  sharing: ShareTarget | null;
  onShare: (target: ShareTarget | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState("");

  const check = () => {
    const wanted = number.trim().toUpperCase();

    if (!wanted) {
      setProblem("Please enter the reservation number you are sitting with.");
      return;
    }

    /**
     * The evening and the party size come from the booking session, which is
     * empty until the browser has hydrated. Asking before then sends a blank
     * date and gets back a refusal about the reservation number, which is a
     * lie about which of the three is missing.
     */
    if (!date || guestCount < 1) {
      setProblem("One moment — still loading your booking. Please try again.");
      return;
    }

    setChecking(true);
    setProblem("");

    fetch(
      `/api/booking/share?number=${encodeURIComponent(wanted)}&date=${encodeURIComponent(date)}&guests=${guestCount}`,
    )
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          setProblem(data.error ?? `We could not check that reservation (${response.status}).`);
          onShare(null);
          return;
        }

        onShare(data as ShareTarget);
      })
      .catch(() => setProblem("We could not check that reservation."))
      .finally(() => setChecking(false));
  };

  return (
    <div className="mt-5 rounded-control border border-line bg-surface-muted p-4">
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-ink">
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          checked={open}
          onChange={(event) => {
            setOpen(event.target.checked);

            if (!event.target.checked) {
              setNumber("");
              setProblem("");
              onShare(null);
            }
          }}
        />
        We are sitting with another booking
      </label>

      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          <Field
            label="Their reservation number"
            hint="Ask them for it — it is on their confirmation."
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                value={number}
                autoCapitalize="characters"
                onChange={(event) => setNumber(event.target.value.toUpperCase())}
              />
            )}
          </Field>

          <div>
            <Button variant="secondary" onClick={check} disabled={checking || !date || guestCount < 1}>
              {checking ? "Checking…" : "Find their table"}
            </Button>
          </div>

          {problem ? (
            <Alert tone="warning">
              {problem}
            </Alert>
          ) : null}

          {sharing && !problem ? (
            <Alert tone={sharing.fits ? "info" : "warning"}>
              {sharing.tableNumber
                ? sharing.fits
                  ? // Room for them there, so there is nothing to add: a row
                    // stops growing once it seats everybody, and offering it
                    // promises something the next tap will refuse.
                    `Reservation ${sharing.number} is at table ${sharing.tableNumber}, and there is room for you there. You will be seated with them.`
                  : `Reservation ${sharing.number} is at table ${sharing.tableNumber}, which does not have room for ${guestCount} more. Tap a table beside theirs on the plan to push it together with them.`
                : `Reservation ${sharing.number} has no table yet, so you will be seated together on the night.`}
            </Alert>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function TablePicker() {
  const router = useRouter();
  const { session, ready } = useBookingGuard(["room", "guests", "date"]);

  const [zones, setZones] = useState<ZoneOffer[] | null>(null);
  const [mode, setMode] = useState<"off" | "optional" | "required">("optional");
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState("");

  /**
   * The party this one is sitting with, if any, and where they are sitting.
   *
   * Asked here rather than on the summary because on an evening where guests
   * choose their own table the two are the same question: a party joining
   * another party is not picking a table, they are being told which one they
   * are at. Asked afterwards, it produced bookings marked as sharing a table
   * while holding a different one.
   */
  const [sharing, setSharing] = useState<ShareTarget | null>(null);

  const { date, guestCount } = session;

  /**
   * Loads the room for this evening and this party size.
   *
   * Written as a promise chain rather than an awaited helper because of rule
   * 2.15: no `setState` reachable synchronously from an effect. The chain also
   * makes the cancellation obvious — a guest who taps back before the room
   * arrives must not have state written into an unmounted screen.
   */
  useEffect(() => {
    if (!ready || !date || guestCount < 1) {
      return;
    }

    let cancelled = false;

    fetch(`/api/restaurant/tables?date=${encodeURIComponent(date)}&guests=${guestCount}`)
      .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
      .then(({ ok, body }) => {
        if (cancelled) {
          return;
        }

        if (!ok) {
          setError(body?.error ?? "Unable to load the room.");
          return;
        }

        /**
         * An evening that is not offering the choice sends the guest straight
         * on rather than showing an empty room. It is also what makes the step
         * safe to link to directly: the answer to "should this screen exist
         * tonight" comes from the server, not from whatever the previous page
         * believed.
         */
        if (body.mode === "off") {
          router.replace("/booking/menu");
          return;
        }

        setMode(body.mode);
        setZones(body.zones);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Unable to load the room.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ready, date, guestCount, router]);

  // Tables pushed together count: a room of four-tops has nothing free for a
  // party of five and can still seat them, which is the whole point of them.
  const offerable = zones ? hasOffer(zones) : false;

  /**
   * What is chosen, looked up across every zone — a guest may pick on the
   * terrace and then look at the main hall, and the summary must still name
   * what they have. Answers for tables pushed together as well as for one.
   */
  const chosenTable = findOffer(zones ?? [], chosen);

  /**
   * How many seats the chosen tables have to come to.
   *
   * This party on an ordinary booking, and **both parties** when sitting with
   * somebody: a row holding two parties measured against one of them is judged
   * big enough while somebody is left standing — and then refuses to let the
   * missing table be added, because as far as it knows there is nothing wrong.
   */
  const needed = sharing?.tables.length ? sharing.seatsNeeded : guestCount;

  const goOn = (tableId: string | null) => {
    writeBookingSession({ tableId: tableId ?? "", joinNumber: sharing?.number ?? "" });
    router.push("/booking/menu");
  };

  const choose = (tableId: string | null) => {
    setChosen(tableId);
    setError("");
  };

  const handleContinue = () => {
    if (mode === "required" && !chosen) {
      setError("Please choose a table to continue.");
      return;
    }

    /**
     * A row the guest built by hand can be too small for their party — they
     * are pointing at tables, not doing arithmetic. Caught here because the
     * booking route drops a table it cannot seat and takes the reservation
     * anyway: correct on that side, and silent, so a guest who walked on with
     * two tables for a party of six would have found out by receiving a
     * booking with no table at all.
     */
    if (chosenTable && chosenTable.seats < needed) {
      setError(
        sharing?.tables.length
          ? `Tables ${chosenTable.label} seat ${chosenTable.seats} pushed together, and ${needed} are needed for both parties. Tap a table beside them to add it.`
          : `Tables ${chosenTable.label} seat ${chosenTable.seats} pushed together, which is not enough for ${guestCount}. Add another table, or choose somewhere else.`,
      );
      return;
    }

    goOn(chosen);
  };

  return (
    <PageShell width="lg">
      <BookingSteps current="table" />
      <SeatHoldBanner step="table" />
      <Card elevated className="p-4 sm:p-6">
        <CardHeader
          as="h1"
          align="center"
          flourish
          title="Choose your table"
          description={
            mode === "required"
              ? "Pick where you would like to sit."
              : "Pick where you would like to sit, or leave it to us."
          }
        />

        <ShareWith
          date={date}
          guestCount={guestCount}
          sharing={sharing}
          onShare={(target) => {
            setSharing(target);
            setError("");

            /**
             * Their table becomes this booking's table, and the picker below is
             * locked: the guest asked to sit with somebody, and where that party
             * is sitting is not a thing to be offered a choice about.
             */
            if (target?.tables.length) {
              setChosen(target.tables.join("+"));
            } else if (!target) {
              setChosen(null);
            }
          }}
        />

        {!ready || zones === null ? (
          <Skeleton className="mt-6 h-72 w-full" />
        ) : !offerable && !sharing ? (
          <>
            {/*
              Every table is taken, too small, or out of service. Saying so and
              carrying on is the only decent answer — the seats are still there,
              and refusing the booking over the seating would be absurd.
            */}
            <Alert tone="info" className="mt-6">
              There is no table free for {guestCount} on that evening that you can choose from. Your booking can
              still go ahead and we will seat you.
            </Alert>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/booking/date" size="lg" className="flex-1">
                Back
              </ButtonLink>
              <Button size="lg" className="flex-1" onClick={() => goOn(null)}>
                Continue
              </Button>
            </div>
          </>
        ) : (
          <>
            <TableChooser
              zones={zones}
              guestCount={guestCount}
              needed={needed}
              chosen={chosen}
              onChoose={choose}
              pinned={sharing?.tables ?? []}
            />

            {/*
              What the guest has, in words, next to the button that commits it.
              A table number on a drawing is something to remember; here it is
              something to read.
            */}
            <div
              className="mt-5 rounded-control border border-line bg-surface-muted px-4 py-3 text-center text-sm"
              role="status"
            >
              {chosenTable ? (
                <span className="text-ink">
                  You have chosen{" "}
                  <strong>
                    {chosenTable.tables > 1 ? "tables" : "table"} {chosenTable.label}
                  </strong>
                  , which {chosenTable.tables > 1 ? "seat" : "seats"} {chosenTable.seats}
                  {chosenTable.tables > 1 ? " between them" : ""}.
                </span>
              ) : (
                <span className="text-ink-muted">
                  {mode === "required"
                    ? "No table chosen yet."
                    : "No table chosen — we will seat you if you would rather not pick."}
                </span>
              )}
            </div>

            {error ? (
              <Alert tone="danger" className="mt-4">
                {error}
              </Alert>
            ) : null}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/booking/date" size="lg" className="flex-1">
                Back
              </ButtonLink>
              {/*
                "Any table" is offered unless the evening insists, because most
                guests do not care and forcing a choice adds a step to a flow
                that is otherwise four (§6).
              */}
              {mode === "optional" ? (
                <Button variant="secondary" size="lg" className="flex-1" onClick={() => goOn(null)}>
                  Any table
                </Button>
              ) : null}
              <Button size="lg" className="flex-1" onClick={handleContinue} disabled={mode === "required" && !chosen}>
                Continue
              </Button>
            </div>
          </>
        )}
      </Card>
    </PageShell>
  );
}
