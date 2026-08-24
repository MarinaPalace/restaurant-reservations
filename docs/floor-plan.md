# The floor plan — restaurant designer, and guests choosing a table

**Status: steps 1 and 2 of §9 are built — the designer and the flag, both wired to nothing.**
Staff can draw the room at `/admin/floor-plan` and say who chooses the table; no booking reads
either, and no seat accounting has changed. The guest picker and the table claim do not exist yet.
§10 records step 1 and §15 records step 2, along with which of the §8 questions are now settled.

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

## 12. Was: still not started — the guests' picker

> **Superseded by §17.** The picker and the table claim are built. What follows is the note as it
> stood while they were not, kept because its instruction — §2 first, and the concurrency test before
> the claim — is what the build actually followed, and what found the flaw in §2's own recommendation.


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

---

## 15. §9 step 2: the flag

**Three states, not a boolean** — §8 question 1 is settled, and settled the way §4 asked. `off`,
`optional`, `required`. "Guests may pick a table, or may leave it to us" is a real restaurant
policy rather than a half-configured one, and telling "may" from "must" later would mean revisiting
every call site that had already been written against a boolean.

| Piece | Where |
|---|---|
| The three states, their labels, and the lenient reader | `lib/floor-plan.ts` |
| Stored apart from the plan, under `restaurant.floorPlanMode` | `lib/services/settings.ts` |
| `PATCH`, `floorplan:edit`, checked in the route | `app/api/admin/floor-plan/route.ts` |
| The control, above the drawing | `app/admin/floor-plan/floor-plan-designer.tsx` |

**Off is the default, and off is the acceptance criterion.** A restaurant that never touches this
setting must not be able to tell the plan exists — off has to be indistinguishable from the app as
it was before any of this was built. That is also why an unreadable stored value reads as off: the
lenient direction matters more here than anywhere else in the module, because the alternative is
guests picking tables against a plan the app does not understand.

### Stored apart from the plan

The mode is its own settings document, not a field on the plan. They are changed by different acts
— the plan is redrawn whenever furniture moves, the policy is decided once — and one document would
mean every save of a half-drawn room carried the policy along with it.

### The mode is resolved, never read raw

`optional` or `required` against a plan with nothing bookable in it is not a policy, it is a broken
booking flow: `required` would ask every guest to pick and then have nothing to offer. So there are
two answers, and callers get the resolved one. `bookableTables` counts only tables that are **in
service and labelled** — the label is what becomes a booking's `tableNumber` (§3), so an unlabelled
table could be picked and then not be nameable on the sheet. An unlabelled table is a room somebody
is still drawing (§10), which is exactly why saving allows it and booking must not.

`PATCH` refuses `409` when turning it on against an empty room, rather than storing a setting that
silently would not apply. But the plan can be emptied *after* the mode is stored, which is why every
reader still resolves through `resolveFloorPlanMode` instead of trusting what is in the store —
`getTableSelection` reads both halves together and hands back one answer plus the plan, so no caller
can have the two disagree.

### Strict in, lenient out — again

Same split as §11, for the same reason. `floorPlanModeSchema` refuses an unknown mode with a `400`:
a payload the designer would never send is a bug, and accepting it silently as off would leave a
screen believing it saved a policy it did not. `toFloorPlanMode` drops the same value to off,
because stored data may have been written by a version that no longer exists.

### The control

Three buttons, saved the moment one is pressed — not part of "Save floor plan". A half-moved table
should not have to be saved to change who picks where a party sits. A failed save puts the previous
choice back, so the control never shows a policy that was not stored. The route is the gate
(rule 2.5); the buttons only avoid offering what would be refused, and the screen says plainly that
nothing reads the setting yet.

### What was verified

Unit tests over the reader, `bookableTables` and the resolution, and over the settings round trip
including an unrecognised stored value and the mode not disturbing the plan. `tsc`, `eslint` and the
suite are clean. **This one was not driven against a running server** — unlike §10 and §11, the
`409`, the `401` and the audit entry are unexercised outside the tests.

### Still the dangerous step

Nothing here goes near seat accounting. §9 step 3 — the table claim — still does, and §2 still says
write the concurrency test first.

---

## 16. Which side the chairs go on, and the wall you could not reach

Two things from drawing a real room with §15.

### The margin at the side wall was a rotation bug

A window pushed against the right-hand wall stopped short of it and would not close the gap — around
a metre for a window of any useful length. It was not a clamping rule and not the pointer maths that
§13 fixed. It was this:

Everything is drawn **turned about the centre of its own unrotated box**, but `clampPosition` bounded
that unrotated box. Lay a window down and it is 160 × 20; stand it on end against a side wall and it
still *stores* 160 × 20 while *covering* 20 × 160. The clamp held its stored 160 of width inside the
hall, so the glass — 20 deep — came to rest half the difference short of the wall:

| Window, stood on end | Old gap at the wall | Now |
| --- | --- | --- |
| 160 cm | 70 cm | flush |
| 240 cm | 110 cm | flush |
| 300 cm | 140 cm | flush |

`rotatedExtent` gives the axis-aligned box around the turned shape — what a tape measure would find
— and that is what is now held inside the hall. The consequence worth knowing about is that **`x`
and `y` may legitimately be negative**: a 160-long window standing on end with its glass exactly on
the left-hand wall stores `x = -70`. That is not a thing escaping the room; it is the corner of a box
that is no longer where the shape is.

