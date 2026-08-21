"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { DishImage } from "@/components/dish-image";
import { useI18n } from "@/components/i18n-provider";
import { cx } from "@/components/ui/utils";
import { format, localeOf } from "@/lib/i18n";
import { localizeMenuCatalog } from "@/lib/menu-localization";
import { createSequentialSaver } from "@/lib/sequential-save";
import { discountedPrice, formatPrice, sumFinalPrices, sumListPrices, type Currency } from "@/lib/money";
import type { MenuCourse, MenuOption, ReservationRecord } from "@/types/booking";

/**
 * Promotions on the confirmation screen: the one place a guest is offered
 * them, and so the one place they can be taken.
 *
 * ## Why this is not a form with a Save button
 *
 * The guest has already finished. Their table is booked, the number is on the
 * screen, and the page is one they may well close in the next ten seconds.
 * Anything needing a second, deliberate press will be missed by most of them,
 * and a promotion nobody notices is a promotion that does not exist. So each
 * choice saves itself.
 *
 * ## Why saving itself is harder than it looks
 *
 * The first version fired a request on every tap and applied whichever
 * response came back, so two taps in quick succession raced and the older
 * reply could overwrite the newer choice. `lib/sequential-save.ts` holds the
 * fix, the reasoning and the tests; this component's only obligation is to put
 * every save through it and to check `isLatest()` before touching the screen.
 *
 * ## Why a failure does not roll the screen back
 *
 * Reverting a guest's tap tells them their choice was refused, when what
 * actually happened is that the request never arrived. The choice stays where
 * they put it, the message says so, and "try again" resends it.
 */

/** Which product is taken from each group. A group absent means "none from it". */
type Chosen = Record<string, string>;

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "failed"; reason: "error" | "gone" };

/** What a product costs, worked out the same way the server works it out. */
function priceOf(option: MenuOption) {
  const price = Math.max(0, Number(option.price ?? 0));
  const discountPercent = Math.min(100, Math.max(0, Math.round(Number(option.discountPercent ?? 0))));

  return { price, discountPercent, finalPrice: discountedPrice(price, discountPercent) };
}

