"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/feedback";
import { BookingSteps } from "@/components/booking-steps";
import { PageShell } from "@/components/page-shell";
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
export function TablePicker() {
  const router = useRouter();
  const { session, ready } = useBookingGuard(["room", "guests", "date"]);

  const [zones, setZones] = useState<ZoneOffer[] | null>(null);
  const [mode, setMode] = useState<"off" | "optional" | "required">("optional");
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState("");

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

  const goOn = (tableId: string | null) => {
    writeBookingSession({ tableId: tableId ?? "" });
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

    goOn(chosen);
  };

  return (
    <PageShell width="lg">
      <BookingSteps current="table" />
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

        {!ready || zones === null ? (
          <Skeleton className="mt-6 h-72 w-full" />
        ) : !offerable ? (
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
            <TableChooser zones={zones} guestCount={guestCount} chosen={chosen} onChoose={choose} />

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
