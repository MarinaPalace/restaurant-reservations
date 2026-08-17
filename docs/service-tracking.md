# Check-in and service tracking — design note

**Status: not built.** This is the shape the feature would take, written down while it is fresh so
the next session can start from a decision rather than a blank page. Nothing in the app does any of
it yet.

---

## What was asked for

Two things, in the order they happen on the night:

1. **Check-in.** Guests arrive at the restaurant; a member of staff marks each table as arrived,
   the way reception marks an arrival at the hotel.
2. **Service tracking.** As each course goes out, staff mark what has been served — so at any
   moment the pass can answer "what is still to go out?" rather than counting plates by memory.

---

## Why it is not simply a checkbox

The service sheet already knows the *plan*: who is coming, what they ordered, how many of each
dish. What is missing is the **state of the evening**, and state has three properties the current
data model does not have:

- **It changes many times an hour**, from several devices at once — the pass, a waiter's phone,
  the desk. Two people marking the same course served must not fight.
- **It is worthless the next morning.** Nobody asks in March whether table 7's soup went out at
  20:14 in January. It is operational, not a record — the opposite of a reservation.
- **It is per course, per table**, which is a finer grain than anything stored today. A booking
  holds selections; service holds *progress against* those selections.

---

## The shape it should take

### Where the state lives

On the reservation, as one additional optional field — the same rule every other addition in this
app has followed (rule 2.2), so nothing needs migrating and every existing booking reads as
"nothing served yet":

```ts
/** How far through the evening this table is. Absent on every booking made
 *  before this, which reads as "not arrived". */
service?: {
  arrivedAt?: string;             // ISO instant; absent = not arrived
  /** Course id → when that course went out to this table. */
  servedAt?: Record<string, string>;
};
```

A `Record<courseId, timestamp>` rather than a list of booleans: it answers "what is outstanding"
by subtraction from the menu, it cannot drift out of order, and the timestamps are what make a
"still waiting after 40 minutes" flag possible later without another schema change.

**Not a separate collection.** A service record keyed by reservation would need joining on every
read of the sheet, and the sheet is the hottest read in the app. The field belongs with the booking
it describes.

### How it is written

One route, `PATCH /api/admin/reservations/<number>/service`, permission `reservations:edit`, taking
either `{ arrived: true }` or `{ courseId, served: true }` — and the reverse, because the common mistake
is marking the wrong table and it has to be undoable in one tap.

Writes must be **idempotent and last-write-wins per course**, not read-modify-write: two waiters
marking the main course served at the same moment must both succeed, with the same result. On
Mongo that is `$set: { "service.servedAt.<courseId>": now }` filtered on the reservation number —
a single conditional update, the same shape as the seat claims (rule 2.7). The local JSON store
does it inside the store lock.

**No audit entries.** The log records changes to bookings; a course going out is not a change to
the booking, and an evening of forty tables times five courses would bury the log it shares with
cancellations and refunds. If service ever needs a history, it gets its own store with its own
retention.

### What staff see

A third layout on the dashboard beside *Per table* and *Per guest* — call it **Service** — because
staff already know that toggle and it reads the same evening.

- One row per table, in table-number order, with the rooms and guest count.
- A large **Arrived** control at the left. Nothing else on the row is offered until it is pressed:
  a table that has not sat down cannot have been served.
- Then one cell per course: tap to mark served, tap again to undo, showing the time it went out.
- A **still to serve** strip at the top: per course, how many plates are outstanding across the
  whole room. That is the number the kitchen actually asks for, and it is the same arithmetic
  `buildOptionTotals` already does, less what has been marked served.

Two interface rules, both learned the hard way elsewhere in this app:

- **Targets are large and nothing moves under a finger.** This screen is used standing up, at
  speed, one-handed, on a phone that may be several years old. See rule 2.14.
- **It must survive a bad connection.** The restaurant's floor is not the office. Marks should
  apply optimistically and reconcile on the response; a failed write shows on the row it belongs
  to, not as a page-level error that loses the other twenty.

### What it is not

- **Not a POS.** No prices, no bills, no covers-per-hour reporting. The moment it grows those it
  needs an entirely different set of guarantees.
- **Not a kitchen display system.** The kitchen slip stays what it is: paper, cut off the bottom of
  the sheet. This tracks what has *gone out*, which is a floor question.
- **Not a replacement for the printed sheet.** Paper does not lose its battery in the middle of a
  service. The screen is in addition to it, and the sheet must stay printable exactly as it is.

---

## Open questions, worth settling before any code

1. **Does check-in mean the table, or the guests?** A booking for four where three arrive is
   common. Storing an arrival count rather than a flag costs nothing now and cannot be added later
   without another decision. Recommend: `arrivedGuests?: number`, with the control setting it to
   the full party in one tap and letting staff adjust.
2. **How does a shared table behave?** Rooms dining together are one row on the sheet but several
   bookings. Arrival and service should apply to the whole group, the way a table number already
   does — one tap, several records written, which the existing `assignTableNumber` already models.
3. **Who may mark service?** Probably a new permission (`service:record`) so a waiter's account can
   do this and nothing else. Adding a permission is additive and administrators hold it implicitly.
4. **When does the state expire?** It is worthless after the evening. Either leave it (it is small)
   or clear it on a date's close. Recommend leaving it and never showing it for a past date, which
   is the smaller change.
5. **Should the guest see it?** No — "your main course is on its way" is a promise the floor cannot
   always keep, and it invites a complaint the app cannot answer.

---

## A rough order of work

1. The field, the store round-trips, and the tests that an old booking reads as "not arrived"
   (mirroring what `additionalRooms` did).
2. The route, with the concurrent-write test — two marks at once, both succeed, one result.
3. The Service layout, on the dashboard, behind the permission.
4. The outstanding-plates strip.
5. Only then, if it is wanted: times, delays, and anything that looks like a report.

Steps 1–3 are the feature. Everything after is comfort.
