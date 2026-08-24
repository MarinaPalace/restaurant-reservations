import { TABLE_SOURCE_LABELS, type TableSource } from "@/types/booking";
import { cx } from "@/components/ui/utils";

/**
 * Who chose a table, drawn on the table number.
 *
 * ## Why it is worth a mark at all
 *
 * Owner, staff and guest all write the same `tableNumber`, and once written
 * they were indistinguishable. So nobody on the floor could tell whether a
 * table could be moved freely or whether a guest had picked it deliberately on
 * `/booking/table` and would mind being moved off it. The number says *where*;
 * this says *who decided*.
 *
 * ## Never colour alone
 *
 * Roughly one man in twelve cannot separate a red-green pair, a screenshot
 * printed in black and white has no colour at all, and a ring around a number
 * on a busy day sheet is small. So each source carries **three** signals: the
 * colour, a letter (G, S, O), and a border style — solid, dashed, double. Any
 * one of them alone identifies it, and the full name is on the tooltip and in
 * the accessible label.
 *
 * ## Why these colours
 *
 * Amber for the guest, which is what was asked for and is also right: guest
 * picks are the ones staff must think twice about moving, and amber is this
 * app's established "attention, not error". The other two are the app's own
 * accent and ink rather than the blue and violet first suggested — this palette
 * is warm throughout, and two imported hues would read as a different
 * application's badges rather than as part of this sheet. The letters and the
 * border styles carry the distinction either way.
 */

const RING: Record<TableSource, string> = {
  guest: "border-2 border-solid border-warning",
  staff: "border-2 border-dashed border-accent",
  owner: "border-4 border-double border-ink-muted",
};

const LETTER: Record<TableSource, string> = {
  guest: "text-warning",
  staff: "text-accent",
  owner: "text-ink-muted",
};

/** The border for a table number, given who set it. Absent source: as before. */
export function tableSourceRing(source: TableSource | undefined): string {
  return source ? RING[source] : "border border-dashed border-line-strong";
}

/** What a screen reader and a hovering pointer are told. */
export function tableSourceTitle(source: TableSource | undefined, table: string): string {
  if (!source) {
    return table ? `Table ${table}. Nobody recorded who chose it.` : "No table set.";
  }

  return `Table ${table}. ${TABLE_SOURCE_LABELS[source].name}.`;
}

/** The letter, drawn beside the number. Nothing at all when nobody is recorded. */
export function TableSourceLetter({ source }: { source: TableSource | undefined }) {
  if (!source) {
    return null;
  }

  return (
    <span aria-hidden="true" className={cx("ml-1 align-super text-[0.65em] font-bold", LETTER[source])}>
      {TABLE_SOURCE_LABELS[source].letter}
    </span>
  );
}

/**
 * The key, once, at the top of a sheet.
 *
 * Three colours nobody explains is three colours nobody reads.
 */
export function TableSourceLegend({ className }: { className?: string }) {
  return (
    <p className={cx("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted", className)}>
      <span className="text-ink-subtle">Who chose the table:</span>
      {(Object.keys(TABLE_SOURCE_LABELS) as TableSource[]).map((source) => (
        <span key={source} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cx(
              "inline-flex size-5 items-center justify-center rounded text-[0.6rem] font-bold",
              RING[source],
              LETTER[source],
            )}
          >
            {TABLE_SOURCE_LABELS[source].letter}
          </span>
          {TABLE_SOURCE_LABELS[source].name.replace("Chosen by ", "")}
        </span>
      ))}
    </p>
  );
}
