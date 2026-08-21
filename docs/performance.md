# Performance — why it got slow, and how to find out

**Status: the structural fixes are in; the cause is still unconfirmed.** Signing in takes around a
minute, and it began after the service board shipped. This note was the plan; §7 records what was
actually changed against it.

**Nothing here is a confirmed cause.** The findings below come from reading the code, not from
measuring the deployment, and the first section exists precisely so the next session does not spend
its time optimising the wrong thing.

**§1 has still not been done.** The work in §7 was the part that is right regardless of what the
measurement says — an unindexed full-collection scan on a polled page is worth removing whether or
not it is *the* minute. It is not a substitute for measuring, and if signing in is still slow, §1.1
is where to go first, not back into the query layer.

---

## 1. Measure first — three checks, ten minutes

Do these **before changing a line**. Each is cheap and each can eliminate whole branches of the tree
below.

### 1.1 Is the database asleep?

**Check this first.** An Atlas **M0/M2 free-tier cluster pauses after inactivity** and takes 30–60
seconds to resume. That single fact matches the reported symptom — *about a minute* — better than
anything else in this note, and it would make every other measurement meaningless.

- Atlas → cluster → is it *Paused*?
- Sign in twice in a row. If the first takes a minute and the second takes two seconds, **it is the
  cluster resuming**, not the code.

`connectToDatabase` uses `serverSelectionTimeoutMS: 10_000`, so a resuming cluster may also be
throwing timeouts that surface as unrelated errors.

### 1.2 Where is the time actually going?

Vercel → the deployment → **Logs**, filtered to `/api/admin/login` and `/admin`. The function
duration is on each line. That tells you in one glance whether it is:

- the **login route** (bcrypt, §3.3),
- the **dashboard render** after the redirect (§3.1),
- or **neither**, in which case it is cold start or network.

Sign-in is two requests, and they fail differently. Do not treat them as one.

### 1.3 How much data is there?

```js
// mongosh
db.reservations.countDocuments()
db.reservations.find().sort({ createdAt: -1 }).explain("executionStats")
```

Look for `COLLSCAN` and for `SORT` appearing as an in-memory stage. See §3.1 — that query has no
index behind it.

---

## 2. What changed when the board shipped

Being straight about this, because it narrows the search and because two of the three are mine.

| Change | Load added |
|---|---|
| `/admin/service` page | `getReservationsList()` + `getFullMenuCatalog()` per render |
| **The board polls every 5s** | …and every poll re-runs that page |
| `/admin/analytics` page | `getReservationsList()` + `listPassKeys()` + `getFullMenuCatalog()` + dates |

The middle row is the one to look at hardest. `router.refresh()` on a five-second interval re-runs
the **server component**, which means a board left open on a tablet issues a full-collection read
**twelve times a minute, indefinitely** — and on Vercel each one is a function invocation against
the same database everything else is queueing behind.

That is a load generator I added, and it is the most plausible link between "the service board
landed" and "the whole app got slow".

---

## 3. The suspects, ranked

### 3.1 `getReservationsList()` reads every reservation, sorted on an unindexed field

**The structural problem, and the one worth fixing regardless of what the measurement says.**

```ts
// lib/services/reservations.ts
const reservations = await ReservationModel.find().sort({ createdAt: -1 }).lean();
```

No filter. No limit. And `createdAt` **has no index** — the model indexes `reservationNumber`,
`date`, `tableGroupId` and `passKeyId`, but not `createdAt`. So this is a collection scan plus a
sort Mongo may have to do in memory (and which fails outright past 32MB without an index).

It is called by **three** pages: `/admin`, `/admin/analytics`, `/admin/service`. It was one before
this branch.

**The fix, in order of value:**

1. **Add the index.** `createdAt: -1` in the reservation schema. One line, no data change, and it
   turns the sort from a blocking stage into an index walk. Do this first; it is nearly free.
2. **Add `getReservationsBetween(fromKey, toKey)`** and use it everywhere. `date` is already
   indexed, so a range query is cheap. `docs/analytics.md` §5.4 already called for this and it was
   not done — analytics folds in memory, which is right, but it should fold *this evening* or *this
   month*, not *everything since the restaurant opened*.
   - `/admin/service` needs **one date**. It currently loads every reservation ever and filters in
     JavaScript. That is the worst offender per request.
   - `/admin/analytics` needs the range plus its comparison period.
   - `/admin` needs today and the upcoming list.
3. Only then consider caching.

### 3.2 The board's polling multiplies §3.1

Five seconds was chosen for a screen with thirty rows and no thought for what re-rendering it costs
on the server. Options, cheapest first:

- **Widen the interval** to 15–20s. A course going out is not a fact anybody needs within five
  seconds; the person who marked it already sees it optimistically.
- **Poll a cheap endpoint, not the page.** A route returning just a cursor — the greatest
  `updatedAt` for the evening — and calling `router.refresh()` only when it moves. That is what
  `docs/service-tracking.md` §6 actually described, and the implementation shortcut it.
- **Stop polling when nothing is outstanding** — after the last course goes out there is nothing to
  learn.

Note it already pauses on `visibilitychange`, so a backgrounded tab is not the problem. A tablet
left awake on the pass — which the wake lock deliberately encourages — is.

### 3.3 bcryptjs, twice, on every cold start

Specific to the reported symptom, because it is on the sign-in path.

```ts
// lib/services/staff-users.ts — runs at MODULE LOAD
const DUMMY_HASH = bcrypt.hashSync("password-that-is-never-correct", BCRYPT_ROUNDS); // rounds: 10
```

