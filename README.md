# Vista Del Mar — Restaurant Reservations

A hotel guest reservation app for Vista Del Mar, the à la carte restaurant, built with Next.js 16,
TypeScript, Tailwind CSS v4 and MongoDB/Mongoose.

The house name, tagline and reservation-number prefix live in `lib/brand.ts`; the mark itself is
`components/brand.tsx`, with a favicon version at `app/icon.svg`.

Guests book with the **pass-key** they were given at check-in, in a five-step flow (pass-key +
room → guests → date → menu → confirm), leave a contact detail, and can add the booking to their
calendar. Staff manage availability, the menu, pass-keys, staff accounts and the nightly kitchen
report from `/admin`, each signed in under their own name.

## Features worth knowing about

**Pass-keys.** Dinner is part of a stay of five nights or more, so a room number alone is not
enough to book — anyone can read one off a door. Reception issues a **pass-key** at check-in from
`/admin/pass-keys`, and prints a slip carrying the code and the address to book at. The guest enters
that key and the room they are currently in.

```
VDM-K7QP-3M2X-R4TN
```

Ten characters of Crockford base32: no `I`, `L`, `O` or `U`, so nothing on the card is ambiguous;
case-insensitive; dashes and spaces ignored; and the characters people type when they misread a card
(`O` for zero, `I` or `l` for one) are folded onto what they meant. `vdm-k7qp3-m2xr4` and
`VDMK7QP3M2XR4` are the same key. The `VDM-` prefix is already in the box, so guests only type the
part that varies.

**The party size comes from the hotel booking.** Reception knows it before the guest arrives, so the
key carries it: the booking flow offers no larger a table, and the server refuses one regardless.
Fewer is always fine — people drop out of dinner — and the number stays editable, because parties
change. A key with no size recorded is bound only by the restaurant's maximum of six.

**A long stay earns more than one dinner** — one per five nights, up to three. A key expires when
the stay does, so a table cannot be held for an evening after check-out, and a stay under five
nights is refused unless somebody deliberately overrides it, which is recorded on the key and in the
log.

**Reception works from an arrivals table.** One row per guest — hotel reservation number, name,
room, check-in, check-out, party size — and one press issues them all and puts the cards on screen
to print.
Nights and dinners are worked out from the two dates rather than typed, so nothing can disagree, and
check-in has Today/Tomorrow buttons because keys are usually written a day ahead. Keys are
identified by the hotel's booking reference rather than the room, because guests get moved.

Keys print as **credit-card-sized cards** in house colour, carrying a **QR code**: the guest scans
it and lands on the booking step with the key already filled in. Already-issued keys can be ticked
and reprinted, and administrators can delete one outright.

**The key is checked on the first screen**, not when the finished booking is submitted, so nobody
picks a date and a full menu for four people only to be told the key was spent. The date calendar
then shows how long the key is good for and greys out evenings after the stay ends.

**Changing your booking.** The pass-key is also how a guest returns to their reservations — *not* the
reservation number, which they hand to other rooms so they can share a table and which would
therefore let any of those rooms cancel it. A key holding several dinners lists them all and the
guest picks one. Cancelling **gives a use back**, so a guest who cancels can book another evening
rather than losing dinner over one tap.

**Invitations.** Guests who are not staying get the same kind of key, marked as an invitation, and
receive it as a link — `/premium/<pass-key>` — so they go from the email straight into the booking
without typing anything. Invitation keys only work on the invitation flow and in-house keys only on
the everyday one; each is refused on the other, at every step.

**There is one front door.** Everyone starts at `/booking` and enters a key; the app works out from
the key which flow they belong in and sends them there. Bare `/premium` now redirects — it used to
show the premium menu and every invitation-only evening to anyone who found the address.

**Booking twice on one evening** is allowed, because a guest with dinners to spare often books for a
room that has none — but the app says so first, since usually the guest meant to change the booking
they already have.

**Staff accounts.** Each member of staff signs in as themselves at `/admin/users`, with their own
permissions: take, edit, cancel and restore reservations; edit the menus; manage evenings; issue
pass-keys; manage accounts. **Deleting a reservation is administrators only.** Disabling an account
takes effect on its next request. The `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` owner account still
works and cannot be deleted from the panel, so a deployment is always recoverable.

**Who did what.** Every change to a booking or an account is recorded, with the name of the person
who made it — cancellations especially, whether by a guest with their pass-key, by reception, or by
an administrator. A booking's full history is on its page at `/admin/reservation/<number>`, and a
cancelled booking shows who cancelled it and when in the service sheet.

**Undoing a cancellation.** Cancelled bookings show a *Restore* button. This is a real claim on the
seats, not a status flip: cancelling released them, so a restore can be refused because the evening
filled up or was closed in the meantime, and it says which.

