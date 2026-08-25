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
- Figures use `--num` (the sans); `--mono` is for the small-caps labels only. See below.
- Rail data (`RATES`, `FFA`, `BUNKERS`) is placeholder shaped like the feed that replaces it,
  so wiring a real one is a data change and nothing else. It renders once with the shell.
- The rail's up/down colours are their own tokens (`--rail-up`, `--rail-dn`) because the
  spine is dark in **both** themes — the panel's green and red do not carry there. Same
  reason the ticker's category tags use fixed light values.
- Comms and Reports are placeholder content on a live shell; the prediction desk is real.

## Colour and type — the rules that are easiest to undo

These were arrived at by measurement, and each one looks like a free choice until you
re-measure. The validator is `scripts/validate_palette.js` in the `dataviz` skill.

**The six category hues are validated, not chosen.** `--c-ffa` `--c-dry` `--c-tank`
`--c-port` `--c-new` `--c-int`, light and dark stepped separately. The set they replaced
failed three ways: teal and grey sat under the chroma floor and read as grey, purple
against blue was ΔE 2.5 for deuteranopes, and grey against green was ΔE 10.6 with normal
colour vision. **Ports is orange specifically so it never sits adjacent to Tankers' blue** —
the checks run on adjacent pairs, so the order is part of the result. Dark's lightness band
is 0.48–0.67, much narrower than light's 0.43–0.77; dark steps will not pass by lightening
the light ones. If you swap a hue, re-run the validator for both modes rather than eyeballing.

Two warnings are accepted deliberately: green/orange CVD sits in the 6–8 band, and amber is
a hair under 3:1. Both are legal **only** because every category mark carries its name in
text beside it. **If a category is ever shown as colour alone, those two stop being legal.**

**Category colour lives on the swatch, never the label text.** `.cat::before` takes
`--cc`; `.cat` itself wears `--small`. Colouring the 8.5px label with the category hue put
four of the six under AA. This is also the general rule — marks carry the series colour,
text wears a text token.

**Chart colour follows the entity, never its rank.** The reports bars used to fill the
tallest bar differently, which meant re-sorting would repaint the survivors. `C.cats` is a
fixed-order array read from the same six tokens; bar *j* takes slot *j*.

**Figures are the sans, not the mono.** `--num` carries every numeric rule and the chart
labels; `--mono` is left on the small-caps labels, where it gives the deck its character
instead of fighting it. Two sub-rules that go with it: display values (`.stat .k`, hero
numbers) use **proportional** figures — `tabular-nums` gives every digit the width of a
zero, so `1,000` reads loose at 29px — and `tabular-nums` is kept for columns that must
align vertically. `.mono` the *class* now points at `--num`; it means "a figure", not "a
monospace face".

**Stat tiles.** The accent is an edge down the left plus a wash into the card, not a rule
across the top — a full-bleed 2px line has its ends clipped by the 12px radius and reads as
a lid. Meter tracks are a light step of their own accent (`color-mix` against `--accent`),
not flat grey, so state reads across the whole bar.

**A gotcha for anyone writing a contrast check.** `color-mix()` computes to
`color(srgb 0.94 …)` with 0–1 floats, not `rgb()` with 0–255. A parser that assumes `rgb()`
reads those as near-black and reports confident nonsense — it cost a round trip here,
reporting a false 1.89:1 on a tile that actually measures 4.78:1.

## Verification

Re-runnable against any static server pointed at the file.

| Check | Result |
| --- | --- |
| Viewport × theme × module | 42/42 clean, 390→1920, no overflow, no console errors |
| Narrow widths | 320 / 360 / 375 clean, nav fits, no table scrolling internally |
| Interaction tests | 13/13 — trade, close, resolve, search, new market, comms, report, theme persistence |
| Contrast (WCAG AA) | 0 failures, both themes, DOM text and SVG text |
| Tile wash worst case | 4.78:1 light / 5.19:1 dark with the wash forced to full strength across the whole tile |
| Category palette | Passes the validator in both modes; two accepted warnings, see above |
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
