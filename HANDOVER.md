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

**386 tests, 22 files. Lint, types and build are clean. Keep them that way.**

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
`tableGroupId`, `tableNumber`, `serviceTime`, `serviceEndTime`, `passKeyId`, `cancellation`,
`additionalRooms`, `addOns`, `price`, `discountPercent`) are all optional, and absent values read as
sensible defaults. **No migration has ever been required, and it should stay that way.**

`lib/services/reservations.mongo.test.ts` inserts documents in the *old* shape straight into Mongo
and asserts they read correctly and survive a save round-trip field for field.

### 2.3 Saving one catalogue must never touch the others

There are **three** catalogues, separated by `MenuCourse.menu` (`"standard" | "premium" | "promo"`,
absent = standard). `saveMenuCatalog` prunes **only within the catalogue being saved**. Deleting by
"ids not in the list I just saved" would wipe the other two entirely.

Read the field through `menuCatalogOf`, never directly. It also resolves the legacy `addOn` flag —
see 2.16.

**The everyday filter is the one that goes wrong.** "Standard" is the *absence* of a marking, so it
cannot be matched by equality; it is expressed as `{ menu: { $nin: ["premium", "promo"] }, addOn:
{ $ne: true } }`. A `$nin` that forgets one of the others deletes that catalogue the next time
somebody renames a starter. Every direction has a test — `lib/services/promotions.mongo.test.ts`
covers the promotions ones, and the older pair are in `reservations.mongo.test.ts`.

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

### 2.9 Hiding a thing for print is not the same as removing it

`visibility: hidden` keeps the box. Both prints in this app were built that way,
and both were wrong in ways nobody connected to the cause:

- Printing nine pass-key cards produced the cards, then **two or three blank
  pages** — the arrivals table underneath, invisible but still occupying paper.
  Reception reported it as "the PDF always has empty pages".
- The service sheet was pinned to the top of page one with `position: absolute`,
  and an absolutely positioned box does not paginate. A long evening broke
  differently depending on the browser.

The fix is in the `@supports selector(:has(*))` block in `globals.css`: anything
that is not the printed subtree, an ancestor of it, or inside it is
`display: none`; the ancestors become `display: contents`; and the subtree flows
normally from the top of the page. The old visibility rules stay as the
fallback for browsers without `:has()`, which is why both approaches are in the
file.

Two more things that cost paper, both fixed there too:

- **`tfoot` repeats on every printed page.** The service sheet's totals row
  therefore printed under each page, reading as if each page were a total of
  itself. It is `display: table-row-group` in print, so it appears once, at the
  end. `thead` still repeats, which is genuinely useful.
- **Controls print at touch-target size.** The table number in the first column
  is a button carrying the app's 32px minimum — 8mm of blank paper per row, and
  the reason twenty tables needed two pages. Buttons, inputs and selects inside
  `[data-print-area]` are stripped to their text in print.

**The sheet is portrait, and set as large as the evening allows.** Landscape
came from treating it as a wide matrix, but width was never the scarce thing —
190mm holds the columns comfortably, while the rows want depth, and portrait
gives 277mm of it. That depth is what pays for readable type: the sheet is set
at 8–11pt rather than 7.2pt, chosen per evening by `chooseSheetPrintSize` from
the number of tables and the number of dishes, and applied through
`data-print-size` and a ladder in the print block. A quiet evening prints at
11pt; a full one steps down rather than spilling, because a sheet split over two
pages is worse than a small one. The arithmetic is a pure function with tests —
print layout cannot be measured from the screen, so measuring the DOM would be
measuring the wrong page.

Pass-key cards follow the same page: two across, five down, ten to a sheet.

An evening of **thirty tables fits one page at 10pt**, with the kitchen slip on
its own page as intended, and the slip is set at 12pt because it has a page to
itself and is read from a bench. Measured, not guessed: see "verifying a print"
below.

### 2.10 Nothing in the suite looks at print CSS

Types, lint, 314 tests and the build all passed while the entire print
stylesheet was missing. Rewriting the motion layer, `globals.css` was spliced on
a comment marker and only the head kept — and that marker sat *before* the print
block, so 239 lines went silently: `[data-print-area]`, the A4 landscape page,
the scroll-clip fix, the percentage column widths, and the whole pass-key card
print context. It reached production.

