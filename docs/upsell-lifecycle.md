# Upsell lifecycle — what holds, and what does not

Written before freezing this codebase as the base for a paid product. A promotion is the only
thing in this app that money changes hands over, so it is the part where a quiet bug is
expensive rather than embarrassing.

Everything below was **checked by running it**, not by reading the code. The tests live in
`lib/services/upsell-lifecycle.test.ts`,
`app/api/admin/reservations/[reservationNumber]/add-ons/staff-add-ons.test.ts` and
`app/api/booking/add-ons/add-ons.test.ts`.

Of the four gaps found, **three are fixed**. Gap 1 is a feature to design rather than a bug, and
is left for whoever builds the product.

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
| 3 | Can it be oversold with limited quantity? | **Not applicable — the feature does not exist.** See Gap 1. |
| 4 | Is the selection correctly attached to the reservation? | **Yes**, priced and named from the catalogue by id. Prices and names sent by the browser are ignored. |
| 5 | Does cancellation remove the upsell? | **No, deliberately** — the line stays on the record. Revenue and kitchen prep exclude cancelled bookings instead. |
| 6 | Does restoration restore it correctly? | **Yes**, at the originally agreed price — even if the product has since been withdrawn. |
| 7 | Does the kitchen see it? | **Yes.** Service board, extras list and per-guest sheets all show it, and all drop cancelled bookings. |
| 8 | Are totals / reports correct? | **Yes.** Revenue, discount and take-up come from the stored figures, confirmed bookings only. |
| 9 | Can staff add / remove manually? | **Yes**, and wider than a guest can — reception may add anything. Every change is audited by name. |
| 10 | What if the price changes after selection? | **Nothing changes on the booking**, including when somebody later edits that booking. The second half was not true until Gap 4 was fixed. |
| 11 | Is the historical price preserved? | **Yes**, including the name — verified across a rename and a price rise. |

## Gap 1 — there is no quantity, anywhere — **deferred, deliberately**

A promotion has `active`, `price` and `discountPercent`. It has no stock, cap, or
per-evening allowance. **A promotion cannot be oversold because it cannot be limited**, so
question 3 has no answer in this codebase rather than a good one.

**Decided at the freeze: not now.** For the business this was built for — hotel guests choosing
a bottle with dinner — unlimited is the right model, and the evening-level on/off switch is the
only lever anyone has ever needed. It is recorded here as a known absence rather than an
oversight, so that nobody later reads the missing check as a bug and "fixes" it into a half
implementation.

When it does arrive, it is a feature to design rather than a check to add, and it is the one
that will need care. A cap means concurrent guests racing for the last unit, which is exactly
the shape of the seat accounting in `reservations.ts` — so it should reuse that lesson rather
than rediscover it: **a conditional update that claims the unit, never a read-then-write.**
The count belongs with the thing that claims it, not on the menu document; a catalogue is not
a ledger.

## Gap 2 — a cancelled booking accepted a chargeable item — **fixed**

The guest route required a confirmed booking. The staff route never checked, so reception could
add a bottle to a cancelled booking, receive `200`, and watch the line vanish from every report —
they all exclude cancelled bookings.

Nothing was over-charged, which is why it survived: it failed silently in the safe direction. But
the screen said yes and the money never appeared.

It now answers `409` with `RESERVATION_NOT_CONFIRMED` and says what to do instead — restore the
booking first, and then the line is real. "No" without "instead, do this" is how a rule ends up
worked around on paper.

## Gap 3 — a withdrawn product froze the rest of the booking — **fixed**

Every line in a request was re-resolved against the live catalogue, and one miss rejected the whole
set. Once the bar stopped offering a wine a guest already had, nothing else could be added to that
booking: asking for a dessert meant re-sending the wine, and the wine was gone.

## Gap 4 — the same bug, silently repricing — **fixed**

This one was not in the original list. It fell out of fixing Gap 3, and it is the expensive half.

Because every line was re-resolved, a product whose **price** had changed was quietly repriced on
the booking. Reception adding a dessert — touching nothing about the wine — moved that wine from
the 30 the guest agreed to to whatever the bar charges today. A probe measured exactly that:
`before: 30, after: 90`. Nothing on screen said the bill had changed.

It is the same root cause as Gap 3 and the same fix, which is why finding one found the other. Note
what it means: the codebase got the hard case right — a price rise never reached back into a
booking nobody touched — and got it wrong the moment anybody edited that booking at all.

### The fix for both

`lib/services/promotion-selection.ts`, used by both routes, which had carried identical copies of
the loop and therefore identical bugs.

**A line the booking already holds is carried through exactly as stored** — not looked up for its
price, not for its name, and not to find out whether the bar still sells it. Only genuinely new
choices are resolved against the catalogue and priced from it.

Repricing is still possible and now has to be meant: take the product off, put it back.

## What to keep true if this becomes a product

1. **Never re-derive an agreed price.** Every question above that came out right, came out
   right because of this.
2. **Cancelled keeps its lines.** Reporting filters; storage does not forget.
3. **Reception can override anything**, and every override is audited by name — "who put the
   Chardonnay on room 402's bill?" is the question the log exists to answer.
4. **The catalogue is not a ledger.** If limited quantity arrives, the count belongs with the
   thing that claims it, not on the menu document.
