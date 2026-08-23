# Backlog — decided, not yet built

Things that have been thought about and deliberately not started. Each entry says what it is, what it
would touch, and what has to be settled before anybody writes code. An idea with no entry here has
not been thought about; an entry here is not a commitment to build.

Read `HANDOVER.md` §2 first. Every plan below is constrained by it.

---

## 1. The reservation card — Apple Wallet, Google Wallet, and a scanner

**Status: planned, not started. Requested 2026-09.**

### What it is

A guest saves their booking to the wallet on their phone. At the door, a member of staff scans it and
the booking comes up — arrival time, party size, table, allergies — and can be marked seated in one
action.

### Why it is worth building

The pass-key already does the *authorisation* job. What it does not do is survive the walk from the
room to the restaurant: a guest who has closed the confirmation screen has a reservation number
written on nothing. A wallet card is a booking that is still there when the phone is opened at the
door, and it turns the arrival from "what name is it under?" into a scan.

It also closes the loop the service board already opened. The board's `seated` mark is the number
analytics rests on and it is currently typed by hand from a paper sheet; a scan is the same mark with
nobody typing.

### The shape it would take

**A pass, not a QR code in an email.** Both wallets take a signed bundle:

- **Apple**: a `.pkpass` — a zip of `pass.json`, images and a `manifest.json`, signed with a Pass
  Type ID certificate from an Apple Developer account. Served as `application/vnd.apple.pkpass`.
- **Google**: a JWT signed with a service-account key, describing an `EventTicketObject` against a
  class created once. The guest gets a "save" link rather than a file.

Two different formats over one internal record, which is the thing to get right first:

```ts
type ReservationPass = {
  reservationNumber: string;
  /** What the scanner reads. Not the reservation number — see below. */
  passToken: string;
  date: string;
  time?: string;
  guestCount: number;
  tableNumber?: string;
  roomNumber: string;
  /** Bumped on every change, so a stale card can be told from a current one. */
  version: number;
};
```

### The decisions that have to be made before any code

1. **The scanned token must not be the reservation number.** Guests read reservation numbers out to
   each other to share a table (README), so a scanner that accepted one would let any of those rooms
   check the party in. The card carries its own opaque `passToken`, generated per booking, and the
   scan endpoint resolves it — the same reasoning that made the pass-key rather than the reservation
   number the key to guest self-service (rule 2.5).

2. **A scan is an authorisation, not a lookup.** `POST /api/admin/service/scan` behind
   `service:record`, taking a token and returning the booking *plus* marking it seated in the same
   call — or refusing, with a reason a person at a door can act on: wrong evening, already seated,
   cancelled. A GET that returns a booking to anybody holding a token is a guest list.

3. **Cards go stale, and both wallets have a push channel.** Apple needs a web service URL and a
   registration table; Google needs the object patched. Deciding *whether to push* is the real
   question: a booking whose table changed at 18:00 has a wrong card in a pocket, and the honest
   options are push, or print nothing on the card that can change. **Recommend: no table number on
   the card at first.** It is the field most likely to change and the least useful to the guest, and
   leaving it off removes the whole update problem for version one.

4. **Both need paid accounts and secrets.** An Apple Developer Program membership and a Pass Type ID
   certificate; a Google Cloud service account with the Wallet API enabled. Neither is a code
   problem, both are lead time, and neither should be discovered halfway through the build.

5. **What happens with no phone.** A printed card with the same QR, produced from the same record.
   This must not become a feature only guests with a recent phone can use.

### What it touches

| Thing | What happens |
| --- | --- |
| `ReservationRecord` | Gains `passToken` and `passVersion`. Additive (rule 2.2). |
| Guest routes | `passToken` is **staff-and-owner only** — add it to `STAFF_ONLY_RESERVATION_FIELDS` unless the guest's own card needs it, and if it does, only on their own booking. |
| The service board | A scan is the same write `setReservationAttendance` already does. No new seat accounting. |
| Analytics | `attendanceCoverage` should rise sharply. That is the number to watch to know whether this worked. |
| Seat accounting | **Untouched.** A card is a view of a booking, never a claim. |

### Order of work

1. The internal `ReservationPass` record and the token, with the scan endpoint and its test. This is
   the half that has to be right and needs no Apple or Google account at all.
