/* What a reader's key can and cannot do.
 *
 * The database is protected by row level security, not by the key being secret
 * — the publishable key ships inside the page. So the only meaningful test is
 * the one run from outside, with exactly the key a reader has, against the
 * live policies. This is that test.
 *
 * It asserts three things:
 *
 *   reads    published reports and the data behind them are visible; a DRAFT
 *            is not, and neither are a draft's blocks.
 *   writes   nothing is writable. Not reports, not blocks, not the analytics
 *            tables. Every write goes through a server endpoint holding the
 *            service role, so there is no public write surface at all.
 *   funnel   visitors, interactions and subscribers are unreachable — not
 *            empty, unreachable. A subscriber list a public key can read is a
 *            subscriber list that gets scraped.
 *
 * The read assertions need a draft and a published report to exist. With
 * SUPABASE_SERVICE_ROLE_KEY set the check makes them itself and tears them down
 * afterwards; without it those assertions are reported as skipped rather than
 * silently passing on an empty table.
 *
 *   node checks/db-rls.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

/* .env is not loaded by anything in a plain node run, and adding a dependency
   for five lines of parsing is not worth it. */
function loadEnv() {
  const file = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const URL = process.env.PUBLIC_SUPABASE_URL;
const PUBLISHABLE = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !PUBLISHABLE) {
  console.error("PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY are required.");
  console.error("Copy .env.example to .env.");
  process.exit(1);
}

const anon = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
const admin = SERVICE ? createClient(URL, SERVICE, { auth: { persistSession: false } }) : null;

const SLUG_PUB = "rls-check-published-fixture";
const SLUG_DRAFT = "rls-check-draft-fixture";

let pass = 0;
let fail = 0;
let skipped = 0;

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
function skip(name, why) {
  skipped++;
  console.log(`  skip  ${name} — ${why}`);
}

/** A write that RLS refuses shows up either as an error or as zero rows. */
function refused(res, what) {
  const denied = !!res.error || !res.data || res.data.length === 0;
  assert.ok(denied, `${what} was ALLOWED — it returned ${JSON.stringify(res.data)}`);
}

/* Every assertion below reads "refused" as a pass, and a request that never
 * left the machine is also refused. So the host has to be proved reachable
 * FIRST, or this whole file reports a clean bill of health for a database it
 * cannot see — which is exactly what it did the first time it ran, from a
 * sandbox whose egress allowlist did not include the project.
 *
 * `sources` is readable by anon by policy, so a failure here is the network. */
async function proveReachable() {
  const { error } = await anon.from("sources").select("key").limit(1);
  if (!error) return;
  console.error("\ncannot reach the database, so nothing below would mean anything.\n");
  console.error(`  ${error.message}\n`);
  if (/allowlist|fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(error.message)) {
    console.error("  That is a network refusal rather than a policy one: this host is not");
    console.error("  reachable from here. Run the check somewhere with egress to the project,");
    console.error("  or add the host to the sandbox's allowlist.\n");
  } else {
    console.error("  `sources` is readable by anon by policy, so this is a real regression.\n");
  }
  process.exit(2);
}

async function makeFixtures() {
  await admin.from("reports").delete().in("slug", [SLUG_PUB, SLUG_DRAFT]);
  const { data, error } = await admin
    .from("reports")
    .insert([
      {
        slug: SLUG_PUB,
        title: "RLS check — published",
        status: "published",
        published_at: new Date().toISOString(),
      },
      { slug: SLUG_DRAFT, title: "RLS check — draft", status: "draft" },
    ])
    .select("id, slug");
  if (error) throw new Error(`could not create fixtures: ${error.message}`);
  const byslug = Object.fromEntries(data.map((r) => [r.slug, r.id]));
  const { error: bErr } = await admin.from("report_blocks").insert([
    { report_id: byslug[SLUG_PUB], ord: 0, kind: "prose", payload: { text: "public" } },
    { report_id: byslug[SLUG_DRAFT], ord: 0, kind: "prose", payload: { text: "secret" } },
  ]);
  if (bErr) throw new Error(`could not create block fixtures: ${bErr.message}`);
  return byslug;
}