Two rules follow.

**Never splice this file on a text marker.** Edit the region you mean. Splicing
is a truncation with extra steps, and it deleted work from three commits.

**Print is a feature with no automated cover.** After touching `globals.css`,
check `grep -c data-print app/globals.css` is still in the twenties, and print
the service sheet and a pass-key card by hand. Nothing else will tell you.

### 2.11 A pass-key is spent before the booking it pays for is written

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

### 2.12 Restoring a cancellation is a fresh claim on the seats

Cancelling gives the seats back to the evening. Somebody else may have taken them, or the evening
may have been closed since — so `restoreReservation` claims them again with the same conditional
update a new booking uses, and reports `DATE_FULL` or `DATE_CLOSED` rather than quietly overselling
the room. The status filter on the record write makes two simultaneous restores safe: the loser
hands its claimed seats straight back.

Never "just flip the status back to confirmed". That was the obvious implementation and it is
wrong.

### 2.13 A key belongs to one flow, and every gate must know it

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

### 2.14 Nothing may move under a finger

Two rules in the motion layer, both written after the menu screen became close
to unusable on a phone: guests reported that pressing a dish made "everything
move", and that they kept selecting the wrong one.

**`:active` matches ancestors, not just the target.** The press effect was
written as `.lift:active`, and `.lift` is on the course card *and* on every dish
inside it — so tapping one dish scaled the whole card, and every other dish slid
under the finger mid-tap. On a phone the card fills the screen, so the entire
menu lurched at every press. The selector is now restricted to things that are
actually pressed (`button`, `a`, `[role="radio"]`, …), and a container that
merely holds a control stays where it is. **Never put a press effect on a
container.**

**Scroll-driven reveal is for pointer devices only.** `.reveal` animates a
course card as it scrolls into view — and that card is also what the guest is
tapping. Taller than the viewport, it is still mid-animation while its dishes
are on screen, so the target moves as you scroll toward it. It is now inside
`@media (hover: hover)`.

Related, and the same principle: selecting a dish used to remount the button
(`key={`${option.id}-${isSelected}`}`) so the CSS bloom would restart. That
threw away and rebuilt the dish photograph on every tap. The flash is now a
small overlay element that remounts on its own, and it animates opacity only —
the old one scaled the button from 0.94 to 1.04, which moved the thing that had
just been tapped.

`.lift` also carried a standing `will-change: transform`, one composited layer
per dish on the page. Removed.

**On touch, the interface arrives and then holds still.** That is now a rule of
its own, in the `@media (hover: none)` block:

- **No press transform.** Sinking a control 8px into the page reads well under a
  mouse, where the pointer is beside the thing it presses. Under a thumb the
  control moves *while it is being touched*, and on an older phone the repaint
  lands after the finger has lifted somewhere else — guests were pressing the
  same button two and three times. Touch gets an instant opacity change instead:
  no transform, no transition, nothing to arrive late.
- **No ambient loops.** The drifting gradient and the sweeping sheen cost a
  composite pass forever on hardware with none to spare, for an effect nobody
  looks at. They remain on pointer devices.
- **The chosen party-size chip lifts on pointer devices only** (`.chosen-chip`).
  It used to lift on the phone too — and remounted itself to replay the
  animation — so the picker rearranged under the thumb at every tap.

The entrances (`stage`, `settle`, `rise`, the drawn rule) still play once on
arrival everywhere. Motion on a phone is for the moment a screen appears, not
for every time it is touched.

**When touching the motion layer, drive the menu screen on a phone** — or at
least in a device emulator with touch and a slow CPU. None of this shows up in
types, lint or tests.

### 2.15 No `setState` synchronously inside an effect

React 19's lint rule is on and treated as an error. Data that does not depend on client state is
fetched **on the server** and passed as props. `sessionStorage` is read through
`useSyncExternalStore` (`hooks/use-booking-session.ts`), never during render — reading it in
render caused a hydration mismatch on the confirmation page.

---


