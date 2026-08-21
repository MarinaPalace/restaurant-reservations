import { Fragment } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { Card, CardHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/feedback";
import { ContactLink } from "@/components/contact-link";
import { getCurrentStaffUser } from "@/lib/auth/guard";
import { getReservationByNumber } from "@/lib/services/reservations";
import { getAuditEntries } from "@/lib/services/audit-log";
import { getPassKeyById } from "@/lib/services/pass-keys";
import { formatPassKey } from "@/lib/pass-key";
import { getCurrency } from "@/lib/services/settings";
import { formatPrice, sumFinalPrices } from "@/lib/money";
import { getMenuCatalog } from "@/lib/services/restaurant";
import { canonicalizeSelections } from "@/lib/menu-selection";
import { reservationLabel } from "@/lib/kitchen-report";
import { findMissingCourses, summarizeSelections } from "@/lib/reservation-ticket";
import { formatLongDate } from "@/lib/date";

export const metadata: Metadata = { title: "Reservation" };

export default async function ReservationDetailPage({
  params,
}: {
  params: Promise<{ reservationNumber: string }>;
}) {
  if (!(await getCurrentStaffUser())) {
    redirect("/admin/login");
  }

  const { reservationNumber } = await params;
  const [stored, menu, history, currency] = await Promise.all([
    getReservationByNumber(reservationNumber),
    getMenuCatalog(),
    // Everything that has happened to this booking, newest first.
    getAuditEntries({ reservationNumber, limit: 50 }),
    // What promotions on this booking are priced in.
    getCurrency(),
  ]);

  if (!stored) {
    // A missing reservation is a 404, not a silent bounce to the dashboard.
    notFound();
  }

  // Shown so reception can read the key back to a guest who has lost their
  // slip and needs to change the booking themselves.
  const passKey = stored.passKeyId ? await getPassKeyById(stored.passKeyId) : null;

  // Resolved against the English menu, so a booking taken in another language
  // still reads in English for staff.
  const reservation = { ...stored, selections: canonicalizeSelections(stored.selections, menu) };

  const guestGroups = Array.from({ length: Math.max(reservation.guestCount, 1) }, (_, guestIndex) => ({
    guestIndex,
    entries: reservation.selections.filter((entry) => (entry.guestIndex ?? 0) === guestIndex),
  }));

  /**
   * How many of each dish this booking needs — the number written on the ticket
   * the guest handed in. Without it, checking a booking against its ticket meant
   * reading every guest's list and adding the dishes up by hand.
   */
  const summary = summarizeSelections(reservation.selections, menu);
  const missingCourses = findMissingCourses(reservation.selections, menu, reservation.guestCount);

  return (
    <PageShell width="md" headerHref="/admin" showLanguage={false}>
      <Card className="p-5 sm:p-6">
        <CardHeader
          as="h1"
          eyebrow="Reservation"
          title={reservation.reservationNumber}
          actions={
            <div className="flex flex-wrap gap-3" data-print="hide">
              <ButtonLink href="/admin">Back to dashboard</ButtonLink>
              <ButtonLink href={`/admin/reservation/${reservation.reservationNumber}/edit`} variant="primary">
                Edit reservation
              </ButtonLink>
            </div>
          }
        />

        <dl className="mt-6 grid gap-4 rounded-control bg-surface-muted p-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-ink-subtle">
              {reservation.kind === "premium"
                ? "Guest"
                : reservation.additionalRooms?.length
                  ? "Rooms"
                  : "Room"}
            </dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{reservationLabel(reservation)}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-subtle">Guests</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{reservation.guestCount}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-subtle">Date</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">
              <time dateTime={reservation.date}>{formatLongDate(reservation.date)}</time>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-subtle">Contact</dt>
            <dd className="mt-1">
              <ContactLink contact={reservation.contact} />
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-subtle">Arrival</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">
              {reservation.time ? `${reservation.time}${reservation.endTime ? `–${reservation.endTime}` : ""}` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-subtle">Table</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{reservation.tableNumber || "—"}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-subtle">Status</dt>
            <dd className="mt-1">
              <Badge tone={reservation.status === "confirmed" ? "success" : "info"}>{reservation.status}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-subtle">Pass-key</dt>
            <dd className="mt-1 font-mono text-base font-semibold text-ink">
              {passKey ? formatPassKey(passKey.code) : "—"}
              {passKey ? null : (
                <span className="block font-sans text-sm font-normal text-ink-muted">
                  Taken by staff, so the guest cannot change it themselves.
                </span>
              )}
            </dd>
          </div>
        </dl>

        {reservation.cancellation ? (
          <div className="mt-6 rounded-control border border-warning/30 bg-warning-soft p-4">
            <p className="eyebrow">Cancelled</p>
            <p className="mt-1 font-medium text-warning">
              By {reservation.cancellation.actorName}
              {reservation.cancellation.actorKind === "guest" ? " (guest, using their pass-key)" : ""} on{" "}
              {new Date(reservation.cancellation.at).toLocaleString("en-GB")}
              {reservation.cancellation.reason ? ` — ${reservation.cancellation.reason}` : ""}
            </p>
          </div>
        ) : null}

        {reservation.notes ? (
          <div className="mt-6 rounded-control border border-danger/30 bg-danger-soft p-4">
            <p className="eyebrow">Comment</p>
            <p className="mt-1 font-medium text-danger">{reservation.notes}</p>
          </div>
        ) : null}

        {reservation.tableGroupId ? (
          <p className="mt-4 text-sm text-ink-muted">
            Sharing a table with the other rooms in booking{" "}
            <span className="font-semibold text-ink">{reservation.tableGroupId}</span>.
          </p>
        ) : null}

        {/*
          The ticket check. Everything below this is the same information broken
          out per guest, which is what the kitchen plates from — but nobody can
          verify a booking against the card the guest filled in by reading six
          separate lists, which is what staff were doing.
        */}
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="eyebrow">Dishes on this booking</h2>
            <p className="text-sm text-ink-muted">
              {summary.plates} plate{summary.plates === 1 ? "" : "s"} for {reservation.guestCount}{" "}
              {reservation.guestCount === 1 ? "guest" : "guests"}
              {summary.declined > 0 ? ` · ${summary.declined} course(s) declined` : ""}
            </p>
          </div>

          {summary.courses.length === 0 ? (
            <p className="mt-2 text-sm font-medium text-danger">
              No dishes are recorded on this booking. The kitchen has nothing to prepare for it.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <caption className="sr-only">How many of each dish this booking needs</caption>
                <thead>
                  <tr className="border-b border-line-strong text-ink-muted">
                    <th scope="col" className="py-1 pr-6 font-semibold">Course</th>
                    <th scope="col" className="py-1 pr-6 font-semibold">Dish</th>
                    <th scope="col" className="py-1 text-right font-semibold">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.courses.map((course) => (
                    <Fragment key={course.courseId}>
                      {course.dishes.map((dish, index) => (
                        <tr key={dish.optionId} className="border-b border-line">
                          <td className="py-1 pr-6 text-ink-muted">{index === 0 ? course.courseName : ""}</td>
                          <td className="py-1 pr-6 font-medium text-ink">{dish.optionName}</td>
                          <td className="py-1 text-right text-base font-semibold tabular-nums text-ink">
                            {dish.quantity}
                          </td>
                        </tr>
                      ))}
                      {course.declined > 0 ? (
                        <tr className="border-b border-line">
                          <td className="py-1 pr-6 text-ink-muted">
                            {course.dishes.length === 0 ? course.courseName : ""}
                          </td>
                          <td className="py-1 pr-6 text-ink-subtle">No thank you</td>
                          <td className="py-1 text-right text-base font-semibold tabular-nums text-ink-subtle">
                            {course.declined}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line-strong">
                    <th scope="row" colSpan={2} className="py-1 pr-6 text-left font-semibold">
                      Total plates
                    </th>
                    <td className="py-1 text-right text-base font-semibold tabular-nums">{summary.plates}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Older bookings, and anything taken before the form insisted on it,
              can still be short — so it is said here rather than assumed. */}
          {missingCourses.length > 0 && reservation.status === "confirmed" ? (
            <p className="mt-3 rounded-control border border-warning/30 bg-warning-soft p-3 text-sm font-medium text-warning">
              Unfinished:{" "}
              {missingCourses
                .map((entry) => `${entry.courseName} — ${entry.missing} of ${reservation.guestCount} guests`)
                .join(" · ")}
              . Edit the reservation to complete it.
            </p>
          ) : null}
        </section>

        <div className="mt-6 space-y-3">
          {guestGroups.map(({ guestIndex, entries }) => (
            <section key={guestIndex} className="rounded-control border border-line bg-surface-muted p-4">
              <h2 className="eyebrow">Guest {guestIndex + 1}</h2>
              {entries.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">No menu selections recorded.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {entries.map((entry, index) => (
                    <li key={`${entry.courseId}-${index}`}>
                      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{entry.courseName}</p>
                      <p className="text-base font-semibold text-ink">{entry.optionName}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        {/*
          What the guest took on the confirmation screen.

          It is not a course and not a plate, so it is deliberately not folded
          into the guest lists above: nobody cooks it, and counting it there
          would put it in the kitchen's totals. Reception needs it because it
          goes on the bill, which is why the prices are here in full rather
          than just the names.
        */}
        {reservation.addOns?.length ? (
          <section className="mt-6 rounded-control border border-gold/40 bg-accent-soft p-4">
            <h2 className="eyebrow">Promotions ordered</h2>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {reservation.addOns.map((addOn) => (
                  <tr key={addOn.optionId} className="border-t border-gold/20 first:border-t-0">
                    <td className="py-1.5 pr-4 font-semibold text-ink">{addOn.optionName}</td>
                    <td className="py-1.5 pr-4 text-ink-muted">{addOn.courseName}</td>
                    <td className="py-1.5 text-right whitespace-nowrap tabular-nums">
                      {addOn.discountPercent > 0 ? (
                        <>
                          <s className="text-ink-subtle">{formatPrice(addOn.price, currency, "en")}</s>{" "}
                          <span className="font-medium text-success">−{addOn.discountPercent}%</span>{" "}
                        </>
                      ) : null}
                      <span className="font-semibold text-ink">{formatPrice(addOn.finalPrice, currency, "en")}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gold/40">
                  <td className="py-1.5 pr-4 text-ink-subtle" colSpan={2}>
                    To settle at the table
                  </td>
                  <td className="py-1.5 text-right font-semibold tabular-nums text-ink">
                    {formatPrice(sumFinalPrices(reservation.addOns), currency, "en")}
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>
        ) : null}

        {/*
          The trail. It is append-only and outlives the record it describes,
          which is the point: "why is there no booking for room 402?" is only
          answerable if the change left a trace.
        */}
        <section className="mt-8" data-print="hide">
          <h2 className="eyebrow">History</h2>
          {history.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">
              Nothing recorded. This booking predates the log.
            </p>
          ) : (
            <ol className="mt-3 space-y-3 border-l border-line pl-4">
              {history.map((entry) => (
                <li key={entry.id}>
                  <p className="text-sm font-medium text-ink">{entry.summary}</p>
                  <p className="text-xs text-ink-muted">
                    {entry.actorName}
                    {entry.actorKind === "guest" ? " (guest)" : entry.actorKind === "system" ? "" : " (staff)"} ·{" "}
                    <time dateTime={entry.at}>{new Date(entry.at).toLocaleString("en-GB")}</time>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </Card>
    </PageShell>
  );
}
