import sharp from "sharp";
import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { MAX_IMAGE_EDGE, TARGET_IMAGE_BYTES } from "@/lib/image-compression";
import { MenuCourseModel } from "@/lib/models/menu-course";
import { MenuOptionModel } from "@/lib/models/menu-option";
import { decodeStoredImage, isStoredImage } from "@/lib/menu-images";

/**
 * Re-encodes the dish photographs already in the database.
 *
 *   npm run recompress:images          # says what it would do, changes nothing
 *   npm run recompress:images -- --apply
 *
 * Run it with the deployment's environment (for Vercel: `vercel env pull
 * .env.local` first), because it edits that deployment's menu.
 *
 * Why it exists: the uploader's quality ladder used to stop early, so a
 * detailed photo could be stored at around 500 KB and kept, and thirty of those
 * is what the menu was carrying. The ladder is stricter now, but only for new
 * uploads — nothing rewrites what was already saved.
 *
 * Guests will not see the difference: `next/image` re-encodes these per device
 * anyway, so they were never downloading the stored file. What shrinks is the
 * database, the menu editor that has to load these records, and the first fetch
 * the optimiser makes of each photo.
 *
 * The same shape as the browser does it, and deliberately from the same
 * constants, so a photo re-encoded here and one uploaded tomorrow agree.
 */

const QUALITY_LADDER = [82, 72, 62, 50, 40, 32, 25];

const apply = process.argv.includes("--apply");

function kb(bytes: number) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function recompress(dataUrl: string): Promise<{ dataUrl: string; bytes: number } | null> {
  const decoded = decodeStoredImage(dataUrl);

  if (!decoded) {
    return null;
  }

  // An SVG is vector and usually tiny; rasterising one only makes it worse.
  if (decoded.contentType === "image/svg+xml") {
    return null;
  }

  const base = sharp(decoded.body).rotate().resize({
    width: MAX_IMAGE_EDGE,
    height: MAX_IMAGE_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  });

  let best: Buffer | null = null;

  for (const quality of QUALITY_LADDER) {
    // `flatten` gives a transparent PNG a white backing rather than a black one.
    best = await base.clone().flatten({ background: "#ffffff" }).jpeg({ quality }).toBuffer();

    if (best.byteLength <= TARGET_IMAGE_BYTES) {
      break;
    }
  }

  if (!best) {
    return null;
  }

  return { dataUrl: `data:image/jpeg;base64,${best.toString("base64")}`, bytes: best.byteLength };
}

async function main() {
  if (!isMongoConfigured()) {
    console.log("MONGODB_URI is not set — there is no stored menu to re-encode.");
    process.exit(1);
  }

  await connectToDatabase();

  let seen = 0;
  let rewritten = 0;
  let before = 0;
  let after = 0;

  for (const model of [MenuCourseModel, MenuOptionModel]) {
    const records = (await model.find({}).select("imageUrl name").lean()) as {
      _id: unknown;
      name?: string;
      imageUrl?: string;
    }[];

    for (const record of records) {
      if (!isStoredImage(record.imageUrl)) {
        continue;
      }

      seen += 1;
      const originalBytes = decodeStoredImage(record.imageUrl as string)?.body.byteLength ?? 0;
      const result = await recompress(record.imageUrl as string);

      if (!result) {
        console.log(`  ? ${record.name ?? record._id} — could not be read as an image, left alone`);
        continue;
      }

      before += originalBytes;

      /**
       * A photo that is already small enough is left exactly as it is. Re-encoding
       * a JPEG always loses something, and there is nothing to win here.
       */
      if (result.bytes >= originalBytes) {
        after += originalBytes;
        console.log(`  = ${record.name ?? record._id} — ${kb(originalBytes)}, already as small`);
        continue;
      }

      after += result.bytes;
      rewritten += 1;
      const saved = Math.round((1 - result.bytes / originalBytes) * 100);
      console.log(
        `  ${apply ? "✓" : "→"} ${record.name ?? record._id} — ${kb(originalBytes)} → ${kb(result.bytes)} (${saved}% smaller)`,
      );

      if (apply) {
        await model.findByIdAndUpdate(record._id, { imageUrl: result.dataUrl });
      }
    }
  }

  console.log("");
  console.log(`  ${seen} photograph(s) found, ${rewritten} worth re-encoding.`);
  console.log(`  ${kb(before)} → ${kb(after)}`);

  if (!apply && rewritten > 0) {
    console.log("");
    console.log("  Nothing was changed. Re-run with --apply to write it.");
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
