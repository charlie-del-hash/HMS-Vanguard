/* What Vercel will actually deploy.
 *
 * Every finding of the hosting audit, turned into an assertion. These all
 * share a shape: the thing looked configured, and was not. A config file that
 * validates and does nothing is worse than a missing one, because it stops
 * anybody looking again.
 *
 *   headers      vercel.json's `headers` are NOT merged by the Astro adapter —
 *                it reads that file only to warn about trailingSlash. They are
 *                spliced in by scripts/vercel-config.mjs, and this checks the
 *                splice happened and landed before `handle: filesystem`.
 *   404          the generated config routes misses to /404.html. For a week
 *                that file did not exist.
 *   dead weight  a registered-but-unused framework integration ships a client
 *                runtime nothing references. React cost 188KB of that.
 *   surface      only .vercel/output is deployed, so checks/, scripts/ and
 *                HANDOFF.md are no longer reachable on the shared domain —
 *                which closes the .vercelignore question in HANDOFF.md. This
 *                asserts it stays closed.
 *
 * Runs offline against the build output. No browser, no network.
 *
 *   npm run build && node checks/vercel-output.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, ".vercel", "output");
const STATIC = path.join(OUT, "static");
const CONFIG = path.join(OUT, "config.json");

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok    ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${name}\n          ${e.message}`);
  }
}

if (!fs.existsSync(CONFIG)) {
  console.error("no .vercel/output — run `npm run build` first");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
const vercelJson = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push("/" + path.relative(STATIC, p).split(path.sep).join("/"));
  }
})(STATIC);

console.log("headers reach the routing config");

const fsIndex = config.routes.findIndex((r) => r && r.handle === "filesystem");
const headerRoutes = config.routes.filter((r) => r && r.headers && r["affinity-headers"]);

t("every header source in vercel.json produced a route", () => {
  const declared = vercelJson.headers?.length ?? 0;
  assert.ok(declared > 0, "vercel.json declares no headers — did it lose them?");
  assert.strictEqual(
    headerRoutes.length,
    declared,
    `vercel.json declares ${declared} header source(s) but the output has ${headerRoutes.length}. ` +
      `Did the build run scripts/vercel-config.mjs?`,
  );
});

t("header routes come before `handle: filesystem`", () => {
  assert.notStrictEqual(fsIndex, -1, "no filesystem handler in the routing config");
  for (const r of headerRoutes) {
    const i = config.routes.indexOf(r);
    assert.ok(
      i < fsIndex,
      `header route ${r.src} is at ${i}, after the filesystem handler at ${fsIndex} — ` +
        `it would only run for requests that missed a file`,
    );
  }
});

t("header routes continue rather than terminating the match", () => {
  for (const r of headerRoutes) {
    assert.strictEqual(r.continue, true, `${r.src} does not set continue:true`);
  }
});

t("the security headers are actually among them", () => {
  const all = Object.assign({}, ...headerRoutes.map((r) => r.headers));
  const keys = Object.keys(all).map((k) => k.toLowerCase());
  for (const want of ["x-content-type-options", "referrer-policy"]) {
    assert.ok(keys.includes(want), `${want} is not set on any route`);
  }
});

console.log("the output is complete");

t("every dest the config routes to exists", () => {
  for (const r of config.routes) {
    if (!r || typeof r.dest !== "string") continue;
    if (!r.dest.startsWith("/") || r.dest.includes("$")) continue; // dynamic
    assert.ok(
      files.includes(r.dest),
      `the config routes to ${r.dest} but the build never produced it`,
    );
  }
});

t("the deck is served, and served at / too", () => {
  assert.ok(files.includes("/ops-deck.html"), "the ops deck is missing from the build");
  assert.ok(files.includes("/index.html"), "/ has no file");
});

t("the deck in the output is byte-identical to the source", () => {
  const src = fs.readFileSync(path.join(ROOT, "public", "ops-deck.html"));
  for (const f of ["/ops-deck.html", "/index.html"]) {
    const out = fs.readFileSync(path.join(STATIC, f.slice(1)));
    if (f === "/index.html" && !out.equals(src)) return; // a real landing page took over
    assert.ok(out.equals(src), `${f} is not byte-identical to public/ops-deck.html`);
  }
});

console.log("nothing ships that nothing uses");

t("no client bundle is unreferenced", () => {
  const bundles = files.filter((f) => f.startsWith("/_astro/") && f.endsWith(".js"));
  const corpus = files
    .filter((f) => /\.(html|js|css)$/.test(f))
    .map((f) => ({ f, body: fs.readFileSync(path.join(STATIC, f.slice(1)), "utf8") }));
  const orphans = bundles.filter(
    (b) => !corpus.some((c) => c.f !== b && c.body.includes(path.basename(b))),
  );
  const sized = orphans.map(
    (o) => `${o} (${Math.round(fs.statSync(path.join(STATIC, o.slice(1))).size / 1024)}KB)`,
  );
  assert.strictEqual(
    orphans.length,
    0,
    `nothing loads these, so they are dead weight in every deploy: ${sized.join(", ")}. ` +
      `A framework integration registered with no island using it does this.`,
  );
});

console.log("the deployed surface is only the build");

t("no repository file is reachable on the domain", () => {
  for (const leaked of ["/HANDOFF.md", "/README.md", "/package.json", "/vercel.json"]) {
    assert.ok(!files.includes(leaked), `${leaked} is being served`);
  }
  for (const dir of ["/checks/", "/scripts/", "/src/", "/supabase/"]) {
    const hit = files.find((f) => f.startsWith(dir));
    assert.ok(!hit, `${dir} is being served (${hit})`);
  }
});

t("no environment file is in the output", () => {
  const hit = files.find((f) => /(^|\/)\.env($|\.)/.test(f));
  assert.ok(!hit, `${hit} is in the deployed output`);
});

console.log(`\nvercel-output: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
