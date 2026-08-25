# Affinity Ops Deck — handoff

`affinity-ops-deck.html` is one self-contained file — no build step, no dependencies, no
network calls. Open it directly or serve it; both work.

**Live:** https://charlie-del-hash.github.io/HMS-Vanguard/ — `/ops-deck.html` serves the
same page.

## Publishing

`.github/workflows/static.yml` builds **only from `main`** — a feature branch will push but
will not publish. The workflow copies the deck into the Pages artifact at build time, so
there is no second committed copy to drift:

```yaml
- name: Stage the ops deck as the site
  run: |
    mkdir -p _site
    cp affinity-ops-deck.html _site/index.html
    cp affinity-ops-deck.html _site/ops-deck.html
```

The deck is the site root now that the Macro Topics reader has been removed from the repo;
`/ops-deck.html` is kept as an alias so the URL that was already circulated still resolves.

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

## Tables measure their panel, not the window

Every table in the deck sheds columns on the width of **its own panel**, through a
container query on `.panel.cqpanel` (the basket's `.eqpanel` is the same thing). This is not
a stylistic preference — a media query gets it wrong here, twice over:

**The spine breaks the proxy.** It is 240px wide above 960px and gone below it, so a 768px
viewport leaves a full-width table **less** room (730px) than a 960px viewport does (922px).
Viewport width is not monotonic with the width a table actually gets, so a width query sheds
columns in the wrong order on the way down.

**Sticky side panels break it again.** The prediction desk's market table and calibration
board sit beside a ticket that takes a fixed share of the row. Between roughly 1200 and
1320px of viewport they were squeezed to ~515px for 567px of columns and scrolled sideways —
a band the phone-only rules never reached, and nobody had looked at. The same applied to the
basket once it gained a side panel.

Thresholds are **measured, not chosen**. `#mktscroll` is 567px with the trend column and
410px without, so its break is at 566px. Re-measure with
`table.style.width = 'min-content'` before moving one.

**A hidden column is not a dropped fact.** The library and the wiring table each keep a
`.tmeta` line under the row's name, hidden at full width and revealed one item at a time as
its column goes — so owner, desk, cadence, updated and scope survive on a phone in a
different arrangement rather than disappearing. Where the deck instead just hides a column,
it is because a panel beside the table already carries it: the ticket for the market table,
the selected-name panel for the basket. Those two are the only cases where dropping is
correct, and both are documented in place.

Verified 320 → 1920 in both themes across all four views: 112/112 with no page overflow and
no table scrolling inside its own panel.

## Reports has two tabs

`03 Reports` is one module with two views behind a `.tabrow`: **Library** (the research
output) and **Shipping equities** (a coverage basket of listed owners and terminal
operators). They sit together rather than as a fourth spine entry because they answer the
same question from either end — what the desk published, and what the market did with it.
`S.rtab` holds the choice and it survives switching modules, like every other filter.

Both are placeholder data on a live shell. `EQUITIES` is 23 names shaped like the quote feed
that replaces it — a listing, the last print in the listing currency, the day's and the
year's move, market cap normalised to US$bn so one column adds up across nine exchanges, NAV
per share, the multiple, the yield, the 52-week range, a fleet line and the desk's one-line
take. `h` is eight weekly closes ending on the last print. Wiring a real feed is a data
change and nothing else.

**Almost nothing in the tab is typed twice.** `pnav()` is computed from NAV per share rather
than stored beside it. `BASKET` is rolled up from the constituents' own histories, so the
index line and the names under it cannot tell different stories. `EQ_YTD` is the market-cap
weighted return of each segment's rows. The tiles, the exchange count and the figures inside
the desk-view copy all read the same array. The one earlier version of this tab typed the
segment returns and the basket path as constants; they agreed on the day they were written,
which is exactly how that kind of thing survives review.

**The rows are literals grouped by segment**, not a flat list with a `seg` field per row.
That is deliberate: the flat version lost the segment on twenty of twenty-three rows the
first time it was written, and nothing catches it but eyes.

**The histories share a market factor.** Each name's path is 65% a common shape and 35% its
own. Twenty-three independent walks average out flat, which made the rolled-up index a
straight line; a sector basket does not behave that way.

**Segments take the six category slots in `C.cats` order.** `EQ_SEGS` is
Containers → Dry bulk → Tankers → Ports & terminals → Gas carriers → Car carriers, mapped
onto `--c-ffa --c-dry --c-tank --c-port --c-new --c-int` in that order. That is deliberate:
the palette was validated on **adjacent pairs**, so reusing the slots in their validated
order carries the result over unchanged. Reordering the segments re-opens the checks — see
the colour rules below before you do. The same swatch rule applies: the hue is on `.cat`'s
mark, never on the 8.5px label.

**`indexChart` exists because `areaChart` has a zero baseline.** A series rebased to 100
lives in a narrow band around its base, so a zero-based frame spends almost all of its
height on empty air. `indexChart` pads the observed range instead and keeps the rebase line
as the single reference, which is the level a reader actually compares against. Its fill
colour comes from where the series ends **relative to the rebase**, not from the last tick,
so one down week does not flip an eight-week gain to red.

**The selected name is the ticket, again.** Clicking or Entering a row fills a `.sticky`
panel beside the table — the eight-week window at its own geometry, the 52-week range, the
three multiples, the fleet, the desk note, its segment peers as one-click jumps, and where
one exists, the crossing to the prediction market that is the same view expressed as a
question. It reuses `.sticky`, so it inherits the measured height cap along with the
behaviour. The table sheds columns as it narrows for the same reason the market table does:
this panel is where the shed detail lives.

**`indexChart` takes its geometry from the caller.** The side panel is half the width of a
full panel, so a shared viewBox would render the type at half the size. It runs at 680×210
in a full panel and 440×200 in the side one, and the labels come out the same size on screen.

**The scatter carries segment as shape *and* hue.** It is the one place in the deck with no
label beside the mark, and the palette's two accepted contrast warnings are only legal while
a category is never colour alone — so each segment gets a shape too, and the legend shows
both. P/NAV runs on a **log** axis because it is a ratio: 0.5× and 2× are the same distance
from parity, and a linear axis squashes twenty names into the left third to make room for two
terminal operators. Every point keeps its label; the placement tries right, left, above and
below, then nudges, testing against the marks as well as the labels already down. Dropping
labels would have been easier and leaves points nobody can identify. Verified: 23 labels, 0
overlapping pairs, 0 sitting on a mark, 0 out of frame.

## Colour and type — the rules that are easiest to undo

These were arrived at by measurement, and each one looks like a free choice until you
re-measure. The validator is `scripts/validate_palette.js` in the `dataviz` skill.

**Avatar fills carry white text, so they are contrast constraints, not brand swatches.**
`CHANNELS[].color` has exactly one use — the `.av` disc — and `.av` sets white at 11px bold
on it. That is small text: it needs 4.5:1. WhatsApp's green was `#1FA05C` at **3.36:1** and
had failed AA since the day it was written; the earlier "0 failures" line was measured over a
narrower scope and never reached it. It is now `#008745`, which is the **lightest** green
that clears the bar (4.61:1), stepped down in OKLCH so the hue moves 1.5° and the chroma
barely at all rather than being picked by eye. Slack (`#611F69`, 11.0:1) and ICE (`#14406B`,
10.6:1) always had room. Two things follow: do not lighten the green back toward the brand
value without re-measuring, and if a fourth channel is added, check its fill before its hue.

The alternative — keeping the brand green and switching that one avatar to dark text — was
rejected because it would leave two avatars with white initials and one with dark, and the
set has to read as a set. Darkening keeps all three consistent, and in practice evens out
their visual weight, which the lighter green had broken.

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
| Viewport × theme × view | 112/112 clean — 14 widths, 320→1920, both themes, all four views |
| Table overflow | 0 tables scroll inside their own panel at any tested width, in any view |
| Interaction tests | 25/25 — trade, close, resolve, search, new market, comms, report, basket select/filter/sort/peer/crossing, theme persistence |
| Scatter labels | 23 of 23 placed: 0 overlapping pairs, 0 on a mark, 0 out of frame |
| Derived figures | Tiles re-checked against the rendered table rows, not against the source array |
| Contrast (WCAG AA) | 0 failures in the rendered body — all four views, both themes, at 1440 and 390, DOM and SVG text. Channel avatars measured separately: 4.61 / 11.00 / 10.63 |
| Tile wash worst case | 4.78:1 light / 5.19:1 dark with the wash forced to full strength across the whole tile |
| Category palette | Passes the validator in both modes; two accepted warnings, see above |
| Keyboard | 221 stops across the four views, 0 without a focus ring |
| Touch targets | Nothing under 44pt under `pointer:coarse` except the qty slider, which the CSS sets to 32px on purpose |
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
- The qty slider is 32px tall under `pointer:coarse`, set explicitly by
  `input[type=range]{height:32px}`. Its thumb is 22px. Deliberate, and still under 44pt.
- The equities basket is static. Nothing recomputes, so selecting, sorting and filtering are
  the only live parts of the tab; a feed would want `syncTicker`-style in-place updates
  rather than a re-render, for the same reason the ticker has them.
- The scatter's label widths are estimated from the character count rather than measured.
  Every figure in the deck uses one face, so the estimate holds — but a face change, or a
  ticker with unusually wide glyphs, would need it re-checked.
- The basket table has no arrow-key navigation either, only Enter and Space on a focused row.
- Only one name can be selected. Comparing two side by side means reading the peer list,
  which gives P/NAV and YTD but not the rest.