`bcryptjs` is the pure-JavaScript implementation, roughly an order of magnitude slower than the
native binding. A cost-10 hash there is tens to hundreds of milliseconds on a small serverless CPU —
and this one runs **at import**, so every cold start of anything that imports `staff-users` pays it.
That is `lib/auth/guard.ts`, which is *every admin page and route*.

Then the login itself runs a real `bcrypt.compare` at the same cost.

**It is almost certainly not a minute on its own** — but it is a fixed tax on the exact path being
complained about, and it is easy to remove:

- Make `DUMMY_HASH` **lazy** — compute it on first use inside the function, not at module scope.
  The timing-attack defence it exists for is unaffected. Two lines.
- Consider whether the dummy comparison needs to be a real bcrypt call at all, or whether a fixed
  delay would do. (Keep the defence; question the implementation.)
- Do **not** lower the rounds. Ten is already the floor for a password hash.

### 3.4 Cold starts

Vercel functions cold-start, and this app imports Mongoose — which is large. A cold start plus a
Mongoose connect plus §3.3 plus §3.1 compounds into something that feels broken.

Worth checking whether the admin pages are all `dynamic = "force-dynamic"` (they are, deliberately —
availability must never be stale) and whether that is costing more than it needs to on pages where a
few seconds of staleness would be harmless.

### 3.5 The local JSON store, if it is in use anywhere

`readReservations` parses the whole file on every call, and every write serialises the whole file
under one global lock (`withStoreLock`). That is fine for development and would be a disaster under
a polling board. **Confirm `MONGODB_URI` is actually set in the deployment** — if it is not, the
store is doing full-file JSON round trips twelve times a minute, and that alone would explain
everything.

---

## 4. If one change is wanted before a proper session

**Widen the board's poll interval** in `app/admin/service/service-board.tsx`:

```ts
const POLL_MS = 5000;   // →  20000
```

One constant. It cannot break anything — the board already reconciles correctly at any interval —
and it cuts the load that section adds by four. It is not the fix; it is a tourniquet while the
measuring in §1 happens.

---

## 5. Order of work

1. **§1.1** — is the cluster paused? If yes, most of this note is moot; resize or keep it warm, then
   re-measure before doing anything else.
2. **§1.2** — where the time goes, from the logs. Login route or dashboard render.
3. **Add the `createdAt` index** (§3.1). One line, no risk, helps immediately.
4. **`getReservationsBetween`**, and switch all three pages to it. `/admin/service` first — it needs
   exactly one evening and currently loads everything.
5. **Fix the polling** (§3.2) — cursor endpoint, or a wider interval.
6. **Make `DUMMY_HASH` lazy** (§3.3).
7. Re-measure. Stop when it is fast enough.

## 6. What not to do

- **Do not add caching before §3.1 and §3.2.** Caching a query that scans a collection hides the
  problem and adds staleness to a screen whose entire purpose is being current. Availability going
  stale is how two guests get the same seat.
- **Do not denormalise or add a rollup table** for analytics. `docs/analytics.md` §5.1 explains why
  aggregate-on-read is right at this size; the problem is the *range*, not the folding.
- **Do not lower the bcrypt cost.**
- **Do not optimise from this note alone.** Every item here is a hypothesis from reading the code.
  §1 exists because the last time this project guessed at a cause it was wrong twice.

---

## 7. What was done

Everything in this section is committed. It is §5 items 3, 4, 5 and 6 — the ones that stand on their
own merits without the measurement, and none of them changes what any page can show.

| § | Change | Where |
|---|---|---|
| 3.1 | `createdAt: -1` index on the reservation schema | `lib/models/reservation.ts` |
| 3.1 | `getReservationsByDate(date)` — one evening, off the `date` index | `lib/services/reservations.ts` |
| 3.1 | `getReservationsBetween(from, to)` — an inclusive `date` range | `lib/services/reservations.ts` |
| 3.1 | Service board reads one evening instead of filtering everything in JS | `app/admin/service/page.tsx` |
| 3.1 | Analytics reads the range ∪ its comparison period, not the collection | `app/admin/analytics/page.tsx` |
| 3.2 | Board poll widened 5s → 20s | `app/admin/service/service-board.tsx` |
| 3.3 | `DUMMY_HASH` computed on first use instead of at import | `lib/services/staff-users.ts` |

The local JSON store got matching `listLocalReservationsByDate` / `listLocalReservationsBetween`, so
development does not quietly keep the full-file read the deployment no longer does.

Narrowing a query is only safe if it selects the same rows the JavaScript filter did, so
`lib/services/reservations-range.mongo.test.ts` pins the boundaries: both ends inclusive,
neighbouring evenings excluded, month and year boundaries, and the newest-first order the lists
depend on. One test asserts the new query and the old filter return the same reservations.

### What was deliberately left

**`/admin` still loads every reservation.** `AdminDateManager` holds the whole list client-side and
its calendar can select *any* date, past included — narrowing the query blanks out every evening
outside the window until the manager can fetch a date on demand. That is a real change to the
component, not a query swap, and it wanted its own commit. The `createdAt` index (§3.1) makes the
scan it still does cheaper, and unlike the board this page is not on a poll: it is paid once per
sign-in.

**No caching**, per §6.

### Still to measure

§1.1 (**is the Atlas cluster paused** — still the best single match for *about a minute*), §1.2 (the
function durations in the Vercel logs) and §3.5 (**confirm `MONGODB_URI` is set in the deployment** —
there is no `.env` in the checkout to confirm it from). If the cluster is paused or the URI is
missing, that is the answer and the rest of this note is a footnote to it.