Turning something now **re-clamps it**, too. Otherwise a window flush to the right wall would swing
out through it the moment it was rotated, and a wall set on the diagonal would poke into the street.
Anything square to the room is untouched to the millimetre: the overhang is zero at 0°, 90°, 180° and
270°, so no existing plan moves by being read.

### Chairs go on the sides you say

`chairSides` — any of top, right, bottom, left; absent means all four. A table against a wall is laid
on three sides, a banquette on one, and two tables pushed together are not laid where they meet.

They are **sides of the table, not of the room**: named before rotation, drawn inside the table's
transform, so clearing the side that faces the wall keeps facing the wall when the table is turned.

The chairs stay **derived** (§13). This says where there is room for them; the count still comes from
the seat count and is still shared out — a four-top laid on two sides puts two on each rather than
dropping two chairs on the floor. Round and oval tables take arcs instead of sides: each side owns
the quarter of the circle facing it, and **sides next to each other make one arc**, so chairs across
"top and right" flow round the corner rather than bunching at the middle of each. Facing sides stay
two arcs, so a round table laid top and bottom does not quietly fill in the sides between them.

All four sides is stored as *absent*, however it is arrived at — one representation of the ordinary
table, and no field grown on every table that never needed one. Empty or unrecognisable reads as all
four, the same lenient direction as `active` and `chairs` (§11): a plan nobody can parse should draw
an ordinary table, not a bare one. Turning chairs off entirely is what the `chairs` switch is for,
which is why the picker will not let the last side be cleared.

The control is a three-by-three diagram with the chair count in the middle, rather than four
checkboxes. "Which side" is a question about a shape in a room, and is answered faster by pointing at
it than by reading the word "left".

### One visible change to tables already drawn

Sharing the chairs out is now largest-remainder over the sides in the order top, bottom, left, right,
which reproduces the old arithmetic **exactly** for every rectangle. Only *square* tables at an exact
tie differ, and both differences are fixes: a square seating six was drawn 2 / 2 / 2 / 0 — one side
bare — and is now 2 / 2 / 1 / 1; a square seating five moves its odd chair from the right to the top.
Chairs are a drawing, not seat accounting, so nothing downstream reads this.

### What was verified

Unit tests over `rotatedExtent`, over a window on end reaching both side walls, over a diagonal wall
held inside both walls, over the unrotated case being unchanged to the millimetre, and over the
turned position surviving a save and a read. For the chairs: the three-sided table, the banquette,
the single side, the round arc and its bounds, facing sides staying apart, all-four being identical
to what `chairPositions` drew before, and the sides surviving a round trip including nonsense and
the empty list. `tsc`, `eslint` and the full suite (756 tests) are clean. **Not driven against a
running server.**

---

## 17. §9 step 3: the claim, and the picker

The switch from §15 could be turned on and a guest saw nothing, because §6 had never been built. It
is built now, and §2 was the section that mattered.

### The concurrency test came first, and it earned its place immediately

`lib/services/table-claims.mongo.test.ts` was written before a line of the claim reached the booking
flow, as §2 asks. It found the design note's own recommendation to be impossible:

**MongoDB rejects `$expr` in the query predicate of an upsert.** The single conditional upsert
sketched in §2 cannot be written. Had the claim been wired in first and tested after, this would have
surfaced as a runtime error on a live booking.

So the claim is **two atomic steps**, and neither is a read-then-write:

1. **Join** — a conditional update with no upsert, matching only if a claim exists *and* this party
   still fits beside whoever is on it.
2. **Open** — a plain insert, with the unique index on `(date, tableId)` deciding the race.

A duplicate-key error from step 2 is contention rather than a bug: somebody created the claim between
our join missing and our insert. The retry is **required, not defensive** — the table may still have
room for us, and failing there would refuse a booking that fits. There is a test for exactly that,
and it fails without the retry.

Two guards, doing different jobs: the party-size check covers the empty table, which `$expr` never
sees because there is no document; the `$expr` covers the contended one.

### What the claim gives for free

Sharing is not a special case — a claim with two reservation numbers on it *is* a shared table, which
is what `tableGroupId` already meant. Growing a party only needs room for the extra guests.

Releasing is idempotent by filter rather than by checking first: the booking must still be on the
claim for the update to match, so a cancel that runs twice cannot leave a table reading free while
somebody is sitting at it.

**Seat accounting is untouched.** `reservedSeats` means exactly what it meant. A booking with the
plan on makes two claims, and the second failing hands the first back — the same unwinding
`createReservationEntry` already did when a write failed.

### `tableId` on the booking, beside `tableNumber`

They answer different questions. The number is what everybody *calls* the table and is what the
sheet, the board and `groupRoomRowsByTable` read — unchanged, which is the continuity §3 promised.
`tableId` is the plan's stable id and is what a cancellation releases.

Resolving the claim back through the label at cancellation time would release whichever table answers
to that string *today*, which may be a different table entirely after a rename, or none.

### Cancelling and restoring

Cancelling releases both claims. A cancelled booking that kept its table would block it all evening
with nobody there and nothing on any screen to explain it.

