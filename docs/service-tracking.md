# The service board — design note

**Status: built — steps 1–4, 6 and 7.** The board is at `/admin/service`, behind `service:record`,
and no-shows reach analytics with their coverage figure.

**Not built: step 5, polling across devices in anger.** The board refreshes on a timer already, but
it has only ever been used on one screen; the multi-device behaviour in §6 is written down and not
yet exercised. Nor is the wake lock tested on a real tablet.

The reasoning below is kept, because every trap in it still applies.

This supersedes the earlier version of this note. The decisions it recorded are kept; what is new
is the **board** as a device, the split between attendance and service progress (§2 — the most
important thing here), how two devices stay in step (§6), and how no-shows reach analytics (§7).

Read `HANDOVER.md` §2 first — §2.2 (additive schema), §2.7 (conditional writes), §2.14 (nothing
moves under a finger) and §2.5 (authorisation in the route) each decide something below.

---

## 1. What was asked for

Two things, in the order they happen on the night:

1. **Check-in.** A guest arrives, and a member of staff marks the table as arrived and seated.
2. **Service tracking.** As each course goes out, staff mark what has been served, so at any moment
   the pass can answer "what is still to go out?" rather than counting plates from memory.

And one thing that follows from the first: **no-shows**, which analytics cannot compute today and
which is the single most valuable number a restaurant tracks. See `docs/analytics.md` §4.1.

---

## 2. The one decision everything else follows from

**These are two different kinds of fact with two different lifetimes, and conflating them is the
mistake this note exists to prevent.**

| | Attendance | Service progress |
|---|---|---|
| The question | Did they come? | How far through are they? |
| Lifetime | **Permanent** — a business record | **Ephemeral** — worthless next morning |
| Read by | Analytics, reception, disputes | The pass, tonight, for the next twenty minutes |
| Audited | **Yes** — it changes what a guest is charged for and what the owner concludes | No |
| Grain | Per booking | Per course, per table |
| Absent means | Unknown. **Never "seated", never "no-show"** | Nothing served yet |

Nobody asks in March whether table 7's soup went out at 20:14 in January. Everybody asks in March
how many people did not turn up in January.

So they are two fields, not one, even though both are written from the same screen by the same tap:

```ts
/**
 * Did they come? A permanent record. Absent = nobody recorded it, which is
 * neither "seated" nor "no-show" and must never be read as either.
 */
attendance?: {
  status: "seated" | "no-show";
  at: string;                  // ISO instant
  /** Who marked it. A no-show is disputable, so it names somebody. */
  byName: string;
  /** How many actually sat down. Absent = the whole party. */
  guests?: number;
};

/**
 * How far through the evening this table is. Operational, not a record.
 * Course id → when that course went out.
 */
service?: {
  servedAt?: Record<string, string>;
};
```

Both optional and additive (rule 2.2), so every existing booking reads as "not arrived, nothing
served" and nothing needs migrating.

**`servedAt` is a map, not a list of booleans.** It answers "what is outstanding" by subtraction
from the menu, it cannot drift out of order, and the timestamps make a "still waiting after forty
minutes" flag possible later without another schema change.

**Not a separate collection.** A service record keyed by reservation would need joining on every
read of the sheet, and the sheet is the hottest read in the app. Both fields belong with the
booking they describe.

**Per guest, with a whole-course fast path.** The first version tracked whole courses only, on the
reasoning that a waiter carries four mains in one trip. That was half right: the trip is one, but
the *table* is not uniform. Two things broke it in use — "2 Amuse Bouche" does not say what anybody
is eating, so a waiter cannot tell what to carry; and an allergy note says **"guest 2 is allergic to
gluten"**, so guest 2's plate comes from a different pan and goes out on its own.

So `servedGuests` arrived as the second additive field the note predicted — as nested maps
(`courseId → guestIndex → when`) rather than the array of indices originally sketched, because each
guest then has **its own document key**: `$set`/`$unset` touches one plate and two waiters marking
different guests on the same course cannot lose each other. An array would have been a
read-modify-write, which is what rule 2.7 says not to do.

Tapping the course header is still one tap; it writes every plate of that course in one update.
Which guests those are is worked out on the **server**, from the booking's own selections, so a
guest who declined the course never gets a plate marked for them.

The legacy `servedAt` map is still read: a course with a timestamp there counts as fully served
(rule 2.2, no migration).

---

## 3. The board is its own screen

**Revised from the earlier note**, which put this as a third layout on the dashboard beside *Per
table* and *Per guest*. That was wrong for the device it runs on.

The dashboard carries a calendar, a date editor, capacity fields and a print button. On a tablet
propped at the pass during service, all of that is noise around the one thing being used, and every
one of those controls is a mis-tap that navigates away mid-service.

**A dedicated route: `/admin/service`**, defaulting to tonight, with `?date=` for the rare case of
correcting yesterday.

