"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { ContactLink } from "@/components/contact-link";
import {
  buildKitchenColumns,
  buildKitchenCsv,
  buildKitchenFileName,
  buildKitchenRows,
  type KitchenLayout,
} from "@/lib/kitchen-report";
import { formatLongDate } from "@/lib/date";
import { cx } from "@/components/ui/utils";
import type { MenuCourse, ReservationRecord } from "@/types/booking";

export function KitchenReport({
  date,
  serviceTime,
  reservations,
  menu,
  onAssignTable,
  onCancel,
  busyReservationNumber,
}: {
  date: string;
  serviceTime?: string;
  reservations: ReservationRecord[];
  menu: MenuCourse[];
  onAssignTable: (reservationNumber: string, tableNumber: string) => Promise<void>;
  onCancel: (reservationNumber: string) => Promise<void>;
  busyReservationNumber: string | null;
}) {
  const [layout, setLayout] = useState<KitchenLayout>("guest");
  const [editing, setEditing] = useState<{ reservationNumber: string; value: string } | null>(null);

  const columns = useMemo(() => buildKitchenColumns(reservations, menu), [reservations, menu]);
  const rows = useMemo(() => buildKitchenRows(reservations, columns, layout), [reservations, columns, layout]);

  const firstRowOfBooking = useMemo(() => {
    const seen = new Set<string>();
    const first = new Set<string>();

    for (const row of rows) {
      if (!seen.has(row.reservationNumber)) {
        seen.add(row.reservationNumber);
        first.add(row.key);
      }
    }

    return first;
  }, [rows]);

  const covers = reservations
    .filter((reservation) => reservation.status === "confirmed")
    .reduce((total, reservation) => total + reservation.guestCount, 0);

  const contactByNumber = useMemo(
    () => new Map(reservations.map((reservation) => [reservation.reservationNumber, reservation])),
    [reservations],
  );

  /** Alternating shading so rooms sharing a table read as one block. */
  const groupShade = useMemo(() => {
    const shades = new Map<string, boolean>();
    let toggle = false;
    let previous = "";

    for (const row of rows) {
      const group = row.tableGroupId ?? row.reservationNumber;
      if (group !== previous) {
        toggle = !toggle;
        previous = group;
      }
      shades.set(row.key, toggle);
    }

    return shades;
  }, [rows]);

  const downloadCsv = () => {
    const csv = buildKitchenCsv(columns, rows, layout);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = buildKitchenFileName(date, layout);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const submitTable = async () => {
    if (!editing) {
      return;
    }
    const { reservationNumber, value } = editing;
    setEditing(null);
    await onAssignTable(reservationNumber, value.trim());
  };

  return (
    <Card className="p-5 sm:p-6" as="section">
      <CardHeader
        eyebrow="Kitchen report"
        title={formatLongDate(date)}
        description={
          <>
            {covers} {covers === 1 ? "cover" : "covers"}
            {serviceTime ? ` · arrival ${serviceTime}` : " · no arrival time set"}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2" data-print="hide">
            <div role="group" aria-label="Sheet layout" className="flex rounded-control border border-line-strong">
              {(["guest", "booking"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={layout === option}
                  onClick={() => setLayout(option)}
                  className={cx(
                    "min-h-11 px-4 text-sm font-medium transition-colors first:rounded-l-control last:rounded-r-control",
                    layout === option ? "bg-primary text-primary-fg" : "bg-surface text-ink hover:bg-surface-sunken",
                  )}
                >
                  {option === "guest" ? "Per guest" : "Per room"}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={downloadCsv} disabled={rows.length === 0}>
              Export CSV
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
          </div>
        }
      />

      {!serviceTime ? (
        <Alert tone="warning" className="mt-4" >
          No arrival time is set for this evening. Guests were not told when to arrive.
        </Alert>
      ) : null}

      <div className="mt-5">
        {rows.length === 0 ? (
          <EmptyState title="No reservations yet" description="Nothing has been booked for this evening." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <caption className="sr-only">
                Kitchen sheet for {formatLongDate(date)}, one row per {layout === "guest" ? "guest" : "room"}
              </caption>
              <thead className="bg-surface-sunken text-ink-muted">
                <tr>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">
                    Table
                  </th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">
                    Room
                  </th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">
                    {layout === "guest" ? "Guest" : "Guests"}
                  </th>
                  {columns.map((column) => (
                    <th key={column.id} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">
                      {column.label}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Comment
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold" data-print="hide">
                    Contact
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold" data-print="hide">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const reservation = contactByNumber.get(row.reservationNumber);
                  const isEditing = editing?.reservationNumber === row.reservationNumber;
                  const shaded = groupShade.get(row.key);

                  return (
                    <tr
                      key={row.key}
                      className={cx(
                        "border-t border-line align-top",
                        shaded && "bg-surface-muted",
                        row.cancelled && "opacity-50 line-through",
                      )}
                    >
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <input
                            autoFocus
                            aria-label={`Table for room ${row.room}`}
                            value={editing.value}
                            onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                            onBlur={submitTable}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") submitTable();
                              if (event.key === "Escape") setEditing(null);
                            }}
                            className="w-20 rounded border border-line-strong bg-surface px-2 py-1 text-ink outline-none focus:border-accent"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setEditing({ reservationNumber: row.reservationNumber, value: row.table })
                            }
                            className="min-h-8 min-w-12 rounded border border-dashed border-line-strong px-2 py-1 text-left font-semibold text-ink hover:border-accent"
                          >
                            {row.table || <span className="text-ink-subtle">set</span>}
                          </button>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums text-ink">{row.room}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{row.guests}</td>
                      {columns.map((column) => (
                        <td key={column.id} className="px-3 py-2">
                          {row.choices[column.id] || <span className="text-ink-subtle">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        {row.comment ? (
                          <span className="font-medium text-danger">{row.comment}</span>
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2" data-print="hide">
                        {firstRowOfBooking.has(row.key) ? <ContactLink contact={reservation?.contact} /> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2" data-print="hide">
                        <div className={cx("flex items-center gap-2", !firstRowOfBooking.has(row.key) && "invisible")}>
                          <Link
                            href={`/admin/reservation/${row.reservationNumber}`}
                            className="text-xs underline underline-offset-2 hover:text-accent"
                          >
                            {row.reservationNumber}
                          </Link>
                          {!row.cancelled ? (
                            <Button
                              variant="danger"
                              onClick={() => onCancel(row.reservationNumber)}
                              loading={busyReservationNumber === row.reservationNumber}
                              loadingLabel="…"
                            >
                              Cancel
                            </Button>
                          ) : (
                            <Badge tone="info">cancelled</Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