### 2.16 Promotions are a catalogue, not a flag on a dinner course

The first version marked a course `addOn: true` on the everyday menu and filtered it out of every
dinner query. That is one filter per query and one bug away from a bottle of wine appearing as a
starter, and it made "add another promotion" mean "add another course to the dinner menu".

Promotions are now `menu: "promo"`, edited at `/admin/menu?menu=promo`. The dinner menu asks for
`standard` and promotions are simply not in the answer — isolation by construction rather than by
remembering.

**The old flag still has to work.** Live databases hold courses marked `addOn`, and rule 2.2 says no
migration. `menuCatalogOf` reads such a course as a promotion, so it moves catalogue on read;
`saveMenuCatalog` writes `menu` and clears the flag on every save, so the compatibility arm goes
quiet on its own. Do not delete that arm until you have checked production for `addOn: true`.

### 2.17 A promotion's price is the server's, never the client's

The browser sends two ids. Names, prices and discounts are resolved from the catalogue by id, the
same rule dish names follow (2.6) and for the same reason: anything the client can name, the client
can invent. The stored figures are copies, not references — a guest agreed to a number, and
re-pricing the wine next week must not change what they owe.

All money goes through `lib/money.ts`. `40 * 0.85` is `33.999999999999996` in binary floating point,
and that must never reach a guest or a bill.

### 2.18 A save fired on every tap must be ordered

The promotions screen saves each choice as it is made, because a guest who has already got their
reservation number will not press a second button. Two taps in quick succession — changing your mind
— raced in the first version, and an older reply overwrote a newer choice: the screen showed the
wine, the booking held nothing. It was reported as "selecting an option does not save it".

`lib/sequential-save.ts` is the fix and carries the reasoning. Requests are **chained**, never
concurrent, so the server applies them in order; and only the **newest** may write to the screen,
checked *after* every await rather than once at the top. Both halves are needed, and both are
tested.
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
  i18n/               The guest interface in seven languages: en.ts is the
                      master, the rest are partials merged over it.
  reservation-ticket.ts  Dish counts ⇄ per-guest choices, and the dish summary.
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

**Menus.** Three catalogues — everyday, premium and promotions — switched between at the top of
`/admin/menu`. Opening the premium editor while the premium catalogue is **empty**
fills it with a copy of the everyday menu as an *unsaved draft* — every id replaced with a `draft-`
one, so the two can never share an id (see rules 2.3 and 2.4). Nothing is written and invited guests
see nothing until somebody presses Save. Options carry description, optional ingredients (translatable, hidden
from guests when blank), an optional vegan flag (leaf badge), allergens from the fourteen EU
declarables plus whatever the menu already used, and photos. Uploads are resized in the browser to
~100–200 KB; stored photos are served from `/api/menu/images/<id>` with a content hash and
immutable cache headers, so the menu payload stays small.

**Declining a course.** `NONE_OPTION_ID` is a real selection, so "does not want a starter" is
distinguishable from "has not chosen yet". Never counted in prep totals.

**Promotions.** Products offered **once**, on the confirmation screen, after the guest has their
reservation number — a bottle of wine, a dessert, a welcome glass. That is the whole point: this
screen is the only place they are offered, and the copy says so, because a guest who assumes they
can add the wine later and cannot has been misled by the wording rather than by the rule.

They live in their own catalogue (rule 2.16), edited at `/admin/menu?menu=promo`, so adding a
promotion never means adding a course to the dinner menu. Each group offers at most one product,
"no, thank you" included, and each choice saves itself as it is made (rules 2.17 and 2.18). The
picker is `components/promo-picker.tsx`; the catalogue and currency are loaded on the server by
`app/booking/confirmation/page.tsx` and handed down, so the offer arrives with the confirmation
rather than a round trip after it.

A product carries a `price` and an optional `discountPercent`, and the screen shows both — the
original struck through beside the discounted one, with a `−25%` badge and a running total. A guest
shown "30.00" learns nothing; a guest shown "40.00 30.00 −25%" learns they are being given
something. `price: 0` reads as complimentary and still has to be chosen, which is what tells the
kitchen to pour it.

What a guest took is stored on the reservation as `addOns`, priced by the server, and printed with
the confirmation.