Restoring takes a **fresh claim on both** (§7). The table was given back on cancellation and somebody
may be sitting there now; a restore that assumed it back would double-book the room. If the table has
gone — taken, or deleted from the plan — the restore fails cleanly and hands the seats back. The
guest can be given another table; two parties at one table cannot be fixed at the door.

### The picker

A step between the date and the menu, because both the date and the party size are needed to say what
can be offered. It fetches rather than being handed the room, unlike every other step, because both
of those live in `sessionStorage` — and because the room is the one thing on this flow another guest
can change while it is on screen.

- **Nothing says who has a table.** "Taken" is all a guest is told, and that is enforced by the
  *shape* `offerTables` builds rather than by the screen choosing not to render it: there is no room
  number in a `TableOffer` to leak. The seats already taken are not exposed either — "two of its four
  seats have gone" is still something about a stranger's party.
- **Taken tables stay drawn**, greyed and not tappable (rule 2.14). A room with them removed is a
  different room every time it loads.
- **"Any table" unless the evening insists.** Most guests do not care, and forcing a choice adds a
  step to a flow that is otherwise four.
- **Unlabelled tables are dropped entirely**, not shown as unavailable. The label becomes
  `tableNumber`; drawing an unlabelled table as taken would be a lie about a free one.
- **A claim can still fail between drawing and submitting.** That is a `409` and the guest goes back
  to the picker with the table now visibly taken — the same shape as a full evening.
- An evening where nothing can be offered says so and lets the booking go ahead anyway. The seats are
  still there, and refusing a dinner over the seating would be absurd.

The step is on the rail for every flow but walked only by some: an evening with selection off routes
the guest straight from the date to the menu, and the step itself checks again for anybody who links
to it directly. A fixed rail was chosen over one that grows and shrinks per evening, because the one
thing worse than an extra label is a progress bar that goes backwards.

### Still open

- **`assignTableNumber` does not move the claim.** §7 says it must, or the two disagree: staff typing
  a table number by hand today sets `tableNumber` without claiming, so a guest could later be offered
  a table reception has already given away on paper. It is a real gap and the next thing to close.
- **Changing a table from the manage screen** (§8.3) is not built. A guest who wants a different
  table telephones, as they did before.

---

## 18. The picker was cut off, and now it moves

### The fault, measured rather than guessed

Driven in a real headless Chrome at 390 x 844 — a phone — with a hall of 1400 x 900 cm and four
tables:

| | Before | After |
| --- | --- | --- |
| The drawing | 352 px wide inside a 324 px card | fits the card |
| Table 2, at the far wall | drawn at x 366–386, **outside** the card | inside, and pickable |
| Reaching it | scroll the card sideways — impossible with a finger | drag, pinch, buttons, keys, or the list |

The plan was `w-full min-w-[22rem]` inside a wrapper with `overflow-x-auto`. On a phone the
`min-w` wins: the drawing is forced wider than the card it sits in, and the far part of the room is
outside it. In principle that wrapper scrolls. In practice the SVG carries `touch-none` — which is
right, it is what stops the page scrolling under a drag on the plan — so a finger on the drawing
scrolls nothing at all, and the only scrollable strip left is the two pixels of padding around it.
Nothing on screen said there was more room to the right, either.

So: a table in the far half of the room could be seen by nobody on a phone and picked by nobody at
all. A booking flow that did not work.

The guess in the backlog — a viewBox sized to something other than the plan — was close but not
what it was. The viewBox was `0 0 zone.width zone.height` and the drawing genuinely fits inside it:
every read normalises through `clampPosition`, so nothing on a plan ever sits outside its hall. The
fault was one layer up, in CSS.

### The extent comes from the drawing

`lib/floor-plan-viewport.ts` is the arithmetic, pure and tested: `planBounds` unions the hall
rectangle with the **rotated** footprint of every table and every feature, and adds 20 cm of margin
so a table flush against a wall does not read as clipped.

The rotation matters even though today it can never push past the wall. `clampPosition` bounds the
rotated footprint (§13), so a 160 cm window stood on end is stored at `x = -70` with its glass
exactly on the wall — its *stored* rectangle is outside the hall while its *drawn* one is not.
Anything that measured the stored rectangle would be wrong, and anything that trusted the hall's
own numbers would be wrong the moment a plan arrived from somewhere that did not clamp. The extent
is read off the drawing so neither can happen.

**The hall is always included**, even when the furniture sits well inside it — fitting to the
furniture alone would make the plan a different shape every evening as tables come and go, which is
rule 2.14 by another route.

The box on screen is shaped like the plan rather than given a height of its own. A fixed height
letterboxed a wide room inside deep empty bands — 322 x 416 for a room half again as wide as it is
deep — and since zooming and panning never change the ratio, one `aspect-ratio` holds at every
magnification.

### Fit first, then move

The plan opens fitted: the whole room, however small that has to be. Nobody should have to move
anything to discover that a table exists. After that it can be moved around — drag or wheel on a
pointer, drag or pinch on glass, and `+` / `−` / **Fit** buttons beside the plan, because
gesture-only is not enough for a laptop with no wheel. The plan takes focus and answers the arrow
keys, `+`, `−` and `0`; a table reached by tabbing is panned into the frame, since tabbing to
something that cannot be seen is the same fault as the clipping, only quieter. Zoom stops at the
fitted plan on the way out and at 8× on the way in, and the view is clamped to the plan, so it
cannot be dragged off the side of the room.

