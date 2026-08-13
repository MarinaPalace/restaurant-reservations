import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getReservationsList } from "@/lib/services/reservations";
import { getRestaurantDates } from "@/lib/services/restaurant";
import { AdminDateManager } from "@/app/admin/date-manager";

export default async function AdminPage() {
  const cookieStore = await cookies();
  const isAuthenticated = cookieStore.get("admin-auth")?.value === "true";

  if (!isAuthenticated) {
    redirect("/admin/login");
  }

  const reservations = await getReservationsList();
  const restaurantDates = await getRestaurantDates();

  return (
    <main className="min-h-screen bg-[#f7f3ee] p-4 text-[#1d1b1a]">
      <div className="mx-auto max-w-6xl py-8">
        <div className="rounded-[28px] border border-[#e7d8c6] bg-white p-6 shadow-[0_18px_55px_rgba(49,31,13,0.08)]">
          <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#8e6b49]">À LA CARTE RESTAURANT</p>
              <h1 className="mt-2 text-3xl font-semibold">Staff Dashboard</h1>
            </div>
            <div className="flex items-center gap-3">
              <a href="/admin/menu" className="rounded-2xl border border-[#d7c8b6] bg-white px-5 py-3 font-semibold text-[#1d1b1a]">Menu editor</a>
              <form action="/api/admin/logout" method="POST">
                <button type="submit" className="rounded-2xl border border-[#d7c8b6] bg-white px-5 py-3 font-semibold text-[#1d1b1a]">Log out</button>
              </form>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {restaurantDates.map((date) => {
              const remaining = Math.max(date.capacity - date.reservedSeats, 0);
              return (
                <div key={date.date} className="rounded-2xl border border-[#e7d8c6] bg-[#fffdfb] p-4">
                  <div className="text-lg font-semibold">{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" }).format(new Date(`${date.date}T12:00:00`))}</div>
                  <div className="mt-2 text-sm text-[#695d53]">{date.capacity} seats</div>
                  <div className="mt-1 text-sm text-[#695d53]">{remaining} remaining</div>
                  <div className="mt-3 inline-flex rounded-full bg-[#edf6ee] px-3 py-1 text-sm font-medium text-[#2f7d51]">
                    {date.isOpen ? "OPEN" : "CLOSED"}
                  </div>
                </div>
              );
            })}
          </div>

          <AdminDateManager initialDates={restaurantDates} initialReservations={reservations} />

          <div className="mt-8 overflow-hidden rounded-2xl border border-[#e7d8c6]">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[#f8f1ea] text-[#624f3f]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Reservation</th>
                    <th className="px-4 py-3 font-semibold">Room</th>
                    <th className="px-4 py-3 font-semibold">Guests</th>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.map((reservation) => (
                    <tr key={reservation.reservationNumber} className="border-t border-[#f1e6db]">
                      <td className="px-4 py-3 font-medium text-[#1d1b1a]">{reservation.reservationNumber}</td>
                      <td className="px-4 py-3">{reservation.roomNumber}</td>
                      <td className="px-4 py-3">{reservation.guestCount}</td>
                      <td className="px-4 py-3">
                        {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${reservation.date}T12:00:00`))}
                      </td>
                      <td className="px-4 py-3">{reservation.status}</td>
                      <td className="px-4 py-3">
                        {reservation.createdAt ? new Date(reservation.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
