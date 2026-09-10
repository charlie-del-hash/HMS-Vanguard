/* The two Supabase clients, and the wall between them.
 *
 * ── the reader's client ───────────────────────────────────────────────
 * `publicClient()` holds the publishable key. That key is public by design —
 * it ships in the page — and everything protecting the data is RLS, not the
 * key. Through it a caller can read published reports and the data behind
 * them, and nothing else: the funnel tables carry RLS with no policy at all,
 * so visitors, interactions and subscribers are unreachable with it.
 *
 * ── the server's client ───────────────────────────────────────────────
 * `serviceClient()` holds the service role, which BYPASSES RLS entirely. It is
 * the only way anything gets written, and it must never reach a browser.
 *
 * Astro will happily bundle whatever a component imports, and a `.astro` file's
 * frontmatter and its client script live in the same file — so an import added
 * in the wrong half is a plausible mistake rather than an exotic one.
 *
 * The secret therefore comes from `astro:env/server`, which makes that mistake
 * a BUILD failure. The previous arrangement read import.meta.env and threw at
 * call time if `window` existed; that never leaked the key (Vite compiles a
 * non-PUBLIC var to `void 0` in client code — verified with a canary) but it
 * failed quietly the other way: a client script importing this module pulled
 * 215KB of Supabase SDK into the page, and a guard that only fires when the
 * function is called had nothing to say about it.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY } from "astro:env/client";
import type { Database } from "./database.types";

export type Client = SupabaseClient<Database>;

const url = PUBLIC_SUPABASE_URL;
const publishable = PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env for local work, and set it ` +
        `in the Vercel project for deploys — the build reads content at build time.`,
    );
  }
  return value;
}

/**
 * Read-only client for anything a reader can see. Safe in the browser, safe in
 * a prerendered page, safe to hand to an island.
 */
export function publicClient(): Client {
  return createClient<Database>(
    required("PUBLIC_SUPABASE_URL", url),
    required("PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishable),
    {
      auth: { persistSession: false },
      global: { headers: { "x-affinity-client": "public" } },
    },
  );
}

/**
 * Full-access client. Bypasses RLS. Server only — endpoints, and the admin's
 * server routes. Never import this from a component's client script.
 */
export async function serviceClient(): Promise<Client> {
  /* Imported lazily and by name so the module graph only reaches
     `astro:env/server` on a path that actually wants the service role — and so
     a client bundle that reaches it fails the build rather than shipping. */
  const { SUPABASE_SERVICE_ROLE_KEY: secret } = await import("astro:env/server");
  return createClient<Database>(
    required("PUBLIC_SUPABASE_URL", url),
    required("SUPABASE_SERVICE_ROLE_KEY", secret),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-affinity-client": "service" } },
    },
  );
}

/** True when the environment is configured enough to reach the database. */
export function isConfigured(): boolean {
  return Boolean(url && publishable);
}
