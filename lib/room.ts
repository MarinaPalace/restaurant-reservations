/**
 * Room numbers are not numbers.
 *
 * The hotel uses labels like L10, HA3 and A43 alongside plain 402, so they are
 * stored and compared as strings. Anything already saved as a numeric room is
 * read back as its digits, which keeps older bookings working untouched.
 */

const ROOM_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,9}$/;

/** Upper-cased and trimmed, so "l10" and "L10" are the same room. */
export function normalizeRoomNumber(value: string | number | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function isValidRoomNumber(value: string | number | null | undefined) {
  return ROOM_PATTERN.test(normalizeRoomNumber(value));
}

export function roomNumbersMatch(a: string | number | null | undefined, b: string | number | null | undefined) {
  const left = normalizeRoomNumber(a);
  return left.length > 0 && left === normalizeRoomNumber(b);
}

/**
 * Every room on one booking, in the order they were entered.
 *
 * A ticket may name two or three rooms sitting at one table, and they are shown
 * joined with a plus — the same way the service sheet has always shown rooms
 * that asked to sit together, so staff read one familiar thing.
 */
export function formatRoomList(
  roomNumber: string | number | null | undefined,
  additionalRooms?: string[] | null,
) {
  return [roomNumber, ...(additionalRooms ?? [])]
    .map(normalizeRoomNumber)
    .filter((room) => room.length > 0)
    .join(" + ");
}

/**
 * Orders rooms the way a person reads them: 2 before 10, and A43 grouped with
 * the other A rooms rather than sorted by character code.
 */
export function compareRoomNumbers(a: string | number | null | undefined, b: string | number | null | undefined) {
  return normalizeRoomNumber(a).localeCompare(normalizeRoomNumber(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