export function PromoPicker({
  groups: untranslatedGroups,
  currency,
  reservation,
  passKey,
  onSaved,
}: {
  /** Loaded on the server and sent untranslated; localized here. */
  groups: MenuCourse[];
  currency: Currency;
  reservation: ReservationRecord;
  /** What authorises the change. The reservation number only says which booking. */
  passKey: string;
  /** Hands the updated booking back, so the confirmation screen re-renders. */
  onSaved: (reservation: ReservationRecord) => void;
}) {
  const { t, language } = useI18n();
  const locale = localeOf(language);

  // Localized in the browser, so switching language is instant rather than a
  // round trip — the same choice the menu step makes.
  const groups = useMemo(() => localizeMenuCatalog(untranslatedGroups, language), [untranslatedGroups, language]);

  /**
   * Seeded once from the booking, and the source of truth from then on.
   *
   * Deliberately not derived from `reservation.addOns` on every render. That
   * lags a request behind the tap, so the card the guest just pressed would
   * un-press itself for as long as the round trip takes.
   */
  const [chosen, setChosen] = useState<Chosen>(() =>
    Object.fromEntries((reservation.addOns ?? []).map((addOn) => [addOn.courseId, addOn.optionId])),
  );
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  /** Remounted to replay the confirmation flash on the card just tapped. */
  const [flash, setFlash] = useState<{ id: string; tick: number } | null>(null);

  const reservationNumber = reservation.reservationNumber;

  /**
   * Saves go through here rather than straight to `fetch`, which is what makes
   * them land in the order the guest made them. See `lib/sequential-save.ts`
   * for the bug that is about — it is the one this screen was reported for.
   */
  const saverRef = useRef<ReturnType<typeof createSequentialSaver>>(undefined);
  saverRef.current ??= createSequentialSaver();

  const persist = useCallback(
    (next: Chosen) => {
      setSave({ status: "saving" });

      saverRef.current?.save(async (isLatest) => {
        try {
          const response = await fetch("/api/booking/add-ons", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              passKey,
              reservationNumber,
              addOns: Object.entries(next)
                .filter(([, optionId]) => optionId)
                .map(([courseId, optionId]) => ({ courseId, optionId })),
            }),
          });

          const data = await response.json().catch(() => ({}));

          // A newer choice has been made since. Its own request is already on
          // its way, and it — not this one — decides what the screen says.
          if (!isLatest()) {
            return;
          }

          /**
           * The product was withdrawn between this page being rendered and the
           * tap. Nothing on screen can be trusted to still be on offer, and
           * this screen is server-rendered, so the honest answer is to say so
           * and let the guest reload.
           */
          if (response.status === 409) {
            setSave({ status: "failed", reason: "gone" });
            return;
          }

          if (!response.ok || !data.reservation) {
            setSave({ status: "failed", reason: "error" });
            return;
          }

          onSaved(data.reservation as ReservationRecord);
          setSave({ status: "saved" });
        } catch {
          if (isLatest()) {
            setSave({ status: "failed", reason: "error" });
          }
        }
      });
    },
    [onSaved, passKey, reservationNumber],
  );

  const choose = (groupId: string, optionId: string | null) => {
    const next: Chosen = { ...chosen };

    if (optionId) {
      next[groupId] = optionId;
    } else {
      delete next[groupId];
    }

    setChosen(next);
    // Counted rather than timestamped: `Date.now()` is impure, and all this
    // needs is a value that differs from the last one so the flash remounts.
    setFlash((current) => ({ id: optionId ?? `none-${groupId}`, tick: (current?.tick ?? 0) + 1 }));
    persist(next);
  };

  /**
   * What has been taken, priced from the catalogue on screen.
   *
   * Read from `chosen` rather than from the saved booking for the same reason
   * the cards are: a total that jumps a beat after the tap reads as a fault.
   * The server prices everything again regardless, and its figure is the one
   * that is stored.
   */
  const taken = useMemo(
    () =>
      groups.flatMap((group) => {
        const option = group.options.find((entry) => entry.id === chosen[group.id]);
        return option ? [{ option, ...priceOf(option) }] : [];
      }),
    [chosen, groups],
  );

  const total = sumFinalPrices(taken);
  const savedAmount = sumListPrices(taken) - total;

  // Nothing on offer: the section has nothing to say, so it says nothing.
  if (groups.length === 0) {
    return null;
  }

  return (
    <section
      className="mt-6 overflow-hidden rounded-card border border-gold/40 bg-surface"
      data-print="hide"
      aria-labelledby="promo-title"
    >
      {/* The offer's own header, set apart from the booking details above it:
          this is the one part of the screen that asks for something back. */}
      <header className="border-b border-line bg-accent-soft px-5 py-6 sm:px-7">
        <p className="eyebrow">{t.promo.eyebrow}</p>
        <h2 id="promo-title" className="display mt-1 text-2xl text-balance text-accent-ink sm:text-3xl">
          {t.promo.title}
        </h2>
        <span aria-hidden="true" className="rule-gold rule-animate mt-3 block" />
        <p className="mt-3 max-w-prose text-sm text-pretty text-ink-muted">{t.promo.description}</p>

        <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-gold/50 bg-surface px-3 py-1 text-xs font-semibold text-accent-ink">
          <span aria-hidden="true">✦</span>
          {t.promo.onlyNow}
        </p>
      </header>

      <div className="stage space-y-7 px-5 py-6 sm:px-7">
        {groups.map((group) => (
          <fieldset key={group.id} className="min-w-0">
            <legend className="flex flex-wrap items-baseline gap-x-3">
              <span className="display text-xl text-ink">{group.name}</span>
              {group.description ? <span className="text-sm text-ink-muted">{group.description}</span> : null}
            </legend>

            {/* Products as cards, not table rows: a bottle deserves the same
                treatment a dish gets, and the discount has somewhere to sit. */}
            <div
              role="radiogroup"
              aria-label={format(t.promo.groupOptions, { group: group.name })}
              className="mt-3 grid gap-3 sm:grid-cols-2"
            >
              {group.options.map((option) => (
                <PromoCard
                  key={option.id}
                  option={option}
                  currency={currency}
                  locale={locale}
                  selected={chosen[group.id] === option.id}
                  flashing={flash?.id === option.id}
                  flashKey={flash?.tick}
                  onChoose={() => choose(group.id, option.id)}
                />
              ))}

              <DeclineCard
                selected={!chosen[group.id]}
                flashing={flash?.id === `none-${group.id}`}
                flashKey={flash?.tick}
                onChoose={() => choose(group.id, null)}
              />
            </div>
          </fieldset>
        ))}
      </div>

      <PromoFooter
        currency={currency}
        locale={locale}
        taken={taken}
        total={total}
        savedAmount={savedAmount}
        save={save}
        onRetry={() => persist(chosen)}
      />
    </section>
  );
}

