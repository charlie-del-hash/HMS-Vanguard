/* Making a publish reach readers.
 *
 * Report pages are prerendered — that is the whole reason a crawler sees the
 * article as text and the funnel works at all. The cost is that changing a row
 * in the database changes nothing a reader can see until a build runs.
 *
 * So "publish" has to do something, or it is a status column that lies. A
 * Vercel deploy hook is a URL that starts a build; POSTing to it after a
 * publish is the smallest mechanism that makes the button honest.
 *
 * ── when it is not configured ─────────────────────────────────────────
 * The admin says so. It does not quietly succeed, and it does not pretend the
 * report is live: the editor prints that the report is published in the
 * database and will appear at the next build, and how to wire the hook. An
 * editor that says "Published!" while the site does not change is the same
 * class of fault as a config file that validates and does nothing.
 */

export type RebuildResult =
  | { state: "triggered" }
  | { state: "not-configured" }
  | { state: "failed"; why: string };

/**
 * Ask Vercel to rebuild.
 *
 * Never throws: publishing already succeeded by the time this runs, and a
 * failed rebuild must not read as a failed publish. The two are reported
 * separately because they are different problems with different fixes.
 */
export async function triggerRebuild(): Promise<RebuildResult> {
  const { VERCEL_DEPLOY_HOOK_URL: hook } = await import("astro:env/server");
  if (!hook) return { state: "not-configured" };

  /* A deploy hook is a bare https URL with a secret in the path, and a typo'd
     one would POST that secret wherever the typo points. */
  if (!/^https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\//.test(hook)) {
    return {
      state: "failed",
      why: "VERCEL_DEPLOY_HOOK_URL does not look like a Vercel deploy hook, so it was not called.",
    };
  }

  try {
    const res = await fetch(hook, { method: "POST" });
    if (!res.ok) return { state: "failed", why: `the hook answered ${res.status}` };
    return { state: "triggered" };
  } catch (e) {
    return { state: "failed", why: e instanceof Error ? e.message : String(e) };
  }
}

/** What to tell the editor, in words rather than a state name. */
export function rebuildMessage(r: RebuildResult): string {
  switch (r.state) {
    case "triggered":
      return "Saved, and a rebuild has started. The report appears on the site when it finishes, usually within a minute or two.";
    case "not-configured":
      return (
        "Saved. The report is published in the database but report pages are prerendered, " +
        "so it will not appear on the site until the next build. Set VERCEL_DEPLOY_HOOK_URL " +
        "to have publishing rebuild automatically."
      );
    case "failed":
      return `Saved, but the rebuild could not be started: ${r.why} The report is published in the database and will appear at the next build.`;
  }
}
