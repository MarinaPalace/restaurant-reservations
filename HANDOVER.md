# Engineering handover — Vista Del Mar reservations

Written before the final push to beta. `README.md` covers how to run and use the app; this file
covers **why things are the way they are**, the traps that already bit us once, and what is still
open. Read the "Rules that must not be broken" section before changing anything.

---

## 1. What this is

A reservation app for **Vista Del Mar**, a hotel's à la carte restaurant.

- **Hotel guests** book at `/booking` — a five-step flow (pass-key + room → guests → date → menu →
  confirm). The **pass-key** is issued at check-in and is what proves they are staying here.
- **Invited guests** book at `/premium` — a single page for people not yet staying, who choose
  weeks ahead from a separate menu and a restricted set of evenings.
- **Staff** work at `/admin` — availability, the two menus, the nightly service sheet, pass-keys,
  staff accounts, and full create/edit/cancel/restore/delete of any reservation. Each person signs
  in as themselves, and every change is recorded against their name.

Stack: Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind v4, Mongoose 9, Zod 4,
Vitest. Deployed on Vercel.

**299 tests, 19 files. Lint, types and build are clean. Keep them that way.**

---

## 2. Rules that must not be broken

These are the ones that caused real bugs. Each has tests guarding it.

### 2.1 Dates are local calendar strings, never UTC

Use `lib/date.ts`. **Never** `toISOString().slice(0,10)`.

`toISOString()` converts to UTC first, so in Europe/Sofia a local 18 August became `2026-08-17`.
The calendar showed availability against the wrong cells and guests booked the wrong evening.
`lib/date.test.ts` guards this, including DST boundaries.

### 2.2 Every schema change must be additive and optional

The production database holds a live menu and live bookings. Fields added after the fact
(`ingredients`, `vegan`, `menu`, `premium`, `kind`, `guestName`, `time`, `endTime`, `notes`,
`tableGroupId`, `tableNumber`, `serviceTime`, `serviceEndTime`, `passKeyId`, `cancellation`) are all
optional, and absent values read as sensible defaults. **No migration has ever been required, and it should stay that way.**

`lib/services/reservations.mongo.test.ts` inserts documents in the *old* shape straight into Mongo
and asserts they read correctly and survive a save round-trip field for field.

### 2.3 Saving one menu must never touch the other

There are two catalogues, separated by `MenuCourse.menu` (`"standard" | "premium"`, absent =
standard). `saveMenuCatalog` prunes **only within the menu being saved**. Deleting by
"ids not in the list I just saved" would wipe the other menu entirely. Two tests cover both
directions.

### 2.4 Menu ids must survive a save

Reservations reference `courseId` / `optionId`. An early version deleted and recreated every
course on save, orphaning all historical bookings. `saveMenuCatalog` upserts by id.

### 2.5 Authorisation is checked in the route, never only in the UI

