# Affinity Ops Deck — handoff

`affinity-ops-deck.html` is one self-contained file — no build step, no dependencies, no
network calls. Open it directly or serve it; both work.

The checks live beside it in `checks/` and are not part of the deployed page. `node checks/run.js`
runs all of them; see the Verification section below for what they hold.

**Live:** https://affinity-wine.vercel.app/ — **this is the link to circulate.** It is the
Vercel production domain, and it is the one chosen for sharing over the Pages URL. GitHub Pages
serves the same page at https://charlie-del-hash.github.io/HMS-Vanguard/ and stays as a mirror.
On both, `/ops-deck.html` serves the same page.

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

Two Vercel projects (`affinity` and `hms-vanguard`) also build this repo, both rooted at the
repo root rather than a subfolder — which is why the reader's old `macro-topics-site/vercel.json`
never took effect. The root `vercel.json` rewrites `/` and `/ops-deck.html` to
`/affinity-ops-deck.html`, so Vercel and Pages serve the same page at the same two paths.
Vercel builds every branch, so its previews show a branch before `main` does — which is how a
branch gets tested before it is merged.

**`affinity`'s production domain is the shared link.** Both hosts publish the same file from
`main`, so this is a choice about which URL circulates rather than about what is deployed: the
Vercel domain reads as a product, the Pages one reads as somebody's repository. Two things follow.
Pages is a mirror rather than a fallback, so it must not be allowed to drift or go stale. And
Vercel serves the **repo root** rather than a staged artifact, so anything committed to the repo
is reachable on the shared domain — the Pages workflow copies only the deck, but Vercel does not,
so `checks/`, `HANDOFF.md` and everything else answer on the shared URL.

**That is not currently worth acting on, and here is why, so it does not get re-raised.** The
repository is public, so a `.vercelignore` would hide a file from one public URL while leaving it
on another; it buys no confidentiality, and it invites the worse mistake of trusting it as though
it did. The control that matters is the repository's visibility, not this file. It becomes worth
adding in exactly one case: the repo goes private and the Vercel deployment stays public, at which
point the shared domain is the only public surface and `.vercelignore` is what stands in front of
it.

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

**The basket's shed order is priority, not position.** It drops the trend, then Company, then
Yield, Cap, P/NAV and last YTD — measured floors 804 / 716 / 607 / 535 / 457 / 388 / 304 for
the surviving set, with each break about 12% above the floor it protects. The earlier order
dropped Cap and P/NAV together at 730 and held Company to 430, so a 1366 laptop lost the
multiple the whole tab argues from while still showing a name the ticker already identifies.
Company is the most recoverable fact in the row, so it goes first — and it folds under the
ticker rather than vanishing (`.cofold`), but only where nothing else carries it: with the
detail panel open beside the table the name is 350px to the right, and duplicating it would
cost 20px on every row for nothing.

**A hidden column is not a dropped fact.** The library and the wiring table each keep a
`.tmeta` line under the row's name, hidden at full width and revealed one item at a time as
its column goes — so owner, desk, cadence, updated and scope survive on a phone in a
different arrangement rather than disappearing. Where the deck instead just hides a column,
it is because a panel beside the table already carries it: the ticket for the market table,
the selected-name panel for the basket. Those two are the only cases where dropping is
correct, and both are documented in place.

Verified 320 → 1920 in both themes across all four views: 112/112 with no page overflow and
no table scrolling inside its own panel. The basket is additionally swept at every 4px from
320 to 1920 with the detail panel both open and folded — 802 widths, 0 overflows.

**A sticky column header was tried and removed.** It needs a scrollport that actually scrolls;
the nearest one is `.main`, which carries `overflow-y:auto` but never engages because `.shell`
only sets `min-height`. The header therefore pins to a scrollport that never moves. Making it
work means giving `.main` a real height or capping and internally scrolling the table, both of
which are changes to the load-bearing layout model above. Do not retry without reading it.

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

**Selection is three states, not two.** `S.eqSel` null means the reader cleared it — Escape, or
clicking the selected row or mark again — and that is the only way to see all 23 scatter points
undimmed, because every path used to end in a selection and 22 of 23 marks sat permanently at
55%. A non-null value the filter excludes still falls back to the top of what is on screen.
The "Show all" control in the Relative value header is the visible way to reach the cleared
state; the scatter is where the benefit shows, so that is where the control lives.