/** One product. A photograph when there is one, and the price arithmetic in full. */
function PromoCard({
  option,
  currency,
  locale,
  selected,
  flashing,
  flashKey,
  onChoose,
}: {
  option: MenuOption;
  currency: Currency;
  locale: string;
  selected: boolean;
  flashing: boolean;
  flashKey?: number;
  onChoose: () => void;
}) {
  const { t } = useI18n();
  const { price, discountPercent, finalPrice } = priceOf(option);

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onChoose}
      className={cx(
        "lift group relative flex flex-col overflow-hidden rounded-card border text-left",
        selected ? "border-gold bg-accent-soft" : "border-line bg-surface hover:border-accent",
      )}
    >
      {/* Remounting this one span replays the flash. Remounting the card would
          throw the photograph away and fetch it again on every tap. */}
      {flashing ? <span key={flashKey} aria-hidden="true" className="bloom-ring" /> : null}

      {option.imageUrl ? (
        <span className="relative block aspect-[16/9] w-full overflow-hidden">
          <DishImage
            src={option.imageUrl}
            alt=""
            width={640}
            height={360}
            className={cx(
              "absolute inset-0 !rounded-none !border-0 size-full object-cover",
              "transition-transform duration-[--motion-hero] ease-[--ease-settle] group-hover:scale-[1.06]",
            )}
          />

          {discountPercent > 0 ? (
            <span className="absolute left-2 top-2 z-10 rounded-full bg-success px-2.5 py-1 text-xs font-bold text-success-soft shadow-lg">
              {format(t.promo.discount, { percent: discountPercent })}
            </span>
          ) : null}

          {selected ? (
            <span
              aria-hidden="true"
              className="absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full bg-gold text-base font-bold text-primary-fg shadow-lg"
            >
              ✓
            </span>
          ) : null}
        </span>
      ) : null}

      <span className="flex min-w-0 flex-1 flex-col p-4">
        <span className="flex items-start justify-between gap-3">
          <span className={cx("display text-lg text-balance", selected ? "text-accent-ink" : "text-ink")}>
            {option.name}
          </span>

          {/* Without a photograph there is nowhere else for these to go. */}
          {!option.imageUrl && discountPercent > 0 ? (
            <span className="shrink-0 rounded-full bg-success-soft px-2 py-0.5 text-xs font-bold text-success">
              {format(t.promo.discount, { percent: discountPercent })}
            </span>
          ) : null}
          {!option.imageUrl && selected ? (
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gold text-xs font-bold text-primary-fg"
            >
              ✓
            </span>
          ) : null}
        </span>

        {option.description ? (
          <span className="mt-1.5 block text-sm text-pretty text-ink-muted">{option.description}</span>
        ) : null}

        <span className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {price === 0 ? (
            <span className="text-sm font-semibold uppercase tracking-wide text-success">{t.promo.free}</span>
          ) : (
            <>
              {discountPercent > 0 ? (
                <s className="text-sm text-ink-subtle">{formatPrice(price, currency, locale)}</s>
              ) : null}
              <span className={cx("text-lg font-semibold", selected ? "text-accent-ink" : "text-ink")}>
                {formatPrice(finalPrice, currency, locale)}
              </span>
            </>
          )}
        </span>
      </span>
    </button>
  );
}

