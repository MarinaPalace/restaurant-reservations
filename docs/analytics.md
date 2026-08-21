# Analytics — design note

**Status: built, phases 0–3, plus no-shows (§4.1).** `/admin/analytics`, behind the `analytics:view` permission.
`lib/analytics/` holds the pure functions; `components/charts.tsx` the marks. What is **not** built
is §4 — the fields that do not exist yet, no-shows chief among them. Read §4 before anybody
publishes a "served" number.

The reasoning below is kept because the traps still apply to everything added next.

Read `HANDOVER.md` §2 first. Several of the rules there decide things in here — §2.1 (local dates)
decides how every bucket is computed, §2.2 (additive schema) decides how the missing fields get
added, §2.5 (authorisation in the route) decides the permission, §2.7 (seat accounting) decides
what must never be recomputed.

---

## 1. What this is not

**`@vercel/analytics` is already installed** and mounted in `app/layout.tsx`. That is *web*
analytics — page views, referrers, devices. It answers "how many people opened the booking page",
and it is a different product from this. Do not extend it, do not send business events to it, and
do not let anybody conclude the restaurant already has analytics because there is a dashboard on
vercel.com.

This note is about **the restaurant's own numbers**: covers, occupancy, what people eat, what
promotions earn, and whether the pass-key system is actually converting into dinners.

---

## 2. The questions worth answering

Grouped by who asks them, because that decides which screen they live on and how often they are
read.

### The owner, monthly

- How many covers did we serve, by week and by month, and is it going up?
- What is our **occupancy** — seats taken against seats offered? A 40-cover room averaging 22 is a
  different business from one averaging 38.
- How much did **promotions** earn, and how much did we give away in discounts?
- How many evenings did we open, and how many did we close?
- Everyday evenings against **invitation** ones: how much of the room goes to invited guests?

### Reception, weekly

- **Cancellations**: how many, how late, and what reasons were recorded?
- **Lead time**: how far ahead do guests book? This decides how late the booking cutoff can safely
  be set (rule 2.21) — currently that number is a guess.
- **Pass-key conversion**: keys issued → keys used → dinners booked. A key that is issued and never
  spent is a guest who was offered dinner and did not take it, and nobody currently knows how many
  of those there are.
- **Unused dinners**: keys that expired with uses left.
- Which **rooms** book repeatedly, and which never do.

### The kitchen, per evening and per season

- **Dish popularity** by course, so the menu can be cut and reordered on evidence.
- How often each course is **declined** (`NONE_OPTION_ID` — a real selection, see README).
- **Party-size distribution**, which decides table layout.
- **Allergy and note frequency** — how often `notes` is non-empty, since that is prep load.

### Nobody, yet — but they will ask

- **No-shows.** The single most valuable number a restaurant tracks, and we cannot compute it at
  all. See §4.

---

## 3. What can be answered today, from data already stored

All of this is derivable now, with no schema change. Field names are exact.

| Question | Source |
| --- | --- |
| Covers per day/week/month | `ReservationRecord.guestCount` + `.date`, `status === "confirmed"` |
| Occupancy | `RestaurantDateAvailability.reservedSeats` / `.capacity` |
| Cancellation rate | `.status === "cancelled"` |
| How late a cancellation came | `.cancellation.at` against the sitting (`getReservationWindow`) |
| Who cancelled, and why | `.cancellation.actorKind` / `.actorName` / `.reason` |
| Lead time | `.createdAt` → `.date` |
| When bookings are *made* (hour of day, and exact time) | `.createdAt` — stored, never displayed; see §4A |
| Dish popularity | `.selections[].optionId`, resolved by id against the menu (rule 2.6) |
| Declined courses | `.selections[].optionId === NONE_OPTION_ID` |
| Party sizes | `.guestCount` |
| Shared tables | `.tableGroupId` — count of bookings sharing one |
| Everyday vs invitation | `.kind`, and `RestaurantDateAvailability.premium` |
| Promotion take-up | `.addOns` present vs absent, per booking |
| Promotion revenue | `sumFinalPrices(.addOns)` — use `lib/money.ts`, never re-derive |
| Discount given away | `sumListPrices(.addOns) - sumFinalPrices(.addOns)` |
| Which promotions sell | `.addOns[].optionId` |
| Pass-key conversion | `PassKeyRecord.usedCount` / `.maxUses`, `.reservationNumbers.length` |
| Keys issued but never used | `.usedCount === 0` and `.expiresOn` in the past |
| Who did what, when | `AuditEntry` — already append-only, already has `at`, `action`, `actorName` |
| Notes/allergy load | `.notes` non-empty |
| Staff vs guest bookings | `AuditEntry.actorKind` on the `reservation:create` line |

