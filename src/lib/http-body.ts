/* Read a request body, and stop reading when it gets too big.
 *
 * ── the bug this exists to fix ───────────────────────────────────────
 * Both public endpoints declared a size limit and neither enforced one.
 *
 *   /api/track     const raw = await request.text();  // then: raw.length > 16KB
 *   /api/subscribe const raw = await request.text();  // then: raw.length > 4KB
 *
 * `request.text()` buffers the WHOLE body first. By the time either cap is
 * consulted, the megabytes are already in the function's memory — so the limit
 * described exactly the thing it was failing to do. A caller sending a 100MB
 * POST is refused, eventually, having already been allocated 100MB.
 *
 * The audit recorded this next to the rate-limiting deferral, because the two
 * compound: the platform-level rate limit bounds how many requests arrive, and
 * this bounds what each one can cost before it is rejected. Neither replaces
 * the other, and this half needs no dashboard.
 *
 * ── content-length is a hint, the stream is the enforcement ──────────
 * The header is the cheap early-out: a caller who declares an oversized body is
 * refused without a single byte being read. But it is the caller's own number —
 * it can be absent (chunked encoding) or simply a lie — so it can never be the
 * thing the limit rests on. The read below counts what actually arrives and
 * cancels the stream the moment the total passes the cap, which is the
 * assertion checks/site-funnel.js makes: a stream that keeps offering chunks
 * stops being pulled.
 *
 * ── what the cap actually bounds, precisely ──────────────────────────
 * `max` plus at most one transport chunk. The total is tested after each chunk
 * arrives, so a caller can always land the chunk that crosses the line — undici
 * hands these over in tens of kilobytes, so the real ceiling is `max` plus that,
 * not `max`. Stating it that way because the whole point of this file is that
 * the previous limit described something it was not doing, and "bounded by max
 * plus one chunk" is a guarantee; "bounded by max" would be another wrong one.
 */

/**
 * The body as text, or `null` if it is larger than `max` bytes or unreadable.
 *
 * `max` is counted in BYTES, not characters — a body of emoji is three to four
 * times longer in bytes than in JavaScript string length, and the point of the
 * cap is memory rather than content.
 */
export async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;

  const body = request.body;
  /* No stream at all means no body — an empty string, not a failure. Some
     runtimes also give a null body for a GET, which is the same answer. */
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        /* Cancel rather than break: an abandoned reader leaves the request
           stream open, and on a serverless runtime that is a socket held for
           the rest of the invocation. */
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    /* A truncated or reset upload. Nothing to record and nobody to tell. */
    await reader.cancel().catch(() => {});
    return null;
  }

  const joined = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    joined.set(c, at);
    at += c.byteLength;
  }
  /* `fatal: false` so malformed UTF-8 becomes U+FFFD rather than throwing:
     whatever it is, it will fail the parse below it, and a decode that throws
     here would be an error path with no caller. */
  return new TextDecoder("utf-8", { fatal: false }).decode(joined);
}
