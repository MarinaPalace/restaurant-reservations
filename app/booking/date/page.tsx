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
      <DatePicker dates={dates.filter((entry) => entry.date >= today)} />
    </PageShell>
  );
}
