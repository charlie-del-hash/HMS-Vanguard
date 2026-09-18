/* Put vercel.json's headers into the file Vercel actually routes from.
 *
 * ── the bug this exists to fix ───────────────────────────────────────
 * The Astro Vercel adapter builds through the Build Output API: it writes
 * `.vercel/output/config.json`, and that file is what the edge routes from.
 * It reads `vercel.json` for exactly one thing — a warning if `trailingSlash`
 * conflicts with the Astro config — and merges nothing from it.
 *
 * So a `headers` block sitting in vercel.json is not applied. It looks applied,
 * it validates against the schema, it survives review, and it does nothing.
 * `X-Content-Type-Options: nosniff` was in there for a week doing nothing.
 *
 * ── why a post-build step rather than an integration hook ────────────
 * An `astro:build:done` hook is the obvious home, but hook order decides
 * whether it runs before or after the adapter writes config.json — and it runs
 * BEFORE, so anything written there is overwritten. `npm run build` chains this
 * explicitly instead, which has no ordering to get wrong and runs identically
 * on Vercel, since Vercel runs the build script.
 *
 * The header sources are converted with Vercel's OWN `getTransformedRoutes`,
 * the same function the platform uses for vercel.json, so `/(.*)` becomes the
 * regex the platform would have produced rather than one I guessed at.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTransformedRoutes } from "@vercel/routing-utils";
import { redirectTarget } from "./hosts.mjs";

const root = new URL("../", import.meta.url);
const vercelJsonPath = fileURLToPath(new URL("vercel.json", root));
const configPath = fileURLToPath(new URL(".vercel/output/config.json", root));

if (!existsSync(configPath)) {
  console.error(
    "[vercel-config] .vercel/output/config.json is missing — run `astro build` first.",
  );
  process.exit(1);
}

const vercelJson = existsSync(vercelJsonPath)
  ? JSON.parse(readFileSync(vercelJsonPath, "utf8"))
  : {};

const config = JSON.parse(readFileSync(configPath, "utf8"));
config.routes ??= [];

/* ── routes built through Vercel's own transformer ────────────────────
 * Both the header routes and the mirror redirect go through
 * getTransformedRoutes, which is the function the platform itself applies to
 * vercel.json. Hand-written `src` regexes would be a second implementation of
 * a thing Vercel already does, differing in exactly the cases nobody tests. */
function transform(what, input) {
  const { routes, error } = getTransformedRoutes(input);
  if (error) {
    console.error(`[vercel-config] ${what} is invalid: ${error.message}`);
    process.exit(1);
  }
  return routes ?? [];
}

const merged = transform("vercel.json headers", { headers: vercelJson.headers ?? [] })
  .filter((r) => r.headers) // getTransformedRoutes also emits phase markers
  .map((r) => ({ ...r, continue: true }));

/* ── the mirror redirect ──────────────────────────────────────────────
 *
 * Two Vercel projects build this repository, so without this both production
 * domains serve the whole site and each claims to be the original. Canonical
 * links now name one host (scripts/hosts.mjs), which tells a crawler which
 * copy to keep — but a reader handed the other URL still reads the other copy,
 * and analytics still splits in two.
 *
 * So the mirror's PRODUCTION domain serves nothing: everything 308s to the
 * canonical origin, method and body preserved. Previews are untouched, because
 * a preview is how a branch gets reviewed and it is not a public address
 * competing for readers.
 *
 * This is deliberately first in the route list. A redirect that runs after
 * `handle: filesystem` only fires for requests that missed a file, which is
 * the opposite of what it is for. */
const target = redirectTarget();
const redirects = target
  ? transform("the mirror redirect", {
      redirects: [{ source: "/:path*", destination: `${target}/:path*`, permanent: true }],
    }).filter((r) => r.status)
  : [];

/* Idempotent, and deliberately WITHOUT a marker of our own on the route.
 *
 * This used to stamp each merged route with `affinity-headers: true` and drop
 * stamped routes before re-merging. It read cleanly and it broke every
 * deployment for a week: Vercel validates .vercel/output/config.json against a
 * schema whose route objects are `additionalProperties: false`, so one foreign
 * key makes the whole config invalid and the deployment fails AFTER the build
 * reports success. Nothing local validates that file, so `npm run build` stayed
 * green the entire time. checks/vercel-output.js now runs Vercel's own schema
 * over the output, which is the assertion that would have caught it on day one.
 *
 * So identity comes from the route itself. We rebuild the same routes from the
 * same vercel.json every run, so a previous run's copies are deep-equal to this
 * run's and are dropped by comparison. Serialised rather than compared field by
 * field because both sides are built by the same code path in the same order. */
const fingerprint = (r) => JSON.stringify(r);
const mine = new Set([...merged, ...redirects].map(fingerprint));
config.routes = config.routes.filter((r) => !mine.has(fingerprint(r)));

/* Before `handle: filesystem`. A header route placed after it only runs for
   requests that missed a file, which is every request except the ones these
   headers are for. */
const fsIndex = config.routes.findIndex((r) => r?.handle === "filesystem");
if (fsIndex === -1) {
  config.routes.unshift(...merged);
} else {
  config.routes.splice(fsIndex, 0, ...merged);
}

/* Ahead of everything, including the headers: there is no point setting a
   security header on a response that is only a Location. */
config.routes.unshift(...redirects);

writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
console.log(
  `[vercel-config] merged ${merged.length} header route(s) into .vercel/output/config.json`,
);
for (const r of merged) {
  console.log(`  ${r.src}  →  ${Object.keys(r.headers).join(", ")}`);
}
if (redirects.length) {
  console.log(
    `[vercel-config] this is a MIRROR project (${process.env.VERCEL_PROJECT_PRODUCTION_URL}) — ` +
      `its production domain 308s everything to ${target}`,
  );
} else if (process.env.VERCEL_ENV === "production") {
  console.log("[vercel-config] production build of the canonical project — serving normally");
}
