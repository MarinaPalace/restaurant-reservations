/**
 * Short dish labels for the service sheet.
 *
 * The printed sheet is a wide matrix — a column per dish — and full menu
 * wording ("Slow roasted lamb shoulder with rosemary jus") makes it impossible
 * to fit an evening on one page. Waiters recognise a dish from a few words, so
 * the columns carry a trimmed label while the kitchen slip keeps the full name.
 */

/** Words that carry no recognition value and are dropped first. */
const FILLER = new Set([
  "with", "and", "of", "in", "on", "a", "an", "the", "served", "over", "under",
  "topped", "fresh", "house", "our", "style", "de", "du", "la", "le", "au", "aux",
]);

const MAX_WORDS = 3;

export function shortenDishName(name: string, maxWords = MAX_WORDS) {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "";
  }

  const words = trimmed.split(" ");
  if (words.length <= maxWords) {
    return trimmed;
  }

  // Drop filler first, so "Slow roasted lamb shoulder with rosemary" keeps the
  // words that identify the dish rather than the first three in the sentence.
  const significant = words.filter((word) => !FILLER.has(word.toLowerCase().replace(/[^\p{L}]/gu, "")));
  const chosen = significant.length > 0 ? significant : words;

  return chosen.slice(0, maxWords).join(" ");
}
