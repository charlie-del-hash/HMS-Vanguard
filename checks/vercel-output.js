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
const { createRequire } = require("module");

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

console.log("Vercel will accept the routing config at all");

/* THE assertion in this file.
 *
 * .vercel/output/config.json is validated by the platform, not by the build.
 * Its route objects are `additionalProperties: false`, so a single unrecognised
 * key makes the whole config invalid and the deployment fails after the build
 * has already reported success. Nothing local validates it, so `npm run build`
 * is green either way and the only symptom is a red deployment nobody can read
 * the log of.
 *
 * That happened: vercel-config.mjs stamped `affinity-headers: true` onto each
 * route it merged, to make the merge idempotent, and every deployment failed
 * for a week while every check here passed. The schema is shipped inside
 * @vercel/routing-utils, so this validates the real output against the real
 * schema with the same validator Vercel uses. */
const { getTransformedRoutes, routesSchema } = require("@vercel/routing-utils");

t("every route validates against Vercel's own schema", () => {
  let Ajv;
  try {
    Ajv = createRequire(require.resolve("@vercel/routing-utils"))("ajv");
  } catch {
    try {
      Ajv = require("ajv");
    } catch {
      assert.fail("ajv is not resolvable, so the routing config cannot be validated");
    }
  }
  const one = new Ajv({ allErrors: true }).compile(routesSchema.items);

  /* A route matches one of two shapes — a real route or a `handle` marker — so
     the schema is a oneOf and the losing branch reports every key of the
     winning one as "additional". Naming the genuinely foreign keys means
     comparing against what either shape allows. */
  const variants = routesSchema.items.oneOf ?? routesSchema.items.anyOf ?? [routesSchema.items];
  const allowed = new Set(variants.flatMap((v) => Object.keys(v.properties ?? {})));

  const bad = [];
  for (const r of config.routes) {
    if (one(r)) continue;
    const foreign = Object.keys(r).filter((k) => !allowed.has(k));
    bad.push(
      `${JSON.stringify(r).slice(0, 80)} — ` +
        (foreign.length ? `unexpected key(s): ${foreign.join(", ")}` : "does not match either route shape"),
    );
  }
  assert.strictEqual(
    bad.length,
    0,
    `Vercel would reject this config and fail the deployment AFTER a successful ` +
      `build:\n          ${bad.join("\n          ")}`,
  );
});

console.log("headers reach the routing config");

const fsIndex = config.routes.findIndex((r) => r && r.handle === "filesystem");

/* Which routes did scripts/vercel-config.mjs put there? Recomputed from
   vercel.json through Vercel's own transformer — same input, same function the
   script uses — rather than recognised by a marker written into the route. The
   marker is what broke the deployments, so this check must not reintroduce one
   in order to do its job. */
const expectedHeaderRoutes = (
  getTransformedRoutes({ headers: vercelJson.headers ?? [] }).routes ?? []
)
  .filter((r) => r.headers)
  .map((r) => ({ ...r, continue: true }));
const want = new Set(expectedHeaderRoutes.map((r) => JSON.stringify(r)));
const headerRoutes = config.routes.filter((r) => r && want.has(JSON.stringify(r)));

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

  /* The corpus has to include the SERVER bundle, not just the static output.
     Once any page is server-rendered, the reference to its island's runtime
     lives inside the function rather than in a file on disk — so scanning
     static output alone reports a perfectly well-used bundle as dead weight.
     Which is worse than it sounds: the fix somebody reaches for is deleting
     the assertion, and it is the assertion that caught React shipping 187KB to
     every reader for nothing. */
  const serverFiles = [];
  const fnDir = path.join(OUT, "functions");
  if (fs.existsSync(fnDir)) {
    (function walkFn(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkFn(p);
        else if (/\.(mjs|js|json)$/.test(e.name)) serverFiles.push(p);
      }
    })(fnDir);
  }

  const corpus = [
    ...files
      .filter((f) => /\.(html|js|css)$/.test(f))
      .map((f) => ({ f, body: fs.readFileSync(path.join(STATIC, f.slice(1)), "utf8") })),
    ...serverFiles.map((p) => ({ f: `server:${p}`, body: fs.readFileSync(p, "utf8") })),
  ];
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

