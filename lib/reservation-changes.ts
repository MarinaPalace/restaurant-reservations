import type { AuditChange, ReservationAddOn, ReservationRecord, ReservationSelection } from "@/types/booking";

/**
 * What changed about a booking, field by field.
 *
 * ## Why this exists
 *
 * "Updated reservation" is not a log. It records that somebody touched
 * something and leaves the only question anybody ever asks — *what did they
 * change?* — unanswered, which meant the log could not settle an argument about
 * a moved table. This turns a before and an after into a list of named fields
 * with their old and new values, so an entry can say **Table 12 → 7** and
 * **Party 4 → 6**.
 *
 * ## Pure, and tested without a database
 *
 * Like `lib/service-board.ts` and `lib/floor-plan-viewport.ts`: the awkward
 * cases here are all about shapes of data — an empty string against an absent
 * field, a contact method that changed while the address did not — and those
 * are exactly what is worth being able to test without a browser or a Mongo.
 *
 * ## What it deliberately does not do
 *
 * It does not diff `service` or `attendance`. Those have their own audit
 * actions with their own words for what happened, and folding them in here
 * would produce two entries saying the same thing differently. It also never
 * looks at `updatedAt`, which changes on every write and would make every entry
 * claim a change nobody made.
 */

/**
 * One field that moved, ready to render without parsing prose.
 *
 * The shape itself lives in `types/booking.ts` as `AuditChange`, because it is
 * stored on an audit entry; this name is what it is called while it is being
 * worked out.
 */
export type ReservationChange = AuditChange;

/** Blank, absent and whitespace are the same thing: nothing. */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value);
}

/**
 * The dishes, as a countable line.
 *
 * A guest-by-guest diff of the menu would be a paragraph nobody reads. What
 * staff need from the log is that the order changed and roughly how much of it,
 * with the kitchen sheet the place to see the dishes themselves.
 */
function describeSelections(selections: readonly ReservationSelection[] | undefined): string {
  const list = selections ?? [];
  if (list.length === 0) {
    return "";
  }

  const dishes = [...list]
    .map((selection) => selection.optionName)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");

  return `${list.length} ${list.length === 1 ? "dish" : "dishes"} (${dishes})`;
}

function describeAddOns(addOns: readonly ReservationAddOn[] | undefined): string {
  const list = addOns ?? [];
  if (list.length === 0) {
    return "";
  }

  return [...list]
    .map((addOn) => addOn.optionName)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
}

function describeContact(contact: ReservationRecord["contact"]): string {
  if (!contact) {
    return "";
  }

  const address = contact.method === "email" ? text(contact.email) : text(contact.phone);
  if (!address) {
    return "";
  }

  // The app is named as well as the number: moving a guest from a phone call to
  // WhatsApp is a real change to how they will be reached.
  const app = contact.method === "phone" && contact.messagingApp && contact.messagingApp !== "phone"
    ? ` (${contact.messagingApp})`
    : "";

  return `${address}${app}`;
}

type FieldSpec = {
  field: string;
  label: string;
  read: (record: Partial<ReservationRecord>) => string;
};

/**
 * Every field worth a line in the log, in the order a person would read them.
 *
 * Ordered rather than alphabetical: a summary that leads with the date and the
 * party size says what happened faster than one that leads with a note.
 */
const FIELDS: FieldSpec[] = [
  { field: "date", label: "Date", read: (record) => text(record.date) },
  { field: "time", label: "Arrival", read: (record) => text(record.time) },
  { field: "guestCount", label: "Party", read: (record) => (record.guestCount ? String(record.guestCount) : "") },
  { field: "tableNumber", label: "Table", read: (record) => text(record.tableNumber) },
  { field: "roomNumber", label: "Room", read: (record) => text(record.roomNumber) },
  {
    field: "additionalRooms",
    label: "Sharing with",
    read: (record) => (record.additionalRooms ?? []).map(text).filter(Boolean).join(", "),
  },
  { field: "guestName", label: "Name", read: (record) => text(record.guestName) },
  { field: "status", label: "Status", read: (record) => text(record.status) },
  /*
    Named rather than logged as "shared table": who a party was put with is the
    part anybody re-reading the log will want to know.
  */
  { field: "tableGroupId", label: "Shared table", read: (record) => text(record.tableGroupId) },
  { field: "notes", label: "Kitchen note", read: (record) => text(record.notes) },
  { field: "staffNote", label: "Staff note", read: (record) => text(record.staffNote) },
  { field: "contact", label: "Contact", read: (record) => describeContact(record.contact) },
  { field: "selections", label: "Menu", read: (record) => describeSelections(record.selections) },
  { field: "addOns", label: "Extras", read: (record) => describeAddOns(record.addOns) },
];

/**
 * What moved between two versions of a booking.
 *
 * Returns an empty list when nothing did, which is the caller's signal to write
 * no entry at all: a log full of "no change" lines is a log nobody scrolls.
 */
export function describeReservationChanges(
  before: Partial<ReservationRecord>,
  after: Partial<ReservationRecord>,
): ReservationChange[] {
  const changes: ReservationChange[] = [];

  for (const spec of FIELDS) {
    const from = spec.read(before);
    const to = spec.read(after);

    if (from === to) {
      continue;
    }

    changes.push({
      field: spec.field,
      label: spec.label,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
  }

  return changes;
}

/** One change, as a person would say it. */
export function describeChange(change: ReservationChange): string {
  if (change.from && change.to) {
    return `${change.label} ${change.from} → ${change.to}`;
  }

  if (change.to) {
    return `${change.label} set to ${change.to}`;
  }

  return `${change.label} cleared (was ${change.from})`;
}

/**
 * The whole diff as one line, for the `summary` every entry already carries.
 *
 * Long changes are counted rather than listed. A summary that runs to three
 * lines is not a summary, and the structured `changes` beside it is where the
 * detail lives for anything that wants to render it properly.
 */
export function summariseChanges(changes: readonly ReservationChange[], limit = 3): string {
  if (changes.length === 0) {
    return "No changes";
  }

  const named = changes.slice(0, limit).map(describeChange);
  const rest = changes.length - named.length;

  return rest > 0 ? `${named.join("; ")} and ${rest} more` : named.join("; ");
}
