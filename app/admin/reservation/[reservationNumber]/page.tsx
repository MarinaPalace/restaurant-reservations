import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getReservationByNumber } from "@/lib/services/reservations";

export default async function ReservationDetailPage({ params }: { params: Promise<{ reservationNumber: string }> }) {
  const cookieStore = await cookies();
  const isAuthenticated = cookieStore.get("admin-auth")?.value === "true";

  if (!isAuthenticated) {
    redirect("/admin/login");
  }

  const { reservationNumber } = await params;
  const reservation = await getReservationByNumber(reservationNumber);

  if (!reservation) {
    redirect("/admin");
  }

  return (
    <main className="min-h-screen bg-[#f7f3ee] p-4 text-[#1d1b1a]">
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-[28px] border border-[#e7d8c6] bg-white p-6 shadow-[0_18px_55px_rgba(49,31,13,0.08)]">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#8e6b49]">RESERVATION</p>
          <h1 className="mt-3 text-3xl font-semibold">{reservation.reservationNumber}</h1>

          <dl className="mt-6 space-y-3 rounded-2xl bg-[#faf7f3] p-4 text-sm text-[#564d46]">
            <div className="flex justify-between"><dt>Room</dt><dd className="font-semibold text-[#1d1b1a]">{reservation.roomNumber}</dd></div>
            <div className="flex justify-between"><dt>Guests</dt><dd className="font-semibold text-[#1d1b1a]">{reservation.guestCount}</dd></div>
            <div className="flex justify-between"><dt>Date</dt><dd className="font-semibold text-[#1d1b1a]">{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${reservation.date}T12:00:00`))}</dd></div>
            <div className="flex justify-between"><dt>Status</dt><dd className="font-semibold text-[#1d1b1a]">{reservation.status}</dd></div>
          </dl>

          <div className="mt-6 space-y-3">
            {reservation.selections?.map((selection: { guestIndex?: number; courseId: string; courseName: string; optionName: string }, index: number) => (
              <div key={`${selection.courseId}-${selection.guestIndex ?? "guest"}-${index}`} className="rounded-2xl border border-[#e7d8c6] bg-[#fffdfb] p-3">
                <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#8e6b49]">
                  {selection.guestIndex !== undefined ? `Guest ${selection.guestIndex + 1}` : "Selection"}
                </div>
                <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-[#8e6b49]">{selection.courseName}</div>
                <div className="mt-1 text-lg font-semibold">{selection.optionName}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
