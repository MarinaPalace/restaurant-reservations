import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { BookingSteps } from "@/components/booking-steps";
import { DatePicker } from "@/app/booking/date/date-picker";
import { getRestaurantDates } from "@/lib/services/restaurant";
import { todayKey } from "@/lib/date";

export const metadata: Metadata = { title: "Choose a date" };

// Availability changes with every booking, so this must never be prerendered.
export const dynamic = "force-dynamic";

export default async function DatePage() {
  const dates = await getRestaurantDates();
  const today = todayKey();

  return (
    <PageShell width="md">
      <BookingSteps current="date" />
      {/*
        Past evenings are never bookable, and **invitation evenings are not this
        flow's to offer** — they belong to /premium and are held for guests with
        an invitation key.

        The second filter was missing here while `/api/restaurant/dates` has
        always had it. This page was the one actually feeding the calendar, so a
        regular guest was shown invitation nights as ordinary evenings, with
        seats, and refused when they chose one. Nothing was ever bookable that
        should not have been — every route refuses a premium evening to a
        standard key — but being offered a table and then told no is its own
        kind of broken.
      */}
      <DatePicker dates={dates.filter((entry) => entry.date >= today && !entry.premium)} />
    </PageShell>
  );
}
