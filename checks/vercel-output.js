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

console.log("the deploy build installs only what it needs");

/* Vercel runs a build on this repo now, and main does not — main has a
   manifest but no `build` script, so the platform skips the build entirely
   there. That asymmetry is why main deployed green all week while every
   deployment of this branch failed, and why none of the checks noticed: they
   all run after a build that already worked, on a machine that is not Vercel.
   These four assertions are about the build Vercel runs, not the one we run. */

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const deps = pkg.dependencies ?? {};
const devDeps = pkg.devDependencies ?? {};

t("engines.node is in the form Vercel documents", () => {
  const node = pkg.engines?.node;
  assert.ok(node, "no engines.node — the Node version is then whatever Vercel defaults to");
  assert.match(
    node,
    /^\d+\.x$/,
    `engines.node is "${node}". Vercel documents MAJOR.x (e.g. "22.x") and this field ` +
      `OVERRIDES the project setting, so a form it will not parse fails the build before ` +
      `anything is installed.`,
  );
});

/* The bug: @vercel/routing-utils was a devDependency, and the build imports it.
   That works on any machine that installs devDependencies and nowhere else. */
t("nothing the build script runs imports a devDependency", () => {
  const scripts = [...(pkg.scripts?.build ?? "").matchAll(/node\s+(\S+\.m?js)/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0, "the build script runs no node scripts — did it change?");
  for (const rel of scripts) {
    const file = path.join(ROOT, rel);
    assert.ok(fs.existsSync(file), `the build runs ${rel}, which does not exist`);
    const body = fs.readFileSync(file, "utf8");
    const specifiers = [
      ...body.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g),
    ].map((m) => m[1]);
    for (const spec of specifiers) {
      if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) continue;
      const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      assert.ok(
        !devDeps[name],
        `${rel} imports ${name}, which is a devDependency. The build cannot complete ` +
          `without it, so it is a dependency — it only looked fine because every ` +
          `environment so far happened to install devDependencies too.`,
      );
      assert.ok(deps[name], `${rel} imports ${name}, which is not declared as a dependency`);
    }
  }
});

/* Playwright's postinstall downloads three browsers. Locally that is suppressed
   by PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD; on Vercel nothing suppresses it, and a
   deploy build has no reason to install a browser automation framework. */
t("the deploy build does not install Playwright", () => {
  assert.ok(
    !deps.playwright && !deps["playwright-core"],
    "Playwright is a dependency, so the deploy build installs it and downloads browsers",
  );
  const install = vercelJson.installCommand ?? "";
  assert.ok(
    /--omit[= ]dev|--production/.test(install),
    `vercel.json installCommand is ${JSON.stringify(install) || "unset"}. Without an ` +
      `explicit omit, Vercel installs devDependencies and Playwright fetches browsers ` +
      `on every deployment.`,
  );
});

t("the build's own dependencies survive a devDependency-free install", () => {
  for (const need of ["astro", "@astrojs/vercel"]) {
    assert.ok(deps[need], `${need} must be a dependency — the deploy build omits devDependencies`);
  }
});

console.log(`\nvercel-output: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
