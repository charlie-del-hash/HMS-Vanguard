# Affinity Ops Deck

Static HTML, no build step, no dependencies.

| File | What it is |
| --- | --- |
| `affinity-ops-deck.html` | Ops deck — prediction desk, comms queue, research library and a shipping equities basket. Single self-contained file. |
| `HANDOFF.md` | Layout model, conventions and known gaps. Read before changing the frame. |
| `checks/` | Headless-Chromium checks that drive a served copy of the deck and read the live DOM. `node checks/run.js`. Development only — nothing in `checks/` is deployed. |
| `vercel.json` | Rewrites and headers for the Vercel deployments, which build from the repo root. |

Open the deck straight in a browser, or serve the folder with `npx serve .`.

**Live:** the `hms-vanguard` Vercel project is production, and its domain is the link to share.

**GitHub Pages has been retired.** `.github/workflows/static.yml` used to publish the ops deck as
the site ROOT on every push to `main`, which since the Astro landing page exists would have put a
second, stale copy of the site at a second address — each canonicalising to itself. Vercel is the
single home; the deck stays reachable there at `/ops-deck.html`, which is the URL that was
circulated. Nothing links to the Pages address any more, and the Pages site itself should be
disabled in **Settings → Pages** so the old build stops being served.

Two Vercel projects (`affinity`, `hms-vanguard`) are connected to this repo, both rooted at the
repo root. **`hms-vanguard` is production.** A second project building the same repo means two
domains each canonicalising to themselves — see HANDOFF.md before leaving it that way.

`vercel.json` holds headers only, and they are merged into the build output by
`scripts/vercel-config.mjs`; the Astro adapter does not read them. Anything added to `vercel.json`
needs the same treatment or it silently does nothing.