**Two things worth noticing.** `lib/kitchen-report.ts` already contains most of the dish-counting
logic (`buildOptionColumns`, `buildOptionTotals`, `buildPrepList`, `countDeclined`, `countPlates`)
as pure functions over `ReservationRecord[]`. Analytics should reuse those rather than write a
second, subtly different counter — two functions that count plates differently is a bug waiting for
a disagreement. And the **audit log is already a time series**; it is the only place that records
*when* something was done by *whom*, and it outlives the record it describes.

---

## 4. What cannot be answered, and what it would cost

Each of these needs a new field. Rule 2.2: **additive and optional, absent reads as a sensible
default, no migration.**

### 4.1 No-shows — the big one

**Built.** The service board records it; this section is kept for the rules it states, which the
analytics page still has to honour.

Before it existed, nothing recorded whether anybody turned up. Without it, "occupancy" means *booked*, not *served*,
and the two diverge exactly when it matters.

The field: `ReservationRecord.attendance?: "seated" | "no-show"`. Absent reads as unknown — **not**
as "seated", because guessing here quietly inflates every number that uses it.

Where it gets set: **the service board — `docs/service-tracking.md`, which is now the plan for
this.** Do not add a second attendance field here; read what that produces.

Three things from it that analytics has to honour:

- The field is `attendance?: { status: "seated" | "no-show"; … }`, and **absent is unknown** —
  neither seated nor no-show. Nothing may infer a no-show from silence: on a busy night nobody
  taps, and reading that as "nobody came" would poison every number built on it.
- **Report coverage beside the rate.** *"No-shows: 3 of 38 — attendance recorded for 38 of 42."*
  A no-show rate over a night nobody marked is a confident number about nothing, and the coverage
  figure is what stops it being quoted.
- Once it exists, occupancy gains a **served** figure beside **booked**, and the two diverging is
  itself the interesting number.

Until then, **do not publish a no-show number**, and do not label booked covers as "served".

### 4.2 The guest's language

`BookingSession.language` lives in sessionStorage and is never persisted. So "what languages do our
guests book in?" — which decides which menu translations are worth paying for — is unanswerable.

The field: `ReservationRecord.language?: string`, written at booking time in
`app/api/reservations/route.ts`. Cheap, additive, and useful immediately.

### 4.3 Where a booking came from

QR code from a pass-key card, typed address, ticket at the desk, the `/premium` invitation flow —
all indistinguishable afterwards. `AuditEntry` gets close (`actorKind` separates staff from guest)
but not the rest.

The field: `ReservationRecord.source?: "guest" | "staff" | "ticket" | "premium" | "qr"`. Optional;
older bookings read as unknown.

### 4.4 Covers *offered* on days with no date row

Occupancy needs a denominator. A day with no `RestaurantDateAvailability` row is not "0 capacity",
it is "we never opened that day", and averaging the two together is wrong. This needs no new field,
only care: **exclude unconfigured days from occupancy, and report "evenings open" separately.**

---

## 4A. When a booking came in — show it, and sort by it

**Status: built.** `lib/reservation-order.ts` holds the comparators and the formatters; the sheet
has a screen-only *Booked* column and an order selector; the reservation page shows the long form
with its zone. What follows is the reasoning, kept because the traps still apply to anything else
that reads `createdAt`.

**The data is already there and has always been there.** `ReservationRecord.createdAt` is written
on every booking, by both backends. What is missing is only that **nothing displays it** —
`grep -rn createdAt app/ components/` returns nothing — so "when did this come in?" is currently
answered by guessing, or by opening the reservation and reading the audit log.

Worse, the ordering is fetched and then thrown away:

- `getReservationsList()` sorts `{ createdAt: -1 }` on Mongo, and
  `listLocalReservations()` sorts by `createdAt` descending too — the two backends agree, which is
  worth knowing because they easily might not have.
