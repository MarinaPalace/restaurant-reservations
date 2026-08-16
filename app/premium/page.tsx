import { redirect } from "next/navigation";

/**
 * The invitation flow has no open front door any more.
 *
 * This page used to show the premium menu and every evening held for invited
 * guests to anyone who found the address — the booking itself was refused
 * without a key, but the whole offer was on display, which was the point of
 * keeping those evenings private in the first place.
 *
 * An invitation now arrives as `/premium/<pass-key>`, and anyone arriving here
 * without one is sent to the single entry step, which works out from the key
 * itself whether they belong in this flow or the everyday one.
 */
export default function PremiumIndexPage() {
  redirect("/booking");
}
