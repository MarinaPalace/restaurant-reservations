# Time zones — design note

**Status: partly built, one thing to verify, one thing to fix, one thing to decide.**

- **Built:** the `restaurant.timeZone` setting, the labels (`Sofia time (UTC+3)`), and the
  dashboard's clock-mismatch warning. Shipped in the promotions PR.
- **To verify:** whether calendar reminders are correct on Vercel. See §4. It is correct locally;
  that is not evidence.
- ~~**To fix:** the warning's wording.~~ **Done** — `describeClockMismatch` now says bookings are
  unaffected and names the four things that genuinely depend on the clock. §5 keeps the reasoning.
- **To decide:** how time zones work once there are tenants. See §7. Not now.

Read `HANDOVER.md` §2.1 and §2.16 first.

---

## 1. The one thing to understand

There are **two kinds of time** in this app, and almost every mistake here comes from treating them
as one kind.

### Stored strings — timezone-free, and safe

`ReservationRecord.date` is `"2026-08-25"`. `ReservationRecord.time` is `"19:00"`.
`RestaurantDateAvailability.serviceTime` is `"19:00"`.

These are **plain strings**. Staff type them meaning the restaurant's local wall clock, they are
stored exactly as typed, and they are displayed exactly as stored. No conversion happens anywhere,
in either direction.

**This is why changing the server's `TZ` is safe.** It rewrites nothing, moves no booking, and
shifts no time a guest has been told. Anybody who is nervous about changing it — reasonably, since
production data is involved — can stop being nervous about *this* part.

It is also why labelling `19:00` as *Sofia time (UTC+3)* is correct **today**, on a UTC server: the
string means what staff meant when they typed it, and the label says which clock that was.

### Computed instants — derived from the server clock, and not safe

Four things build a real `Date` from those strings, and a `Date` is an instant, which means it is
interpreted in **the server's zone**:

```ts
// lib/calendar.ts
const start = fromDateKey(dateKey);   // new Date(y, m-1, d, 12) — server-local
start.setHours(hour, minute, 0, 0);   // server-local 19:00
```

Whatever zone the process is in, that is the 19:00 it means. The four consumers:

| What | Where | Effect if the server clock is not the restaurant's |
| --- | --- | --- |
| Calendar reminders (`.ics`, Google) | `buildIcsFile`, `buildGoogleCalendarUrl` → `toCalendarStamp` | The reminder fires at the wrong hour |
| Self-service change deadline (12h) | `getModificationDeadline` | Guests lose, or keep, self-service for the wrong window |
| Guest booking cutoff | `canGuestBookDate` (rule 2.21) | Bookings close at the wrong hour |
| "Is this date past?" | `todayKey`, `isPastDateKey` | Wrong for the hours between midnight in the two zones |

`toCalendarStamp` is the clearest case, because it converts explicitly:

```ts
// lib/calendar.ts
return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
```

It emits a UTC instant. That conversion is **correct if and only if the process clock is the
restaurant's clock** — which is exactly the assumption rule 2.1 is built on.

---

## 2. Where the app assumes the server is the restaurant

Rule 2.1 says dates are local calendar strings, and everything above follows from it. The
assumption is not a bug; it is a deliberate simplification that is right for one restaurant, and it
is stated in the handover.

What was never written down is the **deployment obligation** it creates: the process must run in
the restaurant's zone. On a laptop in Sofia that is true by accident. On Vercel it is not — Vercel
functions run in **UTC** unless `TZ` is set.

That gap is the whole of this note.

---

## 3. What is *not* affected, so nobody re-litigates it

- **Stored `date` / `time` / `serviceTime`** — strings, §1.
- **`createdAt`, `updatedAt`, `usedAt`, `AuditEntry.at`** — genuine ISO instants, absolutely
  correct in any zone. Only their *rendering* changes, and rendering them in the restaurant's zone
  is more correct, not less.
- **Seat accounting** — counts, no time in it (rule 2.7).
- **Pass-key `checkInOn` / `expiresOn`** — date keys, compared as strings.

---

## 4. Verify before believing either of us

**A local test proves nothing here.** A development machine in Sofia produces correct output
because the assumption in §2 happens to hold; the same code on Vercel need not. This was tested
locally and the export was right, which is exactly the result a UTC-server bug would still allow.

**The check**, on production, for a sitting whose arrival time is `19:00`:

1. Open a confirmation and download the `.ics`.
2. Look at the `DTSTART` line.

