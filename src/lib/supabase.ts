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
 * in the wrong half is a plausible mistake rather than an exotic one. The guard
 * below makes that mistake loud: importing this module into client code throws
 * at call time with the reason, instead of shipping the key and failing
 * silently in the reader's favour.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type Client = SupabaseClient<Database>;

const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const publishable = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined;

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
export function serviceClient(): Client {
  if (typeof window !== "undefined") {
    throw new Error(
      "serviceClient() was reached from the browser. The service role bypasses RLS, " +
        "so this import has to move to server code — an API route under src/pages/api, " +
        "or the frontmatter of a page that is not prerendered.",
    );
  }
  const secret = import.meta.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
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