**The basket is a single tab stop.** Rows carry a roving `tabindex` — 0 on the selected row, or
the first when nothing is selected — and the arrow keys move it, with Home and End for the
ends. Arrows move focus only and never re-render, which is what keeps them instant; Enter and
Space select. Every path that selects also restores focus afterwards, by giving each row an
`id` so `render()`'s existing id-based focus restore finds it again. Before that, selecting
anything dropped focus to `<body>` and a keyboard reader was returned to the top of the page.

**The desk view answers to the filter.** The three written notes each carry the segment they are
about, and only the notes whose subject survives the filter are printed — filtering to car
carriers used to leave the panel discussing Hormuz, boxes and dry bulk, three paragraphs about
nothing on screen. A segment the desk has not written about still has a view and it is in the
array: `segNote()` gives the cap-weighted return, the spread inside the segment and the two names
at its ends, how much of it trades above NAV and at what median, and the crossing to the
prediction desk where one exists. Computed, like everything else on this tab, so it cannot come to
disagree with the table under it. With the whole basket showing, the panel reads exactly as
before; an empty filter says so rather than arguing about names that are not there.

**Placeholder data says so where the figures are.** "Not a live feed" used to be the last line of
a footnote under a table of confident numbers. It is now a chip in the tab row above the tiles, a
line directly under them, a Source row in the detail panel — which is a long way from the top of
the page and carries a name's price, NAV and yield with no other qualification — and a column in
the CSV, because the file leaves the building and the qualification has to go with it. A trailing
line would not have been CSV.

**`BASKET_YTD` is the basket's own year, equal-weighted**, which is how the basket is defined and
not the same thing as the cap-weighted segment returns beside it. The detail panel says how far
the selected name sits from it and the export carries the same number as a column. The *column* in
the table is not there, and the measurement is why — see B6 under "Where to pick this up".

**One live region serves the whole deck.** `#live` is mounted with the shell, not by `render()`,
because a region rebuilt on every paint is not reliably announced. `say()` writes to it and
`note()` calls it, so toasts speak too; `announceEq()` gives the selected name, its segment,
its multiple and its year.

**The selected name is the ticket, again.** Clicking or Entering a row fills a `.sticky`
panel beside the table — the eight-week window at its own geometry, the 52-week range, the
three multiples, the fleet, the desk note, its segment peers as one-click jumps, and where
one exists, the crossing to the prediction market that is the same view expressed as a
question. It reuses `.sticky`, so it inherits the measured height cap along with the
behaviour. The table sheds columns as it narrows for the same reason the market table does:
this panel is where the shed detail lives.

**Charts are drawn at the size they are displayed, not scaled to it.** Every chart used to be a
fixed `viewBox` at `width:100%`, which made its type size a function of the container: the
coverage basket, the segment bars and the scatter rendered their labels at 4.7–6.4px on a phone,
and the side-panel chart ran to 18.7–20.3px on a tablet. The old note here — that `indexChart`'s
two geometries make the labels "come out the same size on screen" — was true at 1440, where it
was tuned, and nowhere else. A `font-size` attribute inside a scaled viewBox is not a size, it
is a ratio.

A chart is therefore no longer built during `render()`. It reserves a slot (`chartSlot`), and
`paintCharts()` runs once the column is in the document, measures each slot and asks for an SVG
drawn at exactly that width. viewBox width equals CSS width, scale is 1, and 9.5 means 9.5px at
every viewport. A debounced `resize` listener repaints without a full render. Measured after:
scale 1.000 and 8.5–13px across all fourteen widths, in every chart in the deck.

Drawing at true size makes crowding real rather than invisible, so each chart thins its own
labels instead of shrinking them: the line charts drop intermediate value labels below 40px of
point spacing and every other x label below 30px; the bar chart wraps a two-word name before it
reduces type, floors at 8.5px, and compacts "4 NAMES" to "n=4" under a 50px step; the scatter
places a label only where a free position exists and leaves it off otherwise.

**The scatter measures its labels now.** It used to estimate them at 5.75px a character, listed
here as a known gap on the grounds that one face makes the estimate safe. It was not safe — the
tickers measure 5.8 to 7.9 per character, up to 37% wider — it was merely invisible, because two
labels on top of each other at 4.7px look like texture. `textWidth()` measures the real face at
the real size through a canvas context, memoised per string. The quadrant captions and the parity
caption go into the same collision set.