- `proxy.ts` (Next 16's renamed middleware) only *redirects*. Every admin page and API route calls
  `isAdminAuthenticated()` itself.
- Hiding something from a list is not access control. We shipped premium dates hidden from the
  date list but still bookable by a hand-made POST — seats held for invited guests could be taken.
  `/api/reservations` now refuses premium evenings outright.
- **Guest self-service is authorised by the pass-key, never the reservation number.** The number
  is not a secret — guests read it out to other rooms so they can share a table — so anything that
  accepted it as proof handed those rooms the power to cancel the booking. Missing or wrong keys
  return `404`, identical to "not found", so the endpoint cannot be used to discover which keys
  exist.
- **Permissions are checked in the route too.** `requireStaff(permission)` in `lib/auth/guard.ts`
  answers both "who is this?" and "may they do this?". Hiding a button in the dashboard is
  presentation, not access control.

### 2.6 Names shown to staff are resolved from the English menu

A guest booking in Bulgarian sends Bulgarian labels. The client's wording is never trusted:
`canonicalizeSelections` resolves course and option names **by id** from the master catalogue on
every write, and the dashboard resolves again on read so older bookings display in English too.
This is also why a tampered request cannot invent a dish name.

### 2.7 Seat accounting is the most delicate code in the app

`reservedSeats` on a date must always match live bookings.

- Mongo: seats are claimed with a **single conditional update** (`$expr` comparing capacity to
  reserved) — not a transaction, so a standalone `mongod` works. The new date is claimed *before*
  the old is released when moving a booking, and handed back if the write fails.
- Local JSON store: the same work inside one store-wide lock.
- Growing a party only needs room for the **extra** guests; seats it already holds are its own.
- Cancelling is idempotent (status filter), so seats are never refunded twice.
- A cancelled booking holds no seats, so editing one moves nothing.

### 2.8 Nothing in a print may sit inside a live scrollbox

A browser prints only the **visible** part of an `overflow` container. The
service sheet lives in a horizontal scrollbox, so for two releases the printout
was whatever happened to be scrolled into view: at the left edge the Comment
column was cut off, at the right edge the first two columns were.

Two rules keep it honest, both in the print block of `app/globals.css`:

- `[data-print-scroll]` is forced to `overflow: visible; width: auto`, so the
  scroll position cannot affect the page.
- Column widths in print are **percentages, never `em`**. With
  `table-layout: fixed`, fixed widths keep their size even when the total
  exceeds the table, which pushed the sheet wider than the paper and moved the
  clipping from the div to the page. Percentages cannot sum past 100%: the
  identity columns claim a fixed share and the dish columns divide what is
  left, growing thinner as dishes are added.

`white-space` is also normalised across every cell in print, because a single
`nowrap` header can hold a column open on its own.

**When changing the sheet, check the print at three scroll positions** — hard
left, middle, hard right — and at a few different dish counts. It has been
reported fixed twice before it actually was.

### 2.9 A pass-key is spent before the booking it pays for is written

`consumePassKey` matches **only a key that is still active** and flips it to `used` in one
conditional update. That single write is the whole mechanism: two requests arriving together with
the same code cannot both come back with a record, so one key can never produce two dinners.

The order matters and is the same shape as the seat accounting — claim, then write, then hand back
on failure. `/api/reservations` spends the key, creates the booking, and releases the key again if
the booking write throws; otherwise a failure that was not the guest's fault would lock them out
for the rest of their stay.

Releasing is filtered by reservation number as well as key id, so a late request cannot free a key
that has since been spent on something else. `lib/db/local-restore.test.ts` and the Mongo suite
cover both directions, including two simultaneous bookings with one code.

### 2.10 Restoring a cancellation is a fresh claim on the seats

Cancelling gives the seats back to the evening. Somebody else may have taken them, or the evening
may have been closed since — so `restoreReservation` claims them again with the same conditional
update a new booking uses, and reports `DATE_FULL` or `DATE_CLOSED` rather than quietly overselling
the room. The status filter on the record write makes two simultaneous restores safe: the loser
hands its claimed seats straight back.

Never "just flip the status back to confirmed". That was the obvious implementation and it is
wrong.

### 2.11 A key belongs to one flow, and every gate must know it

`kind` is `standard` or `premium`. **Three** places check it, and each was
found the hard way:

- `/api/reservations` refuses an invitation key. Without this, a premium key
  booked an everyday evening from the everyday menu and spent itself doing it,
  so the invitation link it had been emailed on then 404'd.
- `/api/premium/reservations` refuses an in-house key.
- `/api/booking/pass-key` — the check on the *first* screen — reports the kind
  and offers only that kind's evenings. It was written without a kind check, so
  an invitation key sailed through the early check and was refused only at the
  very end: exactly the wasted journey that endpoint exists to prevent.

Adding a gate is not enough. Every gate in front of it has to learn the rule
too, or the new one only moves where the failure happens.

### 2.12 No `setState` synchronously inside an effect

React 19's lint rule is on and treated as an error. Data that does not depend on client state is
fetched **on the server** and passed as props. `sessionStorage` is read through
`useSyncExternalStore` (`hooks/use-booking-session.ts`), never during render — reading it in
render caused a hydration mismatch on the confirmation page.

---

## 3. Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | No | Enables MongoDB. Without it, a JSON store under `data/` is used. |
| `ADMIN_USERNAME` | No | The **owner account**, which lives in the environment rather than the database. Defaults to `admin`. |
| `ADMIN_PASSWORD_HASH` | **In production** | bcrypt hash for the owner account. |
| `ADMIN_SESSION_SECRET` | **In production** | ≥16 chars, signs admin session cookies. Required even once staff accounts exist. |
| `NEXT_PUBLIC_DINNER_TIME` | No | Fallback sitting time for dates with no arrival time. `19:00`. |
| `NEXT_PUBLIC_DINNER_DURATION_MINUTES` | No | Fallback sitting length. `120`. |
| `LOCAL_STORE_DIR` | No | Overrides the JSON store path. Used by tests. |

**In production the admin area fails closed**: without both secrets, every admin request returns
`503` naming the offending variable, rather than falling back to a default password.

The owner account is the way into a deployment that has no staff accounts yet, and the way back in
if the last administrator account is lost. It cannot be edited or deleted from the panel. Sign-in
tries the database accounts first, so once real accounts exist the log names a person rather than
"admin".

`npm run check:admin -- 'password'` diagnoses sign-in problems. The three usual causes: env vars
added without redeploying, a shell eating the `$` in the bcrypt hash, and a username mismatch.
**503 = misconfigured; 401 = wrong credentials.**

---

## 4. Layout and conventions

```
app/
  booking/            Hotel guest flow. Pages fetch on the server;
                      client components handle interaction only.
  premium/            Invitation flow — one page, name instead of room.
  admin/              Dashboard, service sheet, menu editor, reservation editor,
                      pass-keys, staff accounts.
  api/                HTTP API.
                      booking/manage — guest self-service, keyed on the pass-key.
components/
  ui/                 Design-system primitives (Button, Card, Field, Alert…).
  brand.tsx           House mark + wordmark.  month-calendar.tsx  Shared ARIA grid.
hooks/                useBookingSession — sessionStorage via useSyncExternalStore.
lib/
  auth/               Credentials, signed sessions, permissions, route guard.
  db/                 Mongo connection, JSON store, seed data, store-lock.
  services/           booking-rules, reservations, restaurant/menu,
                      pass-keys, staff-users, audit-log.
  pass-key.ts         Code generation, normalisation, formatting.
  date.ts room.ts contact.ts calendar.ts kitchen-report.ts …
proxy.ts              Optimistic /admin redirect only.
```

- **Colour comes from tokens.** `app/globals.css` defines light and dark palettes; components use
  `bg-surface`, `text-ink`, `border-line`, `text-accent`. No hex values in components.
- **Three theme states.** Explicit choice sets `data-theme` on the root; no choice follows the OS.
  Each palette is declared under *both* `prefers-color-scheme` and `[data-theme]`, so the toggle
  wins in either direction. A script in `<head>` applies the saved choice before first paint.
- **Booking rules live in `lib/services/booking-rules.ts`.** The API delegates to it, so the rules
  under test are the rules that run. (They once diverged: the route reimplemented a weaker copy.)
- **Rooms are labels, not numbers** — `402`, `L10`, `HA3`. Stored upper-cased, compared
  case-insensitively, sorted naturally. See `lib/room.ts`.

---

## 5. Features worth knowing about

**Menus.** Two catalogues. Opening the premium editor while the premium catalogue is **empty**
fills it with a copy of the everyday menu as an *unsaved draft* — every id replaced with a `draft-`
one, so the two can never share an id (see rules 2.3 and 2.4). Nothing is written and invited guests
see nothing until somebody presses Save. Options carry description, optional ingredients (translatable, hidden
from guests when blank), an optional vegan flag (leaf badge), allergens from the fourteen EU
declarables plus whatever the menu already used, and photos. Uploads are resized in the browser to
~100–200 KB; stored photos are served from `/api/menu/images/<id>` with a content hash and
immutable cache headers, so the menu payload stays small.

**Declining a course.** `NONE_OPTION_ID` is a real selection, so "does not want a starter" is
distinguishable from "has not chosen yet". Never counted in prep totals.

**Shared tables.** Rooms dining together pass a reservation number to each other; the service sheet
shows them as **one row** with all rooms listed and choices already combined. Staff assign a table
number and it applies to everyone on it.

**Service sheet & printing.** Two layouts: per-table (default, the prep matrix) and per-guest (the
plating list). Print is **A4 landscape**, course-grouping row dropped, dish names trimmed to three
words (`lib/dish-name.ts` drops filler first), and only the sheet prints — everything else is
hidden because staff cut the page up. The kitchen slip follows on its own page: dish, quantity,
total plates, allergy notes; no tables or rooms. CSV exports carry a UTF-8 BOM so Excel does not
mangle accented or Cyrillic names.

**Pass-keys.** Reception issues one at check-in, for a stay of five nights or more; the panel is at
`/admin/pass-keys` and prints a slip with the code and the booking address. A key books **one**
dinner and then goes inactive. It expires with the stay, so a guest cannot hold a table for an
evening after they check out.

The code is Crockford base32 (`VDM-K7QP3-M2XR4`) — ten characters, fifty bits, no `I`, `L`, `O` or
`U`, case-insensitive, and dashes are decoration. Anything a guest types that looks like a misread
card (`O` for zero, `I` or `l` for one) is folded onto what they meant. All of that is in
`lib/pass-key.ts` and tested there. Keys issued under the previous twelve-character format are
still accepted, which is why `isValidPassKeyFormat` tests a **range** rather than an exact length.

**A key can carry more than one dinner.** A stay earns one per five nights, capped at three, and
reception can override it at issue and edit it later when a stay is extended. `maxUses` and
`usedCount` are what decide whether a key is spent — `status` stores only `revoked` — so the two can
never drift apart. Both are absent on keys written before multi-use and read as a single use, spent
or not according to the old `status`, so nothing needed migrating.

**Invitation keys** (`kind: "premium"`) are the same mechanism pointed at `/premium`. They carry no
stay, so the five-night rule does not apply to them, and they are emailed as a link —
`/premium/<pass-key>` — so the guest never types the code. That address is a credential: the page is
marked `noindex`, and an unusable or unknown key gets the same 404 as one that never existed. It
does put the key in browser history and any Referer the page sends, which is an accepted trade for a
single-dinner invitation and would not be for anything carrying money.

**There is one front door.** `/booking` takes a key, works out from its `kind` which flow the guest
belongs in, and sends an invitation on to `/premium/<key>`. Bare `/premium` redirects there: it used
to render the premium menu and every invitation-only evening to anyone who found the address — the
booking itself was refused without a key, but the whole offer was on display, which defeated the
point of holding those evenings back.

**Booking a second table on an evening the key already has is allowed** — a guest with dinners to
spare often books for a room that has none — but the entry step and the date step both say so first,
because far more often the guest meant to change what they already booked.

**The key is checked before the guest chooses anything.** `/api/booking/pass-key` answers "will this
work, until when, how many dinners left, and which evenings may I pick" on the first screen. It used
to be judged only when the finished booking was submitted, so somebody with a spent key picked a
date and a full menu for the whole table before being told. The check at booking time is still the
authoritative one; this only fails early.

Cancelling **hands one use back**, so a guest who cancels can book another evening instead of
losing dinner over one tap. Restoring the cancellation takes it again — unless they have already
spent it, in which case the newer booking keeps it. Because a key can hold several dinners,
`/booking/manage` lists them and the guest says which one they mean; the reservation number may be
omitted only when there is exactly one.

Keys are printed as **credit-card-sized cards** (85.6 × 53.98 mm), laid out on a sheet with dashed
cut lines. That print is a separate context from the service sheet — see rule 2.8 — and is switched
on by a `data-printing-cards` attribute on the root for the duration of the print.

Codes are stored in plain text on purpose: reception has to be able to read one back to a guest who
has lost their card. Fifty bits behind a rate limiter is the trade, and it is the operationally
right one for a hotel desk. Revisit it if that changes.

**Rate limiting** (`lib/rate-limit.ts`) sits in front of pass-key entry, booking, invitation booking
and admin sign-in. It counts in memory, so on serverless each instance keeps its own and the real
limit is the configured one times the number of warm instances. That is a deliberate scope: it stops
a script hammering one endpoint, and is not a defence against a distributed attacker. Move the
counters to Redis if that ever matters — the call sites do not change.

**The front desk screen.** `/admin/pass-keys` is shaped like the morning's arrivals list: one row
per guest — hotel reservation number, name, room, check-in, check-out — and one press issues them
all and puts the cards on screen to print. Rows are distinct guests, never copies of one; issuing
twenty identical keys for one room was never the job.

Reception also records the **party size from the hotel booking**, which it knows before the guest
arrives. Dinner can then be booked for that many or fewer, never more — the seats were never held
for more. It is editable, because parties change before arrival, and blank on every key issued
before this, which reads as "no limit beyond the restaurant's own maximum of six".

Reception types **dates, never night counts**. The nights and the number of dinners follow from
check-in and check-out (`nightsBetween`, `suggestedUsesForNights`), so the card and the record cannot
disagree. Check-in has Today/Tomorrow buttons, because keys are usually written a day or two ahead.

Keys are identified by the **hotel's booking reference**, not the room: a guest moved to another
room keeps the same booking number, and the room on the key is only a note — guests confirm their
own room when they book.

Cards carry a **QR code**, generated inline with `qrcode`. No external host: the desk may have no
internet, and nothing in this app may depend on one. It points at `/booking?k=<key>` or
`/premium/<key>`, so scanning lands on the entry step with the key already in the box. Cards print
in house colour — they need `print-color-adjust: exact`, because browsers drop backgrounds to save
toner — while every other print in the app stays ink on white.

Already-issued keys can be ticked and reprinted. **Deleting** one is an administrator's action, like
deleting a reservation; revoking is the everyday one and keeps the record.

**Staff accounts.** `/admin/users`. Each person signs in as themselves and holds a named set of
permissions — take, edit, cancel and restore reservations; edit the menus; manage evenings; issue
pass-keys; manage accounts. **Deleting a reservation is reserved for administrators** and is
stripped from a staff account's list even if the request asks for it. Administrators hold every
permission *implicitly*, so a permission added in a later release reaches them without a migration
and is never silently granted to anybody else. Disabling an account takes effect on its next
request, not when its cookie expires. The last administrator cannot be demoted, disabled or
deleted.

**The log.** Every change to a booking or an account writes one line to an append-only log naming
who did it: `reservation:cancel`, `reservation:restore`, `passkey:issue`, `user:update`, and so on.
A cancelled booking also carries a denormalised copy of who cancelled it, so the record explains
itself in the dashboard, in a CSV export, or read straight out of the database. A booking's full
history is on its own page at `/admin/reservation/<number>`. Writing to the log never breaks the
thing being logged — a failed log write is reported to the console and swallowed.

**Restoring a cancellation.** Cancelled bookings show a *Restore* button in the service sheet, for
accounts with `reservations:restore`. See rule 2.9 — it is a real seat claim and can fail.

**Guest self-service.** `/booking/manage` — **pass-key only**, no reservation number and no room
number, then swap courses or cancel. Closes **12 hours before the sitting** for both edits and
cancellations, enforced server-side; staff are not bound by it. A booking taken by staff has no key
attached, so the guest cannot self-serve it and reception changes it for them.

**Calendar reminders.** Google Calendar plus `.ics`, using the evening's real arrival and end
times (copied onto the booking when made, so moving a sitting does not rewrite history), asking
guests to arrive ten minutes early.

---

## 6. Known limitations and open items

Roughly in the order I would tackle them for beta.

1. **The five-night rule is enforced at issue, not from the PMS.** There is still no integration, so
   reception types the number of nights when it hands over the key and the system refuses anything
   under five. A deliberate exception is allowed, recorded on the key and in the log. If a PMS
   integration ever lands, the stay length should come from it rather than from typing.
2. **A guest who cancels can rebook a different evening** with the same key, as many times as they
   like within their stay. That is intentional — the key limits *live* dinners, not attempts — but
   it is worth knowing before somebody reports it as a bug.
3. **The invitation link puts the key in the URL.** Deliberate, so a guest goes from the email to
   the booking in one tap, and documented in section 5. It means the code reaches browser history
   and any Referer the page sends. Acceptable for a single dinner; revisit if invitations ever carry
   anything else.
4. **Tables have no capacity.** Nothing stops four rooms grouping onto a table that seats six.
   Staff assign the number so they would notice, but the system will not warn.
5. **Cyrillic headings fall back to a system serif.** The display face is loaded with Latin subsets
   only. Body text is unaffected. One-line fix if you want it.
6. **Photos are stored as base64 in the record.** Fine at current scale thanks to the cached image
   route; if the menu grows large, move to blob storage.
7. **Allergen vocabulary is mixed.** Existing dishes use `Dairy`, `Tree Nuts`; the picker offers
   `Milk`, `Tree nuts`. Both work. Worth tidying to one vocabulary by hand.
8. **The JSON store writes to `data/`**, which is not durable on serverless. Only used when
   `MONGODB_URI` is unset — i.e. local development. Production must have Mongo.
9. **Rate limiting counts in one process.** `lib/rate-limit.ts` covers pass-key entry, booking and
   admin sign-in, but on serverless each instance keeps its own counters, so the effective limit is
   the configured one times the number of warm instances. Enough to stop a script on one endpoint;
   not a defence against a distributed attacker. Redis if that ever matters.
10. **Staff passwords have no expiry, history or lockout.** Length is the only rule (ten
    characters). Fine for a small team sharing a desk; revisit if the team grows.
11. **Reservation numbers** now use the `VDM-` prefix; older `ALC-` numbers still resolve, since
    lookup is an exact match and nothing parses the prefix.
12. **Bookings made before pass-keys existed have no key**, so their guests cannot use
    `/booking/manage` at all. There is no migration path — a key is issued at check-in, and those
    guests have already checked in. Reception handles them by hand until they age out.

---

## 7. Working on this

```bash
npm run dev          # local, JSON store, admin/admin123
npm test             # 299 tests; the Mongo suite runs an in-memory mongod
npm run typecheck
npm run lint
npm run build
npm run seed         # seed MongoDB (no-op without MONGODB_URI)
npm run check:admin -- 'password'
```

**Before pushing:** typecheck, lint, tests and build must all be clean. The Mongo suite downloads a
`mongod` binary on first run.

**Verifying by hand is worth it.** Several bugs in this project passed the type checker and the
unit tests but failed the moment a real request hit them — the premium-date hole, the dropped table
number, the calendar falling back to the default sitting. Start the built app and drive the actual
endpoints.

Two traps when driving it by hand:

- `npm start` runs in production mode, so the `admin`/`admin123` fallback is **off** and the session
  cookie is `Secure` — it will not be stored over plain `http` by a strict client. Set
  `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET` for the run, and carry the cookie yourself if
  your client refuses it.
- Set `LOCAL_STORE_DIR` to a scratch directory, or a manual run writes into `data/`.

Tests write to a temp directory via `LOCAL_STORE_DIR` and never touch `data/`. One early test wrote
to the real `data/menu.json` and replaced the restaurant's menu with a fixture; do not reintroduce
that.

---

## 8. History

Every commit message explains the *why*, not just the what. `git log` is worth reading if
something looks odd. The sequence, oldest first:

| Commit | What |
| --- | --- |
| `eee0394` | Security, correctness and accessibility overhaul (auth bypass, timezone, seat accounting, IDOR, design system) |
| `c842c51` | Serverless-safe Mongo connections; admin config diagnostics |
| `57ddfe4` | Guest contact details, calendar reminders, dish photos |
| `8e5800a` | Arrival times, shared tables, comments, kitchen sheet |
| `20024ba` | Declining a course; per-option prep counts |
| `003e23f` | Calendar time fix; guest self-service with a 12-hour cutoff |
| `92f1fed` | Staff reservation editor; lettered room labels |
| `a24fd63` | English names for staff; per-table sums; kitchen slip |
| `0d6f788` | Ingredients, vegan, allergen picker; combined shared tables |
| `a6f1126` | Refined look; light/dark/system theme |
| `8cd93df` | Renamed Vista Del Mar; house mark |
| `02323e6` | One-page service sheet; invitation bookings |