2. The scanner screen on the service board, using the device camera.
3. Google Wallet, which is the cheaper of the two to set up.
4. Apple Wallet.
5. The printed fallback.

**Do not start at step 3.** The wallets are the visible half and the least difficult; the token and
the scan authorisation are where a mistake means somebody else's dinner.

---

## 2. More than one restaurant

**Status: planned, not started. Raised 2026-09; see `docs/multi-restaurant.md` for the full plan.**

Summarised here so this file is the one list: every stored document and every settings key is
currently implicitly about *this* restaurant. Adding a second one is a migration, not a feature, and
the note beside this one sets out what it costs and when to do it.

---

## 3. The guest's table picker is cut off — fix first

**Status: next up. Raised 2026-08-23. Highest priority of the three below.**

### The fault

On `/booking/table` the floor plan is drawn clipped: the plan is larger than the box it sits in, the
part below and to the right of the fold is simply not there, and there is no way to scroll or pan to
it. A guest whose table is in the far half of the room cannot pick it at all. This is a booking flow
that does not work, not a rough edge.

### Where it lives

| File | Its part in this |
| --- | --- |
| `app/booking/table/table-picker.tsx` | The guest-facing plan. The clipping is here. |
| `app/booking/table/page.tsx` | Loads the plan and the availability. |
| `lib/floor-plan.ts` | Real-world dimensions of zones and tables — the source of the true plan extent. |
| `lib/floor-plan-availability.ts` | Which tables can still take the party. |
| `app/admin/floor-plan/floor-plan-designer.tsx` | The designer's own viewport handling — read it before inventing a second one. |

### What to do

1. **Find out why it is clipped before changing anything.** The likely cause is an SVG `viewBox` (or
   a fixed pixel canvas) sized to something other than the plan's real bounding box, inside a
   container with `overflow: hidden`. Compute the extent from the zones and tables themselves, never
   from a constant.
2. **Fit the whole plan by default.** On open, the entire plan is visible, scaled down as far as it
   must be. A guest should never have to move anything to see that a table exists.
3. **Then allow moving around it.** Pinch and drag on touch, wheel and drag on a pointer, plus
   visible `+` / `−` / *fit* controls — gesture-only is not enough, and the plan must remain usable
   with the keyboard. On a narrow phone the fitted plan will be small; that is what zoom is for.
4. **Never let it be the only way to choose.** Beside the plan, a plain list of the available tables
   — label, zone, seats — that selects the same table. This is also the accessible path, and it is
   what saves a guest on a small screen.

### While the picker is being touched, make it easier

- Unavailable tables should be *visibly* unavailable and not merely unclickable, with the reason on
  tap ("seats 2, your party is 4" / "already taken").
- The selected table wants an unmistakable state, and the chosen table's label repeated in the
  summary bar so the guest is not asked to remember it.
- One tap to select, one to confirm. No drag-to-place, ever, in the guest flow.
- The step is optional (the who-chooses-the-table flag): "let the restaurant seat us" has to stay one
  obvious tap away, not buried under the plan.

### What must not change

Seat accounting and the claim rules (`lib/services/table-claims.ts`). This is a viewport and input
problem — the availability logic behind it is already decided and tested.

---

## 4. Show *who* chose the table, and let a table be locked

**Status: planned, not started. Raised 2026-08-23.**

### The gap

The admin day view shows the table number on a booking but not its provenance. Owner, staff and
guest all write the same field, and once written they are indistinguishable — so nobody knows
whether a table can be moved freely or whether a guest picked it deliberately and will be upset to
be moved.

### Part one — mark the source (small, do it with item 3)

Record who set the table and show it.

- `ReservationRecord` gains `tableSource: "owner" | "staff" | "guest"` (additive, rule 2.2) — and
  probably `tableSetAt`. Every place that writes a table sets it: the guest picker, the admin
  reservation route, the service board.
  Files: `lib/models/reservation.ts`, `types/booking.ts`, `lib/services/reservations.ts`,
  `lib/services/table-claims.ts`.
- In the admin views the table number is drawn with a **coloured ring** around it — one colour per
  source. Rings, not fills: the number must stay readable, and the ring is a second channel on top of
  a badge that already carries meaning.
