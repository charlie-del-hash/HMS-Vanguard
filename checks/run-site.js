/* Serve the built site on a loopback port and run the site checks against it.
 *
 * The deck's runner (checks/run.js) serves one file from memory. The site is a
 * directory of them, so this one serves dist/ — the real build output, never
 * the source — and hands each check the URL in SITE_URL.
 *
 *   npm run build && node checks/run-site.js
 *   node checks/run-site.js site-charts        # a subset
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

/* Serve what actually DEPLOYS, not `dist/`.
 *
 * This served dist/ until the admin added the first server-rendered page, at
 * which point Astro restructured the output into dist/client and dist/server —
 * and every request here started 404ing. site-overflow then reported 196/196
 * clean, because a 404 page does not scroll sideways either. A check that
 * passes while looking at nothing is worse than a missing one.
 *
 * .vercel/output/static is the artifact the edge serves, it is what
 * vercel-output.js already treats as authoritative, and it does not move when
 * the rendering mode changes. */
const DIST = path.join(ROOT, ".vercel", "output", "static");
const ORDER = ["vercel-output", "site-report", "site-charts", "site-overflow"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

if (!fs.existsSync(DIST)) {
  console.error(`${path.relative(ROOT, DIST)} is missing — run \`npm run build\` first`);
  process.exit(1);
}

/* A served tree with no index.html is the shape the dist/client move made, and
   it is indistinguishable from "everything 404s" once the checks are running.
   Stop here instead, where the message can say what happened. */
if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(
    `${path.relative(ROOT, DIST)} has no index.html. The build output moved — ` +
      `check where astro is writing static pages before trusting any result below.`,
  );
  process.exit(1);
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const checks = wanted.length ? wanted : ORDER;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  // Never serve outside dist/, whatever the request says.
  let file = path.join(DIST, path.normalize(url).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    return res.end("no");
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("not found");
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(fs.readFileSync(file));
});

server.listen(0, "127.0.0.1", async () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  let failed = 0;
  for (const name of checks) {
    const file = path.join(__dirname, `${name}.js`);
    if (!fs.existsSync(file)) {
      console.log(`\n— ${name}\n  no such check`);
      failed++;
      continue;
    }
    console.log(`\n— ${name}`);
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [file], {
        stdio: "inherit",
        env: { ...process.env, SITE_URL: url },
      });
      child.on("exit", resolve);
    });
    if (code) failed++;
  }
  server.close();
  console.log(failed ? `\n${failed} check(s) failed` : "\nall site checks passed");
  process.exit(failed ? 1 : 0);
});