- Then `app/admin/date-manager.tsx` re-sorts the selected evening's bookings with
  `compareRoomNumbers`, discarding it. That is right for a *service sheet*, which is read by
  walking the room, and wrong for the question "what came in today?".

### What to build

**Show it.** A "Booked" column on the dashboard's reservation list and a line on the reservation
page: date and time, in the restaurant's zone. This is a display fix and does not need to wait for
the analytics work — it is worth doing on its own.

**Sort by it.** Make the ordering a choice rather than a constant: by arrival (room order, today's
default, right for service) or by when the booking arrived, newest or oldest first. A plain
`<select>` or a clickable column header; the sort itself is a pure comparator and belongs in
`lib/analytics/` or beside `compareRoomNumbers` so it can be tested without a browser.

**Filter by it.** Once bookings can be ordered by arrival time, "everything that came in since
yesterday" is the natural next ask — a range over `createdAt` rather than over `date`. Note these
are *different ranges over different fields*: "dinners on Saturday" and "bookings taken on
Saturday" are two questions, and the screen must never blur them.

### The three traps

1. **`createdAt` is optional.** Bookings taken before the field existed have none, and older
   reservations may be exactly the ones somebody sorts to the bottom to find. Absent must render as
   "—" and sort predictably — decide once whether unknown sorts first or last, and test it. It must
   never render as the epoch or as today.
2. **`createdAt` is an ISO instant; `date` is a local calendar string.** §5.3 covers this. Format
   the instant through the same local-date helpers, never `toISOString().slice(0, 10)`.
3. **Say which clock it is on.** Rule 2.16 — the confirmation already labels its arrival time
   `Sofia time (UTC+3)` via `getTimeZone()` and `lib/timezone.ts`. A booking timestamp on a staff
   screen deserves the same treatment, or at minimum the dashboard's existing zone label applies to
   it too. Reuse; do not format a second way.

### Related, and cheap while in there

The **hour of day bookings arrive** is a genuinely useful chart (§2, reception) and falls out of the
same field for free once it is being read and bucketed.

---

## 5. Architecture

### 5.1 Aggregate on read. Do not build a warehouse.

One restaurant, ~40 covers a night, one sitting. That is on the order of **15,000 reservations a
decade** — a rounding error in memory. Reading the range and folding it in a pure function will be
fast enough for the lifetime of this business, and it has two properties a rollup table does not:
it cannot drift out of step with the source, and it recomputes correctly when a booking is
cancelled, restored or edited afterwards.

Revisit only if a range query genuinely gets slow, and revisit it with a measurement rather than a
feeling.

### 5.2 Shape, matching the house style

```
lib/analytics/
  range.ts          Date ranges and buckets (day / week / month). Pure.
  covers.ts         Covers, occupancy, party sizes. Pure.
  cancellations.ts  Rate, lateness, who and why. Pure.
  dishes.ts         Popularity and declines — wraps lib/kitchen-report.ts, does not duplicate it.
  promotions.ts     Take-up, revenue, discount. Uses lib/money.ts.
  pass-keys.ts      Issued → used → booked conversion.
  index.ts          One `buildAnalytics(input, range)` that composes the above.
  *.test.ts         One per module. These are pure functions; they should be trivially testable.
```

Pure functions over arrays, exactly like `lib/kitchen-report.ts`. **No Mongoose imports in
`lib/analytics/`** — that module has to be importable from a client component for the browser-side
bits, the same reason `menuCatalogOf` lives in `types/booking.ts` rather than in the restaurant
service.

The service layer fetches; `lib/analytics/` decides what the numbers mean.

### 5.3 The date problem — read this twice

**Rule 2.1.** Every bucket boundary is a local calendar date. `toDateKey`, `fromDateKey`,
`todayKey` from `lib/date.ts`. **Never** `toISOString().slice(0, 10)` — in Europe/Sofia that turns
an 18 August dinner into 17 August, and in analytics it silently moves covers between weeks and
months rather than failing loudly.

Two more traps specific to bucketing:

- **Weeks start on Monday** here — `buildCalendarGrid` in `lib/date.ts` already assumes it and the
  calendar renders it. Use the same convention or the dashboard and the analytics will disagree
  about which week a Sunday belongs to.