**Figures are placed against a collision set, not parked above the mark.** Every value label in
`indexChart` sat at a fixed 13px above its point. That was right while the chart carried one line
and wrong the moment a second shared the frame: with a name overlaid on the coverage basket,
102.9, 102.8, 104.6 and 106.2 all had the selected name's line running through them at 1440, and
the first figure hung 1.8px off the left edge at every width. Each figure now takes the first free
position from a set holding both series' stroked geometry, the rebase rule, every mark, the x
labels, the rebase caption, the overlay's ticker and the figures already placed.

Two rules make the result read as a set rather than a scatter of dodges. **The side is decided
once for the whole series** — below the basket where the second line runs above it, above where it
does not — and **a figure whose place is taken steps further out on the same side before it
changes sides**, because two depths on one side still read as a set and one figure alone on the
other does not. The ends are placed first: the two figures a reader compares are the ones the
window opened and closed at, and `checks/index-anchors.js` holds them.

The same frame check found two things that had never been looked at. The REBASE caption is wider
than the right margin it sits in, so the dashed rule ran under the word — the rule stops at the
caption now, measured. And the overlay's ticker was parked at its end dot's right shoulder, which
is narrower than the ticker for anything longer than about five characters: MAERSK-B measures 61px
against a 42px margin at 320 and ran clean off the frame. It takes the shoulder where the shoulder
fits, and otherwise sits above the dot, right-aligned to the frame.

**One crosshair, three charts.** `moveCrosshair` mapped the pointer through the `PC.W` constant,
which stopped being the chart's width once the price chart took its geometry from its slot; it
reads `viewBox.baseVal.width` instead. The reason the basket and the side panel had no readout was
never geometry, though — it was that both hooks were ids, `#pricechart` and `#ph`, and two ids
cannot coexist in one document. They are classes now: a chart opts in by carrying `data-pts` and a
`.ph` layer from `crosshairLayer()`, and **each chart phrases its own readout**, which is what lets
three frames of different shapes share one handler. Cents on the price chart; week and level on the
side panel; week, basket and name on the coverage basket, where both series get a dot, because a
plate that says `FRO 111.3` with nothing marking it is asking to be read off the wrong line. Below
380px that sentence is wider than the frame, so it drops back to the basket alone. The plate was
sized at 5.6px a character — the same estimate the scatter was caught out by — and is measured now.
Only one crosshair is ever lit and the lit one is held rather than looked up again, because this
runs at pointer rate; `render()` drops the handle with the charts it is about to replace.

**The scatter labels what fits.** Every point used to keep its label, and when the placement ran
out of room it dropped the ticker at its first candidate anyway. That was survivable only while
the frame was scaled down; at true size it is two tickers on top of each other, which is worse
than one missing. A label is now drawn where a free position exists and left off where none
does, so the count degrades with the frame instead of the type size. Nothing is lost: the mark
keeps shape and hue, the legend keeps the segment, and the tooltip and the tap both give the
name. The selected name is placed first, so the plot always has one anchor. With measured
widths, all 23 still place with zero overlaps down to 320px.

**The scatter carries segment as shape *and* hue.** It is the one place in the deck with no
label beside the mark, and the palette's two accepted contrast warnings are only legal while
a category is never colour alone — so each segment gets a shape too, and the legend shows
both. P/NAV runs on a **log** axis because it is a ratio: 0.5× and 2× are the same distance
from parity, and a linear axis squashes twenty names into the left third to make room for two
terminal operators. Every point keeps its label; the placement tries right, left, above and
below, then nudges, testing against the marks as well as the labels already down. Dropping
labels would have been easier and leaves points nobody can identify. Verified: 23 labels, 0
overlapping pairs, 0 sitting on a mark, 0 out of frame.

## Reported figures come from the company; market data still does not

The basket carries two kinds of number now, and they are kept visibly apart
because only one of them is real.

**`EQ_IR` is editorial.** The company's own investor-relations landing page,
curated once and rarely touched. The landing page rather than a deep link to a
results PDF, deliberately: the deep link is the fresher answer and the one that
rots, because IR sites reorganise and nobody finds out until a reader gets a 404
on a public deck. `irOf()` checks the scheme at the point of use rather than
trusting the file because it lives in the repo, so a non-https URL is refused
rather than rendered.

