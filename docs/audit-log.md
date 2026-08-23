# The log — who changed what, and who may read it

The audit log was built early and worked from the start: `recordAuditEntry` in
`lib/services/audit-log.ts`, the append-only `lib/models/audit-entry.ts`, `AuditAction` in
`types/booking.ts`, and `app/api/admin/audit/route.ts`. What it did not have was **coverage** and
**detail**: two routes wrote to bookings without leaving a trace, and the entries that did exist
said *that* something changed rather than *what*.

This note is the answer to both, and the list nobody should have to reconstruct by grepping.

---

## 1. Two rules that constrain everything here

- **A failed log write must never fail the action being logged.** `recordAuditEntry` swallows its
  own errors and reports them to the server console. Losing the record of a cancellation is bad;
  failing the guest's cancellation because the log was unreachable is worse. Nothing awaits it into
  a transaction.
- **Append-only.** Nothing edits or deletes an entry — not a redaction tool, not a cleanup script.
  If retention is ever needed it is a decision to make deliberately, in this file, first.

---

## 2. Every path that touches a booking, and what it writes

| Route | Action | Entry |
| --- | --- | --- |
| `POST /api/reservations` | `reservation:create` | The guest's own booking, actor is the pass-key. |
| `POST /api/premium/reservations` | `reservation:create` | An invitation booking. |
| `POST /api/admin/reservations` | `reservation:create` | Taken at the desk, actor is the account. |
| `PATCH /api/admin/reservations/[n]` | `reservation:update` | **Field by field** (§3). Nothing written when nothing moved. |
| `DELETE /api/admin/reservations/[n]` | `reservation:delete` | Names the date, room and party, since the record is about to stop existing. |
| `POST …/[n]/cancel` | `reservation:cancel` | Also denormalised onto the record itself as `cancellation`. |
| `POST …/[n]/restore` | `reservation:restore` | |
| `POST …/[n]/table` | `reservation:table` | **Added.** Was writing a table and leaving no trace. |
| `POST …/[n]/add-ons` | `reservation:update` | Staff setting promotions — it changes what a guest is charged. |
| `PATCH …/[n]/service` (attendance) | `reservation:attendance` | Seated, no-show, or cleared. |
| `PATCH …/[n]/service` (staff note) | — | **Deliberately not logged**; see below. |
| `POST /api/booking/manage` | `reservation:update` | The guest's own edit, with the dishes named. |
| `POST /api/booking/manage/cancel` | `reservation:cancel` | The guest cancelling within the cutoff. |
| `POST /api/booking/add-ons` | `reservation:update` | **Added.** A guest taking or returning a promotion. |
| `POST /api/booking/manage/table` | `reservation:table` | **Added.** A guest moving themselves to another table. |

Outside bookings, the same log carries `passkey:*`, `user:*`, `menu:save`, `settings:save` and
`date:update`, each written by its own route.

**The one deliberate gap.** The staff note on the service board is not audited, and that is a
decision rather than an oversight — `docs/service-tracking.md` §4 has the reasoning: it is an
observation made at the table during service, it is visible on the booking, and putting every one
of them in the log would bury the cancellations and refunds it shares a list with.

**Signing in and out are not logged either.** `/api/admin/login` and `/api/admin/logout` write
nothing. That is a real gap for a different question — "who was signed in when this happened?" —
and it is not this one; a session log belongs with rate limiting and lockout, not with a list of
what happened to bookings.

---

## 3. Say what changed, not that something changed

"Updated reservation" is not a log. It records that somebody touched something and leaves the only
question anybody ever asks unanswered.

`lib/reservation-changes.ts` turns a before and an after into a list of named fields:

```
Table 12 → 7
Party 4 → 6
Kitchen note set to nut allergy
Table cleared (was 9)
```

Pure and tested without a database, because the awkward cases are all shapes of data — blank
against absent, the same dishes in a different order, a contact who moved from a telephone call to
WhatsApp — and those are exactly what is worth testing without a browser.

**Worked out from the two records, not from the patch.** The patch says what was *sent*; the pair
says what actually changed. Sending a table number that is already set is not a change, and the old
code logged it as one.