**Currency.** `promo.currency` in the settings store, default `EUR`, changed in the promotions
editor beside the prices it applies to. It is the only setting so far; `lib/services/settings.ts` is
where the next one goes. Prices are rendered with `Intl.NumberFormat`, which puts the symbol where
the guest's language puts it — before the number in English, after it in French and Bulgarian.

**Shared tables.** Rooms dining together pass a reservation number to each other; the service sheet
shows them as **one row** with all rooms listed and choices already combined. Staff assign a table
number and it applies to everyone on it.

**Taking a booking from a ticket.** Guests who cannot use the app are given a card at reception:
the room (or two or three, if rooms want to sit together), how many are coming, and how many of
each dish — one number per dish, on one line. `/admin/reservation/new` now asks for exactly that.
Each dish is a row: tapping it adds one, `−` takes one away, and **+N all** gives every remaining
guest the same thing, which is what most tickets say. A running "3 of 4 chosen" sits above each
course. The per-guest screen is still there behind a toggle, and is the default when *editing*,
because a booking a guest made themselves records who is having what and retyping it as totals
would throw that away — it is also how an allergy is recorded against a particular seat.

Both write the same per-guest `selections`; the translation is `lib/reservation-ticket.ts`.
Quantities are packed into guest indexes in menu order, so two soups become guests 1 and 2. **Which
guest gets which is arbitrary, and has to be** — the ticket does not say. Editing one course
repacks that course only.

**A booking must have a dinner on it.** The server has always refused an incomplete set of choices,
but the form let staff press Create with a room, a date and nothing else and only reported it
afterwards, one course at a time — so bookings were being created short and noticed when the
kitchen sheet came out. The Create button is deliberately **not disabled** (a disabled button gives
no reason): pressing it names every course that is short and by how many guests, scrolls to the
first, and sends nothing. `findMissingCourses` counts per guest, because two choices for guest 1
and none for guest 2 sums to the right total and is still unfinished.

**The dish summary.** Every booking now says how many of each dish it needs — live in the form
while a ticket is being typed, and on the reservation page after it is saved, with the plate total.
That is the number written on the ticket, and until now checking one against the other meant
reading six separate guest lists and adding the dishes up by hand.

**Several rooms on one booking.** `additionalRooms` holds the other rooms from a ticket. They are
one booking rather than one per room, because the ticket gives a single line of dish counts and no
per-room guest numbers — splitting it would mean inventing them. The service sheet, the detail page
and the audit log show them joined as `402 + 405`, the same way a table rooms joined themselves is
shown. The field is optional and absent everywhere else, and a room listed twice is refused.

**The sheet columns one menu, not both.** The dashboard is handed the *full* catalogue, because it
has to be able to show any evening — but the service sheet must column up only the menu that
evening is served from, which `date-manager.tsx` filters by the date's `premium` flag. Passing both
gave every dish a second column, headed the same and permanently empty: the premium copies, which
nobody on an everyday evening can order. The premium menu starts life as a copy of the everyday
one, so the two sets matched dish for dish and it read as a duplicated column — which is exactly
what it was. Not to be confused with the blank column below, which is a different thing.

**Dishes nobody ordered.** Every menu option keeps a column on screen, so staff can see the whole
menu and satisfy themselves a dish really has no takers — but a column of blanks takes no space on
the printed sheet. See `[data-unordered]` in `globals.css`.

**A cell with nothing in it holds a dash, not a blank and not a zero.** A zero competes with the
counts, because the eye stops on every digit; a blank is worse, because reading a wide row across
white space is how a waiter ends up carrying the right dish to the wrong table — which is what
happens when two or three of them are at the pass at once asking what to take. The dash holds the
place and is quiet enough to skip. It is also why an unordered dish used to look like a duplicate
of the column beside it and was reported as a phantom column.

**Service sheet & printing.** Two layouts: per-table (default, the prep matrix) and per-guest (the
plating list). Print is **A4 landscape**, course-grouping row dropped, dish names trimmed to three
words (`lib/dish-name.ts` drops filler first), and only the sheet prints — everything else is
hidden because staff cut the page up. The kitchen slip follows on its own page: dish, quantity,
total plates, allergy notes; no tables or rooms. CSV exports carry a UTF-8 BOM so Excel does not
mangle accented or Cyrillic names.

