import type { NextConfig } from "next";

const ONE_YEAR_SECONDS = 31536000;

const nextConfig: NextConfig = {
  images: {
    /**
     * AVIF first, WebP behind it. A dish photograph is exactly the kind of
     * image AVIF is good at — large, photographic, no hard edges — and it
     * lands well under half the JPEG it replaces. Browsers that cannot read it
     * get WebP, and anything older gets the original.
     */
    formats: ["image/avif", "image/webp"],
    /**
     * The widths a phone or laptop actually paints a dish at. The default list
     * runs up to 3840px, which for a card that is never wider than the screen
     * only ever means a bigger file than anyone can see.
     */
    deviceSizes: [360, 420, 640, 828, 1080, 1200, 1920],
    /**
     * Optimised copies are keyed by source URL, and every uploaded photo
     * carries a content hash in its query string. Replacing a photo therefore
     * produces a different key rather than a stale hit, so there is nothing to
     * gain from expiring these sooner.
     */
    minimumCacheTTL: ONE_YEAR_SECONDS,
    /**
     * Next refuses to optimise a local image carrying a query string unless it
     * is named here — the default is `[{ pathname: "**", search: "" }]`, and an
     * uploaded dish photo is `/api/menu/images/<id>?v=<hash>`, so every one of
     * them came back a 400 (`INVALID_IMAGE_OPTIMIZE_REQUEST` on Vercel).
     *
     * Omitting `search` on the first entry is what allows any `?v=`: the check
     * is skipped when a pattern does not state one. It stays narrow to the
     * route that serves our own uploads. The second entry is the default,
     * restated because declaring this list replaces it — without it, every
     * other local image would silently stop being optimised.
     */
    localPatterns: [{ pathname: "/api/menu/images/**" }, { pathname: "**", search: "" }],
  },
};

export default nextConfig;
