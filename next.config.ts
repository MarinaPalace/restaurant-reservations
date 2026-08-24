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
  },
};

export default nextConfig;
