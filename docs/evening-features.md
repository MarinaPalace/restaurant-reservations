# Evening features — what is switched on, and for which night

**Status: built.** `lib/evening-features.ts` holds the model and the resolution; the switches are on
the date editor at `/admin`. Read `HANDOVER.md` §2 first — §2.2 (additive schema) decides the stored
shape, §2.5 (authorisation in the route) decides who may flip each switch, §2.1 (local dates) decides
what "this evening" means.

---

## 1. What was asked for

> I am not sure if I want to turn this on right now. I want to be able to turn it on and test. But
> along with the settings (on/off) each date must be able to select what to turn on/off. Maybe I will
> want for Thursday the guests to not be able to choose a table or promo menu. I want to test it
> first without breaking the current reservation system. I will open a future date and make a
> pass-key for just that date so no one else sees it. But meanwhile this must not break my current
> system.

Two things, and the second is the acceptance criterion for the first.

---

## 2. The thing to get right, before anything else

**A restaurant that never opens this screen must not be able to tell it was built.**

That is not a nice-to-have, it is the whole point: the feature exists so that something new can be
tried *without* the trying being visible to anybody booking tonight. A per-evening switch that
changed the behaviour of evenings nobody switched would be worse than no switch at all.

It is bought with one decision, made in the type rather than in a comment: **an evening stores only
what it says differently, and absent means inherit**. Every date that already exists carries no
overrides, so every one of them resolves to the restaurant defaults, and the defaults are exactly
what the app did before — promotions on, self-service on, table selection off.

### Three states, not two

Each switch is `on`, `off`, or **"whatever the restaurant says"**. The third is not a missing value,
it is a real answer and the one nearly every evening gives.

A boolean could not tell it from `off`. An evening that had been silently pinned to today's default
would stop following the restaurant-wide setting the moment somebody changed it — the setting would
quietly stop applying to the evenings that never opted out of it, which is the failure this shape
exists to make unrepresentable. `undefined` is inherit, everywhere, and `toEveningOverrides` returns
`undefined` rather than `{}` so that "follows the restaurant" has exactly one representation.

---

## 3. What can be switched

| Switch | Values | Restaurant-wide default | Who may change it |
| --- | --- | --- | --- |
| `tableSelection` | off / optional / required | `off` | `floorplan:edit` |
| `promotions` | on / off | `on` | `menu:edit` |
| `selfService` | on / off | `on` | `dates:manage` |

The booking cutoff (`bookingCutoffHours`) was already per-evening and stays where it is — it is a
number rather than a switch, and rule 2.2 says schema changes are additive. It is grouped with these
in the editor because it answers the same kind of question.

### A permission per switch, not per screen

Deliberately **not** `dates:manage` for all three. Opening an evening and deciding that guests pick
their own tables are different decisions by different people, and the floor-plan route already draws
that line: whoever prices the wine list has no business turning table selection on.

So both routes — the date save and the restaurant defaults — work out **which switches a save
actually moves** (`changedFeatures`) and ask for a permission for each one. An ordinary save of an
evening nobody is re-policying needs nothing beyond `dates:manage`, which is what it always needed.

Clearing an override counts as a change even when the restaurant currently agrees with it: `off` and
"follows the restaurant, which is off today" are different states, and only one of them moves when
the setting does.

---

## 4. Where it is stored

- The evening's own overrides live on the date document, under `features`. Absent on every date
  written before this, which reads as inheriting.
- `promotions` and `selfService` defaults live in one settings document,
  `restaurant.eveningToggles`.
- `tableSelection`'s default is **`restaurant.floorPlanMode`, unchanged** (`docs/floor-plan.md` §15).
  Moving a live setting into a new document to make one type tidier is a migration bought with
  nothing.

`getEveningDefaults` reads both halves and hands back one object, for the same reason
`getTableSelection` reads the mode and the plan together: a caller holding one half and guessing the
other is a caller that can disagree with itself.

---

## 5. Resolving, and the one function that does it

`resolveEveningFeatures(defaults, overrides, plan)`. Nothing reads a stored switch raw.

Three things happen together, which is why it is one function and not three lookups at the call site:

1. The evening's own answer wins where it has one.
2. Everything else inherits the restaurant.
3. Table selection goes through `resolveFloorPlanMode`, so an evening set to "guests must choose"
   against a plan with nothing bookable comes back **off** — rather than asking every guest to pick
   from an empty room and then refusing them. Both routes refuse to *store* that case, but a plan can
   be emptied afterwards, so it is resolved on every read.

Anything unreadable resolves to **inherit**, never to a guess. The failure mode of an unparseable
evening is that it behaves like the restaurant, which is the only safe direction.

---

## 6. What actually changes for a guest

| Switch | Where it is enforced | Where the screen respects it |
| --- | --- | --- |
| `promotions` | `POST /api/booking/add-ons` — 409 `PROMO_CLOSED` | the confirmation screen hides the picker; the manage screen hides the swap |
| `selfService` | `canGuestModify`, called by both manage routes — 409 `CHANGES_CLOSED` | the manage screen shows the reception message instead of the buttons |
| `tableSelection` | **nothing yet** — see §8 | nothing yet |

Two details worth keeping:

