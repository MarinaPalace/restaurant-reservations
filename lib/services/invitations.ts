import { RESTAURANT_NAME } from "@/lib/brand";
import { buildInvitationEmail } from "@/lib/email/invitation";
import { describeMailProblem, isMailConfigured, sendEmail } from "@/lib/email/resend";
import { absoluteUrl, passKeyTargetUrl } from "@/lib/pass-key-links";
import { recordInvitationDelivery } from "@/lib/services/pass-keys";
import type { InvitationDelivery, PassKeyRecord } from "@/types/booking";

/**
 * Sending an invitation, end to end.
 *
 * Shared by the route that issues invitations and the one that sends an existing
 * one again, because the two must produce the same email and record the same
 * thing — when they were written separately in the pass-key work before this,
 * the printed card and the QR code drifted apart, and that is the lesson.
 *
 * Three rules hold this together:
 *
 * 1. **Only invitations are emailed.** An in-house guest is handed a printed
 *    card at the desk. Refusing here as well as in the route means a future
 *    caller cannot quietly start emailing keys to hotel guests, whose addresses
 *    we may not even hold.
 * 2. **Nothing throws.** Every outcome is a value, because the caller has
 *    already issued a key that works and must not lose it over a mail provider.
 * 3. **The attempt is recorded whether it worked or not.** "It says failed" is
 *    an answer reception can act on; silence is not.
 */

export type InvitationSendOutcome = {
  ok: boolean;
  /** Shown to staff. Written for somebody standing at a desk, not for a log. */
  message: string;
  /** What was written onto the key, when anything was. */
  delivery?: InvitationDelivery;
  /** The link itself, so the UI can offer "copy" when sending fails. */
  invitationUrl: string;
};

export function invitationUrlFor(passKey: Pick<PassKeyRecord, "code" | "kind">, host: string) {
  return absoluteUrl(
    passKeyTargetUrl(passKey, { bookingUrl: `${host}/booking`, invitationUrl: `${host}/premium` }),
  );
}

/** Whether this deployment can send at all, and what to say if it cannot. */
export function invitationEmailProblem() {
  return isMailConfigured() ? null : describeMailProblem();
}

export async function sendInvitationEmail(input: {
  passKey: PassKeyRecord;
  /** Overrides the address on the key — reception correcting a typo. */
  to?: string;
  host: string;
}): Promise<InvitationSendOutcome> {
  const { passKey, host } = input;
  const invitationUrl = invitationUrlFor(passKey, host);
  const to = (input.to ?? passKey.guestEmail ?? "").trim().toLowerCase();

  if (passKey.kind !== "premium") {
    return {
      ok: false,
      message: "Only invitations are emailed. An in-house pass-key is printed as a card.",
      invitationUrl,
    };
  }

  if (!to) {
    return { ok: false, message: "This invitation has no email address on it.", invitationUrl };
  }

  const problem = invitationEmailProblem();
  if (problem) {
    // Deliberately not recorded on the key: nothing was attempted, and writing
    // "failed" would make an unconfigured server look like a bad address.
    return { ok: false, message: problem, invitationUrl };
  }

  const attempts = (passKey.invitation?.attempts ?? 0) + 1;

  const result = await sendEmail(
    buildInvitationEmail({ to, passKey, invitationUrl, restaurantName: RESTAURANT_NAME }),
  );

  const delivery: InvitationDelivery = {
    channel: "email",
    to,
    at: new Date().toISOString(),
    status: result.ok ? "sent" : "failed",
    ...(result.ok ? { messageId: result.messageId } : { error: result.message }),
    attempts,
  };

  await recordInvitationDelivery(passKey.id, delivery);

  return {
    ok: result.ok,
    message: result.ok
      ? `Invitation sent to ${to}.`
      : `We could not send to ${to}: ${result.message} The link can be copied and sent by hand.`,
    delivery,
    invitationUrl,
  };
}
