# More than one restaurant — what it costs, and when to do it

**Status: assessed, not started. Raised 2026-09.**

> The app for now is working fine, but what if we have more than 1 restaurant? I think this must be
> implemented better now, than later, because it can break everything from now. This restaurant is
> going to work just 2 more weeks then closing for the winter, maybe the best time for the migration
> will be then.

The instinct is right and so is the timing. This note says why, what exactly has to change, and what
the cheap version costs against the expensive one.

Read `HANDOVER.md` §2 first — §2.1 (local dates), §2.2 (additive schema), §2.5 (authorisation in the
route) and §2.7 (seat accounting) each constrain a different part of this.

---

## 1. Why this gets more expensive every week, not less

Nothing in the app says which restaurant it is about, because there has only ever been one. That is
not sloppiness — it was the correct decision for one restaurant — but it means **the restaurant is
currently expressed as "the whole database"**, and every document written between now and the
migration is another row that has to be given an owner retroactively.

The cost is not in the code. It is in three specific places where "one restaurant" is baked into
something a migration cannot simply add a column to:

### 1.1 Four unique indexes are globally unique

| Index | Today | With two restaurants |
| --- | --- | --- |
| `restaurantDate.date` | one row per date | **breaks** — both restaurants open the 4th |
| `appSetting.key` | one currency, one floor plan | **breaks** — one plan for two rooms |
| `passKey.code` | globally unique | *survives*, but a key must not open the wrong restaurant |
| `reservation.reservationNumber` | globally unique | *survives*, and should stay that way |
| `tableClaim.(date, tableId)` | one claim per table per evening | **breaks** unless `tableId` is already per-restaurant |

The first two are the migration. They are not "add a field" — they are *drop the index, add a
compound one, and backfill every existing row* before the new index can be built.

### 1.2 Every settings key is a singleton

`promo.currency`, `restaurant.timeZone`, `restaurant.floorPlan`, `restaurant.floorPlanMode`,
`restaurant.eveningToggles`. Each is one document keyed by a string, and each is read by a
`get…` that supplies its own default. Two restaurants need two of each, which means the key becomes
`(restaurantId, key)` and every reader has to know which restaurant it is asking about.

**This is the part that "can break everything"** in the sense meant above: a reader that forgets the
restaurant does not fail, it silently returns the *other* restaurant's answer. A wrong currency on a
wine list, or a floor plan of somebody else's room.

### 1.3 The time zone is assumed to be the server's

`docs/timezones.md`: every deadline in this app reads the server clock and assumes it runs in the
restaurant's zone. Two restaurants in two zones makes that assumption false rather than merely
fragile, and the failure is a guest told "19:00" for a sitting the server thinks is 19:00 somewhere
else. This is the one item that is a genuine behaviour change rather than a schema change.

---

## 2. What "a restaurant" would be

```ts
type Restaurant = {
  id: string;
  /** In the address: /r/marina-palace/booking. Stable; renaming breaks links. */
  slug: string;
  name: string;
  timeZone: TimeZone;
  /** Everything currently in the settings store, per restaurant. */
  settings: { currency: Currency; floorPlanMode: FloorPlanMode; /* … */ };
};
```

And **`restaurantId` on every tenant-scoped document**: reservations, dates, pass-keys, menu courses
and options, table claims, audit entries, app settings. Staff users are the interesting exception —
see §4.

---

## 3. Two ways to do it, and which one to take

### 3.1 One database, a column on every row (recommended)

Add `restaurantId` everywhere, make every index compound, and thread it through the service layer.

- **Cost:** one migration, and a change to nearly every function in `lib/services/`.
- **Risk:** a query that forgets the filter reads another restaurant's data. Real, and mitigable —
  see §5.
- **Operationally:** one database, one deployment, one backup. Adding a restaurant is a row.

### 3.2 A database per restaurant

`MONGODB_URI` resolved per request from the slug.

- **Cost:** almost no application change. The models and services are untouched.
- **Risk:** a forgotten filter becomes *impossible* rather than merely unlikely, which is a genuine
  advantage.
