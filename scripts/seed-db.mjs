/* Push the committed seed into Supabase.
 *
 *   node --experimental-strip-types scripts/seed-db.mjs          apply it
 *   node --experimental-strip-types scripts/seed-db.mjs --sql    print the SQL
 *
 * ── why two modes ─────────────────────────────────────────────────────
 * The development sandbox this repo is worked on in has no network egress to
 * the Supabase host, so the direct path cannot run there. `--sql` prints
 * statements that can be applied through any other channel — the dashboard's
 * SQL editor, psql, or an MCP tool — which is how the project was first
 * seeded. Same statements either way, so the two cannot drift.
 *
 * ── idempotent ────────────────────────────────────────────────────────
 * Sources, series and events upsert on their natural key. The report's blocks
 * are deleted and reinserted as a set, because block identity is (report, ord)
 * and a re-seed that merged them would leave the tail of a previously longer
 * report behind — a published page with a stale section on the end, which is
 * exactly the kind of quiet wrongness this repo keeps finding.
 *
 * It writes with the SERVICE ROLE, which bypasses RLS. That is the only way
 * anything is written here; there is no public write surface at all.
 */
import { readFileSync } from "node:fs";
import { SEED } from "../src/content/hormuz.ts";

const sqlOnly = process.argv.includes("--sql");

/** Single-quote a value for SQL, or NULL. Never interpolate raw. */
function q(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${String(v).replace(/'/g, "''")}'`;
}
/** A text[] literal. */
function arr(a) {
  return a?.length ? `ARRAY[${a.map(q).join(",")}]::text[]` : `'{}'::text[]`;
}
/** A jsonb literal. */
function json(o) {
  return `${q(JSON.stringify(o))}::jsonb`;
}

function statements() {
  const out = [];

  for (const s of SEED.sources) {
    out.push(
      `insert into public.sources (key, name, publisher, url, licence, notes, is_indicative)
       values (${q(s.key)}, ${q(s.name)}, ${q(s.publisher)}, ${q(s.url)}, ${q(s.licence)}, ${q(s.notes)}, ${q(s.is_indicative)})
       on conflict (key) do update set
         name = excluded.name, publisher = excluded.publisher, url = excluded.url,
         licence = excluded.licence, notes = excluded.notes, is_indicative = excluded.is_indicative`,
    );
  }

  for (const s of SEED.series) {
    out.push(
      `insert into public.series (key, name, unit, frequency, source_id, notes)
       values (${q(s.key)}, ${q(s.name)}, ${q(s.unit)}, ${q(s.frequency)}::public.series_frequency,
               (select id from public.sources where key = ${q(s.source_key)}), ${q(s.notes)})
       on conflict (key) do update set
         name = excluded.name, unit = excluded.unit, frequency = excluded.frequency,
         source_id = excluded.source_id, notes = excluded.notes`,
    );

    /* Points go in one statement per series, as two parallel arrays unnested
       against each other, rather than one tuple per point. A daily series is
       hundreds of rows and the tuple form repeats the series subquery in every
       one of them — longer to send, slower to plan, and no clearer to read. */
    const ts = s.points.map((p) => q(p.ts.replace(".000Z", "Z"))).join(",");
    const vs = s.points.map((p) => q(p.value)).join(",");
    out.push(
      `insert into public.series_points (series_id, ts, value)
       select (select id from public.series where key = ${q(s.key)}), z.t, z.v
         from unnest(ARRAY[${ts}]::timestamptz[], ARRAY[${vs}]::double precision[]) as z(t, v)
       on conflict (series_id, ts) do update set value = excluded.value`,
    );
  }

  /* Events have no natural key in the schema, so a re-seed replaces the ones
     this seed owns rather than duplicating them. They are identified by the
     tag the seed puts on all of them. */
  const eventTags = [...new Set(SEED.events.flatMap((e) => e.tags))];
  out.push(
    `delete from public.events where tags && ${arr(eventTags)}
       and source_id in (select id from public.sources where key in (${SEED.sources.map((s) => q(s.key)).join(",")}))`,
  );
  for (const e of SEED.events) {
    out.push(
      `insert into public.events (ts, kind, title, summary, lat, lon, actor, severity, confidence, source_id, tags)
       values (${q(e.ts)}::timestamptz, ${q(e.kind)}, ${q(e.title)}, ${q(e.summary)}, ${q(e.lat)}, ${q(e.lon)},
               ${q(e.actor)}, ${q(e.severity)}, ${q(e.confidence)}::public.event_confidence,
               (select id from public.sources where key = ${q(e.source_key)}), ${arr(e.tags)})`,
    );
  }

  for (const r of SEED.reports) {
    out.push(
      `insert into public.reports (slug, kicker, title, dek, summary, status, published_at, author, region, tags, read_minutes)
       values (${q(r.slug)}, ${q(r.kicker)}, ${q(r.title)}, ${q(r.dek)}, ${q(r.summary)},
               ${q(r.status)}::public.report_status, ${q(r.published_at)}::timestamptz,
               ${q(r.author)}, ${q(r.region)}, ${arr(r.tags)}, ${q(r.read_minutes)})
       on conflict (slug) do update set
         kicker = excluded.kicker, title = excluded.title, dek = excluded.dek,
         summary = excluded.summary, status = excluded.status,
         published_at = excluded.published_at, author = excluded.author,
         region = excluded.region, tags = excluded.tags, read_minutes = excluded.read_minutes`,
    );
    out.push(
      `delete from public.report_blocks
         where report_id = (select id from public.reports where slug = ${q(r.slug)})`,
    );
    const rows = r.blocks
      .map(
        (b, i) =>
          `((select id from public.reports where slug = ${q(r.slug)}), ${i}, ${q(b.kind)}::public.block_kind, ${json(b.payload)})`,
      )
      .join(",\n         ");
    out.push(`insert into public.report_blocks (report_id, ord, kind, payload)\n       values ${rows}`);
  }

  return out;
}

const sql = statements();

if (sqlOnly) {
  console.log(sql.map((s) => `${s.trim()};`).join("\n\n"));
  process.exit(0);
}

/* ── apply ──────────────────────────────────────────────────────────── */
function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return undefined;
}

const url = env("PUBLIC_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error(
    "PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to apply the seed.\n" +
      "Writing bypasses RLS, so it needs the service role — see .env.example.\n" +
      "No egress to Supabase from here? Use --sql and apply the output elsewhere.",
  );
  process.exit(1);
}

/* Applied through PostgREST's rpc surface would need a helper function, so
   this goes over the SQL endpoint the CLI uses. Kept deliberately dumb: one
   statement at a time, stop on the first failure, say which one. */
const { createClient } = await import("@supabase/supabase-js");
const db = createClient(url, key, { auth: { persistSession: false } });

let n = 0;
for (const s of sql) {
  const { error } = await db.rpc("exec_sql", { q: s }).catch((e) => ({ error: e }));
  if (error) {
    console.error(`\nstatement ${n + 1} failed: ${error.message}\n\n${s}\n`);
    console.error(
      "If exec_sql does not exist, this project has no SQL-over-REST helper — " +
        "run with --sql and apply the output through the dashboard or psql instead.",
    );
    process.exit(1);
  }
  n++;
}
console.log(`[seed] applied ${n} statement(s)`);