**Giving a promotion back is always allowed.** The offer being closed is a reason not to sell
somebody a bottle of wine, never a reason to trap them with one they have already decided against.
The route only refuses a non-empty list, and an empty list is the shape both "I decline" and "remove
it" arrive in.

**Self-service is checked before the deadline.** An evening that sends its guests to reception is a
standing arrangement, not a thing that runs out at a particular hour, and telling somebody "changes
close four hours before" when they were never going to be able to change it online is a wrong answer
dressed as a helpful one.

**Staff are never bound by any of it**, the same way rule 2.21 exempts them from the booking cutoff.
Reception can still add a promotion to a booking on an evening that is not offering them.

---

## 7. What the guest routes hand out

`/api/restaurant/dates` and `/api/restaurant/dates/[date]` return each evening's switches
**resolved** — what is actually true for that night — rather than the raw overrides it happens to
store. A screen handed "this evening says nothing" would have to know the restaurant defaults to make
sense of it, and a second reader of the same two halves is a second chance for them to disagree.

The confirmation screen fetches its own evening rather than being handed it, because the page cannot
know which evening it is: the booking lives in `sessionStorage` and is read in the browser. It starts
as "offered" — what every evening says unless somebody switched it off — so the ordinary confirmation
renders exactly as it always did, with no flash of a missing offer in front of the number the guest
came for. A failed fetch leaves the offer showing: hiding promotions because of a network blip would
cost the restaurant a sale, and the route is the gate either way.

---

## 8. What this does **not** do yet

**Turning `tableSelection` on for an evening currently changes nothing a guest sees.** The guests'
picker is `docs/floor-plan.md` §12, still not started, and the table claim is §9 step 3 — the step
that touches seat accounting, which §2 of that note says to write the concurrency test for first.

So the switch resolves correctly, is stored correctly, and is refused correctly against an empty
room. There is simply nothing downstream reading it. `promotions` and `selfService` are the two that
can be tested against real bookings today.

---

## 9. How to try something on one evening

1. Open a future date in `/admin` and set its capacity as usual.
2. Under **What is switched on**, change only that evening's switch. Everything else stays on
   "Follow the restaurant".
3. Issue a pass-key whose `expiresOn` falls on or before that date — `isDateWithinStay` already
   confines a key to its own stay, so the key cannot book any other evening.
4. Book with it.

Nothing about tonight's evenings changed at any point, because none of them say anything.

---

## 10. What was verified

Unit tests over the whole model: inheritance, an evening overriding in both directions, the empty-room
degradation, unreadable input reading as inherit, "says nothing" having one representation,
`changedFeatures` including the clear-to-inherit case, and the defaults reading as the app-as-it-was.
The payload guard test in `lib/restaurant-date-form.test.ts` — the one that exists to catch a field
added to the schema and forgotten on the wire — caught `features` and now carries it.

`tsc`, `eslint`, `next build` and the full suite (786 tests) are clean. **Not driven against a
running server**: the 403s per switch, the audit lines and the guest-facing 409s are exercised by the
tests and by reading, not by a browser.

---

## 11. The editor, made compact

The panel had a paragraph under every control. Each was worth writing and none was worth reading
twice, and together they turned something reception opens dozens of times a day into something that
has to be scrolled.

**Explanation that is only needed the first time moved behind a tip** — `components/ui/tooltip.tsx`.
A number that changes stayed on the screen: "8 taken" under the seat count, and the cutoff still
spells itself out as "guests may book until 15:00, then reception only", because that is derived from
two other fields and is the whole point of the control.

The tip shows on **hover and focus, and is never a click to pin**. A pinned tooltip needs dismissing,
which means a click-outside listener, an Escape handler, and a way of being left open over the
control it describes. Hover plus focus covers every input with none of that: a pointer hovers, a
keyboard tabs, and a touch tap focuses — which is why the trigger is a real `<button>` and not a
styled span. `aria-describedby` ties the text to the control, so a screen reader reads it as part of
the field rather than as a stray paragraph.

`Field`, `Input` and `Select` gained a `compact` variant. A guest fills a booking form once and wants
room to breathe; reception opens this forty times a day and wants the whole evening on one screen.

### Advanced, and when it refuses to fold

The cutoff and the feature switches are set on the rare evening that wants them and never touched
again, so making everybody scroll past them is a cost paid daily for a decision taken once. They are
folded away — **but the fold opens by itself whenever the evening has anything to say**, meaning a
cutoff above zero or any override of its own.

Hiding a setting that is not at its default is how somebody comes to wonder why one Thursday behaves
differently from every other and finds nothing on the screen to explain it. Folded has to mean
"nothing unusual here", or the fold is a lie. The header says what is inside it either way.

### Two grains, one list

The three switches can be set for this evening or for every other one, and they are now the same list
with a tab above it rather than two stacked lists. Showing them apart meant repeating every label and
every explanation, and hid the thing actually worth understanding: that an evening inherits until it
says otherwise.

Each is a `<select>` rather than a row of buttons, because "Follow the restaurant (Staff only)" is a
phrase, and four of those wrapped across a narrow panel is most of its height. The inherited answer
is still named on the option, so "follow the restaurant" is never a state somebody has to go and look
up — §3 of this note, unchanged.
