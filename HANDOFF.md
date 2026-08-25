# Affinity Ops Deck — handoff

`affinity-ops-deck.html` is one self-contained file — no build step, no dependencies, no
network calls. Open it directly or serve it; both work.

**Live:** https://charlie-del-hash.github.io/HMS-Vanguard/ops-deck.html
**Reader:** https://charlie-del-hash.github.io/HMS-Vanguard/ (Macro Topics, unchanged)

## Publishing

`.github/workflows/static.yml` builds **only from `main`** — a feature branch will push but
will not publish. The workflow copies the deck into the Pages artifact at build time, so
there is no second committed copy to drift:

```yaml
- name: Stage the ops deck alongside the reader
  run: cp affinity-ops-deck.html macro-topics-site/ops-deck.html
```

A push to `main` deploys in roughly 20 seconds.

## Layout model — read this before changing the frame

Three things are load-bearing and interact. Changing one without the others has already
broken the deck once.

**The document is the scroll container.** `.main` carries `overflow-y:auto`, but `.shell`
only sets `min-height:100vh`, so the shell grows to its content and that inner scroll never
engages. This looks like a bug and is tempting to "fix" by giving the shell a definite
height. Do not, without reading the next two points — that change makes `.main` a real
scrollport roughly one viewport tall, and everything below depends on the scrollport being
the viewport.

**The spine is sticky, not tall.** It is `position:sticky; top:0; height:100dvh;
align-self:flex-start`. Without this it stretches to the full document height — 2600px on a
twelve-market page — which is where the rail's empty space came from and why the rates
scrolled out of view. Below 960px it reverts to a static horizontal bar.

**The ticket panel's height is capped for a reason.** `.sticky` is
`max-height:calc(100dvh - 140px); overflow-y:auto`. A sticky element as tall as its
scrollport barely travels before it pins, and then sits on top of whatever follows it in the
same column — here the positions panel, whose Close button becomes unreachable. Fitting is
not enough; it has to leave a usable strip below it. **140px was measured, not chosen**: at
132px the panel still blocked the Close button once the main column became the scrollport.
Lowering it re-opens the trap.

The cap means the ticket scrolls internally below about 900px of viewport. The Buy button
stays above that fold; only the resolver block at the bottom scrolls.

## Other things worth knowing

- Every colour is a custom property, including the ones the SVG charts use — `readPalette()`
  lifts those into JS at render time, so charts follow the theme instead of hard-coding hex.
- The dark block is scoped to `@media screen`, so print is always light.
- The shell mounts once; only the main body is rewritten, so the ticker marquee does not
  restart on every interaction.
- Three things deliberately update **in place** rather than re-rendering: the ticker
  (`syncTicker`), the ticket numbers (`syncTicket`), and the YES/NO segmented pill
  (`syncSide`). The pill is the reason for the third — a re-render swaps in a new element
  with nothing to animate from, so the slide would never run.
- `ticket()` backs both the rendered panel and the live updates, so the two cannot disagree.
- Radii are a layered scale — `--r` 12px cards, `--r-ctl` 7px controls, `--r-chip` 5px chips.
  Deliberately the older macOS range, not the 26 look.
- Motion runs through `--t` and `--t-slow`; nothing should use a bare duration.
- Rail data (`RATES`, `FFA`, `BUNKERS`) is placeholder shaped like the feed that replaces it,
  so wiring a real one is a data change and nothing else. It renders once with the shell.
- The rail's up/down colours are their own tokens (`--rail-up`, `--rail-dn`) because the
  spine is dark in **both** themes — the panel's green and red do not carry there. Same
  reason the ticker's category tags use fixed light values.
- Comms and Reports are placeholder content on a live shell; the prediction desk is real.

## Verification

Re-runnable against any static server pointed at the file.

| Check | Result |
| --- | --- |
| Viewport × theme × module | 42/42 clean, 390→1920, no overflow, no console errors |
| Narrow widths | 320 / 360 / 375 clean, nav fits, no table scrolling internally |
| Interaction tests | 13/13 — trade, close, resolve, search, new market, comms, report, theme persistence |
| Contrast (WCAG AA) | 0 failures, both themes, DOM text and SVG text |
| Keyboard | All reachable controls show an immediate focus ring |
| Touch targets | Nothing under 44pt under `pointer:coarse` |
| Reduced motion | 0 elements animating or transitioning |
| Market maker | 9/9 LMSR invariants — complementary prices, convex cost, loss-free round trip, `maxAffordable` exact |
| Print | Forces light even from dark theme; ticker and spine hidden |
| Sticky trap | Close button reachable at 640–1100px, and with the main column forced to be the scrollport |

Render is ~13ms with 12 markets; the in-place paths are 0.1–0.2ms. 200 markets would cost
~93ms, which is not worth optimising for at this scale.

## Known gaps

Raised and not taken up, in rough order of value:

- No `<noscript>` — the deck is entirely JS-rendered, so scripts-off is a blank page.
- No hash routing — a module or a specific market cannot be linked to.
- Only the theme persists; selected market, filter and sort reset on reload.
- `render`, `buy`, `ticket` and friends are function declarations, so they land on `window`.
- Market rows have no arrow-key navigation, only Enter/Space on a focused row.
- The toast has no live region, so a screen reader is not told when a trade fills.
