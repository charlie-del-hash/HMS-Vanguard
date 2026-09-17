/* The only markup a report body is allowed to carry.
 *
 * Report prose needs emphasis, figures and links, and it comes out of a
 * database that an admin UI will write to. Two ways to do that and one of them
 * is wrong:
 *
 *   store HTML   — then the page renders whatever is in the column, and a
 *                  compromised editor session or a bad paste is a script tag
 *                  on a published research page. `set:html` does not escape.
 *   store markup — a tiny grammar, parsed here, emitted as escaped HTML with
 *                  only the tags this file writes. There is no path from a
 *                  payload to an attribute or an element we did not choose.
 *
 * So: the second. The grammar is deliberately small — bold, italic, code, a
 * figure span, and links — because every addition is a new thing to get right
 * and a research report does not need more than this.
 *
 * Links are https-only, which is the deck's own irOf() rule (ops-deck.html
 * :1371) applied to the store rather than only to the render: the scheme is
 * checked at the point of use, not trusted because the value came from us.
 * A link that fails the check renders as its text, never as a dead or
 * dangerous anchor.
 */

/** HTML-escape. Applied to every scrap of author text before it is emitted. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * True when a URL may be linked. https only — not http, not protocol-relative,
 * and emphatically not javascript: or data:.
 */
export function isSafeHref(href: string): boolean {
  return /^https:\/\/[^\s"'<>]+$/.test(href);
}

/* Inline tokens, longest-first so `**` is never mistaken for two `*`. The
   figure marker is `#{...}`: it wraps a number in the tabular-figure class so
   a figure inside a sentence lines up with one in a table. */
type Rule = { re: RegExp; wrap: (inner: string) => string };

const RULES: Rule[] = [
  { re: /\*\*([^*]+)\*\*/, wrap: (i) => `<strong>${i}</strong>` },
  { re: /(?<!\*)\*([^*]+)\*(?!\*)/, wrap: (i) => `<em>${i}</em>` },
  { re: /`([^`]+)`/, wrap: (i) => `<code>${i}</code>` },
  { re: /#\{([^}]+)\}/, wrap: (i) => `<span class="mono">${i}</span>` },
];

/**
 * Render one run of author text as safe inline HTML.
 *
 * Everything is escaped first, then the markers are matched against the
 * ESCAPED text — so a payload containing `<b>` becomes `&lt;b&gt;`, and there
 * is no second pass in which it could become a tag again.
 */
export function inline(src: string): string {
  let out = esc(src);

  /* Links first: their text may itself carry emphasis, and doing them last
     would mean running the emphasis rules over an href. */
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_whole, text: string, href: string) => {
    /* href arrives escaped, so &amp; has to come back before it is judged and
       re-emitted — otherwise a perfectly good query string fails the test. */
    const raw = href.replace(/&amp;/g, "&");
    if (!isSafeHref(raw)) return text; // the words survive; the link does not
    const external = !raw.startsWith("https://affinity");
    const rel = external ? ' rel="noopener noreferrer" target="_blank"' : "";
    return `<a href="${esc(raw)}"${rel}>${text}</a>`;
  });

  /* Then the wrapping rules, repeatedly, so nesting works. Bounded rather than
     while(true): a pathological payload must not spin the build. */
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const { re, wrap } of RULES) {
      const m = out.match(re);
      if (!m) continue;
      out = out.slice(0, m.index) + wrap(m[1]) + out.slice((m.index ?? 0) + m[0].length);
      changed = true;
    }
    if (!changed) break;
  }

  return out;
}

/**
 * Plain text, for a meta description or a reading-time estimate: the same
 * input with every marker removed and nothing escaped, because it is going
 * into a text context rather than HTML.
 */
export function plain(src: string): string {
  return src
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/#\{([^}]+)\}/g, "$1")
    .trim();
}

/** Words per minute for a reading estimate. Research prose, not a novel. */
const WPM = 220;

/** Reading time in whole minutes, never zero. */
export function readMinutes(texts: string[]): number {
  const words = texts.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WPM));
}