**Dish photos.** Courses and options each take a picture, either a URL or an upload. Uploads are
resized and re-encoded in the browser before they are sent, so a photo straight off a phone
arrives at roughly 100–200 KB. Stored photos are served from `/api/menu/images/<id>` with a
content hash in the URL and immutable cache headers, which keeps the menu response small and lets
browsers cache each picture. External image addresses are passed through untouched.

**Contact details.** Every booking carries an email address or a phone number, chosen by the
guest on the confirmation step. A phone number also picks a preferred app — phone/SMS, WhatsApp,
Viber or Telegram — and staff see a one-click link that opens the right one.

**Arrival times.** Each evening has a strict arrival time and an end time, set per date in the
dashboard. They are shown to guests when they pick the date and again on their confirmation,
copied onto the booking as it is made (so moving a later sitting does not rewrite existing
bookings), and used for the calendar reminder — which also asks the guest to arrive ten minutes
early and carries a short-notice alarm to that effect. `NEXT_PUBLIC_DINNER_TIME` is only the
fallback for dates with no time set.

**Room labels.** Rooms are text, not numbers — `402`, `L10`, `HA3`, `A43` all work. They are stored
upper-cased so a guest typing `l10` still finds their booking, and sorted naturally on the kitchen
sheet so `2` comes before `10` and the A rooms group together. Bookings saved by earlier versions
with a numeric room read back unchanged.

**Staff reservations.** Reception can take a booking at the desk (*New reservation* on the
dashboard) and edit any part of an existing one (*Edit reservation* on its page): courses, date,
party size, room, table, comment and contact. Moving a booking to another evening or resizing the
party moves the seats with it — the new evening is claimed before the old one is released, so a
concurrent booking cannot slip into the gap, and a refused move leaves both evenings untouched.
Contact details are optional for staff, since a phone booking may not have them.

**Taking a booking from a ticket.** Guests who would rather not use the app fill in a card at
reception: the room — or two or three rooms wanting to sit together — how many are coming, and how
many of each dish, on one line. The form asks for the same thing. Each dish is a row: tap it to add
one, `−` to take one away, and **+N all** to give every remaining guest the same dish, which is what
most tickets say. Each course shows a running "3 of 4 chosen", and a summary at the foot of the form
lists how many of each dish the table needs and the total plates, to check against the card before
saving. Pressing *Create* while anything is missing names the courses that are short and how many
guests they are short by, and sends nothing — a guest skipping a course is entered as
*No thank you*, which is a real choice rather than a gap.

Switch to **Per guest** for the original screen, one guest at a time. That is the way to record a
particular seat's dish — an allergy — and it is the default when editing, because a booking the
guest made themselves knows who is having what. Entering by ticket cannot know that: the card does
not say.

After saving, the reservation's page lists the same dish summary, so a booking can be checked
against the ticket without adding up six separate guest lists.

**Changing a booking.** Guests reach `/booking/manage` from the confirmation or the first booking
step, enter their **pass-key**, and can then swap courses or cancel. Self-service closes **12 hours
before the sitting**, after which they are asked to speak to reception — the kitchen is already
prepping against the counts by then. The cutoff is enforced on the server for both edits and
cancellations; staff are not bound by it, so anything can be fixed at the desk. A booking taken by
staff has no pass-key attached, so reception changes it on the guest's behalf. Staff with the right
permission can delete a booking outright, which releases its seats; cancelling instead keeps it on
the night's record and can be undone.

**Shared tables.** Two or three rooms can eat together: the first room books as usual and passes
its reservation number to the others, who tick "we are dining with another room" and enter it.
Joining is refused if the number is unknown, for another evening, or cancelled. Staff assign the
actual table number in the dashboard, and it applies to everyone sharing that table.

A ticket naming several rooms is the same thing from the other end: reception adds the extra rooms
to the one booking, since the card gives one line of dish counts for the whole table and no way to
tell which room ordered what. The sheet shows them as `402 + 405`, exactly like rooms that joined
themselves.

**Dish details.** An option can carry an ingredients line and a vegan flag, both optional. The
ingredients line is translatable and is hidden entirely from guests when blank; a vegan dish shows
a leaf badge in its top-right corner. Allergens are chosen from the fourteen declarable EU
allergens, and anything already on the menu is offered alongside them, so switching to the picker
cannot drop a value typed by hand. All three fields are additive — a menu saved before they
existed reads and re-saves unchanged.

**Declining a course.** A guest can pick "No thank you" on any course. That is stored as a real
selection with a reserved option id, so the kitchen can tell "does not want a starter" apart from
"has not chosen yet". Declined courses never appear in the prep counts.