- **`createdAt` and `updatedAt` are ISO instants, `date` is a local calendar string.** They are not
  the same kind of value and must never be compared or bucketed by the same code path. Lead time is
  the one place they meet, and that conversion belongs in exactly one function in `range.ts`.

### 5.4 Reading the data

- **Local JSON store**: `getLocalReservations()` reads everything; filter in memory.
- **Mongo**: query by range. `ReservationModel.date` is **already indexed**. `RestaurantDateModel.date`
  is `unique`, so it is indexed too. `AuditEntry` may need an index on `at` if the log is ever
  charted — check before assuming.
- Add `getReservationsBetween(fromKey, toKey)` to `lib/services/reservations.ts` rather than
  reusing `getReservationsList()`, which loads everything and will not stay acceptable forever.
- **Cancelled bookings must be loaded, not filtered out at the source.** The cancellation rate is
  one of the questions; a query that drops them makes it unanswerable.

---

## 6. Authorisation

**Rule 2.5: checked in the route, never only in the UI.**

Add `"analytics:view"` to `STAFF_PERMISSIONS` in `types/booking.ts` — additive, and `admin` holds
every permission implicitly including ones added later, so no existing account needs touching. The
staff-accounts screen picks it up from the same list.

- Page: `app/admin/analytics/page.tsx`, calling `getCurrentStaffUser()` and `hasPermission` itself.
- Route (if any): `requireStaff("analytics:view")`.
- Dashboard link: hidden without the permission, which is presentation only.

Consider whether reception should see revenue at all, or only covers and cancellations. If the
answer is "only covers", that is a **second** permission, not a hidden `<div>`.

---

## 7. The screen

`/admin/analytics`, English (staff screens are not translated — see `lib/i18n/index.ts`).

### 7.1 Charts without adding a dependency — and what the validator said

**Built as hand-rolled inline SVG**, and one finding is worth keeping: the app's accent gold and
success green were run through the palette validator as a two-series categorical pair and **failed**
— ΔE 3.1 under protanopia, and 13.1 even with full colour vision. They are the same colour to a lot
of people. So there is **no categorical palette on this page at all**: every chart is single-hue
magnitude, which is the honest encoding for "how many" anyway. The one ordered ramp — the pass-key
funnel — is three validated steps of the accent hue, in `globals.css` as `--chart-step-1..3`, with
its own steps for dark rather than an inverted copy.

The original reasoning:

**Recommendation: hand-rolled inline SVG.** Bars, a line, and sparklines are perhaps 150 lines
total. It buys three things this codebase specifically needs:

- **Theming for free.** `stroke="var(--accent)"`, `fill="var(--success)"` — light and dark handled
  by the tokens already in `globals.css`, which no chart library will do without configuration.
- **Print that works.** Rules 2.8–2.10 are unforgiving and untested by CI. An SVG in normal flow
  prints; a canvas chart usually does not.
- **No `useEffect` measuring the DOM**, which rule 2.15 makes awkward anyway.

If a library is chosen instead, it must render to SVG, not canvas, and it must be checked against a
real printout before it is merged.

### 7.2 Layout

1. **A range picker** — this month / last month / last 90 days / a custom pair of dates. Default to
   the current month.
2. **Headline tiles**: covers, occupancy %, cancellation rate, promotion revenue. Each with the
   previous period beside it, because a number with nothing to compare it to is decoration.
3. **Covers over time**, bar per day or per week depending on range length.
4. **Dish popularity**, per course, sorted, with declines shown.
5. **Promotions**: take-up rate, revenue, discount given away, which products sell.
6. **Pass-keys**: the conversion funnel, and unused dinners.
7. **Cancellations**: rate, how late they came, reasons where recorded.

### 7.3 Export

CSV, following `buildGuestCsv` / `buildTableCsv` in `lib/kitchen-report.ts` — including the **UTF-8
BOM**, which is already there and is what makes Excel read the file correctly. Do not reinvent the
escaping; reuse `toCsv`.

---

## 8. Privacy

Analytics is aggregate. It must not become a way to read guest data that the reservation screens
guard.

- **Never** put `contact` (email, phone) in an analytics view or export. It is on the booking for
  the restaurant to reach that guest, not for reporting.
