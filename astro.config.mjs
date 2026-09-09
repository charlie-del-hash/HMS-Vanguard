// @ts-check
import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";
import react from "@astrojs/react";
import { existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/* The ops deck is served at / until the landing page exists.
 *
 * The deck lives in public/ and is copied into the build verbatim, so
 * /ops-deck.html is a real file and needs no rewrite. / has no file yet, and
 * the two bad answers are committing a second copy of the deck (HANDOFF.md is
 * explicit that a second copy drifts) or a redirect (which changes the URL a
 * reader sees, and that URL is the one being circulated).
 *
 * So: copy it into place at build time, exactly as .github/workflows/static.yml
 * already does for Pages — but only when nothing else claims /. The moment
 * src/pages/index.astro exists, Astro emits its own index.html, this hook finds
 * it and stands down. It retires itself rather than needing to be remembered.
 */
function deckAtRoot() {
  return {
    name: "affinity:deck-at-root",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        const out = fileURLToPath(dir);
        const index = join(out, "index.html");
        const deck = join(out, "ops-deck.html");
        if (existsSync(index)) return; // a real landing page has taken over
        if (!existsSync(deck)) {
          logger.warn("public/ops-deck.html is missing from the build — / will 404");
          return;
        }
        copyFileSync(deck, index);
        logger.info("no landing page yet — served the ops deck at /");
      },
    },
  };
}

export default defineConfig({
  site: "https://affinity-wine.vercel.app",
  output: "static",
  adapter: vercel({
    webAnalytics: { enabled: true },
    imageService: true,
  }),
  integrations: [react(), deckAtRoot()],
  build: { inlineStylesheets: "auto" },
  vite: { build: { cssMinify: "lightningcss" } },
});
