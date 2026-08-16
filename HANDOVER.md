# Engineering handover — Vista Del Mar reservations

Written before the final push to beta. `README.md` covers how to run and use the app; this file
covers **why things are the way they are**, the traps that already bit us once, and what is still
open. Read the "Rules that must not be broken" section before changing anything.

---

## 1. What this is

A reservation app for **Vista Del Mar**, a hotel's à la carte restaurant.

- **Hotel guests** book at `/booking` — a five-step flow (room → guests → date → menu → confirm)
  keyed to their room number.
- **Invited guests** book at `/premium` — a single page for people not yet staying, who choose
  weeks ahead from a separate menu and a restricted set of evenings.
- **Staff** work at `/admin` — availability, the two menus, the nightly service sheet, and full
  create/edit/cancel/delete of any reservation.

Stack: Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind v4, Mongoose 9, Zod 4,
Vitest. Deployed on Vercel.

**204 tests, 14 files. Lint, types and build are clean. Keep them that way.**

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
`tableGroupId`, `tableNumber`, `serviceTime`, `serviceEndTime`) are all optional, and absent values
read as sensible defaults. **No migration has ever been required, and it should stay that way.**

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
- Guest reservation access requires reservation number **and** room number. Missing/incorrect
  returns `404`, identical to "not found", so the endpoint cannot be used to discover which
  reservation numbers exist.

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

### 2.8 No `setState` synchronously inside an effect

React 19's lint rule is on and treated as an error. Data that does not depend on client state is
fetched **on the server** and passed as props. `sessionStorage` is read through
`useSyncExternalStore` (`hooks/use-booking-session.ts`), never during render — reading it in
render caused a hydration mismatch on the confirmation page.

---

## 3. Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | No | Enables MongoDB. Without it, a JSON store under `data/` is used. |
| `ADMIN_USERNAME` | No | Defaults to `admin`. |
| `ADMIN_PASSWORD_HASH` | **In production** | bcrypt hash. |
| `ADMIN_SESSION_SECRET` | **In production** | ≥16 chars, signs admin session cookies. |
| `NEXT_PUBLIC_DINNER_TIME` | No | Fallback sitting time for dates with no arrival time. `19:00`. |
| `NEXT_PUBLIC_DINNER_DURATION_MINUTES` | No | Fallback sitting length. `120`. |
| `LOCAL_STORE_DIR` | No | Overrides the JSON store path. Used by tests. |

**In production the admin area fails closed**: without both secrets, every admin request returns
`503` naming the offending variable, rather than falling back to a default password.

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
  admin/              Dashboard, service sheet, menu editor, reservation editor.
  api/                HTTP API.
components/
  ui/                 Design-system primitives (Button, Card, Field, Alert…).
  brand.tsx           House mark + wordmark.  month-calendar.tsx  Shared ARIA grid.
hooks/                useBookingSession — sessionStorage via useSyncExternalStore.
lib/
  auth/               Credentials, signed sessions, route guard.
  db/                 Mongo connection, JSON store, seed data.
  services/           booking-rules, reservations, restaurant/menu.
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

**Menus.** Two catalogues. Options carry description, optional ingredients (translatable, hidden
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

**Guest self-service.** `/booking/manage` — reservation number + room number, then swap courses or
cancel. Closes **12 hours before the sitting** for both edits and cancellations, enforced
server-side; an admin session bypasses it.

**Calendar reminders.** Google Calendar plus `.ics`, using the evening's real arrival and end
times (copied onto the booking when made, so moving a sitting does not rewrite history), asking
guests to arrive ten minutes early.

---

## 6. Known limitations and open items

Roughly in the order I would tackle them for beta.

1. **The five-night rule is not implemented.** One dinner per stay, for guests staying 5+ nights.
   Blocked on knowing a guest's stay length — there is no PMS integration. The reservation-count
   check itself is easy once that data exists.
2. **`/premium` is unguarded.** Anyone with the URL can book. Fine for an emailed invitation, not a
   secret link. Consider a token in the URL if that matters.
3. **Invited guests cannot use `/booking/manage`** — it asks for a room number they do not have.
   They must contact the hotel to change anything.
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
9. **No rate limiting** on booking or admin login.
10. **Reservation numbers** now use the `VDM-` prefix; older `ALC-` numbers still resolve, since
    lookup is an exact match and nothing parses the prefix.

---

## 7. Working on this

```bash
npm run dev          # local, JSON store, admin/admin123
npm test             # 204 tests; the Mongo suite runs an in-memory mongod
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
