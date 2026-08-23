# Backlog — decided, not yet built

Things that have been thought about and deliberately not started. Each entry says what it is, what it
would touch, and what has to be settled before anybody writes code. An idea with no entry here has
not been thought about; an entry here is not a commitment to build.

Read `HANDOVER.md` §2 first. Every plan below is constrained by it.

---

## 1. The reservation card — Apple Wallet, Google Wallet, and a scanner

**Status: planned, not started. Requested 2026-09.**

### What it is

A guest saves their booking to the wallet on their phone. At the door, a member of staff scans it and
the booking comes up — arrival time, party size, table, allergies — and can be marked seated in one
action.

### Why it is worth building

The pass-key already does the *authorisation* job. What it does not do is survive the walk from the
room to the restaurant: a guest who has closed the confirmation screen has a reservation number
written on nothing. A wallet card is a booking that is still there when the phone is opened at the
door, and it turns the arrival from "what name is it under?" into a scan.

It also closes the loop the service board already opened. The board's `seated` mark is the number
analytics rests on and it is currently typed by hand from a paper sheet; a scan is the same mark with
nobody typing.

### The shape it would take

**A pass, not a QR code in an email.** Both wallets take a signed bundle:

- **Apple**: a `.pkpass` — a zip of `pass.json`, images and a `manifest.json`, signed with a Pass
  Type ID certificate from an Apple Developer account. Served as `application/vnd.apple.pkpass`.
- **Google**: a JWT signed with a service-account key, describing an `EventTicketObject` against a
  class created once. The guest gets a "save" link rather than a file.

Two different formats over one internal record, which is the thing to get right first:

```ts
type ReservationPass = {
  reservationNumber: string;
  /** What the scanner reads. Not the reservation number — see below. */
  passToken: string;
  date: string;
  time?: string;
  guestCount: number;
  tableNumber?: string;
  roomNumber: string;
  /** Bumped on every change, so a stale card can be told from a current one. */
  version: number;
};
```

### The decisions that have to be made before any code

1. **The scanned token must not be the reservation number.** Guests read reservation numbers out to
   each other to share a table (README), so a scanner that accepted one would let any of those rooms
   check the party in. The card carries its own opaque `passToken`, generated per booking, and the
   scan endpoint resolves it — the same reasoning that made the pass-key rather than the reservation
   number the key to guest self-service (rule 2.5).

2. **A scan is an authorisation, not a lookup.** `POST /api/admin/service/scan` behind
   `service:record`, taking a token and returning the booking *plus* marking it seated in the same
   call — or refusing, with a reason a person at a door can act on: wrong evening, already seated,
   cancelled. A GET that returns a booking to anybody holding a token is a guest list.

3. **Cards go stale, and both wallets have a push channel.** Apple needs a web service URL and a
   registration table; Google needs the object patched. Deciding *whether to push* is the real
   question: a booking whose table changed at 18:00 has a wrong card in a pocket, and the honest
   options are push, or print nothing on the card that can change. **Recommend: no table number on
   the card at first.** It is the field most likely to change and the least useful to the guest, and
   leaving it off removes the whole update problem for version one.

4. **Both need paid accounts and secrets.** An Apple Developer Program membership and a Pass Type ID
   certificate; a Google Cloud service account with the Wallet API enabled. Neither is a code
   problem, both are lead time, and neither should be discovered halfway through the build.

5. **What happens with no phone.** A printed card with the same QR, produced from the same record.
   This must not become a feature only guests with a recent phone can use.

### What it touches

| Thing | What happens |
| --- | --- |
| `ReservationRecord` | Gains `passToken` and `passVersion`. Additive (rule 2.2). |
| Guest routes | `passToken` is **staff-and-owner only** — add it to `STAFF_ONLY_RESERVATION_FIELDS` unless the guest's own card needs it, and if it does, only on their own booking. |
| The service board | A scan is the same write `setReservationAttendance` already does. No new seat accounting. |
| Analytics | `attendanceCoverage` should rise sharply. That is the number to watch to know whether this worked. |
| Seat accounting | **Untouched.** A card is a view of a booking, never a claim. |

### Order of work

1. The internal `ReservationPass` record and the token, with the scan endpoint and its test. This is
   the half that has to be right and needs no Apple or Google account at all.
2. The scanner screen on the service board, using the device camera.
3. Google Wallet, which is the cheaper of the two to set up.
4. Apple Wallet.
5. The printed fallback.

**Do not start at step 3.** The wallets are the visible half and the least difficult; the token and
the scan authorisation are where a mistake means somebody else's dinner.

---

## 2. More than one restaurant

**Status: planned, not started. Raised 2026-09; see `docs/multi-restaurant.md` for the full plan.**

Summarised here so this file is the one list: every stored document and every settings key is
currently implicitly about *this* restaurant. Adding a second one is a migration, not a feature, and
the note beside this one sets out what it costs and when to do it.
