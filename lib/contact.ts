import type { ReservationContact, MessagingApp } from "@/types/booking";

/**
 * How the restaurant reaches a guest about their booking, and — for phone
 * numbers — which app they prefer to be messaged on.
 */

export const MESSAGING_APPS: { id: MessagingApp; label: string }[] = [
  { id: "phone", label: "Phone call or SMS" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "viber", label: "Viber" },
  { id: "telegram", label: "Telegram" },
];

export const MESSAGING_APP_LABELS: Record<MessagingApp, string> = {
  phone: "Phone call or SMS",
  whatsapp: "WhatsApp",
  viber: "Viber",
  telegram: "Telegram",
};

// Deliberately permissive: guests come from many countries and a stricter
// pattern would reject valid numbers.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function isValidEmail(value: string) {
  return EMAIL_PATTERN.test(value.trim());
}

/** Keeps a leading + and digits only, so links are built from a clean number. */
export function normalizePhone(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

export function isValidPhone(value: string) {
  const digits = normalizePhone(value).replace(/^\+/, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function describeContactProblem(contact: ReservationContact | undefined | null): string | null {
  if (!contact) {
    return "Please leave an email address or a phone number.";
  }

  if (contact.method === "email") {
    if (!contact.email?.trim()) {
      return "Please enter your email address.";
    }
    return isValidEmail(contact.email) ? null : "Please enter a valid email address.";
  }

  if (contact.method === "phone") {
    if (!contact.phone?.trim()) {
      return "Please enter your phone number.";
    }
    return isValidPhone(contact.phone)
      ? null
      : "Please enter a valid phone number, including the country code.";
  }

  return "Please choose how we should contact you.";
}

/** Strips whatever does not belong to the chosen method before storing. */
export function normalizeContact(contact: ReservationContact): ReservationContact {
  if (contact.method === "email") {
    return { method: "email", email: contact.email?.trim().toLowerCase() ?? "" };
  }

  return {
    method: "phone",
    phone: normalizePhone(contact.phone ?? ""),
    messagingApp: contact.messagingApp ?? "phone",
  };
}

export function formatContact(contact: ReservationContact | undefined | null) {
  if (!contact) {
    return "—";
  }
  return contact.method === "email" ? (contact.email ?? "—") : (contact.phone ?? "—");
}

/**
 * A link staff can click to reach the guest in their preferred app.
 *
 * The app deep links need the number without a leading +, while `tel:` and
 * `mailto:` take the value as written.
 */
export function buildContactLink(contact: ReservationContact | undefined | null): string | null {
  if (!contact) {
    return null;
  }

  if (contact.method === "email") {
    return contact.email ? `mailto:${contact.email}` : null;
  }

  const phone = normalizePhone(contact.phone ?? "");
  if (!phone) {
    return null;
  }

  const digits = phone.replace(/^\+/, "");

  switch (contact.messagingApp) {
    case "whatsapp":
      return `https://wa.me/${digits}`;
    case "viber":
      return `viber://chat?number=${encodeURIComponent(`+${digits}`)}`;
    case "telegram":
      return `https://t.me/+${digits}`;
    default:
      return `tel:${phone}`;
  }
}