t("no public page pulls in a framework runtime", () => {
  /* astro.config.mjs says "Public pages ship no framework runtime". They did.
     Every one of them, /privacy included — a page with no island on it at all —
     downloaded 7.7KB of React, because EmailCapture did
     `await import("../lib/analytics")`. A namespace import makes the bundler
     emit an `__export` helper, the minifier parked that helper in the React
     chunk, and so the beacon imported React to get it.

     The assertion above cannot see this: the chunk IS referenced, by a real
     page, so it is not dead weight. It is live weight nobody wanted. This walks
     the module graph from each public page instead, and recognises React by
     what is INSIDE a chunk rather than by its filename, so renaming the chunk
     does not quietly retire the check. */
  const isFramework = (body) =>
    /react\.transitional|Minified React error|__SECRET_INTERNALS/.test(body);

  const chunk = (name) => path.join(STATIC, "_astro", name);
  const read = (name) => {
    try {
      return fs.readFileSync(chunk(name), "utf8");
    } catch {
      return null;
    }
  };

  const framework = new Set(
    files
      .filter((f) => f.startsWith("/_astro/") && f.endsWith(".js"))
      .map((f) => path.basename(f))
      .filter((n) => isFramework(read(n) ?? "")),
  );
  /* Nothing to find would make this pass vacuously for the wrong reason — the
     editor island is React and must still be in the output. */
  assert.ok(
    framework.size > 0,
    "no React chunk was found at all, so this assertion proved nothing; " +
      "if the admin editor is no longer a React island, delete this check",
  );

  const pages = files.filter((f) => f.endsWith(".html"));
  const bad = [];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(STATIC, page.slice(1)), "utf8");
    /* Entry points: <script type="module" src> and <link rel=modulepreload>. */
    const seen = new Set();
    const queue = [...html.matchAll(/\/_astro\/([A-Za-z0-9._-]+\.js)/g)].map((m) => m[1]);
    const trail = new Map(queue.map((n) => [n, [n]]));
    while (queue.length) {
      const name = queue.shift();
      if (seen.has(name)) continue;
      seen.add(name);
      const body = read(name);
      if (body === null) continue;
      if (framework.has(name)) {
        bad.push(`${page} → ${(trail.get(name) ?? [name]).join(" → ")}`);
        break;
      }
      for (const m of body.matchAll(/\.\/([A-Za-z0-9._-]+\.js)/g)) {
        if (seen.has(m[1])) continue;
        if (!trail.has(m[1])) trail.set(m[1], [...(trail.get(name) ?? [name]), m[1]]);
        queue.push(m[1]);
      }
    }
  }

  assert.strictEqual(
    bad.length,
    0,
    `these public pages download a framework runtime they have no island for:\n` +
      `          ${bad.join("\n          ")}`,
  );
});

console.log("one site, at one address");

/* ── the duplicate-site problem, asserted ─────────────────────────────
 *
 * Two Vercel projects build this repository. Retiring GitHub Pages removed one
 * copy of the site and left two, each on its own production domain, each
 * emitting a self-referencing canonical — the same failure, moved.
 *
 * scripts/hosts.mjs decides two things from the build environment: where
 * canonical links point, and whether this build's production domain should
 * 308 everything to the other one. Neither is observable by looking at a
 * successful build, which is exactly the shape of bug this file exists for, so
 * both are asserted here: the decision as a pure function, and its consequence
 * in the output that ships. */
const hosts = require("../scripts/hosts.mjs");

t("the redirect fires for a mirror's production domain and nothing else", () => {
  const canonical = `https://${hosts.CANONICAL_HOST}`;
  const mirror = hosts.MIRROR_HOSTS[0];
  assert.ok(mirror, "no mirror host is declared, so this assertion proves nothing");

  const cases = [
    ["a local build", {}, null],
    [
      "production on the canonical project",
      { VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: hosts.CANONICAL_HOST },
      null,
    ],
    [
      "production on a mirror",
      { VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: mirror },
      canonical,
    ],
    [
      "a mirror's PREVIEW, which reviewers still need",
      { VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: mirror },
      null,
    ],
    [
      "a mirror pinned as production by PUBLIC_SITE_URL",
      {
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: mirror,
        PUBLIC_SITE_URL: `https://${mirror}`,
      },
      null,
    ],
    /* The one that matters most. If this returned a target, renaming the
       production project would make PRODUCTION redirect to a domain that no
       longer exists — which is why MIRROR_HOSTS is an allowlist rather than
       "anything that is not canonical". */
    [
      "production on a project named in neither list",
      { VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "renamed-later.vercel.app" },
      null,
    ],
  ];

  const wrong = cases
    .map(([name, env, want]) => [name, want, hosts.redirectTarget(env)])
    .filter(([, want, got]) => want !== got)
    .map(([name, want, got]) => `${name}: expected ${want ?? "no redirect"}, got ${got ?? "no redirect"}`);
  assert.strictEqual(wrong.length, 0, wrong.join("\n          "));
});

t("this build ships no redirect off its own origin", () => {
  /* Whatever produced THIS output — a local build, CI, or the canonical
     project — it is not a mirror, so nothing in it may send a reader
     somewhere else. A stray 308 in the routing config takes the whole site
     off the air, and it would look exactly like a successful build. */
  const away = (config.routes ?? []).filter((r) => {
    const loc = r?.headers?.Location ?? r?.headers?.location;
    return loc && /^https?:\/\//.test(loc);
  });
  assert.strictEqual(
    away.length,
    0,
    `these routes redirect off-origin: ${away.map((r) => `${r.src} → ${r.headers.Location}`).join(", ")}`,
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