- **Colour is never the only signal.** Roughly 1 in 12 men cannot separate a red-green pair, and a
  screenshot printed in black and white loses colour entirely. Each ring carries a short letter or
  glyph as well and a tooltip naming the source in words. `components/ui/tooltip.tsx` already exists.
- Suggested palette, to be checked against the app's own tokens for 3:1 contrast against the card
  background: **guest — amber/orange**, **staff — blue**, **owner (me) — violet**. Orange for the
  guest is what was asked for and it is also the right choice: guest picks are the ones staff must
  think twice about moving, and amber is the established "attention, not error" colour. A ring style
  — solid / dashed / double — should differ per source too.
- A legend, once, at the top of the day view. Three colours nobody explains is three colours nobody
  reads.

### Part two — locking a table (the bigger piece)

A table that has been set can be **locked**, so it cannot be changed by anybody below a given
permission level. The owner locks; staff below the level see the lock and the reason, and the control
to change the table is disabled rather than hidden — a disabled control with a reason teaches, a
hidden one confuses.

Before any code:

1. **Which permission gates it.** `lib/auth/permissions.ts` already carries the scheme. This needs a
   `reservation:table:lock` (or similar) and a decision on whether the check is "has the permission"
   or a genuine *level* comparison — the current model is permission-based, and inventing ranks is a
   bigger change than it looks.
2. **Enforced in the route, never in the UI** (HANDOVER rule). Hiding the button is presentation; the
   write path must refuse.
3. **What a lock survives.** A cancelled and restored booking, a date being re-generated, a table
   renamed in the designer. State the answer here before it is discovered in production.
4. **Who can unlock.** Probably only the same level or above, and every lock and unlock is an audit
   entry (item 5).

---

## 5. Every change to a reservation, in the log

**Status: planned, not started. Raised 2026-08-23.**

### What exists already

The log is built and works: `lib/services/audit-log.ts` with `recordAuditEntry`, the append-only
`lib/models/audit-entry.ts`, `AuditAction` in `types/booking.ts`, and `app/api/admin/audit/route.ts`.
Entries carry the actor and the reservation number, so a booking's history is one query.

**Nothing here is a rebuild.** The task is coverage and presentation.

### The work

1. **Audit every write path.** Walk each route that touches a booking and confirm it calls
   `recordAuditEntry` — `app/api/admin/reservations/**` (update, cancel, restore, delete, add-ons,
   service/attendance), `app/api/booking/manage/**` (the guest's own edits and cancellation),
   `app/api/reservations/route.ts`, `app/api/booking/add-ons/route.ts`, and whatever writes the table
   claim. Every gap gets closed. A written list of paths-to-entries belongs in this doc afterwards.
2. **Say what changed, not that something changed.** "Updated reservation" is not a log. The summary
   should name the field, the old value and the new: *"Table 12 → 7"*, *"Party 4 → 6"*. That probably
   means a small diff helper over the record shape and possibly a structured `changes` field beside
   `summary` (additive, rule 2.2) so the UI can render it rather than parse prose.
3. **New actions** for anything the current `AuditAction` union does not cover — table lock/unlock
   from item 4 among them.
4. **A history panel on the reservation**, on `app/admin/reservation/[reservationNumber]/page.tsx`:
   newest first, actor and time on each line. This is where "who moved this table?" actually gets
   answered — item 4's rings say *who chose*, the log says *what happened since*.
5. **Visibility is a permission, checked in the route.** Owner sees everything; a staff permission
   (`audit:read`, to be settled with item 4's permission work) opens it to others. The audit route
   must gate itself — the log names guests and their bookings, so a leak here is a guest list.

### Two rules that constrain this

- **A failed log write must never fail the action being logged.** `recordAuditEntry` already swallows
  and reports; keep it that way and do not `await` it into a transaction.
- **Append-only.** Nothing edits or deletes an entry — not a redaction tool, not a cleanup script. If
  retention is ever needed it is a decision to make deliberately, in this doc, first.

### Order for tomorrow

Item 3 first (a broken booking flow beats everything), then item 4 part one and item 5 together —
they share the permission question, and item 4's lock needs item 5's entries to be worth anything.
