"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { ContactLink } from "@/components/contact-link";
import {
  buildCourseColumns,
  buildGuestCsv,
  buildGuestRows,
  buildKitchenFileName,
  buildOptionColumns,
  buildCombinedTableRows,
  buildOptionTotals,
  buildPrepList,
  buildRoomRows,
  buildTableCsv,
  chooseSheetPrintSize,
  countDeclined,
  countPlates,
  groupOptionColumns,
  groupRoomRowsByTable,
  type KitchenLayout,
} from "@/lib/kitchen-report";
import { canonicalizeReservations } from "@/lib/menu-selection";
import { shortenDishName } from "@/lib/dish-name";
import { formatLongDate } from "@/lib/date";
import { cx } from "@/components/ui/utils";
import type { MenuCourse, ReservationRecord, StaffPermission } from "@/types/booking";

export function KitchenReport({
  date,
  serviceTime,
  reservations: storedReservations,
  menu,
  onAssignTable,
  onCancel,
  onRestore,
  onDelete,
  busyReservationNumber,
  permissions,
}: {
  date: string;
  serviceTime?: string;
  reservations: ReservationRecord[];
  menu: MenuCourse[];
  onAssignTable: (reservationNumber: string, tableNumber: string) => Promise<void>;
  onCancel: (reservationNumber: string) => Promise<void>;
  onRestore: (reservationNumber: string) => Promise<void>;
  onDelete: (reservationNumber: string) => Promise<void>;
  busyReservationNumber: string | null;
  /**
   * What the signed-in account may do. The API checks the same permissions on
   * every request — this only avoids showing buttons that would be refused.
   */
  permissions: StaffPermission[];
}) {
  const [layout, setLayout] = useState<KitchenLayout>("room");
  const [editing, setEditing] = useState<{ reservationNumber: string; value: string } | null>(null);

  /**
   * Names are resolved against the English menu before anything is rendered,
   * so a booking taken in Bulgarian or Romanian still reads in English here —
   * including bookings taken before names were stored canonically.
   */
  const reservations = useMemo(
    () => canonicalizeReservations(storedReservations, menu),
    [storedReservations, menu],
  );

  const courseColumns = useMemo(() => buildCourseColumns(reservations, menu), [reservations, menu]);
  const optionColumns = useMemo(() => buildOptionColumns(reservations, menu), [reservations, menu]);
  const optionGroups = useMemo(() => groupOptionColumns(optionColumns), [optionColumns]);

  const guestRows = useMemo(() => buildGuestRows(reservations, courseColumns), [reservations, courseColumns]);
  const roomRows = useMemo(() => buildRoomRows(reservations, optionColumns), [reservations, optionColumns]);
  const tableGroups = useMemo(() => groupRoomRowsByTable(roomRows, optionColumns), [roomRows, optionColumns]);
  const tableRows = useMemo(
    () => buildCombinedTableRows(tableGroups, optionColumns),
    [tableGroups, optionColumns],
  );
  const totals = useMemo(() => buildOptionTotals(roomRows, optionColumns), [roomRows, optionColumns]);
  const prepList = useMemo(() => buildPrepList(optionColumns, totals), [optionColumns, totals]);

  /**
   * How large the sheet may be printed. Rows and dish columns are what decide
   * it — see `chooseSheetPrintSize`. Printing is the only thing this affects;
   * the screen is unchanged.
   */
  const printSize = useMemo(
    () => chooseSheetPrintSize({ rows: tableRows.length, dishColumns: optionColumns.length }),
    [tableRows.length, optionColumns.length],
  );

  const covers = reservations
    .filter((reservation) => reservation.status === "confirmed")
    .reduce((total, reservation) => total + reservation.guestCount, 0);
  const plates = countPlates(totals);
  const declined = countDeclined(reservations);

  const reservationByNumber = useMemo(
    () => new Map(reservations.map((reservation) => [reservation.reservationNumber, reservation])),
    [reservations],
  );

  const firstRowOfBooking = useMemo(() => {
    const seen = new Set<string>();
    const first = new Set<string>();

    for (const row of guestRows) {
      if (!seen.has(row.reservationNumber)) {
        seen.add(row.reservationNumber);
        first.add(row.key);
      }
    }

    return first;
  }, [guestRows]);

  const hasRows = (layout === "guest" ? guestRows : tableRows).length > 0;

  const downloadCsv = () => {
    const csv =
      layout === "guest" ? buildGuestCsv(courseColumns, guestRows) : buildTableCsv(optionColumns, tableRows, totals);

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

  const tableCell = (reservationNumber: string, table: string) => {
    const isEditing = editing?.reservationNumber === reservationNumber;

    return isEditing ? (
      <input
        autoFocus
        aria-label={`Table for reservation ${reservationNumber}`}
        value={editing.value}
        onChange={(event) => setEditing({ ...editing, value: event.target.value })}
        onBlur={submitTable}
        onKeyDown={(event) => {
          if (event.key === "Enter") submitTable();
          if (event.key === "Escape") setEditing(null);
        }}
        className="w-16 rounded border border-line-strong bg-surface px-2 py-1 text-ink outline-none focus:border-accent"
      />
    ) : (
      <button
        type="button"
        onClick={() => setEditing({ reservationNumber, value: table })}
        className="min-h-8 min-w-10 rounded border border-dashed border-line-strong px-2 py-1 text-left font-semibold text-ink hover:border-accent"
      >
        {table || <span className="text-ink-subtle">set</span>}
      </button>
    );
  };

  const can = (permission: StaffPermission) => permissions.includes(permission);

  /**
   * Dishes nobody ordered.
   *
   * Every option keeps a column on screen, so staff can see the whole menu and
   * satisfy themselves a dish really has no takers. On paper that is noise: a
   * blank column for a dish the kitchen is not cooking costs width on a sheet
   * that has to fit one page, and it reads as a duplicate of the column beside
   * it. Marked here and hidden by the print rules in globals.css.
   *
   * The course-grouping row is already dropped in print, so its `colSpan`
   * values do not need to follow.
   */
  const unordered = (optionId: string) => (totals[optionId] ? undefined : "true");

  const actionsCell = (reservationNumber: string, cancelled: boolean) => {
    // Who cancelled it, so the question does not have to be asked around the
    // desk. The full history is on the reservation's own page.
    const cancellation = reservations.find(
      (entry) => entry.reservationNumber === reservationNumber,
    )?.cancellation;

    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/reservation/${reservationNumber}`}
            className="text-xs underline underline-offset-2 hover:text-accent"
          >
            {reservationNumber}
          </Link>
          {!cancelled ? (
            can("reservations:cancel") ? (
              <Button
                variant="danger"
                onClick={() => onCancel(reservationNumber)}
                loading={busyReservationNumber === reservationNumber}
                loadingLabel="…"
              >
                Cancel
              </Button>
            ) : null
          ) : (
            <>
              <Badge tone="info">cancelled</Badge>
              {can("reservations:restore") ? (
                <Button
                  variant="secondary"
                  onClick={() => onRestore(reservationNumber)}
                  loading={busyReservationNumber === reservationNumber}
                  loadingLabel="…"
                >
                  Restore
                </Button>
              ) : null}
            </>
          )}
          {can("reservations:delete") ? (
            <button
              type="button"
              onClick={() => onDelete(reservationNumber)}
              className="text-xs text-ink-subtle underline underline-offset-2 hover:text-danger"
            >
              Delete
            </button>
          ) : null}
        </div>

        {cancelled && cancellation ? (
          <p className="text-xs text-ink-subtle" data-print="hide">
            by {cancellation.actorName}
            {cancellation.at ? ` · ${new Date(cancellation.at).toLocaleString("en-GB")}` : ""}
            {cancellation.reason ? ` · ${cancellation.reason}` : ""}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div data-print-area="" data-print-size={printSize}>
      <Card className="p-5 sm:p-6" as="section">
      <CardHeader
        eyebrow="Kitchen report"
        title={formatLongDate(date)}
        description={
          <>
            {covers} {covers === 1 ? "cover" : "covers"} · {plates} {plates === 1 ? "plate" : "plates"} to prepare
            {declined > 0 ? ` · ${declined} course${declined === 1 ? "" : "s"} declined` : ""}
            {serviceTime ? ` · arrival ${serviceTime}` : " · no arrival time set"}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2" data-print="hide">
            <div role="group" aria-label="Sheet layout" className="flex rounded-control border border-line-strong">
              {(["room", "guest"] as const).map((option) => (
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
                  {option === "guest" ? "Per guest" : "Per table"}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={downloadCsv} disabled={!hasRows}>
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
        {!hasRows ? (
          <EmptyState title="No reservations yet" description="Nothing has been booked for this evening." />
        ) : layout === "guest" ? (
          <div data-print-scroll="" className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <caption className="sr-only">Plating list for {formatLongDate(date)}, one row per guest</caption>
              <thead className="bg-surface-sunken text-ink-muted">
                <tr>
                  <th scope="col" data-print="table" className="whitespace-nowrap px-3 py-2 font-semibold">Table</th>
                  <th scope="col" data-print="who" className="whitespace-nowrap px-3 py-2 font-semibold">Room</th>
                  <th scope="col" data-print="who" className="whitespace-nowrap px-3 py-2 font-semibold">Guest</th>
                  {courseColumns.map((column) => (
                    <th key={column.id} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">
                      {column.label}
                    </th>
                  ))}
                  <th scope="col" data-print="note" className="px-3 py-2 font-semibold">Comment</th>
                  <th scope="col" className="px-3 py-2 font-semibold" data-print="hide">Contact</th>
                  <th scope="col" className="px-3 py-2 font-semibold" data-print="hide">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {guestRows.map((row) => (
                  <tr
                    key={row.key}
                    className={cx("border-t border-line align-top", row.cancelled && "opacity-50 line-through")}
                  >
                    <td className="px-3 py-2">{tableCell(row.reservationNumber, row.table)}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">{row.room}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{row.guests}</td>
                    {courseColumns.map((column) => (
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
                      {firstRowOfBooking.has(row.key) ? (
                        <ContactLink contact={reservationByNumber.get(row.reservationNumber)?.contact} />
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2" data-print="hide">
                      {firstRowOfBooking.has(row.key) ? actionsCell(row.reservationNumber, row.cancelled) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div data-print-scroll="" className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <caption className="sr-only">
                Prep counts for {formatLongDate(date)}, grouped by table with a column per dish
              </caption>
              <thead className="bg-surface-sunken text-ink-muted">
                {/* Course names span their options, so the sheet reads in
                    groups rather than as one long run of dish names. */}
                {/* Course grouping, hidden in print so the sheet fits a page. */}
                <tr data-print="course-row">
                  <th scope="col" className="border-r border-line px-3 py-1" />
                  <th scope="col" className="border-r border-line px-3 py-1" />
                  <th scope="col" className="border-r border-line px-3 py-1" />
                  {optionGroups.map((group) => (
                    <th
                      key={group.courseId}
                      scope="colgroup"
                      colSpan={group.options.length}
                      className="whitespace-nowrap border-r border-line px-3 py-1 text-center text-xs font-semibold"
                    >
                      {group.courseName}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-1" />
                  <th scope="col" className="px-3 py-1" data-print="hide" />
                </tr>
                <tr>
                  <th scope="col" data-print="table" className="whitespace-nowrap border-r border-line px-3 py-2 align-bottom font-semibold">
                    Table
                  </th>
                  <th scope="col" data-print="who" className="whitespace-nowrap border-r border-line px-3 py-2 align-bottom font-semibold">
                    Rooms
                  </th>
                  <th scope="col" className="whitespace-nowrap border-r border-line px-3 py-2 align-bottom font-semibold">
                    Guests
                  </th>
                  {optionColumns.map((column, index) => (
                    <th
                      key={column.id}
                      scope="col"
                      data-print="dish"
                      data-unordered={unordered(column.id)}
                      // Full wording on hover; the column shows the short label.
                      title={column.label}
                      className={cx(
                        "px-2 py-2 text-center align-bottom text-xs font-medium",
                        optionColumns[index + 1]?.courseId !== column.courseId && "border-r border-line",
                      )}
                    >
                      <span className="block max-w-24 leading-tight">{shortenDishName(column.label)}</span>
                    </th>
                  ))}
                  <th scope="col" data-print="note" className="px-3 py-2 align-bottom font-semibold">
                    Comment
                  </th>
                  <th scope="col" className="px-3 py-2 align-bottom font-semibold" data-print="hide">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>

              <tbody>
                {tableRows.map((row) => (
                  <tr
                    key={row.key}
                    className={cx(
                      "border-t border-line",
                      // A shared table is one service, so it reads as one block.
                      row.isShared && "bg-accent-soft/40",
                      row.cancelled && "opacity-50 line-through",
                    )}
                  >
                    <td className="border-r border-line px-3 py-2">
                      {tableCell(row.members[0].reservationNumber, row.table)}
                    </td>
                    <td className="whitespace-nowrap border-r border-line px-3 py-2 font-medium text-ink">
                      {row.rooms.join(" + ")}
                      {row.isShared ? (
                        <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-ink">
                          {row.rooms.length} rooms together
                        </span>
                      ) : null}
                    </td>
                    <td className="border-r border-line px-3 py-2 tabular-nums">{row.guests}</td>
                    {optionColumns.map((column, index) => (
                      <td
                        key={column.id}
                        data-unordered={unordered(column.id)}
                        className={cx(
                          "px-2 py-2 text-center tabular-nums",
                          optionColumns[index + 1]?.courseId !== column.courseId && "border-r border-line",
                          row.counts[column.id] ? "font-semibold text-ink" : "text-ink-subtle",
                        )}
                      >
                        {/* Blank rather than 0, so the counts that matter stand out. */}
                        {row.counts[column.id] || ""}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      {row.comments.map((entry) => (
                        <span key={entry.room} className="block font-medium text-danger">
                          {row.isShared ? `${entry.room}: ` : ""}
                          {entry.note}
                        </span>
                      ))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2" data-print="hide">
                      <div className="flex flex-col gap-1">
                        {row.members.map((member) => (
                          <div key={member.reservationNumber} className="flex items-center gap-2">
                            {row.isShared ? (
                              <span className="text-xs font-medium text-ink-muted">{member.room}</span>
                            ) : null}
                            {actionsCell(member.reservationNumber, member.cancelled)}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>

              <tfoot className="border-t-2 border-line-strong bg-surface-sunken font-semibold text-ink">
                <tr>
                  <th scope="row" colSpan={2} className="border-r border-line px-3 py-3 text-left">
                    Total to prepare
                  </th>
                  <td className="border-r border-line px-3 py-3 tabular-nums">
                    {tableRows.filter((row) => !row.cancelled).reduce((sum, row) => sum + row.guests, 0)}
                  </td>
                  {optionColumns.map((column, index) => (
                    <td
                      key={column.id}
                      data-unordered={unordered(column.id)}
                      className={cx(
                        "px-2 py-3 text-center text-base tabular-nums",
                        optionColumns[index + 1]?.courseId !== column.courseId && "border-r border-line",
                        !totals[column.id] && "text-ink-subtle",
                      )}
                    >
                      {totals[column.id] || "0"}
                    </td>
                  ))}
                  <td className="px-3 py-3" />
                  <td className="px-3 py-3" data-print="hide" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* The slip the kitchen actually gets: no tables, no rooms, just how
          many of each dish to make. Printed below a cut line. */}
      {prepList.length > 0 ? (
        <div data-print="prep" className="mt-10">
          <div
            aria-hidden="true"
            className="flex items-center gap-2 text-xs text-ink-subtle"
            style={{ borderTop: "1px dashed currentColor", paddingTop: "0.75rem" }}
          >
            <span>✂</span>
            <span className="uppercase tracking-widest">cut here — for the kitchen</span>
          </div>

          <h3 className="mt-4 text-base font-semibold text-ink">
            To prepare · {formatLongDate(date)}
            {serviceTime ? ` · ${serviceTime}` : ""}
          </h3>

          <table className="mt-2 border-collapse text-left text-sm">
            <caption className="sr-only">Quantities of each dish for the kitchen</caption>
            <thead>
              <tr className="border-b border-line-strong text-ink-muted">
                <th scope="col" className="py-1 pr-6 font-semibold">Course</th>
                <th scope="col" className="py-1 pr-6 font-semibold">Dish</th>
                <th scope="col" className="py-1 text-right font-semibold">Qty</th>
              </tr>
            </thead>
            <tbody>
              {prepList.map((line) => (
                <tr key={`${line.courseName}-${line.optionName}`} className="border-b border-line">
                  <td className="py-1 pr-6 text-ink-muted">{line.courseName}</td>
                  <td className="py-1 pr-6 font-medium text-ink">{line.optionName}</td>
                  <td className="py-1 text-right text-base font-semibold tabular-nums text-ink">{line.quantity}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line-strong">
                <th scope="row" colSpan={2} className="py-1 pr-6 text-left font-semibold">
                  Total plates
                </th>
                <td className="py-1 text-right text-base font-semibold tabular-nums">{plates}</td>
              </tr>
            </tfoot>
          </table>

          {reservations.some((reservation) => reservation.notes && reservation.status === "confirmed") ? (
            <div className="mt-4">
              <h4 className="text-sm font-semibold text-ink">Allergies and requests</h4>
              <ul className="mt-1 space-y-0.5 text-sm">
                {reservations
                  .filter((reservation) => reservation.notes && reservation.status === "confirmed")
                  .map((reservation) => (
                    <li key={reservation.reservationNumber}>
                      <span className="font-medium text-ink">
                        Table {reservation.tableNumber || "—"} (room {reservation.roomNumber}):
                      </span>{" "}
                      <span className="text-danger">{reservation.notes}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      </Card>
    </div>
  );
}
