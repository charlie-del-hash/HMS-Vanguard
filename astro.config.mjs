// @ts-check
import { defineConfig, envField } from "astro/config";
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
      /** @type {(ctx: { dir: URL, logger: { info(m: string): void, warn(m: string): void } }) => void} */
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
  /* Canonical URLs and the sitemap are built from this, so a wrong value here
     points every canonical at the wrong host — quietly, and for as long as
     nobody checks. It used to be a hard-coded constant naming a project that
     turned out not to be production.

     VERCEL_PROJECT_PRODUCTION_URL is the project's own production domain, set
     by the platform on preview builds as well as production ones, so a preview
     canonicalises to the real site rather than to itself. That makes the common
     case self-configuring: nothing to set, and nothing to get wrong when the
     domain changes.

     PUBLIC_SITE_URL overrides it, and that override is what you want if a
     SECOND Vercel project is still building this repo — otherwise each project
     canonicalises to itself and Google sees two copies of the same site. Pin
     both to the production domain, or stop the second project building. */
  site:
    process.env.PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:4321"),
  output: "static",
  adapter: vercel({
    webAnalytics: { enabled: true },
    /* imageService is deliberately off. It routes images through Vercel's
       optimizer, which is a metered resource on Hobby — and there is not one
       image in this build yet. Turn it on with the first hero image, not
       before. */
  }),

  /* Typed environment, and the reason it is worth the ceremony:
     `astro:env/server` with access "secret" is a BUILD-TIME error if a client
     bundle imports it. The previous arrangement read import.meta.env and threw
     at call time if `window` existed. That never leaked the key — Vite compiles
     a non-PUBLIC var to `void 0` in client code, which was verified with a
     canary — but it failed quietly in the other direction: a client script
     importing the server module pulled 215KB of Supabase SDK into the page, and
     a guard that only fires when the function is called said nothing. */
  env: {
    schema: {
      PUBLIC_SUPABASE_URL: envField.string({
        context: "client",
        access: "public",
        optional: true,
      }),
      PUBLIC_SUPABASE_PUBLISHABLE_KEY: envField.string({
        context: "client",
        access: "public",
        optional: true,
      }),
      /* The research portal this whole site funnels towards. Optional because
         nobody has given it yet, and the CTA says so rather than linking
         somewhere invented — see src/lib/config.ts. */
      PUBLIC_PORTAL_URL: envField.string({
        context: "client",
        access: "public",
        optional: true,
      }),
      /* Optional so a build without it still succeeds — nothing reads it until
         the admin and the analytics endpoint exist. It becomes required the
         moment something server-side depends on it. */
      SUPABASE_SERVICE_ROLE_KEY: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
      /* A Vercel deploy hook, so publishing a report can rebuild the site.
         Report pages are prerendered, so a publish is invisible to readers
         until a build runs; this is what makes "publish" mean it.

         Secret, because anyone holding the URL can trigger builds on this
         project for as long as it exists. Optional, because without it the
         admin says plainly that a rebuild is needed rather than pretending
         the report is live. */
      VERCEL_DEPLOY_HOOK_URL: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
    },
  },

  /* React is registered now, and only now: the admin's block editor is the
     first island that actually hydrates. It stayed unregistered through Phases
     0-2 because an integration with nothing using it emitted a 188KB client
     runtime that no page referenced, shipped in every deployment, and
     checks/vercel-output.js fails if an unreferenced bundle comes back.

     Public pages are unaffected — they ship no framework runtime, because
     nothing on them is an island. The editor is behind auth and is the only
     thing that pays for React. */
  integrations: [react(), deckAtRoot()],

  build: { inlineStylesheets: "auto" },
  vite: { build: { cssMinify: "lightningcss" } },
});
