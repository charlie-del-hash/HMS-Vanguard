/* Serve the site with SSR and run the admin checks against it.
 *
 * run-site.js serves `dist/` as static files, which is exactly right for the
 * public pages and useless for these: /admin/* is server-rendered, so there is
 * no file to serve. This starts the real dev server instead, which runs the
 * same middleware, the same guard and the same routes the deployment will.
 *
 * CONTENT_SOURCE=seed because the public pages this also touches would
 * otherwise try to read Supabase, which is unreachable from here — and the
 * content loader's whole design is that it fails rather than falling back.
 *
 *   node checks/run-admin.js
 */
const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/* A random high port by default, and a hard refusal if anything is already on
   it.
 *
 * This was a fixed 4399, and a dev server left over from a previous run held
 * it: the runner's own server failed to bind, the reachability probe got a
 * cheerful 200 from the STALE one, and every check then ran against code from
 * before the edit under test. A deliberately broken guard passed all fifteen
 * assertions. A check measuring the wrong server is worse than no check,
 * because it reports safety it has not looked at. */
const PORT = Number(process.env.ADMIN_PORT || 0) || 4400 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function reachable(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${BASE}/admin/login`, { redirect: "manual" });
      if (res.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await wait(400);
  }
  return false;
}

(async () => {
  /* If anything answers here already, it is not ours and we cannot tell its
     responses from the ones we are about to test. Stop rather than guess. */
  try {
    await fetch(`${BASE}/`, { redirect: "manual", signal: AbortSignal.timeout(1500) });
    console.error(
      `something is already listening on ${BASE}. Refusing to run, because a check that ` +
        `talks to a server it did not start is measuring code it did not build.`,
    );
    process.exit(1);
  } catch {
    /* nothing there — which is what we want */
  }

  const dev = spawn(
    process.execPath,
    [
      path.join(ROOT, "node_modules", "astro", "bin", "astro.mjs"),
      "dev",
      "--port",
      String(PORT),
      "--host",
      "127.0.0.1",
      /* Astro keeps a BACKGROUND dev server and a lock file, so a plain
         `astro dev` finds one already running and exits without starting ours
         — and a leftover daemon from an earlier run then answers the checks on
         code from before the edit under test. That is how a deliberately
         broken auth guard passed all fifteen assertions once. --ignore-lock
         means this always gets its own server on its own port. */
      "--ignore-lock",
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        CONTENT_SOURCE: "seed",
        /* Astro auto-detects an "AI agent environment" and forces the dev
           server into the BACKGROUND as a detached daemon — which survives
           killing this child, keeps its port, and answers a later run's checks
           on stale code. Setting this variable to anything non-empty turns the
           auto-detection off (it is only ever read as `!process.env....`), so
           the server is an ordinary foreground child of this process and dies
           with it. */
        ASTRO_DEV_BACKGROUND: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let log = "";
  dev.stdout.on("data", (d) => (log += d));
  dev.stderr.on("data", (d) => (log += d));

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      dev.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  };
  process.on("exit", stop);
  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });

  if (!(await reachable(40_000))) {
    console.error("the dev server never came up:\n");
    console.error(log.slice(-2000));
    stop();
    process.exit(1);
  }

  let code = 0;
  for (const name of ["site-admin", "site-funnel", "admin-overflow"]) {
    code = (await runCheck(name)) || code;
  }

  async function runCheck(name) {
   return await new Promise((resolve) => {
    const child = spawn(process.execPath, [
      /* site-admin.js imports src/lib/csv.ts directly to test the parser as a
         pure function — no server, no database, just the rules. */
      "--experimental-strip-types",
      "--no-warnings",
      path.join(__dirname, `${name}.js`),
    ], {
      stdio: "inherit",
      env: { ...process.env, ADMIN_URL: BASE },
    });
    child.on("exit", resolve);
   });
  }

  stop();
  /* Confirm it is actually gone rather than assuming the signal landed — a
     survivor is what caused the stale-server bug this runner now guards
     against. */
  for (let i = 0; i < 20; i++) {
    try {
      await fetch(`${BASE}/`, { redirect: "manual", signal: AbortSignal.timeout(400) });
      await wait(200);
    } catch {
      break; // no longer answering
    }
  }
  process.exit(code ?? 1);
})();
