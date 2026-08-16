import { describe, expect, it } from "vitest";
import { shortenDishName } from "@/lib/dish-name";

describe("short dish labels", () => {
  it("leaves a name of three words or fewer alone", () => {
    expect(shortenDishName("Duck Magret")).toBe("Duck Magret");
    expect(shortenDishName("Citrus Cured Salmon")).toBe("Citrus Cured Salmon");
    expect(shortenDishName("Crème Brûlée")).toBe("Crème Brûlée");
  });

  it("trims a long name to three words", () => {
    expect(shortenDishName("Roasted asparagus soup with hazelnut cream")).toBe("Roasted asparagus soup");
  });

  /** Filler goes first, so the words that identify the dish survive. */
  it("drops filler words before truncating", () => {
    expect(shortenDishName("Slow roasted lamb shoulder with rosemary jus")).toBe("Slow roasted lamb");
    expect(shortenDishName("Fillet of beef with a red wine reduction")).toBe("Fillet beef red");
  });

  it("keeps something meaningful when a name is all filler", () => {
    expect(shortenDishName("with and of the served")).toBe("with and of");
  });

  it("tidies stray whitespace", () => {
    expect(shortenDishName("  Sea   Bream  ")).toBe("Sea Bream");
    expect(shortenDishName("")).toBe("");
  });

  it("honours a different word limit", () => {
    expect(shortenDishName("Roasted asparagus soup with hazelnut cream", 2)).toBe("Roasted asparagus");
  });
});
