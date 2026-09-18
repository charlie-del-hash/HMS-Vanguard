/* The beacon. First-party, small, and it stops when asked.
 *
 * ── what it sends ─────────────────────────────────────────────────────
 * A random id this file generated, the events below, and — on the first hit
 * only — the referrer and any UTM tags on the URL. That is the whole payload.
 *
 * What it does NOT send: an IP address (the server derives a two-letter
 * country from the connection and writes that down instead — the IP is never
 * stored), a user-agent string, a screen fingerprint, or anything a third
 * party set. There is no third-party request anywhere in this file.
 *
 * ── it stops when asked ───────────────────────────────────────────────
 * Do Not Track is honoured, and honoured FIRST: no id is generated, no storage
 * is touched, nothing is queued. Respecting DNT after creating the identifier
 * would be a gesture rather than a choice.
 *
 * ── why localStorage and not a cookie ─────────────────────────────────
 * 0003_funnel.sql says "kept in a first-party cookie", which is what was
 * planned. localStorage is what shipped, because the pages this runs on are
 * prerendered static files: a cookie would ride along on every request for
 * every asset and no server would read it, since the beacon posts the id in
 * its body anyway. Same first-party identifier, less sent over the wire.
 *
 * ── it is best-effort by design ───────────────────────────────────────
 * Every failure is swallowed. Analytics must never break a reading page, and a
 * try/catch that logs to the console is still noise a reader can see.
 */

const KEY = "affinity-anon-id";
const ENDPOINT = "/api/track";

/** Events the endpoint accepts. Anything else is dropped there, not here. */
export type EventKind =
  | "pageview"
  | "scroll_25"
  | "scroll_50"
  | "scroll_75"
  | "scroll_100"
  | "read_time"
  | "cta_impression"
  | "cta_click"
  | "outbound_portal"
  | "deck_open"
  | "subscribe"
  | "chart_view";

interface QueuedEvent {
  kind: EventKind;
  slug?: string;
  meta?: Record<string, unknown>;
  ts: string;
}

let queue: QueuedEvent[] = [];
let anonId: string | null = null;
let sentVisitor = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** True when the reader has asked not to be measured, by any of the flags. */
function optedOut(): boolean {
  try {
    const nav = navigator as Navigator & { msDoNotTrack?: string; globalPrivacyControl?: boolean };
    if (nav.doNotTrack === "1" || nav.msDoNotTrack === "1") return true;
    if ((window as unknown as { doNotTrack?: string }).doNotTrack === "1") return true;
    /* Global Privacy Control is a legally recognised opt-out signal in some
       places and a clearly expressed preference everywhere else. */
    if (nav.globalPrivacyControl === true) return true;
  } catch {
    /* if we cannot read the preference, assume nothing and carry on */
  }
  return false;
}

function getId(): string | null {
  if (anonId) return anonId;
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) {
      anonId = existing;
      return anonId;
    }
    const fresh = crypto.randomUUID();
    localStorage.setItem(KEY, fresh);
    anonId = fresh;
    return anonId;
  } catch {
    /* Private mode, blocked storage, a file:// origin. Measuring is optional;
       the page is not. */
    return null;
  }
}

/** Coarse enough to be useful and too coarse to identify anybody. */
function device(): "phone" | "tablet" | "desktop" {
  const w = window.innerWidth;
  if (w < 640) return "phone";
  if (w < 1024) return "tablet";
  return "desktop";
}

/** First-touch attribution: the referrer and UTMs as they were on arrival. */
function visitor(): Record<string, string> {
  const p = new URLSearchParams(location.search);
  const out: Record<string, string> = { device: device() };
  /* Our own pages are not a referrer worth recording — it is where they came
     from that attributes a signup, not which page of ours they were on. */
  const ref = document.referrer;
  if (ref && !ref.startsWith(location.origin)) out.referrer = ref.slice(0, 500);
  for (const k of ["source", "medium", "campaign", "content", "term"]) {
    const v = p.get(`utm_${k}`);
    if (v) out[`utm_${k}`] = v.slice(0, 120);
  }
  return out;
}

