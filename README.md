# Affinity Research

A public research publication — special reports on shipping, energy and the chokepoints between
them — built as an attention funnel for Affinity's private research portal.

Every report is free and open. There is no signup wall, deliberately: the growth instrument is
detailed first-party analytics rather than a form standing between a reader and the work. Email is
offered and easy to ignore.

**Live:** <https://affinity-wine.vercel.app> — the `affinity` Vercel project, the only publisher.

## Quick start

```
npm install
npx playwright install chromium    # only needed to run the checks

npm run dev                        # localhost:4321
npm run build                      # → .vercel/output, the artifact that deploys
npm run check:all                  # every suite
```

No credentials are needed to run, build or check. Without Supabase configured the site renders a
committed seed report and says so in a `<meta>` tag; see **Content** below.

## What is where

| Path | What it is |
| --- | --- |
| `src/pages/` | Routes. `/`, `/reports/[slug]`, `/privacy`, the `/api/*` endpoints, and `/admin/*` behind Supabase Auth. |
| `src/lib/` | The engine room: the eleven block types (`blocks.ts`), the content resolver (`content.ts`), the chart generators (`charts/`), text measurement (`text.ts`), the analytics beacon. |
| `src/components/blocks/` | One component per block kind. A report is an ordered list of blocks; this renders them. |
| `checks/` | Four test suites driving headless Chromium against real output. See [`checks/README.md`](checks/README.md). Never deployed. |
| `scripts/` | Build and maintenance: the routing-config splice, the canonical-host declaration, the share-card renderer, the seed loader, the deck's financials refresh. |
| `supabase/migrations/` | Schema and row-level security, in order. `0001`–`0010`. |
| `public/ops-deck.html` | The original single-file ops deck this project grew out of, still published at `/ops-deck.html` because that URL was circulated. See [`docs/ops-deck.md`](docs/ops-deck.md). |

## Content

`src/lib/content.ts` has one rule and it is worth knowing before anything else: **the source is
explicit and there is no silent fallback.**

- Supabase configured → the database. A read failure is **fatal**; the build stops rather than
  quietly serving something older or emptier. A paused free-tier project looks exactly like this.
- Not configured → the committed seed in `src/content/hormuz.ts`.
- `CONTENT_SOURCE=seed` forces the seed even when credentials are present.

Every deployment says which it used, in `<meta name="affinity-content-source">` — one `curl` away
for anyone wondering whether a deploy is serving the database or the seed.

All figures currently on the site are **indicative**: shaped like the real assessment rather than
being it, and labelled as such on every page. Nothing there should be quoted.

## Checks

| Suite | Command | Covers |
| --- | --- | --- |
| deck | `npm test` | The ops deck, unchanged — the proof that site work has not disturbed what was already live |
| site | `npm run check:site` | The build output: routing config, share metadata, reports, beacon, charts, overflow, contrast |
| admin | `npm run check:admin` | The SSR routes: the auth guard, both public endpoints, the admin's layout |
| database | `npm run check:db` | What a reader's key can and cannot reach. Needs egress and a key, so it is the one suite CI does not run |

The first three run in CI on every push and pull request. `check:db` exits **2** — not 1 — when it
cannot reach the database, because every assertion in it reads "refused" as a pass and a request
that never left the machine is also refused.

## Publishing

One repository, one Vercel project, one address. The `affinity` project publishes
<https://affinity-wine.vercel.app>; `scripts/hosts.mjs` names that host, and every canonical link,
sitemap entry, `robots.txt` Sitemap line and feed URL is built from it. `PUBLIC_SITE_URL` overrides
it without a code change if the site ever moves.

This used to be two projects with the second one 308ing to the first. The second project
(`hms-vanguard`) has been deleted, so the redirect machinery is gone too — what replaced it is an
assertion that the build ships **no** off-origin redirect at all, since with one project there is
no longer a legitimate one. GitHub Pages is retired and unpublished. The reasoning, and the week of
failed deployments that produced it, are in [`HANDOFF.md`](HANDOFF.md).

`vercel.json` holds headers only, and they are merged into the build output by
`scripts/vercel-config.mjs` — the Astro adapter does not read them. Anything added there needs the
same treatment or it silently does nothing.

## Before this takes real traffic

- Environment variables on the production project, and the **order matters**: setting
  `PUBLIC_SUPABASE_URL` switches the content source to the database, and a read failure there stops
  the build.
- The staff bootstrap — there are no users and no staff rows, and sign-up is deliberately off. Two
  steps, once, in [`HANDOFF.md`](HANDOFF.md).
- Rate limiting on `/api/*` at the platform. The endpoints cap what a single request can cost;
  bounding how many arrive is a Vercel Firewall rule.

## Further reading

- [`HANDOFF.md`](HANDOFF.md) — how the site works: publishing, the report system, the admin, the
  funnel, and the faults that shaped each one.
- [`docs/ops-deck.md`](docs/ops-deck.md) — the ops deck's own layout model, tables, colour rules and
  known gaps.
- [`checks/README.md`](checks/README.md) — what every check asserts, and the rule they are built on:
  a check you cannot make fail has not been verified.