**`EQ_FIN` is generated.** `scripts/refresh-financials.js` rewrites it in place
and commits; the existing Pages workflow and Vercel deploy from that commit. The
deck therefore stays one self-contained file with no build step and no network
call at load — refreshing the feed is a data change, exactly like `RATES` and
`FFA`. Do not hand-edit it; the script splices between `EQ_FIN:BEGIN` and
`EQ_FIN:END` and anything else in there is overwritten.

**Both start empty, and that is the point.** A name shows nothing until it has
real entries, because a real filing link beside an invented figure is worse than
no link at all — it lends the invented figure the document's authority, which is
the opposite of what F4 was for. Adding a name is what takes it from indicative
to reported, and **only for the figures actually fetched**: price, NAV, market
cap and the weekly closes stay placeholder until a quote feed is wired, and the
panel's Source row says so per name rather than letting the tab speak for all
23.

**Two providers, because no single free and official source covers nine
exchanges.** SEC EDGAR's XBRL `companyfacts` covers the 13 US-listed names, is
free and keyless, and gives figures as tagged in the company's own filing — as
close to the original as this gets. The other ten span seven venues with nothing
in common, and go through a licensed aggregator. Yahoo was considered and
dropped: it has no official public API, the endpoints are undocumented and get
gated, and its terms prohibit redistributing the data — which is exactly what a
public deck does.

Three things about the extraction that look like details and are not:

- **Most of this basket files under IFRS**, not US-GAAP — Greek, Norwegian,
  Cypriot and Bermudan issuers — so the `ifrs-full` tags are the common case
  here rather than the fallback. `TAGS` tries both taxonomies per figure.
- **EBITDA is not a tag in either taxonomy.** It is derived as operating income
  plus D&A, only where both come from the same period, and the derivation is
  written into the `src` string so nobody mistakes it for something filed.
- **A CIK is never typed.** A wrong one does not error — it fetches a different
  company's accounts and puts them on the deck under the right ticker, which is
  the worst failure this pipeline has, and thirteen ten-digit numbers copied by
  hand is exactly how that happens. `scripts/resolve-ciks.js` reads the SEC's
  own `company_tickers.json` instead, and the workflow runs it before the fetch.

  It is not blind, because a ticker can be reassigned or collide across
  registrants: each EDGAR name carries an `expect` field naming the company the
  deck thinks it is, and the registrant name has to match before the number is
  accepted. A mismatch is reported and **left unresolved**, because an
  unresolved name is skipped downstream and a wrongly resolved one is not.
  `checks/ciks.js` tests that matcher against the thirteen real registrant
  titles and against collisions it must refuse.

**The splice escapes `<`.** The literal is written into an inline `<script>`,
where the HTML parser looks for `</script>` before the JS parser sees anything —
so a provider string containing it would end the script element however well the
JS quoting was done, and `esc()` cannot help because the value is in JS, not
markup. `\u003C` is still `<` at runtime, so the round-trip is unchanged and the
parser never sees a close tag. `checks/splice.js` holds this with a deliberately
hostile fixture; it is the check that found the bug.

## The view is linkable, and it survives a reload

`#predict/7`, `#comms/3`, `#library`, `#equities/FRO`. A constituent can be linked from a desk
note, which was the whole ask; the rest of the deck gets it for free because `routeOf()` and
`applyRoute()` cover every module between them.

The URL is written with `replaceState`, **not** by assigning `location.hash`. The deck's state
changes are selections and filters, and one history entry per selection turns the back button
into an undo stack nobody asked for. `hashchange` therefore only ever fires for a hash the reader
typed or a link they followed inside the page, both of which mean go there.

`PERSIST` covers the view and not the book: which module and tab are open, what is filtered,
sorted, searched and selected. Balance, positions, the log and the open ticket deliberately do
**not** persist — restoring those would promise a portfolio the deck does not keep, and a stale one
is worse than an empty one.

Both are written from `render()`, which is the one funnel every state change already goes through,
and neither writes unless what it carries actually moved: `render()` also runs when a toast
expires, and a storage write per toast tick is waste.

**Everything read back is validated against what the deck actually holds**, because the store and
the hash are both outside input. An unknown module, market, channel, sort or ticker falls through
to the default rather than into the view; a name that has left the basket lands on the basket with
nothing selected, because showing a reader a different name than the one they followed is the
worse answer. A link beats the store — the store is a default and a link is an instruction — which
is why `restoreView()` runs before `applyRoute()` at boot.

Every read and write is wrapped: a `file://` origin refuses storage outright in some browsers, and
the deck has to keep working when it is turned down.

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