A drag over a table pans the room and does **not** choose it: four pixels of movement suppresses
the tap, so a thumb on glass never books a table it was only sliding past.

### The list is the other half of the fix

Under the plan, every table in the zone as plain rows — label, seats, and the reason when it cannot
be had — selecting exactly the same table. Free tables first and **smallest first**: the guest who
does not mind wants the one that fits, and offering a party of two the four-top costs the
restaurant a table it could have sold twice.

This is the accessible path, the small-screen path, and the path for anybody who does not want to
study a floor plan. It is also insurance: a drawing that fails can no longer take the step down
with it.

### Smaller things, while it was open

- An unavailable table says **why** when tapped — "already taken", "seats 2, which is not enough for
  your party" — instead of ignoring the finger. A control that does nothing when pressed reads as a
  broken screen.
- It is crossed through as well as greyed. Tone alone is not a difference everybody receives.
- The chosen table is drawn with a heavier outline, and its label is repeated in words above the
  buttons: a table number on a drawing is something to remember, in the summary it is something to
  read.
- **"Any table" is untouched** and still one tap, beside Continue.

Seat accounting and the claim rules were not touched. This was a viewport and an input problem.

---

## 19. Who chose the table

### The gap

The admin day view showed the table number on a booking but not its provenance. Owner, staff and
guest all write the same `tableNumber`, and once written they were indistinguishable — so nobody
could tell whether a table could be moved freely or whether a guest had picked it deliberately on
`/booking/table` and would mind being moved off it.

### What is recorded

`tableSource` — `"owner" | "staff" | "guest"` — and `tableSetAt` beside it. Additive (rule 2.2):
every booking taken before this reads back with neither, which is the honest answer, and absent
means "nobody recorded it", never a guess.

**Taken from the account, never from the request body.** A source a caller could name is a source a
caller could lie about, and the whole value of the mark is that a guest's pick can be trusted to be
a guest's pick. `tableSourceOfUser` in `lib/auth/permissions.ts` maps the signed-in account to its
source: an administrator is the owner, anybody else is staff. The guest flow passes `"guest"`
because it is the flow the guest walked.

**Set and cleared together with the number.** A table with no number cannot have been chosen by
anybody, so clearing the table clears the source and the timestamp in the same write. A source left
behind would be read as a guest still holding a table they do not have — which is exactly the kind
of quiet lie this feature exists to prevent.

Every path that writes a table sets it: the guest picker, the desk booking, the staff edit, and the
table route. That last one also gained the audit entry it never had (`docs/audit-log.md`).

### How it is drawn

A ring around the number, and **never colour alone**. Roughly one man in twelve cannot separate a
red-green pair, a screenshot printed in black and white has no colour at all, and the ring on a
forty-row day sheet is small. So each source carries three signals — a colour, a letter (G, S, O),
and a border style (solid, dashed, double) — plus the full name in the tooltip and in the
accessible label. Any one of the three identifies it.

The colours are amber for the guest, the app's accent for staff, and ink for the owner. Amber for
the guest is what was asked for and is also right: guest picks are the ones staff must think twice
about moving, and amber is this app's established "attention, not error". The blue and violet first
suggested were dropped — this palette is warm throughout and two imported hues would read as
another application's badges on the same sheet.

A legend sits once at the top of the day sheet, and only when something on that evening is wearing
a ring: three colours nobody explains is three colours nobody reads, and three colours explained on
an evening where nothing wears them is worse. It is screen-only, because a new block on paper
changes the sheet's arithmetic (rule 2.8) and whoever is holding the print has the screen beside
them.

On the reservation's own page there is room for the sentence, so it says "chosen by the owner" in
words, with the time.

### Not built: locking a table

Backlog item 4 part two — a table that cannot be changed below a given permission level — is still
a plan. It needs a decision about whether the check is a permission or a genuine rank comparison,
and the current model is permission-based; inventing ranks is a bigger change than it looks. What
is built here is the half that had to come first: a lock on a table nobody can attribute would say
nothing about whose decision was being protected.

---

## 20. One viewport, and a table a guest can change

### The same bug, in the other room view

The service board's restaurant view was written the same way the guest picker
had been: `w-full min-w-[36rem]` inside an `overflow-x-auto` wrapper, with
`touch-none` on the drawing. Which is the fault of §18 exactly — on a tablet held
in portrait at the pass, the far half of the room was outside the card and no
finger could scroll to it. The tables nobody could reach were the tables nobody
could mark served.

Fixing it twice was not the answer. `components/plan-viewport.tsx` is the
viewport both views draw through: it fits the whole plan on open, moves under a
finger, a wheel, three buttons and the arrow keys, clamps to the plan and stops
at 8×, and shapes its box like the room. What is *on* the floor stays with each
view, because the guest's picker and the service board mean very different
things by a colour.

**One trap worth naming.** The first version took a `height` class so a panel
could size it. An explicit height beats `aspect-ratio` in CSS, so that quietly
put the letterboxing back — measured on a phone, a 1400 × 900 room came out
341 px wide and 512 tall, most of it empty. There is no height prop now, only a
`max-h` for a very deep plan.

