import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    globals: true,
    /**
     * Ten suites each start their own in-memory MongoDB and run at once, so a
     * single query can wait far longer than it ever would in the app — not
     * because anything is slow, but because ten cold servers are competing for
     * the same cores. At the 5s default those suites failed perhaps one run in
     * four, always on a different test, which is the most expensive kind of red
     * there is: it teaches people to re-run rather than to look.
     *
     * Fifteen seconds is still nowhere near a hang, so a test that genuinely
     * stops still fails rather than hanging the run.
     */
    testTimeout: 15_000,
  },
});