- Full width, no calendar, no editors.
- One row per **table**, in table-number order — the order somebody walks the room in.
- The service sheet stays exactly as it is. This is in addition to paper, never instead of it:
  **paper does not lose its battery in the middle of a service.**

### The row

```
┌──────────────────────────────────────────────────────────────────────┐
│ T7   402 + 405   6 guests          [ SEATED ]  [ no-show ]           │
│      ── once seated, the courses appear ──                           │
│      Amuse ✓20:04   Starter ✓20:18   Soup ·   Main ·   Dessert ·     │
└──────────────────────────────────────────────────────────────────────┘
```

- **Arrived is the gate.** Nothing else on the row is offered until it is pressed: a table that has
  not sat down cannot have been served, and offering the courses first invites exactly that error.
- Each course cell names **which dishes**, not just how many: `2 × Salmon · 1 × Velouté`. Tap to
  mark the whole course, tap again to undo. **Undo must be one tap** — the common mistake is marking
  the wrong table, and a mistake that needs a menu to fix will instead be left wrong.
- **Show what each guest chose** expands the row into a plate per guest, each with its own tick and
  its own time. Collapsed by default: the board is read at a glance across a room, and every table
  expanded is a screen nobody can scan. A partly-sent course reads `1/2` on its cell, and the
  outstanding strip counts only what is genuinely left.
- Served cells show the time it went out, because "how long has table 7 been waiting" is the
  question the pass actually asks.

### The strip

Across the top, per course: **how many plates are still to go out across the whole room.** That is
the number the kitchen asks for, and it is arithmetic the app already does —
`buildOptionTotals` from `lib/kitchen-report.ts`, less what has been marked served. Reuse it rather
than writing a second counter that will eventually disagree with the sheet.

### Interface rules, both learned the hard way here

- **Targets are large and nothing moves under a finger** (rule 2.14). Used standing up, at speed,
  one-handed, on a phone that may be several years old. A row must not reorder itself because a
  table was seated — a list that re-sorts while somebody is reaching for it is how the wrong table
  gets marked.
- **It must survive a bad connection.** The floor is not the office. Marks apply optimistically and
  reconcile on the response; a failed write shows **on its own row**, never as a page-level error
  that loses the other twenty.

### The device

A tablet left on during service has two specific needs, both cheap:

- **The screen must not sleep.** `navigator.wakeLock` while the board is open, released on
  navigation. Without it somebody re-unlocks a tablet every ninety seconds all evening.
- **The session must outlast the service.** The admin session is eight hours (`SESSION_TTL_SECONDS`),
  which covers a dinner service comfortably — but check it before assuming, because a board that
  logs itself out at 21:30 is worse than no board.

---

## 4. How it is written

One route, `PATCH /api/admin/reservations/<number>/service`, taking either
`{ attendance: "seated" | "no-show" | null }` or `{ courseId, served: boolean }`.

**Writes are idempotent and last-write-wins per key**, never read-modify-write: two waiters marking
the main course at the same moment must both succeed with the same result. On Mongo that is a
single conditional update —

```ts
{ $set: { "service.servedAt.<courseId>": now } }   // filtered on reservationNumber
```

— the same shape as the seat claims (rule 2.7). The local JSON store does the same work inside the
store lock. Marking a course *unserved* is `$unset` on that one key, so it cannot clear a
neighbouring course by racing it.

**Attendance is audited; service is not.** A no-show changes what the owner concludes and what a
guest may be charged, so it gets an `AuditEntry` naming who marked it — the log already answers
"who did this?" and this is exactly that question. A course going out is not a change to the
booking, and forty tables times five courses would bury the log it shares with cancellations.

**Client-side ordering already exists.** `lib/sequential-save.ts` was built for the promotions
screen and solves the same problem here: two taps on one row in quick succession must reach the
server in order, and only the newest may write to the screen. Use it per row rather than inventing
a second mechanism.

---

## 5. Permissions

A new `service:record` (rule 2.5: checked in the route, never only by hiding the screen). Additive,
and `admin` holds every permission implicitly, so no existing account changes.

The point of a separate permission is that **a waiter's account can have this and nothing else** —
no cancellations, no menu, no pass-keys. That is the account you leave signed in on a tablet on the
floor, and it should be able to do as little as possible.

---

## 6. Keeping two devices in step

The pass, a waiter's phone and the desk may all have the board open. A mark made on one must appear
on the others within a few seconds.

**Poll. Do not reach for WebSockets.**

- Vercel's serverless functions do not hold WebSocket connections, so it would mean a second piece
  of infrastructure for a screen that thirty rows fit on.
- SSE via a streaming route handler *works*, but each open stream pins an invocation for its
  duration, which is a running cost and a timeout to manage — for a payload this small.
- **Polling every ~5 seconds while the board is visible** is simple, survives a flaky connection by
  construction, and costs nothing to reason about. Pause it on `visibilitychange` so a forgotten
  tablet in a drawer is not polling all night.

