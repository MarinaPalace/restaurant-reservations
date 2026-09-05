import type { ReservationCard } from "@/lib/reservation-card";

/**
 * The card, drawn as an image the guest can keep.
 *
 * ## Why this is drawn in the browser
 *
 * The obvious place is the server — it already draws the QR — and it was the
 * first plan. It was wrong for one reason that only shows up in production:
 * rasterising text server-side means rendering with whatever fonts the runtime
 * happens to have, and a serverless runtime has almost none. The failure is
 * silent and it is the guest who finds it: a card in a fallback face, or with
 * the number missing entirely, saved to their phone days before they need it.
 *
 * The browser already has the fonts, has laid the same card out on the screen
 * behind this, and can hand back a real PNG. So the server draws the code —
 * which is exactly what it is good at, and the one thing that must not be
 * attempted in the browser (`lib/qr.ts`) — and the browser draws the card.
 *
 * ## Nothing is measured that is not drawn
 *
 * No screenshot library, no cloning of the DOM. This paints from
 * `ReservationCard`, the same description the screen renders from, so the image
 * and the page cannot say different things.
 */

/**
 * Drawn at twice the finished size and scaled down by the canvas, so the card
 * is sharp on a phone screen and holds up when somebody pinches into the
 * number at a lectern.
 */
const SCALE = 2;

const WIDTH = 640;
const HEIGHT = 940;
const PADDING = 48;

/**
 * The card's own colours, written here rather than read from CSS custom
 * properties.
 *
 * A saved image has no theme: it is opened in a photo gallery, printed, and
 * shown on somebody else's screen. Reading the page's tokens would produce a
 * near-black card for a guest who happened to be in dark mode, which prints as
 * a solid block of ink and photographs badly. So the card is always the light
 * one — the same parchment and espresso as the printed pass-key cards, which is
 * what the guest will see it next to.
 */
const INK = "#17130f";
const INK_MUTED = "#5a4e44";
const INK_SUBTLE = "#75655a";
const CANVAS = "#faf7f2";
const SURFACE = "#ffffff";
const LINE = "#e6dbca";
const ACCENT = "#8a6431";
const GOLD = "#c9a96a";

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

/** Letter-spaced small caps, which canvas has no property for. */
function drawTracked(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
) {
  let cursor = x;

  for (const character of text) {
    context.fillText(character, cursor, y);
    cursor += context.measureText(character).width + tracking;
  }
}

/** The same, measured, so it can be centred. */
function trackedWidth(context: CanvasRenderingContext2D, text: string, tracking: number) {
  let total = 0;

  for (const character of text) {
    total += context.measureText(character).width + tracking;
  }

  return Math.max(0, total - tracking);
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The code could not be drawn."));
    /**
     * The QR arrives as a data URI, so this never touches the network and never
     * taints the canvas — `toBlob` on a tainted canvas throws, which would turn
     * a decorative failure into a card that cannot be saved at all.
     */
    image.src = source;
  });
}

/**
 * Paints the card and hands back a PNG.
 *
 * `qrDataUri` may be null. A card without the code is still the card — the
 * number is printed on it at a size anybody can read out, and staff can type
 * it — so a missing code leaves a gap rather than failing the download.
 */
export async function drawReservationCard(
  card: ReservationCard,
  qrDataUri: string | null,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * SCALE;
  canvas.height = HEIGHT * SCALE;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("This browser cannot save the card as an image.");
  }

  context.scale(SCALE, SCALE);
  context.textBaseline = "alphabetic";

  // ---- ground --------------------------------------------------------
  context.fillStyle = CANVAS;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  // A gold rule across the top, the one flourish the printed cards carry.
  context.fillStyle = GOLD;
  context.fillRect(0, 0, WIDTH, 6);

  const centre = WIDTH / 2;
  let y = PADDING + 34;

  // ---- house ---------------------------------------------------------
  context.fillStyle = INK;
  context.font = `600 30px ${SANS}`;
  context.textAlign = "center";
  context.fillText(card.restaurantName, centre, y);

  y += 26;
  context.fillStyle = ACCENT;
  context.font = `500 12px ${SANS}`;
  context.textAlign = "left";
  const tagline = card.tagline.toUpperCase();
  drawTracked(context, tagline, centre - trackedWidth(context, tagline, 3) / 2, y, 3);

  // ---- the number, which is the point of the card --------------------
  y += 44;
  const numberBoxHeight = 118;

  context.fillStyle = SURFACE;
  context.strokeStyle = LINE;
  context.lineWidth = 1;
  roundedRect(context, PADDING, y, WIDTH - PADDING * 2, numberBoxHeight, 10);
  context.fill();
  context.stroke();

  context.fillStyle = INK_SUBTLE;
  context.font = `500 11px ${SANS}`;
  const numberLabel = card.numberLabel.toUpperCase();
  drawTracked(context, numberLabel, centre - trackedWidth(context, numberLabel, 2.5) / 2, y + 32, 2.5);

  context.fillStyle = INK;
  context.font = `600 38px ${MONO}`;
  context.textAlign = "center";
  context.fillText(card.reservationNumber, centre, y + 82);

  // ---- the booking ---------------------------------------------------
  y += numberBoxHeight + 34;
  context.textAlign = "left";

  for (const row of card.rows) {
    context.fillStyle = INK_SUBTLE;
    context.font = `400 15px ${SANS}`;
    context.fillText(row.label, PADDING, y);

    context.fillStyle = INK;
    context.font = `600 17px ${SANS}`;
    context.textAlign = "right";
    context.fillText(row.value, WIDTH - PADDING, y);

    if (row.note) {
      context.fillStyle = INK_MUTED;
      context.font = `400 12px ${SANS}`;
      context.fillText(row.note, WIDTH - PADDING, y + 17);
    }

    context.textAlign = "left";
    y += row.note ? 44 : 30;

    context.strokeStyle = LINE;
    context.beginPath();
    context.moveTo(PADDING, y - 12);
    context.lineTo(WIDTH - PADDING, y - 12);
    context.stroke();
  }

  // ---- the code ------------------------------------------------------
  const qrSize = 200;
  const qrY = HEIGHT - PADDING - 118 - qrSize;

  if (qrDataUri) {
    try {
      const image = await loadImage(qrDataUri);

      context.fillStyle = SURFACE;
      roundedRect(context, centre - qrSize / 2 - 12, qrY - 12, qrSize + 24, qrSize + 24, 8);
      context.fill();

      context.drawImage(image, centre - qrSize / 2, qrY, qrSize, qrSize);
    } catch {
      // Drawn without it. The number above is the fallback, and it is legible
      // from across a room, which is more than can be said for a broken code.
    }
  }

  // ---- footnote ------------------------------------------------------
  context.fillStyle = INK_MUTED;
  context.font = `400 13px ${SANS}`;
  context.textAlign = "center";

  for (const [index, line] of wrap(context, card.footnote, WIDTH - PADDING * 2).entries()) {
    context.fillText(line, centre, HEIGHT - PADDING - 44 + index * 19);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The card could not be saved."))),
      "image/png",
    );
  });
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

/** Greedy wrap. The footnote is one sentence; anything cleverer is wasted here. */
function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines;
}