**Kitchen sheet.** Two layouts toggle in the dashboard, and each exports to CSV for Excel with a
UTF-8 BOM so accented and Cyrillic dish names survive the open.

- *Per guest* — the plating list: Table, Room, Guest, a column per course naming the dish, and a
  Comment column carrying allergies and requests.
- *Per table* (the default) — the prep sheet: one row per **table**, not per room. Rooms dining
  together appear as a single line with every room listed in the Rooms column ("HA3 + L10") and
  their choices already added together, so nothing has to be summed by eye. Then a column for
  **every option**, grouped under its course, and a **Total to prepare** row closing the sheet.
  Cancelled bookings are excluded from the counts. A dish that table is not having shows a dash
  rather than a zero or an empty cell, so a row can be read straight across at the pass without
  slipping a column.

The columns come from the menu that evening is served from — the everyday one, or the premium one
for an invitation evening. A dish nobody has ordered still keeps its column on screen, so you can
satisfy yourself it really has no takers; on paper it takes no space.

**Invitation bookings (`/premium`).** A separate flow for guests who are not staying yet — people
invited weeks ahead who must choose now. They give a **name** instead of a room, order from a
**separate premium menu**, and may only pick evenings staff have opened for them. Mark an evening
*Invitation only* in the dashboard and it leaves the everyday flow entirely: hidden from the hotel
date list and refused by the booking API, so its seats cannot be taken by a hand-made request.
Staff can still place someone on it from the admin side. Premium evenings show gold with a star in
both calendars.

The premium menu is edited at `/admin/menu?menu=premium`, saved independently of the everyday menu
— saving one never touches the other. The first time you open it while it is empty, it is filled
with a copy of the everyday menu as a starting point. Nothing is stored, and invited guests see
nothing, until you press **Save menu**; from then on the two are entirely separate, and editing one
never changes the other.

**Printing.** Print gives you only the sheet — no calendar, no navigation — in **A4 portrait**,
sized to land an evening on a single page: the course-grouping row is dropped, dish names are
trimmed to three words ("Slow roasted lamb"), and the table-number buttons print as plain numbers
rather than at their on-screen touch size. The type is set **as large as the evening allows** — a
quiet night prints at 11pt, and a busy one steps down through 10, 9 and 8 rather than spilling onto
a second page. **Thirty tables fit on one page at 10pt**, with the totals row appearing once, at
the end. The kitchen slip follows on its own page —
a compact list of every dish with its quantity, total plates, and any allergy notes. Cut it off and
hand it over; it carries no tables or room numbers.

Pass-key cards print the same way: ten to a portrait sheet with cut lines, and nothing else — no
trailing blank pages from the list behind them.

**Seven languages for guests, English for staff.** The whole guest interface — buttons, labels,
messages, dates and month names — is translated into English, Bulgarian, German, French, Polish,
Romanian and Russian. The picker is in the header of every guest screen and the choice is
remembered; a guest who has not chosen gets the language their browser asks for. The menu follows
the same choice, so the dishes and the buttons never disagree.

Staff screens stay in English, and so does the data: the course and option names stored on a
reservation are always the master English wording, resolved from the catalogue by id rather than
trusted from the client. Bookings taken before this are resolved the same way when the sheet is
drawn, so old records read in English too.

To add a language, copy `lib/i18n/en.ts`, translate the values, and register it in
`lib/i18n/index.ts`. Anything left untranslated falls back to English one key at a time.

**Calendar reminders.** The confirmation screen offers Google Calendar and an `.ics` download for
Apple Calendar and Outlook, including the per-guest menu choices and an alarm three hours before
the sitting. Reservations store a date but no time, so the sitting time comes from
`NEXT_PUBLIC_DINNER_TIME`.

## Run locally

```bash
npm install
npm run dev
```

That is enough to try the app: with no `MONGODB_URI` set it uses a local JSON store under `data/`, which seeds itself with a sample menu and 30 days of availability on first run. The `data/` directory is git-ignored — delete it to start fresh.

Admin sign-in in development falls back to `admin` / `admin123` and prints a warning. Sessions are signed with a per-process random key, so they end when the dev server restarts.

To try the guest flow you need a pass-key: sign in at `/admin`, open **Pass-keys**, and issue one
for a stay of five nights or more. The code it shows is what goes in the first booking step.

