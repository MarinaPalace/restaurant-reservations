"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/utils";
import { discountedPrice, formatPrice, sumFinalPrices, type Currency } from "@/lib/money";
import type { MenuCourse, ReservationAddOn } from "@/types/booking";

/**
 * Promotions on a booking, from the desk.
 *
 * Wider than the guest's own screen on purpose. A guest may only change or
 * give back what they took when they booked; reception may add a bottle
 * somebody asks for at the table, correct one ordered by mistake, or take one
 * off a bill. Every rule in this app has reception as its fallback, and one
 * they cannot override is one that ends up written on paper instead.
 *
 * Staff screens stay English (see `lib/i18n/index.ts`), so nothing here is
 * translated — but the *stored* product name is the English master either way,
 * which is what appears on the service sheet.
 */
export function StaffPromotions({
  reservationNumber,
  groups,
  initialAddOns,
  currency,
}: {
  reservationNumber: string;
  /** The promotions catalogue, in English. Empty when none is configured. */
  groups: MenuCourse[];
  initialAddOns: ReservationAddOn[];
  currency: Currency;
}) {
  const router = useRouter();
  const [addOns, setAddOns] = useState(initialAddOns);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /** Which product is taken from each group. Absent means none from it. */
  const chosen = Object.fromEntries(addOns.map((addOn) => [addOn.courseId, addOn.optionId]));

  const save = async (next: Record<string, string>) => {
    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`/api/admin/reservations/${reservationNumber}/add-ons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addOns: Object.entries(next)
            .filter(([, optionId]) => optionId)
            .map(([courseId, optionId]) => ({ courseId, optionId })),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to save the promotions.");
      }

      setAddOns(data.reservation.addOns ?? []);
      setNotice("Saved. The service sheet and the guest's own screen show this immediately.");
      // The page is server-rendered, so the section above this has to be
      // re-fetched or it keeps showing the old total.
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the promotions.");
    } finally {
      setSaving(false);
    }
  };

  const choose = (courseId: string, optionId: string | null) => {
    const next = { ...chosen };
    if (optionId) {
      next[courseId] = optionId;
    } else {
      delete next[courseId];
    }
    void save(next);
  };

  // Nothing configured: there is nothing to offer and nothing to say.
  if (groups.length === 0) {
    return null;
  }

  const total = sumFinalPrices(addOns);

  return (
    <section className="mt-6 rounded-control border border-line bg-surface-muted p-4" data-print="hide">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="eyebrow">Promotions</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {addOns.length === 0
              ? "Nothing ordered."
              : `${addOns.map((addOn) => addOn.optionName).join(", ")} · ${formatPrice(total, currency, "en")}`}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setOpen((current) => !current)}>
          {open ? "Done" : addOns.length === 0 ? "Add a promotion" : "Change"}
        </Button>
      </div>

      {open ? (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <p className="text-xs text-ink-muted">
            Reception can add, change or remove these at any time — the guest can only do so on the
            confirmation screen. Saved immediately, and recorded in the log.
          </p>

          {groups.map((group) => (
            <fieldset key={group.id}>
              <legend className="text-sm font-semibold text-ink">{group.name}</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label
                  className={cx(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-control border px-3 py-2 text-sm",
                    chosen[group.id] ? "border-line bg-surface" : "border-line-strong bg-surface",
                  )}
                >
                  <input
                    type="radio"
                    name={`staff-promo-${group.id}`}
                    className="size-4 accent-[var(--primary)]"
                    checked={!chosen[group.id]}
                    disabled={saving}
                    onChange={() => choose(group.id, null)}
                  />
                  <span className="font-medium text-ink-muted">None</span>
                </label>

                {group.options.map((option) => {
                  const price = Math.max(0, Number(option.price ?? 0));
                  const discount = Math.min(100, Math.max(0, Math.round(Number(option.discountPercent ?? 0))));

                  return (
                    <label
                      key={option.id}
                      className={cx(
                        "flex min-h-11 cursor-pointer items-center gap-3 rounded-control border bg-surface px-3 py-2 text-sm",
                        chosen[group.id] === option.id ? "border-gold" : "border-line hover:border-accent",
                      )}
                    >
                      <input
                        type="radio"
                        name={`staff-promo-${group.id}`}
                        className="size-4 accent-[var(--primary)]"
                        checked={chosen[group.id] === option.id}
                        disabled={saving}
                        onChange={() => choose(group.id, option.id)}
                      />
                      <span className="flex-1 font-medium text-ink">{option.name}</span>
                      <span className="whitespace-nowrap text-xs text-ink-muted">
                        {discount > 0 ? (
                          <s className="mr-1">{formatPrice(price, currency, "en")}</s>
                        ) : null}
                        {formatPrice(discountedPrice(price, discount), currency, "en")}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      ) : null}

      {error ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="success" className="mt-3">
          {notice}
        </Alert>
      ) : null}
    </section>
  );
}
