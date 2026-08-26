# Affinity Ops Deck

Static HTML, no build step, no dependencies.

| File | What it is |
| --- | --- |
| `affinity-ops-deck.html` | Ops deck — prediction desk, comms queue, research library and a shipping equities basket. Single self-contained file. |
| `HANDOFF.md` | Layout model, conventions and known gaps. Read before changing the frame. |
| `checks/` | Headless-Chromium checks that drive a served copy of the deck and read the live DOM. `node checks/run.js`. Development only — the Pages workflow publishes the deck alone. |
| `vercel.json` | Rewrites and headers for the Vercel deployments, which build from the repo root. |

Open the deck straight in a browser, or serve the folder with `npx serve .`.

**Live:** https://charlie-del-hash.github.io/HMS-Vanguard/ — `/ops-deck.html` serves the
same page. Pushes to `main` publish via `.github/workflows/static.yml`.

The repo is also connected to two Vercel projects (`affinity`, `hms-vanguard`), both rooted
at the repo root. `vercel.json` rewrites `/` and `/ops-deck.html` to the deck there, so every
deployment serves the same page at the same paths.
