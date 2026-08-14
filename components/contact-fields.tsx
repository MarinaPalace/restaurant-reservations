"use client";

import { Field, Input } from "@/components/ui/field";
import { MESSAGING_APPS } from "@/lib/contact";
import { cx } from "@/components/ui/utils";
import type { ReservationContact } from "@/types/booking";

/**
 * Asks the guest how the restaurant should reach them. One of email or phone
 * is required; a phone number also picks the app they prefer to be messaged
 * on, which staff then get as a one-click link.
 */
export function ContactFields({
  contact,
  onChange,
  error,
}: {
  contact: ReservationContact;
  onChange: (contact: ReservationContact) => void;
  error?: string;
}) {
  const isEmail = contact.method === "email";

  return (
    <fieldset className="rounded-control border border-line bg-surface-muted p-4">
      <legend className="px-1 text-sm font-semibold text-ink">Contact details</legend>
      <p className="text-sm text-ink-muted">
        In case the restaurant needs to reach you about this reservation.
      </p>

      <div role="radiogroup" aria-label="How should we contact you?" className="mt-4 flex gap-2">
        {(["email", "phone"] as const).map((method) => (
          <button
            key={method}
            type="button"
            role="radio"
            aria-checked={contact.method === method}
            onClick={() => onChange({ ...contact, method })}
            className={cx(
              "min-h-11 flex-1 rounded-control border px-4 text-sm font-medium transition-colors",
              contact.method === method
                ? "border-primary bg-primary text-primary-fg"
                : "border-line-strong bg-surface text-ink hover:border-accent",
            )}
          >
            {method === "email" ? "Email" : "Phone"}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {isEmail ? (
          <Field label="Email address" error={error}>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="email"
                name="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={contact.email ?? ""}
                onChange={(event) => onChange({ ...contact, email: event.target.value })}
              />
            )}
          </Field>
        ) : (
          <>
            <Field label="Phone number" hint="Include the country code, e.g. +359 88 123 4567" error={error}>
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  type="tel"
                  name="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+359 88 123 4567"
                  value={contact.phone ?? ""}
                  onChange={(event) => onChange({ ...contact, phone: event.target.value })}
                />
              )}
            </Field>

            <div className="mt-4">
              <p id="messaging-app-label" className="text-sm font-medium text-ink">
                Preferred app
              </p>
              <div
                role="radiogroup"
                aria-labelledby="messaging-app-label"
                className="mt-2 flex flex-wrap gap-2"
              >
                {MESSAGING_APPS.map((app) => {
                  const isSelected = (contact.messagingApp ?? "phone") === app.id;

                  return (
                    <button
                      key={app.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => onChange({ ...contact, messagingApp: app.id })}
                      className={cx(
                        "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
                        isSelected
                          ? "border-primary bg-primary text-primary-fg"
                          : "border-line-strong bg-surface text-ink hover:border-accent",
                      )}
                    >
                      {app.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </fieldset>
  );
}