(async () => {
  console.log(`db-rls against ${URL}`);
  await proveReachable();
  console.log(SERVICE ? "service key present — read assertions will run\n" : "");

  let ids = null;
  if (admin) {
    try {
      ids = await makeFixtures();
    } catch (e) {
      console.log(`  FAIL  fixture setup\n          ${e.message}`);
      fail++;
    }
  }

  console.log("reads");
  if (ids) {
    await t("a published report is visible", async () => {
      const { data, error } = await anon.from("reports").select("slug").eq("slug", SLUG_PUB);
      assert.ifError(error);
      assert.strictEqual(data.length, 1, "expected the published fixture to be readable");
    });

    await t("a DRAFT report is invisible", async () => {
      const { data, error } = await anon.from("reports").select("slug").eq("slug", SLUG_DRAFT);
      assert.ifError(error);
      assert.strictEqual(data.length, 0, "a draft leaked to an anonymous reader");
    });

    await t("a published report's blocks are visible", async () => {
      const { data, error } = await anon
        .from("report_blocks")
        .select("payload")
        .eq("report_id", ids[SLUG_PUB]);
      assert.ifError(error);
      assert.strictEqual(data.length, 1);
    });

    await t("a DRAFT report's blocks are invisible", async () => {
      const { data, error } = await anon
        .from("report_blocks")
        .select("payload")
        .eq("report_id", ids[SLUG_DRAFT]);
      assert.ifError(error);
      assert.strictEqual(data.length, 0, "a draft's blocks leaked without the draft");
    });
  } else {
    skip("published visible / draft invisible (4)", "no SUPABASE_SERVICE_ROLE_KEY to build fixtures");
  }

  await t("the data behind reports is readable", async () => {
    for (const table of ["sources", "series", "series_points", "events"]) {
      const { error } = await anon.from(table).select("*").limit(1);
      assert.ifError(error, `${table} should be readable: ${error && error.message}`);
    }
  });

  console.log("writes");
  await t("cannot insert a report", async () => {
    refused(
      await anon.from("reports").insert({ slug: "rls-check-intruder", title: "no" }).select(),
      "insert into reports",
    );
  });

  await t("cannot update a published report", async () => {
    const res = await anon
      .from("reports")
      .update({ title: "defaced" })
      .eq("slug", SLUG_PUB)
      .select();
    refused(res, "update of reports");
  });

  await t("cannot delete a published report", async () => {
    refused(await anon.from("reports").delete().eq("slug", SLUG_PUB).select(), "delete from reports");
  });

  await t("cannot write to the data tables", async () => {
    refused(
      await anon.from("sources").insert({ key: "rls-check", name: "no" }).select(),
      "insert into sources",
    );
    refused(
      await anon.from("events").insert({ ts: new Date().toISOString(), kind: "x", title: "no" }).select(),
      "insert into events",
    );
  });

  console.log("funnel tables are unreachable, not merely empty");
  for (const table of ["visitors", "interactions", "subscribers"]) {
    await t(`cannot select from ${table}`, async () => {
      const { error } = await anon.from(table).select("*").limit(1);
      assert.ok(error, `${table} was readable with a publishable key`);
    });
    await t(`cannot insert into ${table}`, async () => {
      const row =
        table === "subscribers"
          ? { email: "rls-check@example.com" }
          : table === "visitors"
            ? { anon_id: "00000000-0000-4000-8000-000000000000" }
            : { kind: "rls-check" };
      refused(await anon.from(table).insert(row).select(), `insert into ${table}`);
    });
  }

  await t("cannot read the staff allowlist", async () => {
    const { data, error } = await anon.from("staff").select("*").limit(1);
    assert.ok(error || data.length === 0, "the staff list was readable");
  });

  await t("is_staff() is not exposed as an RPC", async () => {
    const { error } = await anon.rpc("is_staff");
    assert.ok(error, "is_staff() answered over REST — it should live outside the exposed schema");
  });

  /* ── the two RPCs, from outside ──────────────────────────────────────
   *
   * Both are SECURITY INVOKER, so RLS still decides what they can touch — but
   * that is the second line, not the first. record_events is how /api/track
   * writes the funnel, and it runs there with the SERVICE role. If a reader's
   * key could call it, anyone with the page source could write visitors and
   * interactions rows directly, and every number on the dashboard would be
   * whatever they decided it was. The publishable key ships in the page, so
   * "nobody knows the function name" is not a control. */
  await t("record_events is not callable with a reader's key", async () => {
    const { error } = await anon.rpc("record_events", {
      p_anon_id: "00000000-0000-4000-8000-000000000000",
      p_visitor: {},
      p_events: [{ kind: "pageview" }],
    });
    assert.ok(error, "record_events answered to an anonymous caller");
  });

  await t("save_report_blocks is not callable with a reader's key", async () => {
    const { error } = await anon.rpc("save_report_blocks", {
      p_report_id: "00000000-0000-4000-8000-000000000000",
      p_blocks: [],
      p_note: "rls-check",
    });
    assert.ok(error, "save_report_blocks answered to an anonymous caller");
  });

  /* The view is the query a mailer is meant to reach for, so it has to be at
     least as closed as the table under it. It is security_invoker — but a view
     created in `public` inherits the project's default privileges, which hand
     SELECT to anon, and 0010 revokes that explicitly because of this check. */
  await t("cannot select from mailable_subscribers", async () => {
    const { error } = await anon.from("mailable_subscribers").select("*").limit(1);
    assert.ok(error, "the mailable view was readable with a publishable key");
  });

  if (admin) {
    await admin.from("reports").delete().in("slug", [SLUG_PUB, SLUG_DRAFT]);
  }

  console.log(`\ndb-rls: ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ""}`);
  process.exit(fail ? 1 : 0);
})();
