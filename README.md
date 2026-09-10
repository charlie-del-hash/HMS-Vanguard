# Affinity Ops Deck

Static HTML, no build step, no dependencies.

| File | What it is |
| --- | --- |
| `affinity-ops-deck.html` | Ops deck — prediction desk, comms queue, research library and a shipping equities basket. Single self-contained file. |
| `HANDOFF.md` | Layout model, conventions and known gaps. Read before changing the frame. |
| `checks/` | Headless-Chromium checks that drive a served copy of the deck and read the live DOM. `node checks/run.js`. Development only — the Pages workflow publishes the deck alone. |
| `vercel.json` | Rewrites and headers for the Vercel deployments, which build from the repo root. |

Open the deck straight in a browser, or serve the folder with `npx serve .`.

**Live:** the `hms-vanguard` Vercel project is production, and its domain is the link to share.

GitHub Pages mirrors it at https://charlie-del-hash.github.io/HMS-Vanguard/. Both publish from
`main` and serve the same file; on both, `/ops-deck.html` serves the same page. Pages builds via
`.github/workflows/static.yml`, Vercel from the repo root.

Two Vercel projects (`affinity`, `hms-vanguard`) are connected to this repo, both rooted at the
repo root. **`hms-vanguard` is production.** A second project building the same repo means two
domains each canonicalising to themselves — see HANDOFF.md before leaving it that way.

`vercel.json` holds headers only, and they are merged into the build output by
`scripts/vercel-config.mjs`; the Astro adapter does not read them. Anything added to `vercel.json`
needs the same treatment or it silently does nothing.