function flush(useBeacon = false): void {
  if (queue.length === 0) return;
  const id = getId();
  if (!id) {
    queue = [];
    return;
  }

  const body = JSON.stringify({
    anonId: id,
    /* Sent once per page load. The server keeps the first one it ever saw and
       ignores the rest, so a later visit cannot overwrite the attribution. */
    visitor: sentVisitor ? undefined : visitor(),
    events: queue.splice(0, queue.length),
  });
  sentVisitor = true;

  try {
    if (useBeacon && navigator.sendBeacon) {
      /* sendBeacon survives the page being closed, which is the only way
         read_time on the last page of a session is ever recorded. */
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* dropped; never surfaced */
  }
}

/** Queue an event. Batched, so a scroll does not mean a request per pixel. */
export function track(kind: EventKind, meta?: Record<string, unknown>): void {
  if (optedOut()) return;
  queue.push({ kind, slug: slugOfPage(), meta, ts: new Date().toISOString() });
  if (queue.length > 24) return flush();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flush(), 2500);
}

function slugOfPage(): string | undefined {
  const m = location.pathname.match(/^\/reports\/([^/]+)\/?$/);
  return m ? m[1] : undefined;
}

/* ── the standing instrumentation ───────────────────────────────────── */

let started = false;

/**
 * Start measuring this page.
 *
 * Idempotent, because view transitions re-run page scripts and a second call
 * must not double every event.
 */
export function start(): void {
  if (optedOut() || started) return;
  started = true;

  track("pageview", { path: location.pathname });

  /* ── scroll depth ─────────────────────────────────────────────────
     Reported once each, against the SCROLLABLE distance rather than the page
     height — on a page shorter than the viewport there is nothing to scroll,
     and reporting 100% for it would say a reader finished something they
     never started. */
  const marks: [number, EventKind][] = [
    [25, "scroll_25"],
    [50, "scroll_50"],
    [75, "scroll_75"],
    [100, "scroll_100"],
  ];
  const seen = new Set<EventKind>();
  const onScroll = () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollable < 200) return; // nothing to measure
    const pct = ((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight) * 100;
    for (const [at, kind] of marks) {
      if (pct >= at && !seen.has(kind)) {
        seen.add(kind);
        track(kind);
      }
    }
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ── read time ────────────────────────────────────────────────────
     Only while the tab is visible. A backgrounded tab left open all afternoon
     is not ten thousand seconds of reading, and counting it that way makes
     every average useless. */
  let visibleMs = 0;
  let since = document.visibilityState === "visible" ? Date.now() : 0;
  const settle = () => {
    if (since) visibleMs += Date.now() - since;
    since = document.visibilityState === "visible" ? Date.now() : 0;
  };
  document.addEventListener("visibilitychange", () => {
    settle();
    if (document.visibilityState === "hidden") report(true);
  });

  let reported = false;
  const report = (beacon: boolean) => {
    settle();
    const seconds = Math.round(visibleMs / 1000);
    if (seconds >= 3 && !reported) {
      reported = true;
      track("read_time", { seconds });
    }
    flush(beacon);
  };
  addEventListener("pagehide", () => report(true));

  /* ── the CTA, which is the point of the whole site ───────────────── */
  const ctas = document.querySelectorAll<HTMLElement>("[data-cta]");
  if (ctas.length && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          track("cta_impression", { cta: e.target.getAttribute("data-cta") ?? "" });
          io.unobserve(e.target); // once per page, not once per scroll past
        }
      },
      { threshold: 0.5 },
    );
    for (const el of ctas) io.observe(el);
  }

  addEventListener(
    "click",
    (ev) => {
      const el = (ev.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!el) return;
      const cta = el.getAttribute("data-cta");
      if (cta) track("cta_click", { cta });

      let href: URL;
      try {
        href = new URL(el.href, location.href);
      } catch {
        return;
      }
      if (href.origin !== location.origin) {
        track("outbound_portal", { host: href.host, cta: cta ?? undefined });
      } else if (href.pathname === "/ops-deck.html") {
        track("deck_open");
      }
    },
    { capture: true },
  );
}