**The guest interface is translated; the staff one is not.** Seven languages — English, Bulgarian,
German, French, Polish, Romanian, Russian — in `lib/i18n/`. The menu itself has been translatable
for a long time, but the words around it were not: a Bulgarian guest read their courses in
Bulgarian and every button in English, which is the half of the screen that says what to do next.

- **One choice, one cookie.** The picker sits in the header of every guest screen and writes
  `vdm-language`. The layout resolves it once per request and hands the dictionary to both the
  server tree and, through `I18nProvider`, the client one — so a screen renders in Polish on the
  first paint rather than switching after hydration. With no cookie, `Accept-Language` decides;
  English is the last resort rather than the first, because a guest arriving from the QR code on a
  printed card has made no choice yet.
- **Plain strings with `{placeholders}`, never functions.** The dictionary crosses the server /
  client boundary, and functions do not survive that. `format` fills the gaps and `plural` picks a
  form through `Intl.PluralRules` — Russian and Polish need three, Romanian three, and `count === 1`
  is wrong in most of the languages here.
- **A translation is a deep partial merged over English, key by key.** A half-written language
  shows English for the rest rather than blanks or key names, and a key added to `en.ts` can never
  break a build. `lib/i18n/i18n.test.ts` still holds every language to the full set, and checks
  that no translation invents a placeholder the English sentence does not have.
- **Server messages stay English on the wire.** The API already answered with a `code`; screens
  look that up in the dictionary (`lib/i18n/errors.ts`) and fall back to the server's own sentence
  for codes they do not know. An English message in a log or a support ticket is worth more than a
  Polish one nobody at the desk reads.
- Dates, months, weekday headers and deadlines are formatted with the guest's locale —
  `formatLongDate`, `formatMonthLabel`, `formatDeadline` and `describeReservationTime` all take one.

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

Cards carry a **QR code**, and getting it to appear took three attempts, each of which is worth
knowing about because each looked right:

1. Generated in the browser inside an effect, with the failure caught and swallowed — so a card
   printed a blank square and nothing anywhere said why.
2. Fetched from a guarded API route as an `<img src>`. The route worked and returned valid SVG, but
   that SVG carried only a `viewBox` and **no `width` or `height`**, so the image had no intrinsic
   size and collapsed to nothing as a flex item.
3. Both still depended on a request succeeding at the moment somebody pressed print.
4. Once the bytes were right, the code was *still* invisible — because it sat in a flex row beside
   the text. Flex items default to `min-width: auto`, so the pass-key (fifteen monospace
   characters) refused to shrink below its own width and pushed the QR column past the edge of a
   card that is a fixed size with `overflow: hidden`. It was in the DOM, and the element inspector
   showed it perfectly; it was simply painted outside the card. It is anchored to the corner with
   `position: absolute` now, where nothing can displace it.

It is now drawn on the server by `lib/qr.ts`, with explicit dimensions, and handed to the card as a
base64 data URI — through the page props for existing keys, and in the issue response for new ones.
There is no request to fail, nothing to load before printing, and no authentication in the path of
an image. `lib/qr.test.ts` asserts the width and height attributes specifically, because that is the
part that was silently missing.

The lesson worth keeping: three of the four failures produced *correct data* and were invisible
anyway. Checking the endpoint, the bytes and the types all passed while the guest saw an empty
square. The card is small, fixed-size and clipped — render it and look at it.

No external host either: the desk may have no internet, and nothing in this app may depend on one.
The code points at `/booking?k=<key>` or `/premium/<key>` — worked out by `passKeyTargetUrl`, shared
so a reprinted card and a fresh one always agree. Cards print
in house colour — they need `print-color-adjust: exact`, because browsers drop backgrounds to save
toner — while every other print in the app stays ink on white.

