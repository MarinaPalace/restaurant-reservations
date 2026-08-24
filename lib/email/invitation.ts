import { formatLongDate } from "@/lib/date";
import { formatPassKey } from "@/lib/pass-key";
import type { EmailMessage } from "@/lib/email/resend";
import type { PassKeyRecord } from "@/types/booking";

/**
 * The invitation email.
 *
 * This is the whole invitation: an invited guest is not staying at the hotel, so
 * there is no card to hand over and no desk to hand it at. The link *is* the
 * credential — see the note on `/premium/<key>` in the handover — which sets the
 * shape of the message: one obvious button, the code written out beside it for
 * anyone whose mail client eats links, and nothing else competing for the tap.
 *
 * Written as a plain table-and-inline-styles layout on purpose. Mail clients are
 * not browsers: no external stylesheet, no flexbox, no custom properties, no web
 * fonts. The house colours are literal here for the same reason the printed card
 * carries literal colours rather than theme tokens.
 *
 * English only for now. The dictionary in `lib/i18n` covers the app itself; an
 * invitation is written before we know anything about the guest except their
 * address, and a wrong guess reads worse than English. `language` is threaded
 * through so translations can be added without changing any call site.
 */

/** Ivory paper, deep teal ink, gold rule — the printed card, in an inbox. */
const PAPER = "#fdfaf3";
const INK = "#14343d";
const INK_SOFT = "#4a6670";
const GOLD = "#a8842c";

export type InvitationEmailInput = {
  /** Where it goes. Part of the message so no caller can forget to set it. */
  to: string;
  passKey: Pick<PassKeyRecord, "code" | "guestName" | "expiresOn" | "maxUses" | "maxGuests">;
  /** Absolute, and the only thing in here that must be right. */
  invitationUrl: string;
  restaurantName: string;
  /** Reserved for translations; only "en" is written today. */
  language?: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "Maria" from "Maria Petrova": a greeting, not a database field. */
function firstName(guestName?: string) {
  const trimmed = guestName?.trim() ?? "";
  return trimmed ? trimmed.split(/\s+/)[0] : "";
}

function describeOffer(passKey: InvitationEmailInput["passKey"]) {
  const parts: string[] = [];

  parts.push(passKey.maxUses > 1 ? `${passKey.maxUses} dinners` : "Dinner for one evening");
  if (passKey.maxGuests) {
    parts.push(`up to ${passKey.maxGuests} ${passKey.maxGuests === 1 ? "guest" : "guests"}`);
  }
  if (passKey.expiresOn) {
    parts.push(`to be booked by ${formatLongDate(passKey.expiresOn)}`);
  }

  return parts.join(" · ");
}

export function buildInvitationEmail(input: InvitationEmailInput): EmailMessage {
  const { passKey, invitationUrl, restaurantName } = input;
  const code = formatPassKey(passKey.code);
  const greeting = firstName(passKey.guestName) ? `Dear ${firstName(passKey.guestName)},` : "Dear guest,";
  const offer = describeOffer(passKey);

  /**
   * The subject names the restaurant and says what it is. It deliberately does
   * **not** carry the code: subjects are what appear on a lock screen, get
   * quoted in replies, and end up in mail-client previews shared over a
   * shoulder.
   */
  const subject = `Your invitation to dine at ${restaurantName}`;

  const text = [
    greeting,
    "",
    `You are invited to dine with us at ${restaurantName}.`,
    offer ? `${offer}.` : "",
    "",
    "Choose your evening and your menu here:",
    invitationUrl,
    "",
    `If the link does not open, your invitation code is ${code}.`,
    "",
    "Please keep this email — the link is how you change or cancel the booking later.",
    "",
    `We look forward to welcoming you.`,
    restaurantName,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px 12px;background:#f2ece2;font-family:Georgia,'Times New Roman',serif;color:${INK};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:${PAPER};border:1px solid #e3d9c6;">
      <tr>
        <td style="padding:32px 32px 8px 32px;text-align:center;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${GOLD};">An invitation</p>
          <h1 style="margin:12px 0 0 0;font-size:28px;font-weight:normal;line-height:1.2;color:${INK};">${escapeHtml(restaurantName)}</h1>
          <div style="margin:18px auto 0 auto;width:64px;height:1px;background:${GOLD};"></div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 0 32px;font-size:16px;line-height:1.6;">
          <p style="margin:0 0 14px 0;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 14px 0;">You are invited to dine with us. Please choose your evening and your menu in advance — we keep your choices for the kitchen, so everything is ready when you arrive.</p>
          ${offer ? `<p style="margin:0 0 14px 0;color:${INK_SOFT};font-size:14px;">${escapeHtml(offer)}</p>` : ""}
        </td>
      </tr>
      <tr>
        <td style="padding:10px 32px 4px 32px;text-align:center;">
          <a href="${escapeHtml(invitationUrl)}" style="display:inline-block;padding:14px 28px;background:${INK};color:${PAPER};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;">Reserve your evening</a>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 32px 32px 32px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${INK_SOFT};">
          <p style="margin:0 0 6px 0;">If the button does not work, open this address:</p>
          <p style="margin:0 0 14px 0;word-break:break-all;"><a href="${escapeHtml(invitationUrl)}" style="color:${INK_SOFT};">${escapeHtml(invitationUrl)}</a></p>
          <p style="margin:0 0 6px 0;">Your invitation code</p>
          <p style="margin:0;font-family:'Courier New',monospace;font-size:15px;letter-spacing:2px;color:${INK};">${escapeHtml(code)}</p>
          <p style="margin:16px 0 0 0;">Please keep this email — the link is also how you change or cancel afterwards.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { to: input.to, subject, html, text };
}
