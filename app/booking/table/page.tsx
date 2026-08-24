import type { Metadata } from "next";
import { TablePicker } from "@/app/booking/table/table-picker";

export const metadata: Metadata = { title: "Choose your table" };

/**
 * The table step.
 *
 * Deliberately a thin client shell rather than the server-rendered pattern the
 * other steps use: what is free depends on the date and the party size, and
 * both live in `sessionStorage`. See `table-picker.tsx`.
 */
export default function TablePage() {
  return <TablePicker />;
}