Already-issued keys can be ticked and reprinted, and the list is **searchable** by reservation
number, room, guest name or the code on the card — matched in canonical form, so a code typed with
or without dashes finds it either way. **Editing** opens a dialog over the list rather than a panel
under it, because reception gets there by searching and a form that appears below a long table is
somewhere they then have to go hunting for. Room, reservation number and name are all editable: the
room changes constantly, and a reference mistyped at check-in makes a key hard to find again. Every
field change is named individually in the log.

**Deleting** a key is an administrator's action, like deleting a reservation; revoking is the
everyday one and keeps the record.

The **card** prints no web address. It was being cropped, and the QR is how a guest reaches the app
anyway. What is on it: the house name, the code, the guest's name, the dinners and expiry, and then
the room bottom-left with the hotel's reference bottom-right — the reference being the half that
survives a guest being moved, so reception can still match a card to a booking when the room printed
on it is out of date.

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
accounts with `reservations:restore`. See rule 2.12 — it is a real seat claim and can fail.

**Guest self-service.** `/booking/manage` — **pass-key only**, no reservation number and no room
number, then swap courses or cancel. The key is **never typed twice**: it arrives in the link from
whichever screen the guest came from (`manageHref` builds it) and otherwise from the session, and the
field prefills from either. This is the one place the key is deliberately put in a URL, because a
guest who has just scanned their card and tapped "change or cancel" has nothing in the session yet —
it is only stored once the key has been checked. Closes **12 hours before the sitting** for both edits and
cancellations, enforced server-side; staff are not bound by it. A booking taken by staff has no key
attached, so the guest cannot self-serve it and reception changes it for them.

**Calendar reminders.** Google Calendar plus `.ics`, using the evening's real arrival and end
times (copied onto the booking when made, so moving a sitting does not rewrite history), asking
guests to arrive ten minutes early.

---

`docs/service-tracking.md` is a design note for restaurant check-in and per-course service
tracking — asked for, deliberately not built, and written down so the next session starts from a
decision rather than a blank page.

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
5. **Only the monospace face lacks Cyrillic.** The body and display faces load it — two of the
   seven guest languages need it — but `Geist_Mono` does not, so a pass-key or a reservation number
   rendered in Cyrillic would fall back. Neither ever is: both are `[A-Z0-9-]`.
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
12. **A ticket booking pairs dishes to guests arbitrarily.** The card says four mains and two
    starters, not who is having what, so `expandCourseQuantities` hands the choices out in menu
    order. The per-table sheet and the kitchen slip are unaffected — they count dishes — but the
    per-*guest* plating list will show a combination nobody actually ordered. Use per-guest entry
    when the pairing matters, which in practice means an allergy.
13. **Rooms on one ticket booking are a label, not a lookup.** `roomNumber` is still the first room
    only, so a search or a report that filters by room will not match on the others. Nothing in the
    app does that today; the sheet and the detail page both show every room.
14. **Bookings made before pass-keys existed have no key**, so their guests cannot use
    `/booking/manage` at all. There is no migration path — a key is issued at check-in, and those
    guests have already checked in. Reception handles them by hand until they age out.

---

## 7. Working on this

```bash
npm run dev          # local, JSON store, admin/admin123
npm test             # 481 tests; the Mongo suite runs an in-memory mongod
npm run typecheck
npm run lint
npm run build
npm run seed         # seed MongoDB (no-op without MONGODB_URI)
npm run check:admin -- 'password'
```

**Before pushing:** typecheck, lint, tests and build must all be clean. The Mongo suite downloads a
`mongod` binary on first run.

**Verifying a print.** Nothing in the suite covers print CSS (rule 2.10), and "it looks right in
the preview" has been wrong twice. Print it to PDF and count the pages:

```bash
# with the app running, and a session cookie in cookies.txt
chrome --headless=new --no-pdf-header-footer --print-to-pdf=out.pdf file:///sheet.html
```

Save the page's HTML, **inline the stylesheet** — a `file://` page silently drops an
`http://localhost` stylesheet, and then you are measuring a page with no CSS at all — and count
`/Type /Page` in the PDF. An evening of thirty tables must come out as two pages: the sheet, then
the kitchen slip. Nine pass-key cards must come out as one. Check both ends of
the size ladder — a quiet evening at 11pt and a full one at 8pt.

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