/**
 * Declining, as a card of its own.
 *
 * A group with no way to say no would be a choice a guest cannot take back
 * once made, which is not how an offer works. Dashed and quiet, so it reads as
 * the way out rather than as one more product.
 */
function DeclineCard({
  selected,
  flashing,
  flashKey,
  onChoose,
}: {
  selected: boolean;
  flashing: boolean;
  flashKey?: number;
  onChoose: () => void;
}) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onChoose}
      className={cx(
        "lift relative flex min-h-14 w-full items-center gap-3 rounded-card border border-dashed p-4 text-left sm:col-span-2",
        selected
          ? "border-gold bg-accent-soft text-accent-ink"
          : "border-line-strong bg-surface text-ink-muted hover:border-accent",
      )}
    >
      {flashing ? <span key={flashKey} aria-hidden="true" className="bloom-ring" /> : null}

      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full border border-current text-sm"
      >
        {selected ? "✓" : "—"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{t.promo.none}</span>
        <span className="block text-xs opacity-80">{t.promo.noneHint}</span>
      </span>
    </button>
  );
}

/**
 * The running total, and what the last save did.
 *
 * The save state sits here rather than in a toast: a message that disappears
 * on its own is a message the guest who looked away never saw, and "did my
 * wine save?" is the question this whole screen exists to answer.
 */
function PromoFooter({
  currency,
  locale,
  taken,
  total,
  savedAmount,
  save,
  onRetry,
}: {
  currency: Currency;
  locale: string;
  taken: { option: MenuOption }[];
  total: number;
  savedAmount: number;
  save: SaveState;
  onRetry: () => void;
}) {
  const { t } = useI18n();

  if (taken.length === 0 && save.status === "idle") {
    return null;
  }

  return (
    <footer className="border-t border-line bg-surface-muted px-5 py-4 sm:px-7">
      {taken.length > 0 ? (
        <>
          <p className="eyebrow">{t.promo.chosenTitle}</p>
          <ul className="mt-2 space-y-1">
            {taken.map(({ option }) => (
              <li key={option.id} className="text-sm font-medium text-ink">
                {option.name}
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line pt-3">
            <span className="text-sm text-ink-subtle">{t.promo.total}</span>
            <span className="text-xl font-semibold text-ink">{formatPrice(total, currency, locale)}</span>
          </div>

          {savedAmount > 0 ? (
            <p className="mt-1 text-right text-sm font-semibold text-success">
              {format(t.promo.youSave, { amount: formatPrice(savedAmount, currency, locale) })}
            </p>
          ) : null}
        </>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3" role="status" aria-live="polite">
        {save.status === "saving" ? (
          <span className="inline-flex items-center gap-2 text-sm text-ink-muted">
            <span
              aria-hidden="true"
              className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
            {t.promo.saving}
          </span>
        ) : null}

        {save.status === "saved" ? (
          <span className="inline-flex items-center gap-2 text-sm font-medium text-success">
            <span aria-hidden="true">✓</span>
            {t.promo.saved}
          </span>
        ) : null}

        {save.status === "failed" ? (
          <>
            <span className="text-sm font-medium text-danger">
              {save.reason === "gone" ? t.promo.gone : t.promo.error}
            </span>
            {save.reason === "error" ? (
              <button
                type="button"
                onClick={onRetry}
                className="min-h-11 rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:border-accent"
              >
                {t.promo.retry}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </footer>
  );
}
