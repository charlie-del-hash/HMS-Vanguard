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

**GitHub Pages has been retired, and is unpublished.** `.github/workflows/static.yml` used to
publish the ops deck as the site ROOT on every push to `main`, which since the Astro landing page
exists would have put a second, stale copy of the site at a second address — each canonicalising to
itself. The workflow is deleted and the Pages site is switched off in **Settings → Pages**;
`charlie-del-hash.github.io/HMS-Vanguard/` now returns GitHub's "There isn't a GitHub Pages site
here". Vercel is the single home, and the deck stays reachable there at `/ops-deck.html`, which is
the URL that was circulated.

**Two Vercel projects (`affinity`, `hms-vanguard`) build this repo, and only one of them serves
it.** Retiring Pages removed one duplicate of the site and left another: both projects deploy every
branch, so both production domains served the whole thing, each claiming to be the original. The
repo now decides this rather than the dashboard:

- `scripts/hosts.mjs` names `hms-vanguard.vercel.app` as the canonical host, and every canonical
  link, `og:url`, sitemap entry and feed link is built from it on **both** projects.
- The same file lists `affinity-wine.vercel.app` as a mirror, and `scripts/vercel-config.mjs` gives
  a mirror's **production** deployment a single catch-all `308` to the canonical origin. Previews
  are untouched, so a branch can still be reviewed on either project.
- `PUBLIC_SITE_URL` overrides the canonical host without a code change — that is the setting a real
  custom domain will use.

`checks/vercel-output.js` asserts both halves: that the redirect fires for a mirror's production
domain and for nothing else, and that a non-mirror build ships no off-origin redirect at all.

`vercel.json` holds headers only, and they are merged into the build output by
`scripts/vercel-config.mjs`; the Astro adapter does not read them. Anything added to `vercel.json`
needs the same treatment or it silently does nothing.
