import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVENING_DEFAULTS,
  DEFAULT_EVENING_TOGGLES,
  changedFeatures,
  describeOverrides,
  hasOverrides,
  resolveEveningFeatures,
  toEveningOverrides,
  toEveningToggles,
} from "@/lib/evening-features";
import { EMPTY_PLAN, type FloorPlan } from "@/lib/floor-plan";

/** A plan with something a guest could actually be given: in service, labelled. */
const drawnRoom: FloorPlan = {
  zones: [
    {
      id: "z1",
      name: "Main hall",
      width: 1400,
      height: 900,
      tables: [
        { id: "t1", label: "1", seats: 4, shape: "round", active: true, x: 0, y: 0, width: 70, height: 70, rotation: 0 },
      ],
      features: [],
    },
  ],
};

/**
 * The acceptance criterion for the whole feature, and the first thing to break
 * if any of it is got wrong.
 */
describe("an evening that says nothing", () => {
  it("behaves exactly as the app did before evenings had switches", () => {
    expect(DEFAULT_EVENING_DEFAULTS).toEqual({
      tableSelection: "off",
      promotions: true,
      selfService: true,
    });
  });

  it("inherits every one of them", () => {
    expect(resolveEveningFeatures(DEFAULT_EVENING_DEFAULTS, undefined, drawnRoom)).toEqual({
      tableSelection: "off",
      promotions: true,
      selfService: true,
    });
  });

  /**
   * Inherit is not "pinned to today's default". An evening that never
   * disagreed has to move when the restaurant does, or the setting would
   * silently stop applying to the evenings that never opted out of it.
   */
  it("follows the restaurant when the restaurant changes", () => {
    const defaults = { tableSelection: "optional" as const, promotions: false, selfService: false };

    expect(resolveEveningFeatures(defaults, undefined, drawnRoom)).toEqual({
      tableSelection: "optional",
      promotions: false,
      selfService: false,
    });
  });
});

describe("an evening that says something", () => {
  it("wins on what it says, and inherits the rest", () => {
    const features = resolveEveningFeatures(
      { tableSelection: "off", promotions: true, selfService: true },
      { promotions: false },
      drawnRoom,
    );

    expect(features).toEqual({ tableSelection: "off", promotions: false, selfService: true });
  });

  /**
   * The whole point of the feature: one future date running something the rest
   * of the restaurant has switched off, so it can be tested against real
   * bookings without turning it on for tonight.
   */
  it("can turn a feature on that the restaurant has off", () => {
    const features = resolveEveningFeatures(
      DEFAULT_EVENING_DEFAULTS,
      { tableSelection: "required" },
      drawnRoom,
    );

    expect(features.tableSelection).toBe("required");
    // And nothing else moved with it.
    expect(features.promotions).toBe(true);
    expect(features.selfService).toBe(true);
  });

  it("can turn one off that the restaurant has on", () => {
    expect(
      resolveEveningFeatures({ tableSelection: "optional", promotions: true, selfService: true }, { tableSelection: "off" }, drawnRoom)
        .tableSelection,
    ).toBe("off");
  });

  /**
   * An evening asking guests to pick a table from a room nobody has drawn is a
   * broken booking flow, not a policy — `required` would ask every guest to
   * choose and then have nothing to offer. The plan can be emptied after the
   * evening was set, so it is resolved on every read.
   */
  it("comes back off when there is no room to pick from", () => {
    expect(
      resolveEveningFeatures(DEFAULT_EVENING_DEFAULTS, { tableSelection: "required" }, EMPTY_PLAN).tableSelection,
    ).toBe("off");
  });
});

describe("reading what an evening stored", () => {
  it("keeps what it recognises and drops what it does not", () => {
    expect(
      toEveningOverrides({ tableSelection: "required", promotions: false, selfService: "yes please" }),
    ).toEqual({ tableSelection: "required", promotions: false });
  });

  /**
   * Absent is inherit, so anything unreadable behaving like the restaurant is
   * the only safe failure. A guess would be an evening quietly running a policy
   * nobody set.
   */
  it("reads anything unusable as saying nothing at all", () => {
    expect(toEveningOverrides(undefined)).toBeUndefined();
    expect(toEveningOverrides(null)).toBeUndefined();
    expect(toEveningOverrides("off")).toBeUndefined();
    expect(toEveningOverrides({})).toBeUndefined();
    expect(toEveningOverrides({ tableSelection: "sideways" })).toBeUndefined();
    // Null per field is how the editor clears one back to inherit.
    expect(toEveningOverrides({ promotions: null })).toBeUndefined();
  });

  it("says nothing with one shape, not two", () => {
    // Not `{}`: "follows the restaurant" has exactly one representation, so no
    // caller has to test for both.
    expect(toEveningOverrides({ tableSelection: "nonsense" })).toBeUndefined();
    expect(hasOverrides(undefined)).toBe(false);
    expect(hasOverrides({})).toBe(false);
    expect(hasOverrides({ promotions: true })).toBe(true);
  });

  it("stores only what the evening actually says", () => {
    // `promotions` absent rather than present-and-undefined, so what reaches
    // the store is the disagreement and nothing else.
    expect(Object.keys(toEveningOverrides({ tableSelection: "off" }) ?? {})).toEqual(["tableSelection"]);
  });
});

describe("the restaurant-wide half", () => {
  it("reads an empty store as the app as it was", () => {
    expect(toEveningToggles(undefined)).toEqual(DEFAULT_EVENING_TOGGLES);
    expect(toEveningToggles("nonsense")).toEqual(DEFAULT_EVENING_TOGGLES);
    expect(toEveningToggles({})).toEqual(DEFAULT_EVENING_TOGGLES);
  });

  it("keeps a switch somebody actually set", () => {
    expect(toEveningToggles({ promotions: false })).toEqual({ promotions: false, selfService: true });
  });
});

/**
 * The route asks for a permission per switch **moved**, so an ordinary save of
 * an evening nobody is re-policying needs nothing beyond `dates:manage`.
 */
describe("which switches a save moves", () => {
  it("finds nothing moved when nothing changed", () => {
    expect(changedFeatures(undefined, undefined)).toEqual([]);
    expect(changedFeatures({ promotions: false }, { promotions: false })).toEqual([]);
  });

  it("finds a switch being set, cleared and changed", () => {
    expect(changedFeatures(undefined, { promotions: false })).toEqual(["promotions"]);
    expect(changedFeatures({ promotions: false }, undefined)).toEqual(["promotions"]);
    expect(changedFeatures({ tableSelection: "optional" }, { tableSelection: "required" })).toEqual([
      "tableSelection",
    ]);
  });

  /**
   * Clearing an override is a change even when the restaurant currently agrees
   * with it: "off" and "follows the restaurant, which is off today" are
   * different states, and only one of them moves when the setting does.
   */
  it("counts clearing an override that happens to match the default", () => {
    expect(changedFeatures({ promotions: true }, undefined)).toEqual(["promotions"]);
  });

  it("finds several at once", () => {
    expect(changedFeatures(undefined, { tableSelection: "required", selfService: false })).toEqual([
      "tableSelection",
      "selfService",
    ]);
  });
});

describe("saying it in words", () => {
  it("says nothing about an evening that follows the restaurant", () => {
    expect(describeOverrides(undefined)).toEqual([]);
    expect(describeOverrides({})).toEqual([]);
  });

  it("names only what this evening disagrees about", () => {
    expect(describeOverrides({ tableSelection: "required", promotions: false })).toEqual([
      "table selection required",
      "promotions off",
    ]);
  });
});