- **Operationally:** worse in every other way. A migration runs N times, a backup is N backups,
  cross-restaurant analytics needs a fan-out, and connection pooling on serverless gets harder with
  every restaurant added.

**Recommend 3.1.** The isolation 3.2 buys is real but it is bought with permanent operational cost
for a problem that a repository-layer discipline solves once (§5). 3.2 is the right answer only if
the restaurants are separate businesses with separate owners who must never see each other's numbers
— which, for a group under one hotel, they are not.

---

## 4. Staff, and the thing not to get wrong

An account should belong to **one or more restaurants**, with its permissions **per restaurant**. A
head office admin holds every restaurant; a waiter holds one.

That means `StaffUserRecord.permissions` becomes `Record<restaurantId, StaffPermission[]>`, and
`hasPermission(user, permission)` becomes `hasPermission(user, restaurantId, permission)`. Every
route that calls `requireStaff("x")` must become `requireStaff(restaurantId, "x")` — and the
restaurant has to come from the *route*, never from the request body, or the permission check is
checking the wrong thing.

**This is the highest-risk part of the whole migration**, higher than the schema, because getting it
wrong is a member of staff at one restaurant cancelling a booking at another. It should be the piece
that gets the tests written first, the way the table claim just was.

---

## 5. The discipline that makes 3.1 safe

A forgotten `restaurantId` filter is the failure mode. Three things reduce it to near zero, and all
three are cheap **if they go in at the start**:

1. **No route talks to a model.** Services take `restaurantId` as their first argument and are the
   only thing that touches Mongoose. This is already almost true.
2. **The id comes from the URL**, `/r/<slug>/…`, resolved once in a layout or middleware and passed
   down. Never from a body, never from a header a client controls.
3. **A test that walks every service function** with two restaurants seeded and asserts each one only
   ever sees its own. It is the multi-tenant equivalent of the concurrency test in
   `lib/services/table-claims.mongo.test.ts` — one file, and it catches the whole class.

---

## 6. When

**The winter closure is the right window, and it is the only good one.**

Not because the migration is long — it is perhaps a week of careful work — but because of what it
needs that a live service cannot give:

- **A moment with no bookings in flight.** Backfilling `restaurantId` and rebuilding four unique
  indexes is not something to do while somebody is claiming the last table. It does not need a
  maintenance window if done carefully, but *wanting* one is a much better position than needing one.
- **Room to get the staff permissions wrong once.** §4 will not be right first time.
- **No cost to a rollback.** Restoring a backup during the closure loses nothing. Restoring one on a
  Saturday in season loses an evening's bookings.

### The order

1. **Before the closure — nothing.** Do not start half of this while the restaurant is serving. A
   half-migrated schema is worse than either end of it. Keep building features; every one of them is
   a few more rows to backfill and that is a much smaller cost than a rushed migration.
2. **Week one of the closure:** the schema. `restaurantId` everywhere, compound indexes, the backfill
   script, and the isolation test from §5.3. Verified against a restored copy of production, not
   against a fresh database — the interesting failures are all in the existing rows.
3. **Week two:** staff and permissions (§4), and the routing (`/r/<slug>`). Tests first.
4. **Then:** the time zone assumption (§1.3), which is the only behaviour change and wants its own
   attention.
5. **Last:** a second restaurant, in the admin, as a row. If steps 1–4 are right this is an
   afternoon; if it is not, one of them was not.

### What to do *now*, in the two weeks before

Nothing structural. But two habits from today cost nothing and save a day each later:

- **Any new stored document gets a `restaurantId` from the start**, defaulted to the one restaurant.
  A column that is already there is not a migration.
- **Any new settings key goes through `lib/services/settings.ts`** rather than reading the store
  directly, so there is one place to add the scope.

---

## 7. What this does *not* need

- **A rewrite.** Nothing about the domain is wrong. `docs/floor-plan.md`, `docs/evening-features.md`
  and the seat accounting are all correct for one restaurant and stay correct for many.
- **A different database.** Mongo is fine for this shape.
- **Deciding it now.** The plan above is reversible until step 2 begins. What is *not* reversible is
  starting it mid-service, which is the one thing this note exists to argue against.
