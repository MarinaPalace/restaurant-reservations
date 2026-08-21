"use client";

import { useCallback, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/utils";
import { format, localeOf } from "@/lib/i18n";
import { formatPrice, sumFinalPrices, sumListPrices, type Currency } from "@/lib/money";
import { createSequentialSaver } from "@/lib/sequential-save";
import type { MenuCourse, ReservationAddOn, ReservationRecord } from "@/types/booking";

/**
 * What a booking already holds in promotions, read back to the guest — and,
 * where the booking still allows it, changed.
 *
 * ## Two jobs, and the line between them
 *
 * **A record.** Promotions are offered once, on the confirmation screen. Left
 * off the manage screen entirely, the only party who could say what had been
 * ordered was the restaurant, and "I never ordered a bottle of wine" was a
 * conversation with no evidence on the guest's side of it.
 *
 * **A limited edit.** A guest may swap what they took for something else in
 * the same group, or give it back. They may **not** take something they
 * declined: the offer was the moment, not the booking. So the groups on
 * offer here are exactly the groups this booking already holds — which is
 * also what the route enforces, in `mode: "manage"`, rather than trusting
 * this screen.
 *
 * The consequence is worth stating plainly, because it surprises people:
 * **giving a promotion back is final.** Once the group is empty the booking no
 * longer holds it, so there is nothing left to change and the group disappears
 * from this screen. The copy warns before it happens.
 *
 * Prices are the ones stored on the booking, not today's catalogue: the guest
 * agreed to a number, and re-pricing the wine next week must not change what
 * this says they owe.
 */

type SaveState = { status: "idle" } | { status: "saving" } | { status: "failed" };

export function PromoSummary({
  addOns,
  currency,
  className,
  /** Set on the confirmation screen, where the offer above already says all this. */
  compact = false,
  /**
   * What editing needs. Absent — on the confirmation screen, or once the
   * change deadline has passed — makes this a read-only record.
   */
  editing,
}: {
  addOns: ReservationAddOn[] | undefined;
  currency: Currency;
  className?: string;
  compact?: boolean;
  editing?: {
    /** The promotions catalogue, already localized. Only held groups are used. */
    groups: MenuCourse[];
    passKey: string;
    reservationNumber: string;
    onSaved: (reservation: ReservationRecord) => void;
  };
}) {
  const { t, language } = useI18n();
  const locale = localeOf(language);
  const [open, setOpen] = useState(false);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [notice, setNotice] = useState("");

  // Same ordering guarantee the picker has; see lib/sequential-save.ts.
  const saverRef = useRef<ReturnType<typeof createSequentialSaver>>(undefined);
  saverRef.current ??= createSequentialSaver();

  const persist = useCallback(
    (next: ReservationAddOn[], removedEverything: boolean) => {
      if (!editing) {
        return;
      }

      setSave({ status: "saving" });
      setNotice("");

      saverRef.current?.save(async (isLatest) => {
        try {
          const response = await fetch("/api/booking/add-ons", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              passKey: editing.passKey,
              reservationNumber: editing.reservationNumber,
              // Says which screen is asking, so the route applies the narrower
              // rule: change or drop what is held, never take anew.
              mode: "manage",
              addOns: next.map((addOn) => ({ courseId: addOn.courseId, optionId: addOn.optionId })),
            }),
          });

          const data = await response.json().catch(() => ({}));
          if (!isLatest()) {
            return;
          }

          if (!response.ok || !data.reservation) {
            setSave({ status: "failed" });
            return;
          }

          editing.onSaved(data.reservation as ReservationRecord);
          setSave({ status: "idle" });
          setNotice(removedEverything ? t.promo.removedAll : t.promo.saved);
          if (removedEverything) {
            setOpen(false);
          }
        } catch {
          if (isLatest()) {
            setSave({ status: "failed" });
          }
        }
      });
    },
    [editing, t],
  );

  // Nothing taken is not worth a heading. A guest who declined everything does
  // not need to be told so on every screen for the rest of their stay.
  if (!addOns?.length) {
    return null;
  }

  const total = sumFinalPrices(addOns);
  const saved = sumListPrices(addOns) - total;

  /**
   * Only the groups this booking already holds, and only if the catalogue
   * still offers them. A group withdrawn since is not swappable — there is
   * nothing to swap to — but what was taken is still shown and still owed.
   */
  const editableGroups = editing
    ? addOns
        .map((addOn) => ({
          held: addOn,
          group: editing.groups.find((entry) => entry.id === addOn.courseId),
        }))
        .filter((row): row is { held: ReservationAddOn; group: MenuCourse } => Boolean(row.group))
    : [];

  const swap = (held: ReservationAddOn, optionId: string | null) => {
    const rest = addOns.filter((addOn) => addOn.courseId !== held.courseId);

    if (!optionId) {
      persist(rest, rest.length === 0);
      return;
    }

    persist([...rest, { ...held, optionId }], false);
  };

  return (
    <section className={cx("rounded-control border border-gold/40 bg-accent-soft p-4", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">{t.promo.takenTitle}</h2>
        {editableGroups.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            className="min-h-11 text-sm font-semibold text-accent-ink underline underline-offset-4"
          >
            {open ? t.promo.keepEditing : t.promo.change}
          </button>
        ) : null}
      </div>

      <ul className="mt-2 space-y-2">
        {addOns.map((addOn) => (
          <li key={addOn.optionId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="min-w-0">
              <span className="font-semibold text-ink">{addOn.optionName}</span>
              <span className="ml-2 text-xs text-ink-muted">{addOn.courseName}</span>
            </span>

            <span className="flex items-baseline gap-2 whitespace-nowrap">
              {addOn.price === 0 ? (
                <span className="text-xs font-semibold uppercase tracking-wide text-success">{t.promo.free}</span>
              ) : (
                <>
                  {addOn.discountPercent > 0 ? (
                    <>
                      <s className="text-xs text-ink-subtle">{formatPrice(addOn.price, currency, locale)}</s>
                      <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-bold text-success">
                        {format(t.promo.discount, { percent: addOn.discountPercent })}
                      </span>
                    </>
                  ) : null}
                  <span className="font-semibold text-ink">{formatPrice(addOn.finalPrice, currency, locale)}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      {total > 0 ? (
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 border-t border-gold/30 pt-3">
          <span className="text-sm text-ink-subtle">{t.promo.total}</span>
          <span className="text-lg font-semibold text-ink">{formatPrice(total, currency, locale)}</span>
        </div>
      ) : null}

      {saved > 0 ? (
        <p className="mt-1 text-right text-sm font-semibold text-success">
          {format(t.promo.youSave, { amount: formatPrice(saved, currency, locale) })}
        </p>
      ) : null}

      {/* Swapping and giving back, group by group. */}
      {open && editableGroups.length > 0 ? (
        <div className="mt-4 space-y-4 border-t border-gold/30 pt-4">
          <p className="text-xs text-ink-muted">{t.promo.changeHint}</p>

          {editableGroups.map(({ held, group }) => (
            <fieldset key={group.id}>
              <legend className="text-sm font-semibold text-ink">{group.name}</legend>
              <div className="mt-2 grid gap-2">
                {group.options.map((option) => (
                  <label
                    key={option.id}
                    className={cx(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-control border bg-surface px-3 py-2 text-sm",
                      held.optionId === option.id ? "border-gold" : "border-line hover:border-accent",
                    )}
                  >
                    <input
                      type="radio"
                      name={`held-${group.id}`}
                      className="size-4 accent-[var(--primary)]"
                      checked={held.optionId === option.id}
                      disabled={save.status === "saving"}
                      onChange={() => swap(held, option.id)}
                    />
                    <span className="flex-1 font-medium text-ink">{option.name}</span>
                    <span className="text-xs text-ink-muted">
                      {formatPrice(
                        Math.max(0, Number(option.price ?? 0)) *
                          (1 - Math.min(100, Math.max(0, Number(option.discountPercent ?? 0))) / 100),
                        currency,
                        locale,
                      )}
                    </span>
                  </label>
                ))}
              </div>

              <Button
                variant="secondary"
                className="mt-2"
                loading={save.status === "saving"}
                onClick={() => swap(held, null)}
              >
                {t.promo.removeOne}
              </Button>
            </fieldset>
          ))}
        </div>
      ) : null}

      {notice ? (
        <p className="mt-3 text-sm font-medium text-success" role="status">
          {notice}
        </p>
      ) : null}
      {save.status === "failed" ? (
        <p className="mt-3 text-sm font-medium text-danger" role="alert">
          {t.promo.error}
        </p>
      ) : null}

      {compact ? null : <p className="mt-3 text-xs text-ink-muted">{t.promo.takenNote}</p>}
    </section>
  );
}
