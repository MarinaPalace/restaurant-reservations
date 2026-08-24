

---

## 14. Four tabs, three new charts, and one evening at a time

The page had become one column of everything, which meant the kitchen scrolled past occupancy and the
owner scrolled past dish counts. §2 already grouped the questions by who asks them; the screen now
does too.

**Overview / Guests / Kitchen / Pass-keys.** Each is read by a different person for a different
decision, and the one thing they share is the period — which is why the range picker stays above the
tabs. The tab is component state rather than the address, unlike the range: which section somebody is
looking at is not a thing they send to anybody, and the period is.

### Covers became a line

Columns say "these are the buckets, here is each one's total"; a line says "this is one thing, here
is its shape". Covers is the second kind, read for its direction rather than for the value of any
single Tuesday, and thirty columns is a picket fence in which no trend is visible at all. The
columns-with-capacity chart is still there underneath, because seats-offered-against-seats-taken is a
genuine two-measure comparison and belongs in bars.

### Comparison is the same hue, dashed

Opt-in, off by default: the stat tiles already carry the direction of travel, and a second line on
every chart nobody asked for is the difference between a chart that answers a question and one that
has to be studied.

The previous period is drawn **dashed and muted rather than in a second colour**. It is not another
category — it is the same quantity a month ago — and spending the identity channel on *when* would
say these are two different things. It is paired **by position**, not by date, because a comparison
is two different stretches of calendar by definition; both are folded on the same bucket size so the
pairing is meaningful.

### The stack is the one place a second colour is earned

Everything else here is single-hue on purpose (§ the module header): the app's accent and success
failed the categorical validator. A stack is the exception, because there is no length left to encode
the second thing with — so it uses the **ordinal accent ramp the funnel already uses**, which passed
the ordinal checks in both themes. Two or three series, never more. Every series is also named in the
legend with its own total, so nothing rests on telling two browns apart: colour is the shortcut, the
words are the answer.

### The shape of the week

A date-ordered chart cannot show it: the same Tuesday appears four times in a month, thirty days
apart. "Covers fell in March" and "Tuesdays are always empty" are different facts with different
answers, and only the second says which evening to stop opening.

**Averaged per evening open, not totalled** — a month with five Saturdays and four Mondays would
otherwise report Saturday as busier by arithmetic alone. A weekday that never opened has `null`, not
zero: nothing was offered, so nothing can be said.

### How far ahead people book

§2 noted the booking cutoff is currently set from a guess. This is the figure that replaces it: if
nine in ten bookings arrive more than a day out, a four-hour cutoff costs almost nothing.

Buckets rather than a mean, because the distribution is the point and has a long tail. A booking with
no `createdAt` is **not counted and is reported separately** — counting it as same-day would invent
the exact pressure this measures. A booking taken *after* its sitting is a staff correction typed up
the next morning, so it lands in same-day rather than as negative notice.

### One evening, opened from a chart

Clicking a point opens that evening: covers, occupancy, bookings, how many the guests took
themselves, no-shows, and a link straight to the service board for that date.

The lines are folded on the server with everything else rather than fetched on the click — a month is
a few dozen rows and the bookings are already in memory, and a round trip per click would make a
chart feel like a page. **Only daily buckets open**, because clicking a week would otherwise open
whichever day happened to name the bucket, which is a worse answer than not opening anything.

The no-show figure keeps its denominator throughout (`docs/service-tracking.md` §7): "2 of 14
recorded", never a rate, and an evening nobody marked says so instead of showing zero.
