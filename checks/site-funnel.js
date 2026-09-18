/* The two public endpoints, poked the way a stranger would poke them.
 *
 * /api/track is the only place a reader's browser can cause a write anywhere in
 * this system, and it is unauthenticated by necessity — a beacon has nobody to
 * sign in as. So what it ACCEPTS is the whole of its security, and that is what
 * these assert: a bounded body, a uuid that is really a uuid, a fixed set of
 * event kinds, and no way to make it say anything back.
 *
 * It answers 204 to everything on purpose. A beacon has nobody to report an
 * error to, and an endpoint that returns 500 when the database is paused turns
 * a quiet outage into red in a reader's console and tells whoever is probing it
 * which requests hurt. These check that the silence is uniform — a 204 for
 * rubbish and a 400 for something slightly different is still an oracle.
 *
 * Nothing here can confirm a row was written: this sandbox has no egress to
 * Supabase. What it confirms is everything before that point.
 *
 *   node checks/run-admin.js
 */
const assert = require("assert");

const BASE = process.env.ADMIN_URL || "http://127.0.0.1:4399";
const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

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

const post = (path, body, init = {}) =>
  fetch(BASE + path, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", Origin: BASE, ...(init.headers || {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });

(async () => {
  console.log("/api/track answers the same way to everything");

  const shapes = [
    ["a well-formed batch", { anonId: UUID, events: [{ kind: "pageview" }] }],
    ["no body at all", ""],
    ["not JSON", "{{{"],
    ["no anon id", { events: [{ kind: "pageview" }] }],
    ["an anon id that is not a uuid", { anonId: "../../etc/passwd", events: [{ kind: "pageview" }] }],
    ["an unknown event kind", { anonId: UUID, events: [{ kind: "drop_tables" }] }],
    ["events that are not an array", { anonId: UUID, events: "pageview" }],
    ["a megabyte of nonsense", "x".repeat(1024 * 1024)],
  ];

  for (const [name, body] of shapes) {
    await t(`${name} → 204, no body`, async () => {
      const res = await post("/api/track", body);
      assert.strictEqual(res.status, 204, `got ${res.status}`);
      const text = await res.text();
      assert.strictEqual(text, "", `answered with ${text.length} bytes`);
    });
  }

  await t("a GET is not an error either", async () => {
    const res = await fetch(`${BASE}/api/track`, { redirect: "manual" });
    assert.strictEqual(res.status, 204, `got ${res.status}`);
  });

  await t("a cross-origin POST is refused before it reaches the handler", async () => {
    /* Astro's origin check. A beacon is same-origin by construction, so
       nothing legitimate is lost and a form on another site cannot post here. */
    const res = await post("/api/track", { anonId: UUID, events: [{ kind: "pageview" }] }, {
      headers: { Origin: "https://evil.example" },
    });
    assert.strictEqual(res.status, 403, `got ${res.status}`);
  });

  console.log("/api/subscribe validates before it trusts");

  await t("a bad address is refused with a sentence", async () => {
    const res = await post("/api/subscribe", { email: "not-an-address" });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
    assert.match(body.message, /email address/i, `said "${body.message}"`);
  });

  await t("an oversized body is refused", async () => {
    const res = await post("/api/subscribe", "x".repeat(8192));
    assert.strictEqual(res.status, 400);
  });

  await t("a valid address says what is wrong rather than pretending", async () => {
    /* Unconfigured here — no service role — so the honest answer is 503 and a
       message saying nothing was recorded. Silently returning 200 would tell a
       reader they are subscribed when they are not. */
    const res = await post("/api/subscribe", { email: "someone@example.com", consent: true });
    const body = await res.json();
    if (res.status === 503) {
      assert.strictEqual(body.ok, false);
      assert.match(body.message, /not configured|nothing was recorded/i, `said "${body.message}"`);
    } else {
      assert.strictEqual(res.status, 200, `got ${res.status}: ${body.message}`);
      assert.strictEqual(body.ok, true);
    }
  });

  await t("it never confirms whether an address is already on the list", async () => {
    /* Both the new and the duplicate path must say the same thing, or the
       endpoint becomes a way to test whether somebody subscribed. */
    const a = await (await post("/api/subscribe", { email: "a@example.com" })).json();
    const b = await (await post("/api/subscribe", { email: "a@example.com" })).json();
    assert.strictEqual(a.message, b.message, `"${a.message}" vs "${b.message}"`);
  });

  console.log("the form works with JavaScript off");

  /* The component's header promised this and it was false: the form posts
     urlencoded, the endpoint did JSON.parse on everything, and a reader with JS
     off was navigated off the article to a page of raw JSON. The check that was
     supposed to cover it read the form's `action` and `method` attributes and
     never submitted — a form can have both and still be broken.
     This replicates exactly what a browser sends. */
  const formPost = (fields) =>
    fetch(BASE + "/api/subscribe", {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", Origin: BASE,
                 Referer: `${BASE}/reports/hormuz-strikes-tanker-economics/` },
      body: new URLSearchParams(fields).toString(),
    });

  await t("a urlencoded post is not rejected as 'not JSON'", async () => {
    const res = await formPost({ email: "nojs@example.com", consent: "yes" });
    assert.notStrictEqual(res.status, 400, "the endpoint still demands JSON");
    const body = await res.text();
    assert.ok(!/did not arrive as JSON/.test(body), body.slice(0, 120));
  });

  await t("it redirects the reader back to a page, not to a JSON blob", async () => {
    const res = await formPost({ email: "nojs@example.com", consent: "yes" });
    assert.strictEqual(res.status, 303, `got ${res.status}`);
    const to = res.headers.get("location") || "";
    assert.ok(to.startsWith("/"), `redirected to ${to}`);
    assert.ok(!to.includes("/api/"), `redirected back to the endpoint: ${to}`);
    assert.match(to, /subscribed=(ok|bad)/, `no outcome in ${to}`);
  });

  await t("a bad address from the form redirects rather than serving JSON", async () => {
    const res = await formPost({ email: "nope" });
    assert.strictEqual(res.status, 303, `got ${res.status}`);
    assert.match(res.headers.get("location") || "", /subscribed=bad/);
  });

  await t("the redirect target cannot be pointed off-site", async () => {
    /* Referer is attacker-influenceable; an open redirect out of a subscribe
       form is a phishing primitive. */
    const res = await fetch(BASE + "/api/subscribe", {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", Origin: BASE,
                 Referer: "https://evil.example/phish" },
      body: new URLSearchParams({ email: "x@example.com" }).toString(),
    });
    const to = res.headers.get("location") || "";
    assert.ok(!/^https?:\/\//.test(to), `redirected to an absolute URL: ${to}`);
    assert.ok(!to.includes("evil.example"), `followed the Referer off-site: ${to}`);
  });

  await t("JSON still works, so the island is unaffected", async () => {
    const res = await post("/api/subscribe", { email: "json@example.com" });
    assert.ok([200, 503].includes(res.status), `got ${res.status}`);
    assert.match(res.headers.get("content-type") || "", /application\/json/);
  });

  console.log("what the endpoint accepts, tested directly");

  /* The route answers 204 to everything, so none of this is observable over
     HTTP — a check that POSTs rubbish and gets 204 proves only that the server
     is running. The validation is a pure function for exactly this reason. */
  {
    const { parseBeacon, KINDS, MAX_EVENTS, MAX_BODY } = await import("../src/lib/track-validate.ts");
    const ok = (extra = {}) => JSON.stringify({ anonId: UUID, events: [{ kind: "pageview" }], ...extra });

    await t("a well-formed beacon parses", async () => {
      const b = parseBeacon(ok());
      assert.ok(b, "returned null");
      assert.strictEqual(b.anonId, UUID);
      assert.strictEqual(b.events.length, 1);
    });

    await t("an id that is not a uuid is refused", async () => {
      for (const bad of ["", "abc", "../../etc/passwd", "3f2504e0-4f89-41d3-9a0c", 42, null]) {
        assert.strictEqual(
          parseBeacon(JSON.stringify({ anonId: bad, events: [{ kind: "pageview" }] })),
          null,
          `accepted ${JSON.stringify(bad)}`,
        );
      }
    });

    await t("an event kind outside the allowlist is dropped", async () => {
      assert.strictEqual(
        parseBeacon(JSON.stringify({ anonId: UUID, events: [{ kind: "drop_tables" }] })),
        null,
        "an arbitrary kind reached the database layer",
      );
      /* And the good ones in a mixed batch survive. */
      const b = parseBeacon(
        JSON.stringify({ anonId: UUID, events: [{ kind: "drop_tables" }, { kind: "pageview" }] }),
      );
      assert.strictEqual(b.events.length, 1);
      assert.strictEqual(b.events[0].kind, "pageview");
    });

    await t("every kind the beacon sends is on the allowlist", async () => {
      /* The two lists are in different files and drift silently: a new event
         added to the beacon and not here is dropped forever, and nothing says
         so because the endpoint answers 204 either way. */
      const src = require("fs").readFileSync(
        require("path").resolve(__dirname, "..", "src", "lib", "analytics.ts"),
        "utf8",
      );
      const declared = (src.match(/export type EventKind =([\s\S]*?);/) || ["", ""])[1];
      const kinds = [...declared.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
      assert.ok(kinds.length > 5, `only found ${kinds.length} kinds in analytics.ts`);
      const missing = kinds.filter((k) => !KINDS.has(k));
      assert.strictEqual(missing.length, 0, `the endpoint would silently drop: ${missing.join(", ")}`);
    });

    await t("the batch and the body are both capped", async () => {
      const many = Array.from({ length: MAX_EVENTS + 25 }, () => ({ kind: "pageview" }));
      const b = parseBeacon(JSON.stringify({ anonId: UUID, events: many }));
      assert.strictEqual(b.events.length, MAX_EVENTS, `kept ${b.events.length}`);
      assert.strictEqual(parseBeacon("x".repeat(MAX_BODY + 1)), null, "an oversized body was parsed");
    });

    await t("meta is flattened to short scalars", async () => {
      const b = parseBeacon(
        JSON.stringify({
          anonId: UUID,
          events: [
            {
              kind: "read_time",
              meta: { seconds: 42, deep: { nested: { thing: 1 } }, long: "y".repeat(5000), ok: true },
            },
          ],
        }),
      );
      const meta = b.events[0].meta;
      assert.strictEqual(meta.seconds, 42);
      assert.strictEqual(meta.ok, true);
      assert.strictEqual(meta.deep, undefined, "a nested object survived");
      assert.ok(meta.long.length <= 200, `a ${meta.long.length}-char string survived`);
    });

    await t("the country comes from the edge, never from the body", async () => {
      const b = parseBeacon(
        JSON.stringify({ anonId: UUID, events: [{ kind: "pageview" }], visitor: { country: "ZZ" } }),
        "GB",
      );
      assert.strictEqual(b.visitor.country, "GB", "a client-supplied country was believed");
      const none = parseBeacon(ok({ visitor: { country: "ZZ" } }));
      assert.strictEqual(none.visitor.country, undefined, "a country appeared without an edge header");
    });

    await t("a device class outside the enum is dropped", async () => {
      const b = parseBeacon(ok({ visitor: { device: "'; drop table--" } }));
      assert.strictEqual(b.visitor.device, undefined);
      assert.strictEqual(parseBeacon(ok({ visitor: { device: "phone" } })).visitor.device, "phone");
    });
  }

  console.log("an oversized body is refused before it is buffered");

  /* ── why this is measured and not just asserted ───────────────────────
   *
   * Both endpoints declared a body cap and neither enforced one: they called
   * `request.text()`, which buffers everything, and consulted the limit
   * afterwards. A test that only checks the RETURN VALUE cannot tell that
   * version from this one — both refuse an oversized body, one of them after
   * allocating it. So these count how much of the stream was actually pulled.
   *
   * That is the same lesson as the rest of this audit: assert the behaviour,
   * not the shape of the answer. */
  {
    const { readCapped } = await import("../src/lib/http-body.ts");

    /** A request whose body is `chunks` x `size` bytes, counting what is read. */
    const streaming = (chunks, size, headers = {}) => {
      const state = { pulled: 0, cancelled: false };
      const body = new ReadableStream(
        {
          pull(controller) {
            if (state.pulled >= chunks) return controller.close();
            state.pulled++;
            controller.enqueue(new Uint8Array(size));
          },
          cancel() {
            state.cancelled = true;
          },
        },
        /* highWaterMark 0, or the stream fills its own queue on construction
           and `pulled` is already 1 before readCapped has run — which reads
           exactly like the bug under test. */
        { highWaterMark: 0 },
      );
      const req = new Request("http://x/api/track", {
        method: "POST",
        body,
        headers,
        duplex: "half",
      });
      return { req, state };
    };

    await t("a body under the cap is returned whole", async () => {
      const req = new Request("http://x/api/track", { method: "POST", body: "hello" });
      assert.strictEqual(await readCapped(req, 1024), "hello");
    });

    await t("a declared oversized length is refused without reading a byte", async () => {
      const { req, state } = streaming(1000, 1024, { "content-length": String(1000 * 1024) });
      assert.strictEqual(await readCapped(req, 4096), null, "an oversized body came back");
      assert.strictEqual(state.pulled, 0, `read ${state.pulled} chunk(s) of a body it had refused`);
    });

    await t("a LYING content-length is still refused, by the stream", async () => {
      /* The header is the caller's own number. This is the case the cap has to
         survive: it says 10 bytes and then sends a megabyte. */
      const { req, state } = streaming(1000, 1024, { "content-length": "10" });
      assert.strictEqual(await readCapped(req, 4096), null);
      assert.ok(
        state.pulled * 1024 <= 4096 + 1024,
        `pulled ${state.pulled * 1024} bytes past a 4096-byte cap`,
      );
    });

    await t("an undeclared oversized body stops being pulled at the cap", async () => {
      /* Chunked upload: no content-length at all, so the stream is the only
         thing standing between the caller and the function's memory. */
      const { req, state } = streaming(1000, 1024);
      assert.strictEqual(await readCapped(req, 4096), null);
      assert.ok(
        state.pulled < 20,
        `pulled ${state.pulled} of 1000 chunks — the cap is not stopping the read`,
      );
      assert.ok(state.cancelled, "the stream was abandoned rather than cancelled");
    });

    await t("both endpoints route their body through it", async () => {
      /* The helper is only worth anything if it is the ONLY way a body is
         read. A stray `request.text()` re-opens the hole silently. */
      const fs = require("fs");
      const path = require("path");
      /* Comments stripped first. Both files EXPLAIN the old `request.text()`
         in prose, and matching that prose failed this assertion while the code
         was already correct — a check reporting a bug that is not there costs
         the same trust as one missing a bug that is. */
      const code = (src) =>
        src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
      for (const route of ["track.ts", "subscribe.ts"]) {
        const src = code(
          fs.readFileSync(path.resolve(__dirname, "..", "src", "pages", "api", route), "utf8"),
        );
        assert.ok(src.includes("readCapped("), `${route} does not use readCapped`);
        assert.ok(
          !/request\.text\(\)/.test(src),
          `${route} still calls request.text(), which buffers the whole body first`,
        );
      }
    });
  }

  console.log(`\nsite-funnel: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
