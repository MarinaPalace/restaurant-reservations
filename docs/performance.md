# Performance — why it got slow, and how to find out

**Status: found, and fixed — pending confirmation on the deployment.** It was §3.1: the pages that
read the whole reservation collection. §7 lists what changed, and **§8 is the part worth reading**,
because it records how the cause was actually identified and which of the theories below were wrong.

**Sections 1 to 6 are the original note, left as written.** They are a plan for an investigation
that had not happened yet, and their ranking of suspects is *not* what turned out to be true — §1.1
in particular is confidently argued and wrong. They are kept because the reasoning is worth having
next to the outcome, not because they should be followed again as they stand.

Read §8 first.

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

**No caching**, per §6.

`getReservationsList` is still exported and still does what it always did. Nothing on a page calls
it any more.

### The dashboard, which was the actual complaint

`/admin` was doing the same thing as the board and analytics, and it kept doing it after the first
commit narrowed those two. It is now narrowed as well:

| Change | Where |
|---|---|
| `getDashboardCounts(today)` — an aggregate and a `countDocuments`, both off the `date` index | `lib/services/reservations.ts` |
| Dashboard reads its two counts instead of folding them from every reservation | `app/admin/page.tsx` |
| Dashboard sends the date manager one evening, not the book | `app/admin/page.tsx` |
| `GET /api/admin/reservations?date=` — one evening, for the calendar | `app/api/admin/reservations/route.ts` |
| The manager fetches an evening the first time it is selected, and keeps it | `app/admin/date-manager.tsx` |
| An evening still loading says so, instead of reading as an empty one | `app/admin/kitchen-report.tsx` |

The counts match `status` as **not cancelled** rather than equal to `confirmed`, because `status` is
one of the optional fields of §2.2 in `HANDOVER.md`: a booking taken before it existed has none, and
`toReservationRecord` reads that absence as confirmed. Asking for `confirmed` would have dropped
every one of them from the dashboard silently. There is a test that unsets the field and asserts it
is still counted.

---

## 8. What the testing actually showed

The measurement in §1 never happened in the form it was written. Something better did: the symptom
was narrowed by elimination, from the outside.

| Observation | What it eliminates |
|---|---|
| Guest pages are fast | The cluster, the region, the network. They query the same database. |
| Sign-in is slow **every** time, not just the first | A paused cluster (§1.1) and cold starts (§3.4). Both are slow once, then fast. |
| `/admin/pass-keys` is fast; `/admin` takes upwards of a minute | Everything the two share — the proxy, the auth guard, the session check, the bcryptjs import (§3.3), `force-dynamic`. The only difference between those two pages is which collection they read. |

That last row is the whole diagnosis. Pass-keys reads a small collection and returns promptly; the
dashboard read the entire reservation book, sorted on an unindexed field, and then serialised every
row into the payload sent to the browser. Both costs grow with the number of bookings ever taken and
neither appears on any page a guest sees.

**§3.1 was right and §1.1 was wrong.** Worth being plain about that, because §1.1 was written as the
most likely answer and stayed the leading theory until the deployment was actually poked at. *About
a minute* sounded like a cluster resuming; it was a collection scan all along, and the thing that
told them apart was not a stopwatch but a second admin page that stayed fast.

`GET /api/admin/diagnostics/timing` was built to settle this and was overtaken by the evidence
before it was ever deployed. It is still worth one look after this deploys — `pingMs` is the floor
under every query in the app and nobody here has ever seen the number — but it is a curiosity now,
not a diagnosis. It can be deleted whenever.

### If the dashboard is still slow after this

Then the remaining suspects are §3.4 and §3.5, and `mongoConfigured` in the diagnostics endpoint
answers the second in one request. But the elimination above says it will not be.

---

## 9. The actual cause: dish photos in the menu documents

§8 was right that the reservation reads were wasteful and wrong that they were *the* problem. A HAR
capture of the guest booking flow settled it in one line:

```
GET /booking/menu        wait 154ms   receive 72,806ms   content 31,933 bytes
x-vercel-id: fra1::iad1::…
```

**Thirty-one kilobytes took seventy-two seconds.** Time to first byte was fine. That shape is not
bandwidth and not a slow query plan — it is an RSC stream held open while the server is still
working. The response is small; the work behind it was not.

### What the work was

Uploaded photos are stored on the record as base64 data URLs. `getMenuCatalog` read the whole
catalogue, ran `toPublicImageUrl` over it, **threw the bytes away** and emitted short URLs. So every
page that showed a menu pulled every photo out of Mongo to discard it — and this deployment runs its
functions in `iad1` against a database that is not in `iad1`, so those megabytes crossed an ocean
first.

`findMenuImage` was worse. It loaded the entire catalogue and scanned it for one id, so a menu of
twenty photographed dishes made twenty image requests and *each* dragged all twenty pictures across
to return one. Quadratic in the number of photos, on the guest booking flow.

### Why it looked like an admin problem

It never was. The split was never admin versus guest — it was **reads the menu** versus **does not**:

| Reads the catalogue | Does not |
|---|---|
| `/admin`, `/admin/service`, `/admin/analytics`, `/booking/menu` | `/admin/pass-keys`, `/booking/date`, the pass-key screen |

Every page in the left column was slow and every page in the right column was fast. `/admin/pass-keys`
being quick looked like proof that the reservation reads were at fault, because pass-keys does not
read reservations either. Both columns were consistent with two different theories, and the
reservation one was picked because §3.1 had already made it plausible. The guest flow is what broke
the tie: `/booking/menu` reads no reservations at all and was just as slow.

### The fix

The public URL is built **inside the database** now, from `_id` and `updatedAt`, so the bytes never
move. `findMenuImage` reads the single record and selects only `imageUrl`. The menu editor still
receives real data URLs — it hands the current picture back to the uploader — via
`getFullMenuCatalog(menu, { withImageData: true })`, and it is the only caller that asks.

`lib/services/menu-images.mongo.test.ts` pins it, because this is easy to undo by accident: putting
the raw field back changes nothing visible on screen and makes every page slow again.

### Still worth doing

**Pin the function region to the database's.** `x-vercel-id: fra1::iad1` says the functions run in
Washington while the edge that served them is Frankfurt. Nothing in this repo sets a region, so they
landed on the default. Every query still pays that crossing — the fix above removed the megabytes,
not the distance. Set `preferredRegion` (or a `vercel.json`) to whatever region the Atlas cluster is
in. This needs the cluster's region, which is a dashboard fact nobody has stated yet.

**Consider moving photos out of the documents.** Storing images in the row they describe is what
made this possible; a blob store or GridFS with the record holding only a key would make the whole
class of bug unavailable. That is a migration, so it is out of scope here — but it is the real
answer if the menu grows.

### What this note should have done differently

Three theories were argued confidently and two were wrong: the paused cluster (§1.1), then a region
mismatch, then the reservation reads (§3.1). Each was reasoned from the code and each fitted the
evidence available at the time. What actually resolved it was one HAR capture, which took a minute
to read and pointed at the answer immediately — the `wait`/`receive` split ruled out three of the
four candidate explanations on its own.

**Ask for a HAR before theorising.** It is cheaper than being wrong twice.