**Stored twice, on purpose.** `summary` is the sentence, as it always was — every entry ever
written has one and must keep rendering. `changes` is the same thing structured (rule 2.2:
additive, never a rename), so the history panel can draw *what became what* rather than parsing
prose to find out. An entry with `changes` renders them under a short action heading; an entry
without falls back to its sentence.

**What it deliberately does not diff:** `service` and `attendance`, which have their own actions and
their own words, and `updatedAt`, which changes on every write and would make every entry claim a
change nobody made.

---

## 4. Every entry names a version

A booking carries a `version`: how many times it has been written, creation
included, bumped by `$inc` in the same update as the change it counts (rule
2.7). Every audit entry records the version it **produced**.

That pairing is the whole point. A history of six entries beside a record with
no version leaves the only structural question unanswered — *is this the record
the last entry made, or has something happened since?* With both numbers on
screen it is answered by reading them.

```
v3  Table cleared (was 2)      Guest in room 505
v2  Table 1 → 2                Guest in room 505
v1  Booked 2 guest(s) …        Room 505
```

**A booking written before versions existed has none**, and lands on 1 with its
next write. That looks like a creation and is not one; what makes it harmless is
that the entry for that same write carries the same 1, so entry and record still
pair. Both stores agree on this deliberately — the local store's `nextVersion`
matches what Mongo's `$inc` does to a missing field.

**The menu is versioned too**, one counter per catalogue (`standard`, `premium`,
`promo`), in settings rather than on the document, and named in the `menu:save`
entry: *"Saved the standard catalogue as v12"*. The editor shows it beside the
title, so "the starter changed in v12" is a sentence that can be said. Unlike
the booking counter this is a read-then-write, which is fine only because saving
a menu already replaces the whole catalogue — two people editing at once lose
each other's *courses* long before they lose a version number. If menu saving
ever becomes incremental, this has to move with it.

**Creating something records what it was created with.** A create entry used to
give the room, the date and the party size and stop, so the log could not answer
"what did they order?" or "which table did they pick?" about the moment the
booking was taken. It now carries the same field-by-field list an edit does —
the dishes counted rather than listed twice (*"12 dishes (2× Duck Magret, …)"*),
and the table among them.

---

## 5. Reading the log is a permission now

It used to be open to anybody signed in, on the reasoning that a log everybody can see is a log
everybody knows is there. That is right about logs and was wrong about this one: every entry names a
guest, a room and what they changed, so the whole of it read end to end is a guest list — and the
account left signed in on a tablet on the floor holds `service:record` and should hold nothing
else.

So `audit:read`, checked **in the route** (`app/api/admin/audit/route.ts`) and in the page that
renders a booking's history. `admin` holds every permission implicitly, so the owner keeps what they
had; an existing staff account has to be granted this deliberately, which is the intended
tightening rather than an accident of it.

On the reservation page the history is not merely hidden without the permission — it is never
fetched. A server component that fetches and does not draw has still read the data.

---

## 6. Verified against a running server

Driven by hand, not only by unit test (`HANDOVER.md` §7 on why):

| What was done | What the log said |
| --- | --- |
| Guest books table 3 with a pass-key | `Booked 2 guest(s) for 2026-08-25 with a pass-key.` |
| Owner moves it to 7 | `reservation:table` — **Table 3 → 7** |
| Reception moves it to 9 | `reservation:table` — **Table 7 → 9** |
| Reception clears it | `reservation:table` — **Table cleared (was 9)** |
| Owner adds a kitchen note | `reservation:update` — **Kitchen note set to nut allergy** |
| A `PATCH` that changed nothing | *no entry at all* |
| Waiter (`service:record` only) reads `/api/admin/audit` | `403 FORBIDDEN` |
| A guest moved their own table, twice, then gave it back | `v1` create · `v2` **Table 1 → 2** · `v3` **Table cleared (was 2)**, actor "Guest in room 505" |

One trap when driving it by hand: without `ADMIN_SESSION_SECRET` set, `next dev` signs sessions with
a per-process secret, and the page bundle and the route bundle end up with different ones — the API
accepts your cookie and every admin *page* bounces you to the login screen. `HANDOVER.md` §7 says to
set it; this is what it looks like when you do not.