### A guest can change their table

Chosen once and never again was the rule, and a guest who wanted a different
table telephoned reception — the thing this app exists to stop. Everything
needed was already built, so the change is small: one route, and the picker
lifted into `components/table-chooser.tsx` so the booking step and the manage
screen ask the question the same way.

`POST /api/booking/manage/table` checks, in the route and not in the screen:

| Rule | Why |
| --- | --- |
| The pass-key authorises it, not the reservation number | Guests read numbers out to share tables (rule 2.5) |
| The 12-hour cutoff, via `canGuestModify` | The same deadline as every other guest edit |
| The evening still offers table selection | An evening with it off is one the restaurant seats |
| The table is resolved from the plan | Rule 2.6 — a request cannot name its own seat count |
| **Not a shared table** | Moving one booking of a joined party splits it, silently, and only visibly at the door |

Sending no table means "hand it back and seat us", the same answer as the "any
table" button — except on an evening where the choice is `required`, which is
required precisely because nobody is doing the seating that night.

**The claim order is the design.** `moveReservationTable` claims the new table
*before* releasing the old one, so a guest who cannot have table 9 still has
table 7 when they are told so. Both are briefly held, which costs one table's
availability for a few milliseconds; releasing first would mean a failure in the
middle leaves the guest with nothing and somebody else may have taken theirs
meanwhile. A failed release afterwards is logged, never raised — the guest has
their new table, and a stale claim on a table that is really free is worth an
alert and not worth failing a change the guest can see.

### Still to come: a cutoff of its own

Table selection is expected to close **earlier** than the booking does — a day
or a few hours before service, so the floor can be laid out — while changing a
menu choice stays open until the 12-hour deadline. That is not built: today both
close together, on `canGuestModify`. The check lives in one place in that route,
which is where the second deadline will go. `docs/backlog.md` item 7 carries it.

### And the table is where the guest can see it

It was on the service sheet, in the log, and nowhere the guest could read it.
Now it is on the confirmation screen beside the party size, and in the calendar
reminder — the Google link and the `.ics` both — because the reminder is what a
guest actually opens on the way down, days after the confirmation screen was
closed. Only when there is one: a line promising a table that does not exist yet
is worse than no line, because the guest turns up looking for it.

---

## 21. A party of five in a room of four-tops

### The refusal that should never have been

A restaurant of four-tops was telling a party of five *there is no table free
for 5 on that evening*. Which was true and useless: staff would push two tables
together without thinking about it, and the software refused a booking over
furniture it could have moved.

### Which tables may be joined is written down, not measured

> **Superseded by §23.** The merge group described here was replaced before any
> restaurant drew one: a shared name says *these may be joined* and cannot say
> *these two are next to each other*, which is the thing that decides whether a
> combination is a row or a heap. Everything below about claiming a merged table
> whole still stands.

`FloorTable.mergeGroup` — any name; tables sharing one may be pushed together.
Deliberately **not** worked out from coordinates: two tables 30 cm apart may
have a pillar between them, and two a metre apart may be joined every Saturday.
Whoever draws the room knows which is which and the software does not, so the
designer asks ("May be pushed together with") and names the partners back, since
a group is a string and a typo is a group of one that silently offers nothing.

Absent on every table drawn before this, so no existing plan changes behaviour.

### One combination per group, and only when nothing else will do

`offerTables` returns `combinations` beside `tables`. Three rules decide them,
and each is there to stop the room being wasted:

- **Only if no single table fits.** Pushing tables together is work for staff and
  it costs the room a second table. Offering it beside a four-top that would
  have done loses a table for nothing.
- **The fewest tables, then the fewest seats.** A group of four tables offers
  eleven combinations for a party of five, and a guest asked to choose between
  them is being asked to do the maitre d's job. So each group offers exactly
  one — and 4 + 4 beats 6 + 4 for a party of seven, which leaves the six-top for
  a party that needs a six-top.
- **Whole tables only.** Every table in a combination must be *completely* free.
  Half a table cannot be pushed against somebody else's dinner.

### A merged table is claimed whole

This is the rule everything else follows from. A party of five on two four-tops
claims **4 and 4, not 5 and 0**: nobody can be seated at a table pushed against a
stranger's party, so both tables leave the room. Measured in a running server —
after that booking, a party of two is shown both four-tops as *taken*.

The claims are taken one at a time and **a failure part way through gives back
what was already taken**, or the room loses a table to a booking that never
happened. Releasing reads the plan to find each table's seats, because that is
what was claimed; a single-table booking still releases the party's own count
and still cancels with exactly the reads it always did.

### What it looks like

The booking carries `tableIds` (additive — `tableId` stays the first of them,
so everything written for one table keeps working) and `tableNumber` becomes
`"7 + 8"`, which is the string the sheet, the board and `groupRoomRowsByTable`
have always keyed on. The service board splits on the `+` so a merged party
lights up **both** its tables and is not listed as unplaced.

On the guest's plan the two tables are drawn joined by a band, tapping either
takes the pair, and the list offers *Tables 1 + 2 · Seats 8* above the ordinary
rows. `t7+t8` is also the id the screen sends back — one field carries a table
or a combination, and `findPlanCombination` resolves it **from the plan**, so a
request cannot join two tables at opposite ends of the room (rule 2.6).