- Room numbers identify a person for the length of a stay. "Rooms that book repeatedly" is a
  legitimate question; a per-room table exportable to CSV is a guest list. Prefer counts.
- Cancellation `reason` is free text typed by staff and may name a guest or a circumstance. Show it
  to reception; keep it out of exports.
- The audit log names staff. Charting "bookings taken per member of staff" is a management decision
  with consequences, not a neutral feature — ask before building it.

---

## 9. Testing

Every module in `lib/analytics/` is a pure function over fixtures, so there is no excuse for thin
coverage. Specifically worth pinning:

- **A booking on a DST boundary** lands in the right day, week and month. `lib/date.test.ts`
  already guards the primitive; this guards the bucketing built on it.
- **A cancelled booking** counts toward the cancellation rate and *not* toward covers.
- **A restored booking** counts as confirmed again (rule 2.12 — restoring is a fresh claim).
- **A booking with no `createdAt`** — older records — does not break lead time, and is excluded
  rather than counted as zero.
- **Occupancy excludes days with no date row**, rather than treating them as 0/0 or 0/40.
- **A promotion's revenue uses the stored `finalPrice`**, not today's catalogue price (rule 2.18).
- **Money totals round to the cent** — `lib/money.test.ts` shows the failure mode.
- **A shared table is not double-counted**: two bookings with one `tableGroupId` are two bookings
  and one table.

---

## 10. Suggested order

Each phase is independently useful and independently shippable. Do not start phase 2 before
phase 1 is on screen and somebody has looked at it.

0. ~~**Show and sort by when a booking came in** (§4A).~~ **Done.** It also settled the `createdAt`
   formatting and null-handling that phases 1–3 depend on — reuse `formatBookedAt`,
   `sortReservationsBy` and `leadTimeHours` rather than writing them again.
1. ~~**The plumbing and the easy half.**~~ **Done.** `lib/analytics/range.ts` + `covers.ts`, the permission, the
   page, the range picker, four headline tiles, one bar chart. Answers the owner's monthly
   questions from data that already exists.
2. ~~**Dishes and cancellations.**~~ **Done.**
3. ~~**Promotions and pass-keys.**~~ **Done** — the funnel counts one cohort, keys *issued* in the
   range, so the three stages describe the same guests.
4. ~~**CSV export.**~~ **Done**, with the UTF-8 BOM so Excel reads it.
5. **The new fields** — `language`, `source`, and attendance. Attendance only alongside, or after,
   `docs/service-tracking.md`; the two must not invent separate check-in mechanisms.

---

## 11. Open questions — decide these before writing code

1. **Should reception see money?** Decides whether one permission or two.
2. **What is "occupancy" when an evening is closed?** Excluded entirely, or counted as zero
   offered? This changes every average on the page.
3. **Does an invitation evening belong in the same occupancy figure** as an everyday one, or is it
   a separate series? They are different businesses sharing a room.
4. **How far back does the range picker go?** Bounded by the oldest booking, or by a fixed window?
5. **Is attendance being collected here, or by service tracking?** Answer before touching the
   schema.
6. **Does anybody want per-staff numbers?** See §8 — ask, do not assume.

---

## 12. Traps specific to this codebase

Collected so they are in one place:

- `toISOString().slice(0, 10)` is **forbidden** (rule 2.1). It has already caused one production
  bug and analytics is where it would hide longest.
- **Never recompute `reservedSeats`** from the reservations to "check" it. Seat accounting is the
  most delicate code here (rule 2.7); analytics reads it, it does not audit it. If the two ever
  disagree that is a bug for a test to catch, not for a dashboard to paper over.
- **Resolve dish names by id** against the master catalogue (rule 2.6). A booking taken in Bulgarian
  stores canonical English, but older records and the promotions catalogue have their own history —
  group by `optionId`, display by lookup.
- **Promotions are not plates** (rule 2.17). They must not appear in dish popularity or in any
  plate count. `lib/kitchen-report.ts` already keeps them apart; do not undo that.
- **A promotion's price is the one stored on the booking** (rule 2.18), not the catalogue's today.
- **Nothing in the suite looks at print CSS** (rule 2.10). If this page prints, print it by hand.
- The audit log is **append-only and outlives the record it describes** — which makes it the right
  source for "what happened", and the wrong source for "what is true now".
