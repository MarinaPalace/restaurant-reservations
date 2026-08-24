# Upsell lifecycle — what holds, and what does not

Written before freezing this codebase as the base for a paid product. A promotion is the only
thing in this app that money changes hands over, so it is the part where a quiet bug is
expensive rather than embarrassing.

Everything below was **checked by running it**, not by reading the code. The tests live in
`lib/services/upsell-lifecycle.test.ts` and
`app/api/admin/reservations/[reservationNumber]/add-ons/staff-add-ons.test.ts`.

## The rule the whole thing rests on

**What is stored on the reservation is what was agreed.** `courseName`, `optionName`, `price`,
`discountPercent` and `finalPrice` are copied onto the booking when the guest takes the
promotion, and nothing afterwards re-derives them from the catalogue.

That single decision is what makes most of the answers below come out right. It is also the
thing easiest to undo by accident, because "look the price up when you display it" reads like
a tidy-up and is not.

## Answers

| # | Question | Answer |
|---|---|---|
| 1 | Can an upsell be created / edited / disabled safely? | **Yes.** Each catalogue saves independently and ids are preserved, so a reservation pointing at a product keeps pointing at it. |
| 2 | Guest booking, promotion expires mid-flow? | **Handled.** Withdrawn product → `409`; evening's promotions switched off → `409 PROMO_CLOSED`. Giving one back is always allowed, so nobody is trapped holding something they declined. |
| 3 | Can it be oversold with limited quantity? | **Not applicable — the feature does not exist.** See below. |
| 4 | Is the selection correctly attached to the reservation? | **Yes**, priced and named from the catalogue by id. Prices and names sent by the browser are ignored. |
| 5 | Does cancellation remove the upsell? | **No, deliberately** — the line stays on the record. Revenue and kitchen prep exclude cancelled bookings instead. |
| 6 | Does restoration restore it correctly? | **Yes**, at the originally agreed price — even if the product has since been withdrawn. |
| 7 | Does the kitchen see it? | **Yes.** Service board, extras list and per-guest sheets all show it, and all drop cancelled bookings. |
| 8 | Are totals / reports correct? | **Yes.** Revenue, discount and take-up come from the stored figures, confirmed bookings only. |
| 9 | Can staff add / remove manually? | **Yes**, and wider than a guest can — reception may add anything. Every change is audited by name. |
| 10 | What if the price changes after selection? | **Nothing changes on the booking.** The agreed price stands. |
| 11 | Is the historical price preserved? | **Yes**, including the name — verified across a rename and a price rise. |

## Gap 1 — there is no quantity, anywhere

A promotion has `active`, `price` and `discountPercent`. It has no stock, cap, or
per-evening allowance. **A promotion cannot be oversold because it cannot be limited**, so
question 3 has no answer in this codebase rather than a good one.

For the current business — hotel guests choosing a bottle with dinner — unlimited is a
reasonable model, and the evening-level on/off switch is the only lever anyone has needed.

For a SaaS this is a feature to design, not a bug to fix, and it is the one that will need
care: a cap means concurrent guests racing for the last unit, which is the same shape as the
seat accounting in `reservations.ts` and should reuse that lesson (a conditional update that
claims the unit, never a read-then-write).

## Gap 2 — a cancelled booking still accepts a chargeable item

The guest route requires a confirmed booking. The staff route never checks. Reception can add
a bottle to a cancelled booking, receive `200`, and the line is written — and then ignored by
every report, because reports exclude cancelled bookings.

Nothing is over-charged, which is why this has survived: it fails silently in the safe
direction. But the screen said yes and the money never appears, and the only way to notice is
to notice an absence.

**Fix:** refuse a non-confirmed booking, or say plainly on screen that the booking is cancelled
and the line will not be billed.

## Gap 3 — a withdrawn product freezes the rest of the booking

Every item in a staff request is re-resolved against the live catalogue, and one miss rejects
the whole set. Once the bar stops offering a wine a guest already agreed to, **nothing else can
be added to that booking**: asking for a dessert means re-sending the wine, and the wine is
gone.

The only way through is to drop the wine — repricing a booking in order to add a dessert to it.
That is the wrong trade and it is the one the API forces.

**Fix:** resolve only items that are *new* to the booking against the catalogue, and carry
already-agreed lines through untouched, the way the reservation itself already treats them.

## What to keep true if this becomes a product

1. **Never re-derive an agreed price.** Every question above that came out right, came out
   right because of this.
2. **Cancelled keeps its lines.** Reporting filters; storage does not forget.
3. **Reception can override anything**, and every override is audited by name — "who put the
   Chardonnay on room 402's bill?" is the question the log exists to answer.
4. **The catalogue is not a ledger.** If limited quantity arrives, the count belongs with the
   thing that claims it, not on the menu document.
