"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/feedback";
import { cx } from "@/components/ui/utils";
import { BookingSteps } from "@/components/booking-steps";
import { PageShell } from "@/components/page-shell";
import { useBookingGuard, writeBookingSession } from "@/hooks/use-booking-session";
import { FEATURE_LABELS, type FloorFeature } from "@/lib/floor-plan";
import type { TableOffer, ZoneOffer } from "@/lib/floor-plan-availability";

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
 * them. Unavailable tables are drawn, greyed, and not tappable.
 *
 * ## Nothing here says who has a table
 *
 * "Taken" is all a guest may be told, and that is enforced by the shape the
 * route sends rather than by this screen choosing not to render it — there is
 * no room number in a `TableOffer` to leak. See `lib/floor-plan-availability.ts`.
 */
export function TablePicker() {
  const router = useRouter();
  const { session, ready } = useBookingGuard(["room", "guests", "date"]);

  const [zones, setZones] = useState<ZoneOffer[] | null>(null);
  const [mode, setMode] = useState<"off" | "optional" | "required">("optional");
  const [zoneId, setZoneId] = useState<string | null>(null);
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
        setZoneId((current) => current ?? body.zones[0]?.id ?? null);
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

  const zone = zones?.find((entry) => entry.id === zoneId) ?? zones?.[0] ?? null;
  const offerable = zones?.some((entry) => entry.tables.some((table) => !table.unavailable)) ?? false;

  const goOn = (tableId: string | null) => {
    writeBookingSession({ tableId: tableId ?? "" });
    router.push("/booking/menu");
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
            {zones.length > 1 ? (
              <div className="mt-5 flex flex-wrap justify-center gap-1.5">
                {zones.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={entry.id === zone?.id}
                    onClick={() => setZoneId(entry.id)}
                    className={cx(
                      "min-h-10 rounded-control border px-3 text-sm font-medium transition-colors",
                      entry.id === zone?.id
                        ? "border-accent bg-accent-soft text-accent-ink"
                        : "border-line-strong bg-surface text-ink-muted hover:border-accent",
                    )}
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
            ) : null}

            {zone ? (
              <div className="mt-5 overflow-x-auto rounded-control border border-line bg-surface-muted p-2 sm:p-3">
                <svg
                  viewBox={`0 0 ${zone.width} ${zone.height}`}
                  preserveAspectRatio="xMidYMid meet"
                  className="w-full min-w-[22rem] touch-none"
                  role="group"
                  aria-label={`${zone.name}, tables available for ${guestCount}`}
                >
                  <rect width={zone.width} height={zone.height} rx={8} className="fill-surface" />

                  {zone.features.map((feature) => (
                    <RoomFeature key={feature.id} feature={feature} />
                  ))}

                  {zone.tables.map((table) => (
                    <PickableTable
                      key={table.id}
                      table={table}
                      chosen={chosen === table.id}
                      onChoose={() => {
                        setChosen((current) => (current === table.id ? null : table.id));
                        setError("");
                      }}
                    />
                  ))}
                </svg>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-ink-muted">
              <Key className="border-line-strong bg-surface" label="Free" />
              <Key className="border-accent bg-primary" label="Yours" />
              <Key className="border-line bg-surface-sunken" label="Taken or too small" />
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

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx("inline-block size-3 rounded-sm border", className)} aria-hidden="true" />
      {label}
    </span>
  );
}

/** The room around the tables. Scenery: nothing here is interactive. */
function RoomFeature({ feature }: { feature: FloorFeature }) {
  return (
    <g
      transform={`translate(${feature.x} ${feature.y}) rotate(${feature.rotation} ${feature.width / 2} ${feature.height / 2})`}
      className="pointer-events-none"
    >
      <rect
        width={feature.width}
        height={feature.height}
        rx={feature.kind === "plant" ? feature.width / 2 : 6}
        className={cx(
          feature.kind === "window" ? "fill-accent-soft stroke-gold/50" : "fill-surface-sunken stroke-line",
        )}
        strokeWidth={2}
      />
      {feature.height >= 40 && feature.width >= 70 ? (
        <text
          x={feature.width / 2}
          y={feature.height / 2 + 5}
          textAnchor="middle"
          className="select-none fill-ink-subtle text-[14px]"
        >
          {feature.label || FEATURE_LABELS[feature.kind]}
        </text>
      ) : null}
    </g>
  );
}

/**
 * One table.
 *
 * Unavailable tables keep their place and lose their affordance: `aria-disabled`
 * and no handler rather than being removed, so the room a guest is looking at
 * stays the room it was a moment ago.
 */
function PickableTable({
  table,
  chosen,
  onChoose,
}: {
  table: TableOffer;
  chosen: boolean;
  onChoose: () => void;
}) {
  const free = !table.unavailable;
  const middle = { x: table.width / 2, y: table.height / 2 };

  const fill = chosen
    ? "fill-primary stroke-accent"
    : free
      ? "fill-surface stroke-line-strong"
      : "fill-surface-sunken stroke-line";

  return (
    <g
      transform={`translate(${table.x} ${table.y}) rotate(${table.rotation} ${middle.x} ${middle.y})`}
      role={free ? "button" : undefined}
      tabIndex={free ? 0 : undefined}
      aria-disabled={free ? undefined : true}
      aria-pressed={free ? chosen : undefined}
      aria-label={
        free
          ? `Table ${table.label}, seats ${table.seats}`
          : `Table ${table.label}, ${table.unavailable === "too-small" ? "too small for your party" : "not available"}`
      }
      className={cx(free ? "cursor-pointer" : "cursor-default opacity-55")}
      onClick={() => free && onChoose()}
      onKeyDown={(event) => {
        if (free && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onChoose();
        }
      }}
    >
      {table.shape === "round" || table.shape === "oval" ? (
        <ellipse cx={middle.x} cy={middle.y} rx={table.width / 2} ry={table.height / 2} className={cx("stroke-2", fill)} />
      ) : (
        <rect width={table.width} height={table.height} rx={8} className={cx("stroke-2", fill)} />
      )}

      <text
        x={middle.x}
        y={middle.y - 2}
        textAnchor="middle"
        className={cx(
          "pointer-events-none select-none text-[17px] font-semibold",
          chosen ? "fill-primary-fg" : "fill-ink",
        )}
      >
        {table.label}
      </text>
      <text
        x={middle.x}
        y={middle.y + 14}
        textAnchor="middle"
        className={cx(
          "pointer-events-none select-none text-[13px]",
          chosen ? "fill-primary-fg" : "fill-ink-subtle",
        )}
      >
        {table.seats}
      </text>
    </g>
  );
}