One trap this caught, in a real browser and not in a test: the picker's "nothing
is available" check counted only single tables, so the very evening the feature
exists for still said *we will seat you*. `hasOffer` counts combinations now.

---

## 22. Tables close before the booking does

Backlog item 7, built. `tableCutoffHours` on the evening: how many hours before
the sitting guests stop choosing or changing a table. **0 — the default — is
off**, and off is what every evening did before this existed, so a restaurant
that lays the floor as bookings arrive never has to think about it.

Its own number rather than sharing `bookingCutoffHours`, because the two answer
different questions:

| Deadline | Closes when | Default |
| --- | --- | --- |
| `bookingCutoffHours` | the kitchen can take no more covers | at the sitting |
| `MODIFICATION_CUTOFF_HOURS` | the kitchen has counted | 12 hours |
| `tableCutoffHours` | **the floor is laid out** | off |

Enforced in three places, all of them write paths:

- `/api/restaurant/tables` answers `{ mode: "off", closed: "cutoff" }`, so the
  booking flow skips the step exactly as it does for an evening with selection
  switched off — and the manage screen, which had a *Change table* button a
  moment ago, says why rather than silently losing it.
- The **booking** route drops a table named by a screen opened before the cutoff
  and takes the reservation anyway. Silently, deliberately: the guest asked to
  eat, the seats are theirs, and "your table went while you were choosing" is
  not a booking failure.
- The **change** route refuses with a sentence naming reception, who are never
  bound by any of this.

Verified against a running server: with the cutoff four hours out and service at
19:00 it was still open at 02:45; set to 24 hours it answered `closed: "cutoff"`
with the deadline, a booking naming a table came back with none, and a guest
trying to move got the 409.

---

## 23. Which table is next to which, and the chairs lost between them

§21 shipped a merge **group**: a name written on two or more tables, any subset
of which could be pushed together. It was replaced before a restaurant had drawn
one, because a group cannot answer the question staff actually ask.

### A group cannot tell a row from a heap

Tables stand in a row. 1, 11, 12, 13 along a wall: 11 is next to 1, 12 is next
to 11, 13 is next to 12. A group containing all four says any two of them may be
joined — including **1 and 13**, which are at opposite ends with two tables
between them. Staff cannot push those together, so neither may the software.

What is written down now is the adjacency itself: `FloorTable.neighbours`, a
list of `{ tableId, side }`. Sides are the table's **own**, named before
rotation exactly as `chairSides` are, so they turn with the table.

Every link is stored **from both ends** — 1 says 11 is on its left, 11 says 1 is
on its right — and `toFloorZone` is what makes that true on the way in. Saying
it once in the designer is enough; the neighbour is told. A link naming a table
that is not in the hall is dropped, because tables cannot be pushed together
through a wall and a link to a deleted table is a row with a hole in it.

### A combination is a stretch of one row

`rowThrough` walks a table's row — back to one end, then forward through it —
so it makes no difference which table of the row is asked. A combination is a
**contiguous stretch** of that walk:

| Asked for | Answer |
| --- | --- |
| 11 + 12 | yes — they touch |
| 11 + 12 + 13 | yes — a stretch of the row |
| 1 + 12 | no — 11 is standing between them |
| 1 + 11 + 13 | no — a row with a gap in it |

A table somebody is already on **breaks the row**: with 12 sold, 11 and 13 are
not two tables pushed together, they are two tables with a stranger's dinner
between them. That falls out of the walk rather than being checked separately —
the row simply stops there.

`findPlanCombination` enforces the same thing on the way in, and it is the
enforcement that matters: it requires every consecutive pair to be linked **on
the same side**, so a request cannot name a row that doubles back on itself, nor
one given out of the order the tables stand in. Rule 2.6, again — the plan
decides, never the request.

Rows run both ways: left-and-right is one axis, top-and-bottom another. Two rows
can cross at a table without being one row.

### Two four-tops seat six

The mistake the group model was quietly making. Push two four-tops together and
the chair on one's right and the chair on the other's left are standing where
the other table now is. They get taken away. **The pair seats six, and selling
it as eight seats two people on furniture that is not in the room.**

`seatsPerSide` works out where a table's seats are by asking `chairPositions` —
*the function that draws them* — for exactly `seats` chairs and sorting them onto
the side each is nearest. Derived from the drawing rather than being a second
opinion about it, so the number can never drift from what staff can count in the
picture. `joinedSeats` then sums a row and subtracts each junction.

Three things follow for free:

- A **long table joined end to end** costs one seat each; joined along its
  length it costs two or three. Which is correct, and nobody had to say so.
- A side staff had **already cleared** costs nothing. The note on `chairSides`
  always said "two tables pushed together are not laid where they meet" — so two
  two-tops laid top-and-bottom push together and still seat four.
- The **designer shows it**: pick a table and it names the row and what it
  seats, with the seats lost where they meet spelled out. Staff who expect eight
  find out at the plan and not on the night.

`combineTables` searches stretches shortest-first, and it has to *try* them
rather than reason about them: adding a table to a stretch can add fewer seats
than that table has.

