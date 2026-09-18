/* Resolve a draft the same way the public loader resolves a published report.
 *
 * There is exactly one resolver, in content.ts, and this hands it a context
 * built from the signed-in user's client instead of the anonymous one. That is
 * the whole difference: the query runs as someone the staff SELECT policy lets
 * see drafts, and everything downstream — series lookups, source citations,
 * gap refusals, the provenance rule — behaves identically.
 *
 * If this file grew its own resolution logic the preview would slowly stop
 * predicting the published page, and the author would be the last to know.
 */
import { dataFrom, resolveBlocks } from "./content";
import type { ResolvedBlock, BlockKind } from "./blocks";
import type { Client } from "./supabase";

/**
 * A report's blocks, resolved for rendering.
 *
 * Throws what `parsePayload` throws. The caller shows that to the author —
 * which block, and what is wrong with it — because in an editor a bad block is
 * a thing you have just typed, not a reason for a blank page.
 */
export async function resolveForPreview(db: Client, reportId: string): Promise<ResolvedBlock[]> {
  const [{ data: rows, error }, data] = await Promise.all([
    db
      .from("report_blocks")
      .select("kind, ord, payload")
      .eq("report_id", reportId)
      .order("ord", { ascending: true }),
    dataFrom(db),
  ]);

  if (error) throw new Error(`could not read the blocks: ${error.message}`);

  const { data: report } = await db
    .from("reports")
    .select("slug")
    .eq("id", reportId)
    .maybeSingle();

  return resolveBlocks(
    (rows ?? []).map((r) => ({ kind: r.kind as BlockKind, ord: r.ord, payload: r.payload })),
    data,
    report?.slug ?? "preview",
  );
}
