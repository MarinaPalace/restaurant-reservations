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
import { getMenuCatalog } from "@/lib/services/restaurant";
import { canonicalizeSelections } from "@/lib/menu-selection";
import { reservationLabel } from "@/lib/kitchen-report";
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
  const [stored, menu, history] = await Promise.all([
    getReservationByNumber(reservationNumber),
    getMenuCatalog(),
    // Everything that has happened to this booking, newest first.
    getAuditEntries({ reservationNumber, limit: 50 }),
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

  return (
    <PageShell width="md" headerHref="/admin">
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
            <dt className="text-sm text-ink-subtle">{reservation.kind === "premium" ? "Guest" : "Room"}</dt>
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