| `DTSTART` | Meaning |
| --- | --- |
| `...T160000Z` | Correct — 19:00 Sofia in summer. The clock matches. |
| `...T190000Z` | The process is in UTC. Reminders fire three hours late. |

The dashboard's mismatch warning is a second signal: **if it is showing on production, the process
is not in the restaurant's zone**, and the `.ics` is wrong by the same offset.

Do this before changing anything. If `DTSTART` is already `T160000Z`, `TZ` is set somewhere already
and there is nothing to fix.

---

## 5. The single-tenant fix

If §4 shows the process is in UTC:

**Set `TZ=Europe/Sofia` in the Vercel project's environment variables and redeploy.**

That is the whole change. It rewrites no data (§1), makes all four computed things in §1 correct,
and makes the dashboard warning agree with reality so it stops showing.

Do it in a preview deployment first and repeat the §4 check there.

### And fix the warning's wording — done

`describeClockMismatch` in `lib/timezone.ts` used to say:

> Every time shown to a guest is worked out from the server's clock, so they are being labelled with
> the wrong zone.

**That is over-broad and it is wrong.** The arrival time on a confirmation is a stored string
(§1) and is *not* worked out from the clock; labelling it is correct regardless. The sentence
caused real hesitation about a change that was safe.

It now names the four things in §1 that genuinely depend on the clock, and says plainly that stored
times and bookings are unaffected. The detection logic was always right; only the explanation was
wrong.

---

## 6. Why this was easy to get wrong

Worth recording, because the next person will hit it too:

- It is **invisible in development**, where the assumption holds.
- The visible surfaces — the arrival time on the confirmation, the times on the sheet — are the
  strings, which are always right. The broken surfaces are a downloaded file and two deadlines,
  none of which anybody looks at while building a feature.
- Nothing in the test suite catches it: every test runs in the machine's own zone, so the
  assumption holds there too. **A test that pins this would have to force `TZ`**, which vitest can
  do per-file via `process.env.TZ` before importing — worth adding alongside the fix.

---

## 7. Tenants — the real question

The instinct that "UTC is fine for the server, and each tenant picks their own zone" is **right as
a destination and impossible as a setting**. One process has one clock. As soon as two tenants are
in different zones, no value of `TZ` is correct for both, and §5 stops being a fix.

The proper approach, when tenants arrive:

**Stop reading the server clock. Pass the zone in.**

- `getReservationWindow(dateKey, serviceTime, serviceEndTime)` gains a zone parameter and builds
  the instant in *that* zone rather than via `new Date(y, m, d)` + `setHours`.
- `todayKey()` / `isPastDateKey()` gain a zone parameter — "what day is it?" has no answer without
  one.
- `getModificationDeadline`, `canGuestBookDate` and `toCalendarStamp` inherit it from the window.
- The tenant's zone comes from the tenant record, not from a global setting, and `restaurant.timeZone`
  becomes that record's field.

Two implementation notes:

- **Converting a wall-clock time in a named zone to an instant** is the one genuinely awkward
  operation in JavaScript without a library. `Intl.DateTimeFormat` with `timeZone` can format an
  instant, but going the other way needs either the offset-probe trick or `Temporal`
  (`Temporal.ZonedDateTime`, still not universally available in Node LTS at time of writing). Check
  what the runtime offers before hand-rolling it; if hand-rolling, put it in **one** function with
  DST-boundary tests, the way `lib/date.ts` already guards its own primitives.
- **Stored strings stay strings.** Multi-tenancy does not change §1. A tenant's `19:00` is still
  `19:00`; what changes is only which zone it is resolved *into* when an instant is needed.

Until then: one tenant, one clock, `TZ` set to match. That is a correct system, not a compromise —
it just needs the obligation written down, which is what §2 is for.

---

## 8. Summary

| Question | Answer |
| --- | --- |
| Will changing `TZ` move existing reservations? | **No.** Dates and times are stored as strings. |
| Is the Sofia label wrong on a UTC server? | **No** for the arrival time; it is a stored string. |
| Is anything actually wrong on a UTC server? | Calendar reminders, two deadlines, and "is it today". Verify with §4. |
| What is the fix now? | `TZ=Europe/Sofia` on Vercel. One variable, no migration. |
| Does that scale to tenants? | **No.** §7 — pass the zone in, stop reading the server clock. |
| Should we do §7 now? | No. Do it when tenants exist and the requirement is real. |
