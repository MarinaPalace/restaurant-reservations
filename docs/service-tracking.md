

---

## 12. The sheet said how many, not how many of each

A cell reading **4** above "Amuse Bouche, Velouté" is a bug, not a summary. The kitchen cannot plate
four of something; it plates two of one and two of another, and the number that matters is the one
the cell was throwing away.

`BoardCourse.summary` had carried the counts all along — `{ optionName, count }[]` — and the sheet
rendered only the names, then `truncate`d them, so a narrow column lost most of those too. The cell
now prints one line per dish with its count, never truncated: the column grows and the sheet scrolls
sideways, which is what a sheet does. A dish nobody can read is the same as a dish that is not there.

The list view had the same truncation on its course chip. `2 × Salmon · 1 × Velo…` has lost the thing
it was for, so it wraps now instead.

---

## 13. A note only staff see

`staffNote` on the reservation. A different thing from `notes`, which the guest wrote and the kitchen
acts on: this is written *about* the booking by whoever is on the floor — "asked for the window next
time", "celebrating an anniversary", "was unhappy with the wine last time".

**Some of it would be mortifying to send to the person it is about**, which is the whole design
constraint. It is not enough for the guest screens not to render it: a guest can open the network
tab, so the boundary is the route.

### One list, one function, one test

`lib/guest-reservation.ts`. Every guest-facing route — the booking creation, the premium creation,
the manage GET and PATCH, the cancel, the add-ons — returns `toGuestReservation(record)` rather than
the record. The failure being guarded against is somebody adding the *next* staff-only field and
forgetting one of the six, so there is one named list, and a test walks a fully populated record
through it and fails if any listed field survives.

Deny-list rather than allow-list, deliberately. An allow-list is safer against a field nobody
classified, but it would silently stop sending fields guests legitimately read the moment one is
added — a bug that shows up as a blank on a guest's screen rather than as a failing test.

### Per booking, not per table

A shared table has several bookings and the note belongs to the room that earned it, so it follows
that room if the table is rearranged. The row shows one editor per booking, labelled by room only
when the table is shared.

Saved **on blur**, not per keystroke: a note is typed, not tapped, and a write per character would
put dozens of requests behind one sentence. Ctrl/Cmd-Enter commits for somebody who wants to be sure;
Escape abandons. The draft is held locally while the field has focus, so the twenty-second poll
cannot overwrite a sentence somebody is halfway through — `draft === null` meaning "nobody is
typing", the same trick the date editor's number fields use.

Guarded by `service:record` like the rest of the board, which is a choice rather than an oversight.
The note is an observation made at the table by whoever is standing at it; putting it behind
`reservations:edit` would mean the waiter who has the observation cannot record it, which is how it
ends up on a scrap of paper instead. Not audited, for the same reason a course going out is not — but
it *is* permanent, which is why the guest routes strip it.

It sits outside the seated gate, because "asked for the window next time" is worth writing about a
table that never turned up. The sheet shows notes read-only: it is for ticking, and typing a sentence
belongs in the view with room for it.
