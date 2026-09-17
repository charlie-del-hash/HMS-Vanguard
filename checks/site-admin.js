/* The admin door, tested from outside it.
 *
 * ── what this can and cannot prove ────────────────────────────────────
 * Phase 3's own gate is "publish a second report entirely through the UI", and
 * that CANNOT run here: this sandbox has no egress to the Supabase host, so
 * nothing can sign in. That gate needs a human with a browser and a staff row.
 *
 * What the sandbox is uniquely good for is the opposite case. With Supabase
 * unreachable, `access()` returns `unavailable` — and the single most important
 * property of the guard is that `unavailable` is refused exactly like anonymous.
 * A guard that fails OPEN when the database has a bad minute leaves the editor
 * standing open to anyone with the URL, and on a free-tier project that pauses
 * after a week idle that is a scheduled event rather than a risk.
 *
 * So these assertions are the security ones, run in the condition that produces
 * the interesting failure. Everything about editing a report is checked by a
 * person, and HANDOFF.md says so rather than pretending otherwise.
 *
 *   node checks/run-admin.js
 */
const assert = require("assert");

const BASE = process.env.ADMIN_URL || "http://127.0.0.1:4399";

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ok    ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${name}\n          ${e.message}`);
  }
}


/* A session cookie shaped the way @supabase/ssr writes one.
 *
 * The name carries the project ref, taken from the same .env the app reads, so
 * this cannot drift from the client's own naming. The contents are nonsense on
 * purpose — the point is only that the client believes it has a session and
 * goes to verify it, which is the code path under test. */
function fakeSessionCookie() {
  const fs = require("fs");
  const path = require("path");
  let url = process.env.PUBLIC_SUPABASE_URL || "";
  if (!url) {
    try {
      const env = fs.readFileSync(path.resolve(__dirname, "..", ".env"), "utf8");
      url = (env.match(/^\s*PUBLIC_SUPABASE_URL\s*=\s*(.+)$/m)?.[1] || "").trim();
    } catch {
      /* no .env — the ref below is then a guess and the assertion will say so */
    }
  }
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\./)?.[1] || "unknown";
  const session = {
    access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.not-a-real-signature",
    refresh_token: "not-a-real-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "00000000-0000-4000-8000-000000000000", email: "nobody@example.com" },
  };
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  return `sb-${ref}-auth-token=${encodeURIComponent(value)}`;
}

/** fetch without following redirects — the redirect IS the thing under test. */
const raw = (path, init) => fetch(BASE + path, { redirect: "manual", ...init });

/* Every route that must never answer to a stranger. The save endpoint is in
   here deliberately: a guard that protects the pages and forgets the endpoint
   protects the furniture and leaves the door open. */
const GUARDED = [
  ["GET", "/admin"],
  ["GET", "/admin/reports/00000000-0000-4000-8000-000000000000"],
  ["GET", "/admin/data"],
  ["POST", "/admin/data"],
  ["GET", "/admin/preview/00000000-0000-4000-8000-000000000000"],
  ["POST", "/admin/reports/00000000-0000-4000-8000-000000000000/save"],
];

(async () => {
  console.log("the door is shut, and shut the right way");

  for (const [method, path] of GUARDED) {
    await t(`${method} ${path} is refused`, async () => {
      const res = await raw(path, {
        method,
        headers: {
          /* Same-origin, so a refusal here is the auth guard rather than the
             CSRF check answering for it. */
          Origin: BASE,
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify({ blocks: [] }) } : {}),
      });
      assert.strictEqual(res.status, 303, `expected a redirect, got ${res.status}`);
      const to = res.headers.get("location") || "";
      assert.ok(
        to.startsWith("/admin/login") || to.includes("/admin/login"),
        `redirected to ${to} rather than the login`,
      );
    });
  }

  await t("a request carrying a session the database cannot verify is refused", async () => {
    /* THE assertion in this file, and it needs a cookie to be worth anything.
     *
     * With no cookie at all, supabase-js answers "Auth session missing" from
     * memory and never touches the network — so an empty request exercises the
     * anonymous path and says nothing about what happens when the database is
     * unreachable. This check claimed to test that for a while and did not.
     *
     * A syntactically valid session forces the client to go and verify it,
     * which here fails at the network and produces `unavailable`. That is the
     * state that must still be refused: a guard failing OPEN when the database
     * has a bad minute leaves the editor open to anyone with the URL, and a
     * free-tier project pauses after about a week idle. */
    const res = await raw("/admin", {
      headers: { Origin: BASE, Cookie: fakeSessionCookie() },
    });
    assert.strictEqual(res.status, 303, `expected a redirect, got ${res.status}`);
    const to = res.headers.get("location") || "";
    assert.ok(to.includes("/admin/login"), `redirected to ${to} rather than the login`);
    assert.ok(
      to.includes("why=unavailable"),
      `redirected to ${to} — expected why=unavailable, which is the branch this asserts. ` +
        `If this says why=not-staff or has no reason, the fake session is not reaching the ` +
        `network path and the check is measuring the anonymous case again.`,
    );
  });

  await t("an anonymous request is refused", async () => {
    const res = await raw("/admin", { headers: { Origin: BASE } });
    assert.strictEqual(res.status, 303);
    assert.ok((res.headers.get("location") || "").includes("/admin/login"));
  });

  await t("no admin page leaks content while refusing", async () => {
    const res = await raw("/admin/reports/00000000-0000-4000-8000-000000000000", {
      headers: { Origin: BASE },
    });
    const body = await res.text();
    /* A 303 with the page rendered underneath it would hand the whole editor
       to anyone who ignores the redirect. */
    assert.ok(body.length < 600, `refusal carried a ${body.length}-byte body`);
    assert.ok(!/block|Editor|save_report/i.test(body), "the refusal body mentions the editor");
  });

  console.log("cross-site requests cannot act as a signed-in editor");

  for (const path of ["/admin/signout", "/admin/login"]) {
    await t(`POST ${path} from another origin is refused`, async () => {
      const res = await raw(path, {
        method: "POST",
        headers: { Origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
        body: "email=x@y.com",
      });
      assert.strictEqual(res.status, 403, `expected 403, got ${res.status}`);
    });
  }

  await t("signing out is POST-only", async () => {
    /* A GET that destroys a session can be triggered by anything that renders
       a URL — a prefetch, an <img> on another site. */
    const res = await raw("/admin/signout", { headers: { Origin: BASE } });
    assert.strictEqual(res.status, 303);
    assert.ok(!/login/.test(res.headers.get("location") || ""), "GET signed the user out");
  });

  console.log("the login page is usable and says what went wrong");

  await t("it renders", async () => {
    const res = await raw("/admin/login", { headers: { Origin: BASE } });
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.ok(/name="email"/.test(body), "no email field");
    assert.ok(/<form[^>]*method="POST"/i.test(body), "no POST form");
  });

  await t("it distinguishes 'not staff' from 'cannot reach the database'", async () => {
    const notStaff = await (await raw("/admin/login?why=not-staff")).text();
    const down = await (await raw("/admin/login?why=unavailable")).text();
    assert.ok(/not on the staff list/i.test(notStaff), "no not-staff explanation");
    assert.ok(/could not be reached/i.test(down), "no unavailable explanation");
    assert.notStrictEqual(notStaff, down, "both states produce the same page");
  });

  await t("every admin page refuses indexing", async () => {
    for (const path of ["/admin/login"]) {
      const body = await (await raw(path)).text();
      const m = body.match(/<meta name="robots" content="([^"]*)"/i);
      assert.ok(m, `${path} has no robots meta`);
      for (const want of ["noindex", "nofollow", "noarchive"]) {
        assert.ok(m[1].includes(want), `${path} robots is "${m[1]}" — missing ${want}`);
      }
    }
  });

  console.log("pasted CSV keeps the rules it was imported under");

  {
    const { parsePoints, parseEvents } = await import("../src/lib/csv.ts");

    await t("an empty value imports as a GAP, never a zero", async () => {
      const rows = parsePoints("2026-09-01,41200\n2026-09-02,\n2026-09-03,43100");
      assert.strictEqual(rows.length, 3);
      assert.strictEqual(rows[1].value, null, `got ${rows[1].value} — Number("") is 0, and a day
          with no assessment drawn as zero is the most alarming number available`);
      assert.strictEqual(rows[0].value, 41200);
    });

    await t("the other ways of writing a gap also survive", async () => {
      for (const blank of ["-", "–", "NA", "n/a", "null"]) {
        const rows = parsePoints(`2026-09-01,${blank}`);
        assert.strictEqual(rows[0].value, null, `"${blank}" became ${rows[0].value}`);
      }
    });

    await t("a bare date is midnight UTC, not local midnight", async () => {
      assert.strictEqual(parsePoints("2026-09-01,1")[0].ts, "2026-09-01T00:00:00.000Z");
    });

    await t("thousands separators are read as one number", async () => {
      assert.strictEqual(parsePoints('2026-09-01,"41,200"')[0].value, 41200);
    });

    await t("a header row is skipped, a bad date later is not", async () => {
      assert.strictEqual(parsePoints("date,value\n2026-09-01,1").length, 1);
      assert.throws(() => parsePoints("2026-09-01,1\nnonsense,2"), /is not a date/);
    });

    await t("event confidence defaults to reported, not confirmed", async () => {
      const [e] = parseEvents("2026-09-01T00:00:00Z,strike,A title,,,,,,,hormuz");
      assert.strictEqual(e.confidence, "reported", "defaulting to confirmed marks it on the record");
      assert.deepStrictEqual(e.tags, ["hormuz"]);
    });

    await t("half a coordinate is refused", async () => {
      assert.throws(
        () => parseEvents("2026-09-01T00:00:00Z,strike,A title,,27.18,,,,,x"),
        /both lat and lon/,
      );
    });

    await t("an out-of-range severity is refused", async () => {
      assert.throws(() => parseEvents("2026-09-01T00:00:00Z,k,T,,,,,9,,x"), /outside/);
    });
  }

  console.log("the public site is untouched by any of this");

  for (const path of ["/", "/reports/", "/reports/hormuz-strikes-tanker-economics/"]) {
    await t(`${path} still answers`, async () => {
      const res = await raw(path);
      assert.strictEqual(res.status, 200, `got ${res.status}`);
      const body = await res.text();
      assert.ok(!/name="robots"[^>]*noindex/i.test(body), `${path} became noindex`);
    });
  }

  console.log(`\nsite-admin: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
