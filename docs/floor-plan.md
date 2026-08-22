# The floor plan — restaurant designer, and guests choosing a table

**Status: step 1 of §9 is built — the designer, staff-only, wired to nothing.** Staff can draw the
room at `/admin/floor-plan`; no booking reads the plan, no seat accounting has changed, and the
guest picker and the on/off flag do not exist yet. §10 records what was built and which of the §8
questions are now settled.

The rest of this note is unchanged and still describes work not done. **§2 is the part to read
before continuing** — it is about the step that can corrupt data, and none of it has been attempted.

Read `HANDOVER.md` §2 first. **§2.7 (seat accounting) is the one that decides this feature** — more
than any other rule in the app — and §2.2 (additive schema), §2.5 (authorisation in the route) and
§2.14 (nothing moves under a finger) each decide something below.

---

## 1. What was asked for

Three things:

1. **A restaurant designer.** Staff lay out the room: tables, where they are, how many each seats.
2. **Guests choose a table** while making a reservation, from a view of that room.
3. **An on/off switch in the admin panel**, because a restaurant that does not want this must be
   able to carry on exactly as it does today.

---

## 2. The thing to get right, before anything else

**This changes the unit of availability**, and that unit is the most delicate thing in the app.

Today an evening has a `capacity` in **seats**, and a booking claims seats with a single
conditional update — `$expr` comparing capacity to `reservedSeats`, no transaction, so a standalone
`mongod` works. Rule 2.7 exists because that code has been wrong before, and every one of its
properties was paid for: growing a party claims only the *extra* seats, cancelling is idempotent,
the new date is claimed before the old is released, and a failed write hands the seats back.

Letting a guest pick **table 7** adds a second thing that can be exhausted. Two guests picking
table 7 at the same moment must not both get it, and "seats remaining" cannot answer that — the
room can have twenty free seats and no free table that fits four.

**Do not solve this with a read-then-write.** "Check the table is free, then save the booking" is
exactly the race the seat claim was written to avoid, and it will be wrong perhaps once a month —
often enough to matter, rarely enough to be blamed on the guest.

### The recommended shape: claim the table the way seats are claimed

A per-evening, per-table claim record, updated conditionally:

```ts
type TableClaim = {
  date: string;            // local calendar key, never UTC (rule 2.1)
  tableId: string;
  /** Guests already seated at it. */
  guests: number;
  /** The bookings sharing it — normally one. */
  reservationNumbers: string[];
};
```

Claiming is one conditional update, the same shape as the seat claim:

```ts
// Succeeds only if this party still fits.
{ $expr: { $lte: [{ $add: [{ $ifNull: ["$guests", 0] }, partySize] }, tableSeats] } }
```

That gives, for free, the two behaviours the app already has: **a shared table is just a claim with
two reservation numbers on it** (which is what `tableGroupId` already means), and **growing a party
only needs room for the extra guests**.

The seat claim stays exactly as it is. A booking with the floor plan on makes **two** claims —
seats on the date, and a place at the table — and the second failing hands the first back, which is
the same unwinding `createReservation` already does when a write fails.

**Why not a unique index on `(date, tableId)`?** It looks tidy and it is wrong here: it makes
sharing a table impossible, and sharing is an existing feature (rooms dining together, README).

---

## 3. What the room is

