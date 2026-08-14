# À La Carte Restaurant Reservation System

A hotel guest reservation app for an à la carte restaurant, built with Next.js 16, TypeScript, Tailwind CSS v4 and MongoDB/Mongoose.

Guests book from their room number in a five-step flow (room → guests → date → menu → confirm),
leave a contact detail, and can add the booking to their calendar. Staff manage availability,
the menu and the nightly kitchen report from `/admin`.

## Features worth knowing about

**Dish photos.** Courses and options each take a picture, either a URL or an upload. Uploads are
resized and re-encoded in the browser before they are sent, so a photo straight off a phone
arrives at roughly 100–200 KB. Stored photos are served from `/api/menu/images/<id>` with a
content hash in the URL and immutable cache headers, which keeps the menu response small and lets
browsers cache each picture. External image addresses are passed through untouched.

**Contact details.** Every booking carries an email address or a phone number, chosen by the
guest on the confirmation step. A phone number also picks a preferred app — phone/SMS, WhatsApp,
Viber or Telegram — and staff see a one-click link that opens the right one.

**Arrival times.** Each evening has a strict arrival time, set per date in the dashboard. It is
shown to guests when they pick the date and again on their confirmation, copied onto the booking
as it is made (so moving a later sitting does not rewrite existing bookings), and used for the
calendar reminder. `NEXT_PUBLIC_DINNER_TIME` is only the fallback for dates with no time set.

**Shared tables.** Two or three rooms can eat together: the first room books as usual and passes
its reservation number to the others, who tick "we are dining with another room" and enter it.
Joining is refused if the number is unknown, for another evening, or cancelled. Staff assign the
actual table number in the dashboard, and it applies to everyone sharing that table.

**Kitchen sheet.** The dashboard prints the daily sheet in the shape of the old Excel book —
Table, Room, Guests, a column per course, and a Comment column carrying allergies and requests.
Two layouts toggle: one row per guest (for plating) and one row per room (for reception). Both
export to CSV for Excel, with a UTF-8 BOM so accented and Cyrillic dish names survive the open.
Rooms sharing a table are grouped together and shaded as one block.

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

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | No | Enables the MongoDB backend. Without it the local JSON store is used. |
| `ADMIN_USERNAME` | No | Admin username. Defaults to `admin`. |
| `ADMIN_PASSWORD_HASH` | **In production** | bcrypt hash of the admin password. |
| `ADMIN_SESSION_SECRET` | **In production** | ≥16 chars, used to sign admin session cookies. |
| `LOCAL_STORE_DIR` | No | Overrides where the JSON store is written. Used by the tests. |
| `NEXT_PUBLIC_DINNER_TIME` | No | Fallback sitting time (`HH:MM`) for dates with no arrival time set. Defaults to `19:00`. |
| `NEXT_PUBLIC_DINNER_DURATION_MINUTES` | No | Length of the sitting. Defaults to `120`. |

In production the admin area fails closed: without `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET` every admin request returns 503 rather than falling back to a default password.

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
  auth/                 Credential checking and signed admin sessions
  db/                   Mongo connection, JSON store, seed definitions
  services/             Booking rules, reservations, restaurant/menu
  date.ts               Local-timezone date keys (never UTC)
  validation/           Zod schemas shared by the API routes
proxy.ts                Optimistic /admin redirect (pages re-check the session)
```

### Conventions

- **Dates are local calendar strings.** Use the helpers in `lib/date.ts`; `toISOString()` shifts the day for any timezone east of UTC.
- **Colours come from tokens.** `app/globals.css` defines the light and dark palettes; components use semantic classes (`bg-surface`, `text-ink`, `border-line`) rather than hex values.
- **Authorisation is checked in the route.** `proxy.ts` only redirects; each admin page and API route calls `isAdminAuthenticated()` itself.
- **Booking rules live in `lib/services/booking-rules.ts`.** The API delegates to it so the rules under test are the ones that run.