**The checks are in the repo now.** `checks/` holds the harness that produced this table —
headless Chromium driving a served copy of the deck and reading the live DOM, never the source.
Earlier sessions rebuilt it from prose each time; it does not have to be rebuilt again.

```
node checks/run.js                 # all of them
node checks/run.js charts routing  # a subset
```

`run.js` serves the deck on a loopback port and hands each check the URL in `DECK_URL`. See
`checks/README.md` for what each one asserts and the two footguns that have caught people out.

| Check | Result |
| --- | --- |
| Viewport × theme × view | 112/112 clean — 14 widths, 320→1920, both themes, all four views |
| Basket width sweep | 802 widths (every 4px, 320→1920 × panel open and folded), 0 overflows |
| Chart type size | scale 1.000 and 8.5–13px rendered, 196 chart instances. Was 4.7–20.3px |
| Chart label collisions | 0 overlapping text pairs in any chart, 14 widths × 2 themes × 4 views |
| Index-chart labels | 357/357 renders with no text on a line, no text on text and nothing out of frame — 14 widths × 24 selections, plus every segment filter at three widths. Was 58 hits before the placement pass |
| Index-chart anchors | 0 first-or-last figures dropped across 1786 chart instances — 19 widths × 2 themes × 24 selections |
| Crosshair | 9/9 — each of the three charts lights, the plate stays in frame at five positions and is never narrower than its own text, moving between charts leaves exactly one lit, leaving them puts them all out |
| Routing and persistence | 16/16 — the hash follows the view, a link beats the store, the store survives a reload, the back stack does not grow, and junk (unknown ticker, module or market, markup in the hash, a hand-edited store) falls back rather than through |
| Interactions | 47/47 — trade, close, resolve, create, search, sort, filter, comms, report, and the basket's select, clear, chips, bar, scatter, peer, crossing, fold, roving tabindex, arrows, Home, End, Enter, Escape, CSV, live region and theme persistence |
| Contrast (WCAG AA) | Run differentially against the previous build: identical signature set, 0 new, 0 ratios regressed, over both themes × four views at 1440 and 390 |
| Touch targets | Nothing under 44pt in the basket. Deck-wide, three pre-existing exceptions remain: the qty slider (32px, deliberate) and two comms filter chips at 42–43px wide |
| Company-name reachability | 20/20 across 10 widths × panel open and folded: the column and the fold are never both drawn, and where neither is, the detail panel is beside the table carrying the name |
| Reduced motion | 0 elements animating or transitioning |
| Print | Forces light even from dark theme; ticker and spine hidden |
| Market maker | 9/9 LMSR invariants — complementary prices, price in band, convex cost, zero costs nothing, loss-free round trip, the seed price is the price, `maxAffordable` fits and is maximal, a resolved market prints its outcome |
| Scatter labels | 23 of 23 placed: 0 overlapping pairs, 0 on a mark, 0 out of frame |
| Overlay hues | 24/24 — the basket overlay's label and end dot clear AA and 3:1 for all six segments in both themes |
| Derived figures | Tiles re-checked against the rendered table rows, not against the source array |
| Tile wash worst case | 4.78:1 light / 5.19:1 dark with the wash forced to full strength across the whole tile |
| Category palette | Passes the validator in both modes; two accepted warnings, see above |
| Sticky trap | Close button reachable at 640–1100px, and with the main column forced to be the scrollport |

**A note on the contrast number.** The checker was rebuilt this session and is more forgiving than
the one that recorded "70 signatures" — it finds four. That number is not comparable across
checkers and was never meant to be: the check is differential by construction, because gradient
backgrounds cannot be composited from computed style and any checker of this kind carries standing
artefacts. What matters is that the set does not grow between two builds measured by *the same*
checker, and it did not.

Render is ~13ms with 12 markets; the in-place paths are 0.1–0.2ms. 200 markets would cost
~93ms, which is not worth optimising for at this scale.

## Where to pick this up

A UX and visual audit of this tab ran on 25 Aug 2026. It produced six findings and a menu of 52
improvements, each with a stable ID (A1, B4, C12 …). **Thirty are built and all six findings are
closed.** The rest of the menu is below, still keyed to those IDs so the numbering stays
continuous across sessions.

Closed since the audit: C10, C11, D2, F1, F4 and half of B6, plus the label-placement work the
charts needed once a second series shared the frame.

### Take these first

Each is self-contained, none touches the load-bearing layout model, and each is worth more than
it costs.