> **Superseded in part by §10.** A "room" here is a **zone** — a hall of the restaurant, never a
> hotel room; this app already uses that word for where a guest is staying, and one word meaning two
> things is how a wrong number reaches a booking. Tables also carry their own width and height, and a
> zone holds **features** (walls, windows, the door, the bar, the musician's stage) as well as tables.


The floor plan belongs to the **restaurant**, not to a date. Tables do not move nightly; what
changes per evening is which of them are in use.

```ts
type FloorTable = {
  id: string;
  /** What staff and guests call it. Maps onto the existing free-text `tableNumber`. */
  label: string;
  seats: number;
  /** Position on the plan, in a unitless grid the designer owns. */
  x: number;
  y: number;
  shape: "round" | "square" | "rectangle";
  /** Degrees. Rectangles need it; rounds ignore it. */
  rotation?: number;
  /** Out of service — a broken leg, a draught nobody will sit in. */
  active: boolean;
};
```

**`label` maps onto the existing `tableNumber`.** That is the continuity point that makes this
feature cheap: the service sheet, the service board, the printed sheet and `groupRoomRowsByTable`
all key on `tableNumber` today and would need **no changes at all**. A booking that claims the table
labelled "7" sets `tableNumber: "7"`, and everything downstream carries on.

Store it in the settings store (`lib/services/settings.ts`) as one document, or in its own small
collection if it grows past a few dozen tables. It is read on every booking page, so it wants to be
one cheap read.

---

## 4. The switch

`floorPlan.enabled`, in the settings store beside `promo.currency` and `restaurant.timeZone`.

**Off is the default and off must be indistinguishable from today.** That is the acceptance
criterion for the whole feature: with the flag off, the booking flow, the sheet, the board and the
seat accounting behave exactly as they do now, and no code path reads a table claim.

**Checked in the route, never only in the UI** (rule 2.5). A hidden picker is not a rule: with the
flag off, `/api/reservations` must ignore a `tableId` in the payload rather than honour it, or the
first person to read the network tab gets to reserve the window table forever.

Worth considering a third state rather than a boolean — `off | optional | required` — because
"guests may pick, or may leave it to us" is a real restaurant policy and retrofitting it later means
touching every call site. Cheap now, expensive later.

---

## 5. The designer, for staff

`/admin/floor-plan`, behind a new `floorplan:edit` permission (additive; `admin` holds it
implicitly).

- A grid. Drag a table to move it, handles to rotate, a field for seats and label.
- **Snap to a grid.** Free positioning produces a plan that looks drunk and no two people ever agree
  is finished.
- A palette of shapes; add and remove tables.
- Read the seat total back: "12 tables · 48 seats", and offer *"set this evening's capacity from
  the plan"* rather than deriving capacity silently. Silent derivation would change every existing
  date the moment somebody drew a room.

**Do not reuse `MonthCalendar`'s drag conventions or the print CSS.** This screen is not printed and
should not pretend to be; the printed sheet stays the printed sheet (rules 2.8–2.10).

The delicate part is deleting a table that a future booking has claimed. Refuse it, and say which
evening — the same courtesy `saveMenuCatalog` shows historical bookings by upserting ids rather than
recreating them (rule 2.4).

---

## 6. The picker, for guests

A step in the booking flow, after the date and party size are known — because both are needed to
say which tables can be offered.

- The plan, rendered at a size a phone can use. Tables that fit the party and are free are
  tappable; the rest are visibly not.
- **Never say who has a table.** "Taken" is all a guest may see. A floor plan that leaks "table 7,
  room 402, 4 guests" is a guest list, and the pass-key rules (2.5) exist precisely because
  reservation details are not public.
- **Nothing moves under a finger** (rule 2.14). The plan must not re-layout when availability
  refreshes.
- Offer **"any table"** unless the flag is `required`. Most guests do not care, and forcing a choice
  adds a step to a flow that is currently four.
- The claim can still fail between rendering and submitting — somebody else was faster. That is a
  `409` with the plan re-rendered and the taken table now visibly taken, in the same shape as
  `DATE_FULL` today.

---

## 7. What it touches, and what it must not

| Existing thing | What happens |
|---|---|
| `tableNumber` | Set from the claimed table's label. The sheet, board and print need **no change**. |
| `tableGroupId` / shared tables | A claim with several reservation numbers. Already the same idea. |
| Seat accounting (2.7) | **Untouched.** Table claims are a second, separate constraint. |
| `assignTableNumber` | Still there for staff overrides; must also move the claim, or the two disagree. |
| The service board | "No table yet" becomes rare, since bookings arrive with a table. |
| Premium evenings | The plan is the same room; premium evenings just have their own bookings. |
| Booking cutoff (2.21) | Unchanged — it decides *when*, not *where*. |
| Cancelling | Releases the table claim as well as the seats, and idempotently (2.7). |
| Restoring (2.12) | A **fresh claim** on both. The table may have gone in the meantime, and the restore must fail cleanly rather than double-book. |

---

## 8. Open questions — settle these before any code

1. **`off | optional | required`, or just a boolean?** §4. Recommend the three-state.
2. **What happens to bookings made before the plan existed?** They have a `tableNumber` string that
   may match no table. Recommend: they keep it, the board shows it as it does today, and nothing
   tries to reconcile them.
3. **Can a guest change their table later?** The manage screen allows changing dishes. A table
   change is a release-and-claim, which can fail — and failing while giving up the table they had
   would be the worst outcome. Recommend: claim the new one first, release the old after, like the
   date move already does.
4. **Do tables have attributes guests care about?** Window, quiet, near the door. Cheap to add now
   as a `tags: string[]`, awkward later.
5. **How does the room differ by evening?** A table out of service tonight only. Recommend a
   per-date exclusion list rather than a per-date copy of the plan.
6. **Does the designer need multiple rooms?** Terrace, main room, private. If yes, the plan is a
   list of rooms, and it is much cheaper to decide that before the first one is drawn.

---

## 9. Order of work

1. **The plan and the designer**, staff-only, with no booking integration at all. A drawn room that
   does nothing is still useful — it can print, and it proves the model.
2. **The flag**, defaulting off, and the route honouring it.
3. **Table claims**, with the concurrency test *first*: two parties claiming one table at the same
   moment, one wins, and the loser's seat claim is handed back.
4. **The guest picker**, with "any table" as the default.
5. **Cancel, restore and move**, each releasing and re-claiming correctly. This is where the bugs
   will be.
6. Only then: tags, multiple rooms, per-evening exclusions.

Steps 1–3 are where the risk is. Step 3 is the one to write tests for before writing the feature —
it is the only part of this that can corrupt data rather than merely annoy somebody.

---

## 10. What is built

**§9 step 1, and only step 1.** The room can be drawn and saved. Nothing reads it.

| Piece | Where |
|---|---|
| The model, its rules, and the coercion that reads a stored plan | `lib/floor-plan.ts` |
| Stored as one settings document under `restaurant.floorPlan` | `lib/services/settings.ts` |
| `floorplan:edit`, additive — `admin` holds it implicitly | `types/booking.ts`, `lib/auth/permissions.ts` |
| `GET`/`PUT`, permission checked in the route | `app/api/admin/floor-plan/route.ts` |
| The designer | `app/admin/floor-plan/` |

Positions snap to a 10-unit grid and are clamped inside the room, seats and rotations are capped,
and rotation is rounded to a quarter turn — all of it in `toFloorPlan`, which runs both on the way
out of the store and on the way in from the designer. A plan that cannot be read comes back empty
rather than throwing: a plan that breaks its own screen cannot be fixed from that screen.

**Duplicate labels are the one thing a save refuses.** An unlabelled table is a room somebody is
still drawing and is only warned about; two tables answering to "7" is a service problem, because
the label is what becomes a booking's `tableNumber` (§3). Compared across rooms, since the sheet
does not care which room a table is in.

The seat total is read back but **never applied**. Capacity is still set on the calendar, per §5 —
deriving it silently would rewrite every existing date the moment somebody drew a room.

### Settled from §8

1. **Three-state flag** — still open. Not needed until step 2, and nothing built here presumes a
   boolean.
2. **Bookings made before the plan** — untouched, as recommended. Nothing reconciles `tableNumber`
   against the plan, and nothing should until there is a reason.
4. **Tags — yes, with editing.** Stored on the table and editable in the designer. Nothing reads
   them; they are there because retrofitting an attribute guests filter on is awkward later.
6. **Several rooms — yes, from the start.** The plan is a list of rooms, decided before the first
   one was drawn precisely because §8.6 says so.

Questions 3 and 5 are untouched: both are about bookings, and no booking touches the plan yet.

### What was verified

The designer was driven against a running dev server: signing in, drawing a plan, saving it, and
reading it back. The clamping was confirmed by sending a table at `x: 99999, y: -500` and getting
back `940, 0`; the grid by sending `37, 63` and getting `40, 60`. A duplicate label across two rooms
came back `409`, an unauthenticated read and write both came back `401`, and a plan whose `rooms`
was a string came back `400`. An out-of-service table stays on the drawing and out of the totals.

Drag-and-drop itself was **not** driven in a real browser — there is no browser driver installed
here. The geometry it depends on is unit-tested, and the pointer handling is not.

### The next step is the dangerous one

§9 step 3 — table claims — is where this can corrupt data rather than merely annoy somebody, and
§2 says why: it adds a second thing that can be exhausted, and the read-then-write that looks
obvious is exactly the race the seat claim was written to avoid. **Write the concurrency test
first.** Nothing built here has gone near seat accounting, and the next change will.

---

## 11. Zones, tables and features

Three corrections to §10, from watching somebody try to draw their own restaurant with it.

### They are zones, not rooms

A zone is a **hall of the restaurant** — the main hall, the terrace, a private dining room. Calling
them rooms was a mistake: this codebase already uses "room" for where the guest is *staying*
(`roomNumber`, `additionalRooms`, "several rooms on one booking"), and one word meaning two things
in one app is how a hotel room number ends up written on a table.

`toFloorPlan` still reads a plan stored under the old `rooms` key and writes it back as `zones`, so
nothing drawn before this is lost (rule 2.2). There is a test for it, and it was checked against a
plan actually saved by the previous version.

### Tables have their own size

Sizes were fixed per shape, which is wrong the moment a restaurant has a two-top and a banquet
table. Every table now carries `width` and `height`, resizable by dragging a corner handle or by
typing exact numbers — a bar is easier to make exactly 420 wide by typing it than by aiming at a
grip. `oval` joins the shapes. Sizes snap to the grid and are held between `MIN_SIZE` and
`MAX_SIZE`, and growing something against the far wall moves it back inside rather than letting it
overhang.

### A restaurant is not only tables

A zone now holds **features** as well: `wall`, `window`, `door`, `stage`, `bar`, `plant`, `path`,
`screen`, `text`. They are a separate list from tables because they mean something different —
tables seat guests, carry the label that becomes `tableNumber`, and are the only things a guest will
ever be able to pick. Nobody books a wall.

**The stage is the one worth calling out.** The musician plays from it, and *which tables are near
the music* is exactly what a guest asks when they ring up — so it is drawn, it is named "Musician"
by default, and `by the music` is one of the suggested table tags. That is the whole reason features
exist rather than being decoration: the guest picker in §6 is useless if the plan does not show why
one table differs from another.

Each kind draws as the thing it is — a wall is solid, a window is open, a walkway is an outline
because nothing stands in it — so staff recognise their own restaurant instead of decoding a legend.

### Strict in, lenient out

Worth stating plainly, because the two look inconsistent and are not:

- **The schema refuses** a payload containing an unrecognised feature kind, with a `400`. A payload
  the designer would never send is a bug, and hiding it helps nobody.
- **`toFloorPlan` drops** an unrecognised feature and keeps the zone. Stored data may have been
  written by a version that no longer exists, and a plan that cannot be read is a screen that cannot
  be opened to fix it.

Confirmed against a running server: a plan with a `helipad` came back `400`; a plant sent 9999 wide
came back 800 and moved so it still fits; a table at `37,63` came back at `40,60`; a rotation of 45°
came back 90°.

## 12. Still not started: the guests' picker

§6 is untouched and stays untouched until the designer is right, which is the order asked for. When
it starts, §2 is the section that matters — the table claim, and its concurrency test written first.

---

## 13. Real dimensions, halls you can size, and chairs

Four things from drawing a real restaurant with §11.

### The dead space was a bug

Tables could not be dragged into the corners or against the far wall. That was not a clamping
rule — it was the pointer maths. The plan is an SVG with a `viewBox`, which by default is
**letterboxed** inside its element (`xMidYMid meet`), and the old code measured the pointer against
the element's bounding box: the empty bars were counted as floor. Every coordinate was skewed, worse
the further from the centre, so the edges could not be reached at all.

It now converts through the SVG's own `getScreenCTM()`, which knows about the viewBox, the aspect
ratio and any transform above it. There is a test that something 300 wide in a 1400 hall may sit at
exactly 1100 — flush to the wall — and that a wild coordinate lands in the corner rather than short
of it.

### Everything is centimetres of real restaurant

A table 120 wide is 1.2 m. A hall of 1600 × 1000 is 16 m × 10 m, and says so on screen along with
its floor area. Staff measure with a tape and type what they measured.

No migration was needed: the numbers the earlier version stored were already in this range — a table
of 70, a bar of 300 — so reading them as centimetres makes them mean what they always looked like
they meant.

### Halls have their own size

`width` and `height` per zone, editable, from a 2 m alcove to a 60 m hall. Nothing may be larger than
the hall holding it, and **shrinking a hall pulls everything back inside it** rather than stranding
tables beyond a wall where they cannot be selected.

A zone drawn before this takes the default 14 × 9 m, which is the size everything was implicitly laid
out in, so an existing plan keeps every table exactly where it was put.

**On "form":** a hall is a rectangle. An L-shaped or irregular room is drawn as its bounding
rectangle with the missing part walled off, which is what the `wall` feature is for. A polygon editor
would be a great deal more to build and to get wrong, and walls describe the same room.

### Chairs are derived, not placed

One chair per seat, arranged by shape — evenly around a round table, along the sides of a rectangle
with the long sides taking more, which is how a table is actually laid up.

They are **computed from the seat count, not stored**. That is the whole reason they cannot be got
wrong: they move, rotate, resize and duplicate with the table because they are not separate objects
that could be left behind, and a table that seats five cannot be drawn with six chairs. Change the
seats and the chairs follow. There is a per-table switch for a table that genuinely has none — a
counter, a poseur.

### The walkway can be picked up

A walkway is drawn as an outline because nothing stands in it, and an outline is only grabbable *on
the line* — which made it nearly impossible to move. Its fill is now `transparent` rather than
absent: pointer events land across the whole shape while it still reads as empty floor. Same for the
free-text label.

---

## 14. The editor, made usable

### Typing a number no longer fights back

The dimension fields could not be typed into. With a minimum of 20, typing
`100` begins with `1`, which clamped to `20` on the first keypress: the caret jumped, the next digit
landed somewhere unexpected, and the number could never be reached at all.

`NumberField` holds **exactly what was typed** while the field is being edited and clamps nothing.
The value is parsed, clamped and committed on blur or on Enter — the two moments a person has
finished saying what they mean. Escape abandons the edit; empty or nonsense reverts rather than
committing a zero. Every numeric control on the screen goes through it.

It needs no effect to stay in step with a shape being dragged: `draft === null` means nobody is
typing, and the field simply shows the live value. That also keeps it clear of the lint rule against
setting state in an effect, which the first version of the day-loading code fell foul of.

### Any angle

Rotation was quarter turns, which cannot describe a real room — a table set on the diagonal, a bar
following a slanted wall, a stage across a corner. It is whole degrees now, 0–359, with a slider,
free entry and eight presets. Existing plans are unaffected: a quarter turn is still a quarter turn.

### Chairs need not equal seats

`chairCount` is drawn when set, and the seat count is used when it is not — which stays the normal
case, and the one nobody should have to think about. It exists because the room does not always
agree with the arithmetic: a four-top laid with two chairs against a wall, a spare chair pulled up
for a child. **The seat count remains the truth for booking**; this is only what is drawn. Zero is a
real answer and is kept as one, distinct from unset.

### Smaller things

A **metre scale bar** on the drawing, because a plan in real dimensions should say so on its face
rather than only in a side panel. A dashed **selection ring**, since a changed outline colour alone
is easy to lose on a busy floor. Tables out of service are **struck through** rather than merely
greyed. The hall is drawn on its own floor colour inside its walls.
