# À La Carte Restaurant Reservation System

A hotel guest reservation app for an à la carte restaurant, built with Next.js 16, TypeScript, Tailwind CSS v4 and MongoDB/Mongoose.

Guests book from their room number in a five-step flow (room → guests → date → menu → confirm); staff manage availability, the menu and the nightly kitchen report from `/admin`.

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

In production the admin area fails closed: without `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET` every admin request returns 503 rather than falling back to a default password.

Generate the two secrets:

```bash
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" 'your-password'
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Running against MongoDB

```bash
export MONGODB_URI="mongodb://localhost:27017/hotel-restaurant"
npm run seed
npm run dev
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

Tests write to a temporary directory via `LOCAL_STORE_DIR` and never touch `data/`.

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
