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
const DIST = path.join(ROOT, "dist");
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
  console.error("dist/ is missing — run `npm run build` first");
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
