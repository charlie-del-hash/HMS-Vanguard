# Affinity Ops Deck — handoff

**Branch:** `claude/github-pages-mcp-access-9s9ayb` (pushed) · **Base:** `main` @ `df446b7`

`affinity-ops-deck.html` is one self-contained file — no build step, no dependencies, no
network calls. Open it directly or serve it; both work.

## State

GitHub write access was granted mid-session, so everything below is on the remote branch.
`main` is untouched at `df446b7`.

| Commit | What |
| --- | --- |
| `e0dfddd` | Ops Deck v4.0 — reworked prediction desk |
| `f950f60` | Publish to Pages at `/ops-deck.html` |
| `2f53a66` | Fix a typed trade size swallowing the Buy click |
| `aa3f9cd` | Make the deck fit a phone, inline the favicon |
| `91fffc4` | Dark-theme contrast, row semantics, reduced motion |
| `c5e1cc1` | Colour the follow-up delta by whether it improved |
| `62ac322` | Carry the layout down to 320px |

## Publishing

**Nothing is live yet.** `.github/workflows/static.yml` builds **only from `main`**, so the
branch above will not publish. Merging to `main` is what deploys.

The workflow copies the deck into the Pages artifact at build time, so there is no second
committed copy to drift:

```yaml
- name: Stage the ops deck alongside the reader
  run: cp affinity-ops-deck.html macro-topics-site/ops-deck.html
```

After a merge to `main` (~20s build, going by the six previous runs):

- `https://charlie-del-hash.github.io/HMS-Vanguard/` — Macro Topics reader (unchanged)
- `https://charlie-del-hash.github.io/HMS-Vanguard/ops-deck.html` — the deck

## What changed after v4.0

**A bug worth knowing about.** Typing a size into the ticket and clicking Buy did nothing —
you had to click twice. Blurring the size field fired `change`, which re-rendered the ticket,
so the button the pointer went down on was detached before mouseup. `input` already updates
the ticket in place, so the re-render was redundant.

**The phone layout.** The markets table was pushing the whole page sideways at 390px: grid
items default to `min-width:auto`, so the panel could not shrink and `.scroll`'s `overflow-x`
never engaged. Below 420px the module bar wraps so the three modules share the full width;
tables shed their optional columns rather than hide content behind a sideways scroll.

**Accessibility.** Secondary text in dark sat at 4.42:1, under AA for small text — `--small`
is now `#84A0AA`, measuring 4.86:1 at the tightest point. Market rows used `aria-selected`,
which is only meaningful inside a grid; they now use `aria-current`, matching what the
conversation list already did. `transition:all` was animating the focus ring, so it faded in
over 160ms instead of appearing. `prefers-reduced-motion` covered two marquee animations and
left 95 transitions running.

## Verification

Re-runnable against any static server on the file:

| Check | Result |
| --- | --- |
| Viewport × theme × module | 42/42 clean, 390→1920, no overflow, no console errors |
| Narrow widths | 320 / 360 / 375 clean, nav fits, no table scrolling internally |
| Interaction tests | 13/13 — trade, close, resolve, search, new market, comms, report, theme persistence |
| Contrast (WCAG AA) | 0 failures, both themes, DOM text and SVG text |
| Keyboard | All 10 reachable controls show an immediate focus ring |
| Reduced motion | 0 elements animating or transitioning |
| Market maker | 9/9 LMSR invariants — complementary prices, convex cost, loss-free round trip, `maxAffordable` exact |
| Print | Forces light even from dark theme; ticker and spine hidden |
| Pages build | Simulated: `/` serves the reader, `/ops-deck.html` serves the deck |

Render is 12.9ms with 12 markets; the hot paths (typing a size, ticker updates) are 0.1–0.2ms
because they update in place rather than re-rendering.

## Notes for whoever picks this up

- Every colour is a custom property, including the ones the SVG charts use — `readPalette()`
  lifts those into JS at render time, so charts follow the theme instead of hard-coding hex.
- The dark block is scoped to `@media screen`, so print is always light.
- The shell mounts once; only the main body is rewritten, so the ticker marquee does not
  restart on every interaction.
- `ticket()` backs both the rendered panel and the live updates, so the two cannot disagree.
- Comms and Reports are placeholder content on a live shell; the prediction desk is the real
  one.
