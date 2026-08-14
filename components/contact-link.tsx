import { buildContactLink, formatContact, MESSAGING_APP_LABELS } from "@/lib/contact";
import type { ReservationContact } from "@/types/booking";

/**
 * Staff-facing contact, rendered as a one-click link into the app the guest
 * asked to be reached on.
 */
export function ContactLink({ contact }: { contact: ReservationContact | undefined | null }) {
  if (!contact) {
    return <span className="text-ink-subtle">No contact left</span>;
  }

  const href = buildContactLink(contact);
  const value = formatContact(contact);
  const app = contact.method === "phone" ? MESSAGING_APP_LABELS[contact.messagingApp ?? "phone"] : "Email";

  return (
    <span className="inline-flex flex-col">
      {href ? (
        <a href={href} className="font-medium text-ink underline underline-offset-2 hover:text-accent">
          {value}
        </a>
      ) : (
        <span className="font-medium text-ink">{value}</span>
      )}
      <span className="text-xs text-ink-subtle">{app}</span>
    </span>
  );
}
