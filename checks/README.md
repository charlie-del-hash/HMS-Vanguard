# Checks

Headless-Chromium checks for `affinity-ops-deck.html`. They drive a served copy
of the deck and read the **live DOM**, never the source — which is the only way
to test a deck whose layout is decided by container queries and whose charts are
measured at paint time.

These are development files. The Pages workflow copies only the deck itself into
the site artifact, so nothing here is published there.

## Running them

```
node checks/run.js                 # all of them
node checks/run.js charts routing  # a subset
```

`run.js` serves the deck on a loopback port and hands each check the URL in
`DECK_URL`. Playwright resolves through `require("playwright")`; set
`PLAYWRIGHT_MODULE` to an absolute path if it is installed globally, and
`CHROMIUM_PATH` if the browser is not where Playwright expects it.

## What each one asserts

| Check | What it drives, and what it must beat |
| --- | --- |
| `overflow` | 14 widths × 2 themes × 4 views, then the basket at every 4px from 320 to 1920 with the detail panel open and folded. No `.scroll` may scroll inside its own panel and the page may never scroll sideways. **112/112 and 802/802.** |
| `charts` | For every `svg.chart`: rendered width ÷ viewBox width, and every `font-size` × that scale. Plus `getBBox` pairwise overlap on every label. **Scale 1.000, 8.5–13px, 0 overlapping pairs.** |
| `index-labels` | Every label in the coverage basket and the side-panel chart against both series' stroked geometry, the rebase rule, the other labels and the frame — swept over every selection and every segment filter, because the overlay's shape *is* the selection. **0 hits in 429 renders.** |
| `index-anchors` | Placement may thin the middle but must never drop the first or last figure. 19 widths × 2 themes × 24 selections. **0 dropped in 1786 chart instances.** |
| `routing` | `#predict/7`, `#comms/3`, `#library`, `#equities/FRO`: the hash follows the view, a link beats the store, the store survives a reload, the back stack does not grow, and junk — an unknown ticker, module or market, markup in the hash, a hand-edited store — falls back rather than through. **16/16.** |
| `crosshair` | Each of the three charts lights, the readout plate stays inside its frame and is never narrower than its own text, moving between charts leaves exactly one lit, leaving them puts them all out. **9/9.** |
| `interact` | Trade, close, resolve, create, search, sort, filter, comms, report, and the basket's select / clear / chips / bar / scatter / peer / crossing / fold / roving tabindex / arrows / Home / End / Enter / Escape / CSV / live region / theme persistence. **47/47.** |
| `rest` | Touch targets ≥44pt under `pointer:coarse`, company-name reachability, reduced motion, print, and nine LMSR invariants. **3 documented target exceptions and 0 in the basket, 20/20 reachability, 0 animating, 13/13.** |
| `contrast` | WCAG AA over the rendered body, **differentially** — see the header of `contrast.js`. Gradient backgrounds cannot be composited from computed style, so this kind of checker carries standing artefact signatures; what matters is that the set does not grow. |

## Two things that have caught people out

`const S` at the top level of a classic script is a global **lexical** binding,
not a property of `window`, so a check reaches it by name (`new Function("return S.eqSel")()`)
rather than off `window`.

`color-mix()` computes to `color(srgb 0.94 …)` with 0–1 floats, not `rgb()` with
0–255. A parser that assumes `rgb()` reads those as near-black and reports
confident nonsense — it once claimed 1.89:1 on a tile that measures 4.78:1.