Send back a cheap cursor — the greatest `updatedAt` across the evening's bookings — and skip the
re-render when it has not moved. If polling ever genuinely hurts, that measurement is the argument
for changing it; a feeling is not.

**Optimistic marks must not be clobbered by a poll in flight.** A poll that returns while a mark is
still unacknowledged has to leave that row alone, or the cell flicks back and somebody taps it
twice. Same generation-counter idea as `sequential-save`.

---

## 7. How no-shows reach analytics

This is the reason attendance is a permanent field, and it has one rule that matters more than the
rest.

**Never infer a no-show from silence.** On a busy night nobody taps anything, and a rule that
converted "unmarked" into "did not turn up" would record the entire room as no-shows and poison
every number built on it. Absent is **unknown**, permanently, and analytics must say so.

So:

- Staff mark a no-show **explicitly**, with one tap on the row.
- **Closing the evening** offers to mark the remaining unarrived tables in one step — a list, a
  glance, a confirm. That is the realistic path: nobody taps "no-show" at 19:20, they notice at
  21:00 that four tables never came.
- Analytics reports **coverage alongside the rate**: *"no-shows: 3 of 38 bookings — attendance
  recorded for 38 of 42."* A no-show rate computed over a night nobody marked is a confident
  number about nothing, and the coverage figure is what stops somebody quoting it.

Then `docs/analytics.md` §4.1 can be built: occupancy gains a *served* figure beside *booked*, and
the two diverging is itself the interesting number.

---

## 8. What it is not

- **Not a POS.** No prices, no bills, no covers-per-hour. The moment it grows those it needs an
  entirely different set of guarantees.
- **Not a kitchen display system.** The kitchen slip stays paper, cut off the bottom of the sheet.
  This tracks what has *gone out*, which is a floor question, not a pass question.
- **Not visible to guests.** "Your main course is on its way" is a promise the floor cannot always
  keep, and it invites a complaint the app cannot answer.
- **Not a replacement for the printed sheet.** See §3.

---

## 9. Open questions — settle these before any code

1. **Does check-in mean the table or the guests?** A booking for four where three arrive is common.
   `attendance.guests` costs nothing now and cannot be added later without another decision.
   *Recommended:* store it, with the control setting the full party in one tap and letting staff
   adjust. Analytics then reports both *booked* and *actually seated* covers.
2. **How does a shared table behave?** Rooms dining together are one row on the sheet but several
   bookings. Arrival and service should apply to the whole group, the way a table number already
   does — one tap, several records written, which `assignTableNumber` already models.
3. **What happens to a table with no table number?** The board is ordered by table, and staff do not
   always assign one before guests arrive. *Recommended:* an "unassigned" group at the top rather
   than hiding them, and let the number be set from the board. **This mostly goes away** if
   `docs/floor-plan.md` is built — bookings then arrive with a table already claimed.
4. **Should a no-show release the seats?** It would make late walk-ins bookable and would make
   occupancy honest — but it also rewrites seat accounting, which is the most delicate code in the
   app (rule 2.7). *Recommended:* **no**, at least at first. Record the fact; leave the seats. A
   cancellation is the existing tool for freeing a table.
5. **When does service state expire?** It is worthless after the evening and it is small.
   *Recommended:* leave it, and never show it for a past date. Attendance, being a record, is kept
   forever.
6. **Can the board be used to correct yesterday?** Reception will want to. `?date=` allows it;
   attendance is audited so a late correction is traceable.

---

## 10. Order of work

Each step is independently useful. Do not start the next before somebody has used the last one on a
real evening.

1. ~~**The two fields**~~ **Done.**, the store round-trips both ways, and the test that an old booking reads as
   "not arrived, nothing served" — mirroring what `additionalRooms` did.
2. ~~**The route**~~ **Done** — with the concurrent-write test: two marks at once, both succeed, one result.
   Attendance audited, service not.
3. ~~**The board**~~ **Done**, at `/admin/service`, behind `service:record`. Arrival gate, course cells, undo.
   This is the feature; steps 1–3 are the whole of it.
4. ~~**The outstanding-plates strip**~~ **Done** — `outstandingPlates` in `lib/service-board.ts`, which counts only seated tables.
5. **Polling** — a five-second refresh is in, paused when hidden and skipped while a tap is unacknowledged, but untested with two devices. Revisit once more than one screen is genuinely in use. A single-device board does not need
   it, and shipping it earlier is guessing at a problem.
6. ~~**Close-the-evening**~~ **Done** — confirms, names the tables, and is undoable per table.
7. ~~**Analytics**~~ **Done** — occupancy reads "20 of 60 seats booked · 2 actually sat down", and the
   no-show tile always carries its coverage figure.

Steps 8 onwards — service times, delay flags, anything resembling a report — only if somebody asks
after using it for a season.
