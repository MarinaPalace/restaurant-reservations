/**
 * What makes two bookings one table.
 *
 * Lives on its own because two screens ask the question — the kitchen sheet
 * (`lib/kitchen-report.ts`) and the service board (`lib/service-board.ts`) —
 * and they used to answer it separately, each with its own copy of the rule.
 * That is how they came to disagree: the sheet was corrected and the board was
 * not, so one party read as one table on one screen and two on the other. One
 * copy, so they cannot drift again.
 *
 * **The group comes first.** A booking that asked to sit with another said so,
 * and that does not stop being true because a table number is missing or has
 * been changed since. The table is what a group is *labelled* with, not what
 * defines it.
 *
 * Falling back to the table keeps what was always right about the old rule:
 * two rooms seated at one table by reception, who never formally joined, are
 * still sharing it and still read as one row.
 */
export function tableGroupKey(booking: {
  tableGroupId?: string;
  /** The table number, whatever the caller's field for it is called. */
  table?: string;
  reservationNumber: string;
}): string {
  if (booking.tableGroupId) {
    return `group:${booking.tableGroupId}`;
  }

  if (booking.table) {
    return `table:${booking.table}`;
  }

  return `booking:${booking.reservationNumber}`;
}