### Where along the row is the guest's choice

§21 offered one combination per group and defended it: a guest asked to choose
between eleven ways to seat five is being asked to do the maitre d's job. Half
of that was right and half was not, and a room of six two-tops shows which half.

A party of six fits on three of them in **four different places** — 1+2+3,
2+3+4, 3+4+5, 4+5+6. Those are not eleven ways to do the same thing. One is by
the window and one is by the door, and which of them a guest wants is precisely
the question the picker exists to ask. So every stretch that fits is offered.

**How many tables is still not their choice.** Every stretch offered is the same
length — the fewest that will seat the party — because a party of six given four
tables to push together has been sold a worse evening and the room has lost a
table for nothing. The row offers *where*, never *how many*. Tightest first, so
a guest who does not care takes the one that costs the room least, and capped at
`MAX_COMBINATIONS_PER_ROW`, since a dozen near-identical buttons is a list to
get lost in rather than a choice.

### And the guest can tap the tables out themselves

The prepared stretches are what most guests want and they are still what the
list offers. But a guest who wants a *different* three tables — the ones by the
window, not the ones the arithmetic preferred — has no way to say so except by
pointing at them. So the room is not only a set of buttons for prepared answers:
tapping a table beside the ones already picked adds it to the row.

A tap **starts** the row when nothing is chosen — with that one table, and only
that one. It first shipped taking the whole prepared stretch the table belonged
to, which meant a guest could never begin a row of their own: the first tap
answered the question for them. The prepared stretches are still there, named,
in the list below.

From there a tap **extends** the row at either end, **shortens** it when the end
table is tapped again, and otherwise **starts again** from the table tapped — pointing
across the room is a guest changing their mind, not a mistake to refuse. It will
not extend a row that already seats the party: the guest should not have to be
economical on the restaurant's behalf, but a party of four holding six tables is
a room sold out by mid-evening.

`inspectRun` is the client's half of the rule, and deliberately the same rule as
`findPlanCombination`: every table free, each linked to the next, the row running
one way. A guest must never be able to assemble on screen something the booking
would then refuse — or, worse, silently drop.

Two things had to travel to the browser for that: which tables each one stands
against, and **where its seats are**, side by side. The second cannot be worked
out on the client — it depends on `chairSides`, which is a fact about the room
and not something a guest is told — and without it the seat count could not
follow the guest's finger. Finding out at the summary that three two-tops seat
six is finding out too late.

It also needed the offer to say plainly whether **anybody is already at a table**.
`unavailable` answers a different question and answers it with the most useful
reason rather than every reason: a four-top with two people on it reads
*too small* to a party of five, which is true and hides that it is not free. That
was enough to let it into a row — and a row is claimed whole, so the booking
would have failed at the claim with the other tables already taken. `occupied` is
a plain yes or no; how many are on it stays unsaid, since that would say
something about a stranger's party.

Offered stretches overlap, and the plan had to answer for it: table 3 above is
in three of the four offers. Tapping a table takes the **first** stretch holding
it — the tightest — rather than the last, which would have depended on the order
the search happened to run in. A stretch already chosen stays chosen when one of
its tables is tapped again, so a guest letting go of an offer does not silently
land on a different one that shares a table.

One real gap this closed. The booking route never checked the party against the
combination's seats, and nothing below it would: a merged holding claims each
table **whole**, so `claimTable` only ever compares a table's seats with its own
and never with the party. Harmless while 4 + 4 was 8 and wrong the moment it was
6, so `resolveTable` now checks — and drops the table rather than refusing the
booking, the same as every other thing it cannot resolve.

### A party of two may not take a four-top

Asked for alongside the rework, and the same kind of waste from the other end: a
guest booking for two would take the nicest table on the plan, and the party of
four arriving after them found nothing.

A table now carries `kept-for-larger` when it fits, is free, and **something
that fits the party better is free too**. Measured as the seats it would leave
spare — `(seats − taken) − guests` — and only the tightest are offered.

Three things about the measure:

- It counts the seats **still free**, not the table's size, so a party joining
  others at a shared table is judged on what is left of it. Joining is the use
  of a room that costs it least, and it stays offered.
- Some table always holds the minimum, so this can **never refuse every table**.
  A room of nothing but eight-tops still seats a party of two.
- It is decided **hall by hall**. A guest who wants the terrace is not told the
  terrace is closed to them because the main hall has a smaller table; within one
  hall the choice costs the restaurant a table, between halls it is the guest
  choosing where to sit.

It deliberately does **not** feed the decision to push tables together. That
question is "could this party sit here at all", and a four-top being held back
for a larger party is still a four-top that fits — a room of them must not start
joining tables for a party of two. `hardRefusal` answers the first question and
`reasonUnavailable` layers the right-sizing on top of it.

---

## 24. Sitting with a party who is already at a table

"Sit us with room 402" was asked on the summary, after the table had been
chosen. On an evening where guests pick their own table that asks the same
question twice and keeps both answers: joining only set the group, and the
joining guest went on claiming the table they had picked earlier. Two bookings
came out marked as sharing a table while holding different ones — and the manage
screen then refused to change either, because a booking sharing a table has to
be sorted out by reception.