| ID | What | Note |
| --- | --- | --- |
| C4 (second half) | Hovering a table row lights its scatter point | The other direction — click a mark to open the name — is done |
| E4 | Row semantics: make the table a `grid` with `aria-selected` instead of `role="button"` on each `<tr>` | Best done with the roving tabindex that is already in place |
| E6 | A visually hidden table behind the scatter | The marks are clickable but not focusable, and 23 tab stops inside one chart is worse than none, so the table is the keyboard route in. This is the proper answer |
| D10 | Values on the row sparklines | |
| A7 | Inline exchange and segment beside the ticker | The cheaper half of the density work, and it ships alone |

### B6 — the "vs basket" column, and why it is not here

The figure is built: `BASKET_YTD` is rolled up from the rows, the detail panel says how far the
selected name sits from it, and the export carries it as a column. The *table* column is not, and
this is the measurement to weigh before adding it.

With the detail panel open the basket panel measures **764px at a 1440 viewport** and 924px at
1600; folded, 1118px and 1278px. A tenth column costs roughly 85px, so on the same rule every
other break on that table uses — 12% above the floor of the set it protects — it would shed at
about 894 and be **invisible at 1440 with the panel open**, which is the commonest way this tab is
read.

The rest is mechanical if it is judged worth it. Shedding it second, straight after the trend,
leaves every existing break untouched: the surviving sets below it are unchanged, so only
`break(trend)` moves and one new break is inserted. Re-measure with
`table.style.width = 'min-content'` per surviving set, then re-run `node checks/run.js overflow`.

### Then, in rough order of value

- **B4's siblings:** B5 bar-in-cell for YTD, B7 basket weight, B8 the 52-week range as a row
  micro-bar, B9 a USD column or currency toggle, B10 group by segment with subtotals.
- **A6 density.** Rows are 64px. A compact mode near 40px fits the whole basket on one screen.
- **A9** a full-width table mode, collapsing the chart panels to a strip.
- **C6** compare two names side by side, **C7** pin a working set.
- **D6** size the scatter marks by market cap (the data is already there), **D9** a dispersion
  strip per segment — the desk view argues dispersion and nothing draws it.

### These need data that does not exist yet

Don't start them expecting the array to carry it:

- **D4** a 8 / 13 / 52-week window switch — `h` holds eight weekly closes and nothing else.
- **F3** per-name as-of stamps, **F5** a constituent change log — no fields for either.
- **F2** the two missing prediction-desk crossings — `EQ_LINK` covers dry, tank, port and car;
  containers and gas have no market to point at, so this is a markets question, not a basket one.

### Not viable

- **A8** a sticky column header. Tried and removed; see the note under the shed-order section.

## Known gaps

Raised and not taken up, in rough order of value:

- No `<noscript>` — the deck is entirely JS-rendered, so scripts-off is a blank page.
- `render`, `buy`, `ticket` and friends are function declarations, so they land on `window`.
  (`S` does not — it is a top-level `const`, which is a global *lexical* binding and not a window
  property. Anything reaching into the deck from outside, a check included, has to reach it by
  name.)
- Market rows have no arrow-key navigation, only Enter/Space on a focused row; only the basket
  roves.
- The qty slider is 32px tall under `pointer:coarse`, set explicitly by
  `input[type=range]{height:32px}`. Its thumb is 22px. Deliberate, and still under 44pt.
- Two comms channel-filter chips measure 42–43px wide under `pointer:coarse`.
- The equities basket is static. Nothing recomputes, so selecting, sorting and filtering are
  the only live parts of the tab; a feed would want `syncTicker`-style in-place updates
  rather than a re-render, for the same reason the ticker has them.
- Only one name can be selected. Comparing two side by side means reading the peer list,
  which gives P/NAV and YTD but not the rest.
- The scatter's marks are clickable but not focusable — 23 tab stops inside one chart is worse
  than none, so the table is the keyboard route in. A visually hidden table of the same
  ticker / P/NAV / yield triples would be the proper answer and is not there yet (E6).
- `areaChart` has no crosshair. The layer is shared now, so giving it one is a `data-pts`
  attribute and a `crosshairLayer()` call — it was left out only because nothing asked for it.
- The scatter's tickers cross its own faint dashed gridlines in places. Left as it is: they are
  background rules at low contrast, and a label crossing one reads as ordinary chart practice
  rather than as the clash a 2.4px series line makes.