Note that `npm start` runs in production mode, where the `admin`/`admin123` fallback is off and the
session cookie is `Secure` — set `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET` if you want to
drive the built app over plain `http`.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | No | Enables the MongoDB backend. Without it the local JSON store is used. |
| `ADMIN_USERNAME` | No | Username of the owner account, which lives in the environment rather than the database. Defaults to `admin`. |
| `ADMIN_PASSWORD_HASH` | **In production** | bcrypt hash of the owner account's password. |
| `ADMIN_SESSION_SECRET` | **In production** | ≥16 chars, used to sign admin session cookies. Required even once staff accounts exist. |
| `LOCAL_STORE_DIR` | No | Overrides where the JSON store is written. Used by the tests. |
| `NEXT_PUBLIC_DINNER_TIME` | No | Fallback sitting time (`HH:MM`) for dates with no arrival time set. Defaults to `19:00`. |
| `NEXT_PUBLIC_DINNER_DURATION_MINUTES` | No | Length of the sitting. Defaults to `120`. |

In production the admin area fails closed: without `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET` every admin request returns 503 rather than falling back to a default password.

The owner account is how you first sign in and create the real staff accounts, and how you get back
in if the last administrator account is ever lost. Sign-in checks the staff accounts first, so once
they exist the log names a person rather than "admin".

Generate the two secrets:

```bash
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" 'your-password'
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### If admin sign-in fails

```bash
npm run check:admin -- 'the-password-you-are-typing'
```

It reports which variable is at fault. For a deployed environment, pull the
real values first with `vercel env pull .env.local`.

Three things account for almost every failure:

- **Environment variables need a redeploy.** Adding them to an existing Vercel
  deployment has no effect until it is rebuilt.
- **A shell ate the `$` in the hash.** `$2b$10$…` gets expanded to a fragment
  unless it is single-quoted. Pasting into the Vercel dashboard is safest.
- **The username does not match.** `ADMIN_USERNAME` defaults to `admin`.

A misconfigured deployment returns **503** with the offending variable named;
a genuinely wrong username or password returns **401**.

## Running against MongoDB

```bash
export MONGODB_URI="mongodb://localhost:27017/hotel-restaurant"
npm run seed
npm run dev
```

**A new database starts empty**, and the self-seeding JSON store only runs when
`MONGODB_URI` is unset — so guests would see "no dinner dates are open" and
"the menu is not published yet". Seed a hosted database by pointing the same
script at it from your machine:

```bash
MONGODB_URI="<your Atlas connection string>" npm run seed
```

Seats are claimed with a single conditional update rather than a transaction, so a standalone `mongod` works — no replica set required.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Vitest suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run seed` | Seed MongoDB (no-op without `MONGODB_URI`) |
| `npm run check:admin` | Diagnose admin sign-in configuration |

Tests write to a temporary directory via `LOCAL_STORE_DIR` and never touch `data/`. The
MongoDB suite runs against an in-memory `mongod`, downloaded on first run.

## Project layout

```
app/                    Routes. Pages fetch on the server; client components
                        handle interaction only.
  api/                  HTTP API (reservations, menu, availability, admin)
components/             Shared UI: design-system primitives, calendar, steps
hooks/                  useBookingSession — sessionStorage via useSyncExternalStore
lib/
  auth/                 Credentials, signed sessions, permissions, route guard
  db/                   Mongo connection, JSON store, seed definitions
  services/             Booking rules, reservations, restaurant/menu,
                        pass-keys, staff accounts, audit log
  pass-key.ts           Pass-key generation, normalisation and formatting
  date.ts               Local-timezone date keys (never UTC)
  validation/           Zod schemas shared by the API routes
proxy.ts                Optimistic /admin redirect (pages re-check the session)
```

### Theming

`app/globals.css` holds the whole palette as semantic tokens (`surface`, `ink`, `line`, `accent`).
There are three theme states: a guest who has chosen light or dark gets `data-theme` on the root
element, and one who has not follows the operating system. Each palette is therefore declared
twice — once under `prefers-color-scheme`, once under an explicit `[data-theme]` — so the toggle
wins in both directions. A small script in `<head>` applies the saved choice before the first
paint, so dark never flashes light on load.

Headings use a display serif (`.display`); everything else uses the UI sans. Both palettes were
checked against WCAG AA, worst pair 4.98:1.

### Conventions

- **Dates are local calendar strings.** Use the helpers in `lib/date.ts`; `toISOString()` shifts the day for any timezone east of UTC.
- **Colours come from tokens.** `app/globals.css` defines the light and dark palettes; components use semantic classes (`bg-surface`, `text-ink`, `border-line`) rather than hex values.
- **Authorisation is checked in the route.** `proxy.ts` only redirects; each admin page and API route calls `requireStaff(permission)` itself, which answers both who the caller is and whether they may do this. Hiding a button is presentation, not access control.
- **Guest self-service is authorised by the pass-key**, never the reservation number — guests share that number with other rooms to be seated together.
- **Booking rules live in `lib/services/booking-rules.ts`.** The API delegates to it so the rules under test are the ones that run.