The question is asked **before** the table now, on the table step itself. A
party joining another party is not choosing where to sit; they are being told.

`/api/booking/share` answers what that table is and nothing else — not a name,
not a room, not how many are already at it (§6, and the number of strangers at a
table is the part of §6 to be most careful about). It answers *whether this party
fits* rather than handing over the seats taken, is rate-limited, and makes the
same three refusals `resolveTableGroup` makes, worded for somebody still filling
in the form.

### Their table is pinned, not locked

It cannot be let go of — "we are sitting with room 402" is not undone by tapping
room 402's table — but tables **can** be pushed against it. That is how a party
too big for that table alone is seated beside them rather than told to book
separately.

### The row has to seat both parties, and only the row knows that

A party of three joining a party of three at two two-tops was told there was no
room and then not allowed to add the table that would have made room. The rule
that stops a row growing past what it needs was comparing the row's four seats
with *this* party's three, deciding it was already big enough, and refusing
every tap — measuring a row that has to hold six against three of them.

So the share lookup answers `seatsNeeded`, which is both parties together, and
that is the number the picker builds towards: the hint under the plan, when the
row stops growing, and whether the booking may go ahead. `guestCount` alone is
right for an ordinary booking and wrong for every shared one.

The booking route checks it again, and has to: the seat check there measures the
row against this party, and the claim counts a row's people against its first
table without ever comparing them to what the row seats. A screen opened before
somebody else joined would otherwise seat three more at a row with one chair
left.

### Exclusivity is stated, not implied by a number

The part that needed care. A table in a row pushed together is taken **whole**,
however few people are at it, because nobody can be sold a seat at a table
shoved against a stranger's dinner. On an empty table that is said by claiming
every seat. It cannot be said that way on a table another booking is already at:
the count would have to be filled to the table's capacity, and cancelling could
then only give back the whole thing — wiping out the party who were there first.

So `wholeFor` on the claim lists the bookings holding the table whole, and
`guests` stays the count of people actually seated. A table with anybody in that
list is offered to nobody, whatever the count says, and every booking gives back
exactly what it took. Three things follow, and each is a test:

- The shared table still reads **2 seated** after a party of four is pushed onto
  it — the truth, rather than a 4 that means "full".
- A stranger asking for its two spare seats is **refused**, which the seat
  arithmetic on its own would have allowed.
- Cancelling the joining booking leaves the first party at their table with
  their own count, and gives the added table back to the room.

Releasing is a single conditional pipeline rather than a read and then a write:
whether this booking held the table whole has to be decided from the document as
it stands at that instant, and reading first is the race this file exists to
avoid. Absent `wholeFor` reads as "nobody holds this whole", which is what every
claim written before this meant.

---

## 25. The chairs, on the guest's plan

Staff had chairs on their drawing and guests had bare rectangles. A guest
deciding whether their party fits is counting places to sit, and the room was
not showing them any.

**As many chairs as the table seats**, rather than the count staff drew it with.
`chairCount` is what the room looks like and `seats` is what may be booked, and
a guest counting chairs must arrive at the number the booking is measured
against. A side staff never laid — a table against a wall, a banquette — still
has no chairs on it; that is the room, not the arithmetic.

**A chosen row drops the chairs where its tables meet.** Two four-tops pushed
together are drawn with six chairs, not eight, which is the same subtraction
`joinedSeats` does and the reason for doing it in the drawing too: the guest
counts what they are being sold. There is a test tying the two together, so the
picture cannot drift from the price of it.

### Every chair, whoever is at the table

A table with one guest on it is drawn with **all** its chairs, not with one
crossed off. §6 stands: how much of a table is gone says something about a
stranger's party, and the plan says *taken* and stops there. Asked for and
settled deliberately — the room shows what a table seats, never who is at it.

### The margin had to grow

Chairs stand outside the table they belong to, half a metre of floor beyond its
edge, and the viewport allowed 20 cm around the drawing. A table against a wall
had its chairs cut in half by the edge of the picture — which reads as a room
drawn wrong rather than as a picture that stops short. The margin is a chair
wide now.

### Both bookings are at one table, so both say so

A party joining another and pushing a table against theirs left the two
bookings describing different furniture — `12 + 13` for the party who were
there and `12 + 13 + 14` for the one that arrived. The sheet, the board and
`groupRoomRowsByTable` all key on that string, so one table was listed twice,
once under each name, and staff laying the room would have had to work out that
it was one.

The row is written across the whole group, because it is a fact about the group
and the last party to join is the one who knows all of it. The claims are
untouched: a booking whose `tableIds` gain a table it never claimed releases
nothing for it, since releasing requires the claim to still name the booking.

### Smaller things, while it was open

- **The list said nothing was chosen** while three tables were lit up on the
  plan beside it. It was comparing a table id with `t1+t2+t3`; it marks every
  table *in* the row now, and tapping one there builds the row exactly as the
  plan does.
- **"You can push more tables against it"** was offered to a party who already
  fitted at the table they were joining. A row stops growing once it seats
  everybody, so the next tap would have refused — the offer promised something
  that could not happen.
- **The lookup fired before the browser had the booking.** The evening and the
  party size come from the session, which is empty until hydration, and asking
  then sent a blank date and got back a refusal about the reservation number —
  a lie about which of the three was missing.
