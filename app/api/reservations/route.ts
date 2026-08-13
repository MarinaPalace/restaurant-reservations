import { NextResponse } from "next/server";
import { z } from "zod";
import { createReservationEntry } from "@/lib/services/reservations";
import { getMenuCatalog } from "@/lib/services/restaurant";

const reservationInputSchema = z.object({
  roomNumber: z.coerce.number().int().positive(),
  guestCount: z.number().int().min(1).max(6),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  selections: z.array(
    z.object({
      guestIndex: z.number().int().nonnegative().optional(),
      courseId: z.string().min(1),
      courseName: z.string().min(1),
      optionId: z.string().min(1),
      optionName: z.string().min(1),
    }),
  ),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = reservationInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Please enter valid reservation details." }, { status: 400 });
    }

    const menu = await getMenuCatalog();
    const requiredCourses = menu.filter((course) => course.required);

    for (let guestIndex = 0; guestIndex < parsed.data.guestCount; guestIndex += 1) {
      const guestSelections = parsed.data.selections.filter((selection) => selection.guestIndex === guestIndex);

      for (const course of requiredCourses) {
        const selection = guestSelections.find((item) => item.courseId === course.id);
        if (!selection) {
          return NextResponse.json({ error: `Please choose an option for ${course.name}.` }, { status: 400 });
        }

        const courseOption = course.options.find((item) => item.id === selection.optionId);
        if (!courseOption || !courseOption.active) {
          return NextResponse.json({ error: "Invalid menu option selected." }, { status: 400 });
        }
      }
    }

    try {
      const reservation = await createReservationEntry({
        roomNumber: parsed.data.roomNumber,
        guestCount: parsed.data.guestCount,
        date: parsed.data.date,
        selections: parsed.data.selections,
      });

      return NextResponse.json({ reservation }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "DATE_CLOSED") {
        return NextResponse.json({ error: "Unfortunately, this date is no longer available. Please select another date." }, { status: 409 });
      }
      if (message === "DATE_FULL") {
        return NextResponse.json({ error: "Unfortunately, this date is fully booked. Please choose another evening." }, { status: 409 });
      }
      return NextResponse.json({ error: "Something went wrong while creating your reservation. Please try again." }, { status: 500 });
    }
  } catch {
    return NextResponse.json({ error: "Something went wrong while creating your reservation. Please try again." }, { status: 500 });
  }
}
