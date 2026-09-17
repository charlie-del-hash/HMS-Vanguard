# Affinity Ops Deck — handoff

`affinity-ops-deck.html` is one self-contained file — no build step, no dependencies, no
network calls. Open it directly or serve it; both work.

The checks live beside it in `checks/` and are not part of the deployed page. `node checks/run.js`
runs all of them; see the Verification section below for what they hold.

**Live:** the **`hms-vanguard`** Vercel project is production, and its domain is the link to
circulate. (This used to say `affinity`; it was wrong, and a hard-coded copy of that URL was
deciding every canonical link on the site until it was found.) GitHub Pages serves the same deck
at https://charlie-del-hash.github.io/HMS-Vanguard/ and stays as a mirror. On both,
`/ops-deck.html` serves the deck.

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

A push to `main` deploys in roughly 20 seconds — **when the push actually creates a run**, which
as of 26 Aug 2026 it does not.

**Publishing has a fault right now, and it is GitHub's rather than this repo's.** Push events
stopped creating Pages runs: merges to `main` produced no run at all, while `workflow_dispatch`
worked every time. Run #22 has also been wedged since 15:14 in a state before *queued* — it
accepts neither a re-run (`403 already running`) nor a cancel (`409 not queued yet`).

Two things follow. **Dispatch is the workaround**: Actions → Deploy static content to Pages → Run
workflow, which builds from `main` and publishes normally. And **#22 is a hazard if it ever
wakes**: it deploys `757f14e`, so it would republish an older deck over the current one. It did
not block anything — a dispatched run completed alongside it — so an early diagnosis that it held
the concurrency group was wrong.

It has already happened once that a long-delayed push run fired late and won the race, leaving
Pages on `4e90e04` while `main` was `007ed4c`. That was harmless only because those two commits
carry an identical deck, and the workflow publishes the deck alone. **Check the published ref
after any merge that changes `affinity-ops-deck.html`**, and dispatch if the push run never came.

Vercel builds from its own integration rather than from Actions, so the Pages fault above does not
touch it. It is not therefore trouble-free — see **The deploy build is not the build you run**,
below.

Two Vercel projects (`affinity` and `hms-vanguard`) build this repo, both rooted at the repo root
rather than a subfolder — which is why the reader's old `macro-topics-site/vercel.json` never took
effect. **`hms-vanguard` is production.** Vercel builds every branch, so its previews show a branch
before `main` does, which is how a branch gets tested before it is merged.

**A second project building the same repo is not free, now that the repo has a build.** Each one
canonicalises to its own production domain, so two domains serve the same site each claiming to be
the original. Either pin `PUBLIC_SITE_URL` to the `hms-vanguard` domain in both projects, or stop
`affinity` building. Left alone, the site competes with itself.

**Vercel no longer serves the repo root, and that changes an old conclusion.** It used to, which is
why `checks/`, `HANDOFF.md` and everything else answered on the shared domain. The Astro adapter
builds through the Build Output API: only `.vercel/output` is deployed, so the surface is the build
and nothing else. Verified, and `checks/vercel-output.js` asserts it stays that way.

**That closes the `.vercelignore` question rather than answering it.** The old note argued the file
was not worth adding while the repo was public, and would become worth it if the repo went private
with a public deployment. Neither case applies now: there is nothing to ignore, because nothing
outside the build is uploaded.

**`vercel.json` is two files wearing one name, and the difference decides whether a key works.**

*Routing* keys — `headers`, `redirects`, `rewrites` — are read by the **adapter**, and it reads them
for exactly one thing: a warning if `trailingSlash` conflicts with the Astro config. It merges
nothing. Routing comes from the generated `.vercel/output/config.json`, so headers declared here did
nothing at all until `scripts/vercel-config.mjs` began splicing them in — a step chained into
`npm run build` rather than an `astro:build:done` hook, because that hook runs *before* the adapter
writes the file. Anything else routing-shaped needs the same treatment or it silently does nothing.

*Build* keys — `installCommand`, `buildCommand`, `framework` — are read by the **platform**, before
the build starts and before the adapter exists. They work as documented. `installCommand` is set
here, and the reason is below.

So the rule is not "vercel.json does nothing". It is: routing needs splicing, build settings do not.

## The deploy build is not the build you run

Every deployment of the Astro branch failed, on both projects, for a week — and every check here
passed the whole time, because **the thing that was broken is not checked by building.**

**The cause: one foreign key in the routing config.** `.vercel/output/config.json` is validated by
the platform, and its route objects are `additionalProperties: false`. `scripts/vercel-config.mjs`
stamped `affinity-headers: true` onto each route it merged, to make the merge idempotent. That one
key makes the whole config invalid, so Vercel **fails the deployment after the build has already
reported success**. `npm run build` is green either way. The only symptom is a red deployment.

The script is idempotent by deep-equality now — it rebuilds the same routes from the same
`vercel.json` every run, so a previous run's copies are recognised by comparison rather than by a
marker. **Do not reintroduce a marker.** `checks/vercel-output.js` validates the real output against
`routesSchema` from `@vercel/routing-utils` — the platform's own schema, with the same validator —
which is the assertion that would have caught this on day one.

### How to find out what Vercel did, without a Vercel login

**Vercel's API answers 403 for these projects** (`list_teams` returns an empty array, so the
connector is authenticated to an account with no access to `hms-affinity-s-projects` at all). The
build log cannot be read from a session here. What *can* be read needs no Vercel credential:

```
curl -s https://api.github.com/repos/charlie-del-hash/HMS-Vanguard/commits/<sha>/status
```

It carries both projects' deployment result. Run it across a range of commits and it bisects the
break for you — which is how this was found, after two wrong guesses. The result was unambiguous:
`7ff4343`, `6556fec` and `ffdf3a1` all deployed green, and `b7da8af` was the first failure. That
commit introduced the stamp.

**The lesson is the method.** Two plausible causes were fixed first and neither was it, because both
were reasoned from what *could* fail rather than from when it *started* failing. The history was
free and decisive. Bisect before theorising.

### Three real faults found on the way, none of them the cause

Worth keeping, and all now asserted — but none of these broke the deployments, since every one of
them was present in the commits that deployed green:

- **`engines.node` was `">=22"`.** Vercel documents `MAJOR.x` and this field *overrides* the
  project's Node setting. Now `"22.x"`, matching what `checks.yml` runs.
- **The deploy build installed Playwright**, whose postinstall downloads three browsers. Locally
  that is suppressed by `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`, set in the dev container and nowhere
  else. `installCommand` is `npm ci --omit=dev` now, which a deploy has no reason not to be.
- **`@vercel/routing-utils` was a devDependency** and `npm run build` imports it — so the omit above
  would have broken the build had it not been moved to `dependencies` first. `@astrojs/check` was
  not declared at all; `npm run typecheck` only worked off a stale npx cache.

**The general rule, which is the one to remember: nothing a build script runs may import a
devDependency**, and **a config file nothing validates locally is a config file you are guessing
about.**

### Reproducing the deploy environment

A local build is not a deploy build. `.env` exists here and does not exist on Vercel, so the
faithful reproduction is:

```
mv .env /tmp/ && npm ci --omit=dev && NODE_ENV=production CI=1 VERCEL=1 npm run build
```

That passes, and passing it is necessary rather than sufficient — it does not validate the output,
which is what `checks/vercel-output.js` is for.

## The report system

A report is a row plus an ordered list of blocks, and there are eleven block kinds. The contract
lives in `src/lib/blocks.ts`, which `0001_content.sql` already points readers at.

**A payload references data; it does not carry it.** A chart block names series keys, a timeline
names tags, a KPI cites a source key. That is why `series`, `events` and `sources` are tables
rather than more jsonb — a figure lives in one place and a report that prints it points at it.
`src/lib/content.ts` resolves references into `ResolvedBlock`s, so no component talks to the
database and every component can be rendered from a literal. `/dev/blocks/` does exactly that.

**A bad payload fails the build.** `parsePayload` throws rather than skipping a block it cannot
read. A published report silently missing its methodology box is worse than a build that stopped.
The same rule refuses a KPI or a table that has neither a `sourceKey` nor `indicative: true`.

**Prose is a tiny markup grammar, never HTML.** `src/lib/inline.ts` escapes first, then applies
bold/italic/code/figure and https-only links to the ESCAPED text, so there is no second pass in
which a payload could become a tag. `set:html` does not escape, and this content comes out of a
database an admin UI will write to. The last block of `/dev/blocks/` is a hostile payload —
script tags, an `onerror` image, `javascript:` and `data:` links — and `checks/site-report.js`
asserts none of it executes or becomes markup. Negative-tested: removing the escape produces five
failures, one of which is the payload actually running.

### Where the content comes from, and why it never guesses

| | |
| --- | --- |
| credentials set | the database. A failure to reach it **fails the build**. |
| credentials absent | the committed seed, announced in the build log. |
| `CONTENT_SOURCE=seed` | the seed even with credentials — for a sandbox with no egress. |

**There is no silent fallback, deliberately.** A free-tier project pauses after about a week idle,
and a paused database is unreachable; under a fallback that would mean a deploy quietly replacing
live content with placeholder copy. A red build is the correct and survivable failure. The project
had in fact paused by 17 Sep and was restored — expect that again, and see item 0 in the plan.

This sandbox has **no egress to the Supabase host** (`Host not in allowlist`), so local builds
need `CONTENT_SOURCE=seed`. `npm run check:db` exits **2** rather than 1 for that case, because a
check that reads a network refusal as a pass is worse than no check.

### The map is a chart, not a map

`src/lib/charts/map.ts` draws the incident plot through the same pipeline as everything else, and
that is not an aesthetic choice. A tile layer means a third-party request on every report view —
a tracking surface the funnel explicitly does not want — and an SVG stretched to fit its box
scales its text, which is the one failure the whole two-pass arrangement exists to prevent.
Coastlines are carried as lon/lat polylines in the payload.

### Confidence is drawn, not just written

`confirmed` is a filled disc, `reported` an open ring, `unconfirmed` a dashed one — on the map and
in the timeline. Shape as well as colour, which is the palette validator's standing rule and also
0002_data.sql's: a plot that draws all three identically asserts something the desk does not know.

### Two chart-layer faults the first real report exposed

- **Gaps were drawn as zeros.** `Number(null)` is 0, so a day with no assessment collapsed to the
  baseline — inventing a figure, and the most alarming one available. `areaChart` now breaks the
  stroke at gaps. The other generators do not, so `content.ts` **refuses** to hand them a gapped
  series rather than letting one plot a missing day as zero.
- **Label thinning was a constant.** `gap < 30 ? 2 : 1` caps thinning at every-other-point, which
  holds for the deck's two dozen points and fails completely at 58 daily ones: 2,778 overlapping
  pairs. `labelStep` in `geometry.ts` derives the step from the measured label width instead —
  the same lesson as the "5.75px a character" bug, applied one level up.

## The admin, and the one thing you must do by hand first

`/admin` is behind Supabase Auth with a staff allowlist. **There are no users and
no staff rows yet**, and nobody can create either from the UI — sign-up is deliberately off
(`shouldCreateUser: false`), because a public form that creates accounts fills `auth.users` with
whatever a crawler types.

So the bootstrap is two steps, once:

1. **Create the account.** Supabase dashboard → Authentication → Users → Add user, with the work
   email. (Or invite it.)
2. **Make it staff**, in the SQL editor:

```sql
insert into public.staff (user_id, role)
select id, 'admin' from auth.users where email = 'you@affinity';
```

Then `/admin/login` emails a magic link. **Supabase's built-in mailer is rate-limited** on the free
tier — a few messages an hour — which suits a desk signing in occasionally and will not suit a
launch. Configure SMTP before it matters.

### The admin never holds the service role

Every write goes through the signed-in user's own session, so the policies in 0004/0006 decide what
they may do. The alternative — service role plus an authorization check in the route — bypasses RLS
entirely, which makes one mistake in one handler a mistake with unlimited write access and turns
the database's own rules into decoration. As built, an authorization bug in `src/lib/auth.ts` can at
worst show somebody a page; it cannot grant a write the database would have refused.

`SUPABASE_SERVICE_ROLE_KEY` is still unset and still unnecessary. It becomes necessary at Phase 4,
for the analytics endpoint.

### It fails closed, and that is the assertion worth keeping

If Supabase cannot be reached, `access()` returns `unavailable` — and the middleware refuses that
exactly like anonymous. A guard that fails OPEN when the database has a bad minute leaves the editor
standing open to anyone with the URL, and a free-tier project pauses after about a week idle, so
that is a scheduled event rather than a risk.

**`checks/site-admin.js` tests this, and for a while it did not.** With no cookie at all,
supabase-js answers "Auth session missing" from memory and never touches the network — so an empty
request exercises the anonymous path and says nothing about the unreachable one. The check now
sends a syntactically valid session cookie, which forces the client to go and verify it, which
fails at the network here. Negative-tested: a guard modified to let `unavailable` through fails it.

### Editing

- **Metadata** is a plain form. No JavaScript, nothing to get out of step with the island.
- **Blocks** are the one React island on the site — and the only reason React is registered at all.
  Public pages still ship no framework runtime.
- **Saving** posts to `/admin/reports/[id]/save`, which runs `parsePayload` before writing. The
  session cookies are httpOnly, so a browser-side Supabase client could not read them anyway; going
  through the server keeps the token out of reach AND puts every write through the parser.
- **`save_report_blocks`** (migration 0008) replaces a report's blocks in ONE transaction and
  snapshots the previous version into `report_revisions`. Over PostgREST the three operations would
  be three transactions, and a failure between them leaves a published report half rewritten.
  SECURITY INVOKER, so RLS still decides who may.

### The preview is the real renderer

`/admin/preview/[id]` imports the same `Blocks` component and the same stylesheet as
`/reports/[slug]`. It is not a preview of the report; it is the report, with a banner on it.

Reimplementing the renderer in React for a live-as-you-type preview would give two renderers that
agree until the first time one is fixed — and the one the author is looking at would be the wrong
one. The cost is that it shows the last SAVE rather than the current keystroke, which the banner
says.

### Publishing rebuilds, or says it did not

Report pages are prerendered, so publishing changes nothing a reader sees until a build runs. Set
**`VERCEL_DEPLOY_HOOK_URL`** (Vercel → Project → Settings → Git → Deploy Hooks) and publishing
triggers one. Without it the editor says plainly that the report is published in the database and
will appear at the next build — it does not say "Published!" and leave the site unchanged.

### What Phase 3 could not verify here

The phase's own gate is *publish a second report entirely through the UI*. **That cannot run in this
sandbox** — there is no egress to the Supabase host, so nothing can sign in. It needs a human, a
browser, and the two bootstrap steps above. Everything in `checks/site-admin.js` is the security
half, run in the condition that produces the interesting failure.

**Deferred, deliberately:** media upload to Supabase Storage. There is not one image in the build,
`imageService` is off for the same reason, and a storage bucket with an upload path is real surface
to secure for a feature nothing currently needs.

## The funnel: what is measured, and what measures it

Content is free, email is optional, and **analytics is the growth instrument** rather than a signup
wall. That decision is what makes these three tables load-bearing and their privacy posture part of
the product rather than a footer.

### One writer, and it is not the browser

`visitors`, `interactions` and `subscribers` have RLS with **no write policy for any role**. The only
writer is `/api/track` (and `/api/subscribe`), holding the service role. That is not belt-and-braces:
the country on a visitor row is derived from the request IP, the IP is never stored, and a browser
cannot know its own country — so a server has to be in the path regardless, and once it is, a public
INSERT grant would be pure extra surface.

`anon` has **no grant at all** on any of the three. 0009 gave `authenticated` SELECT behind
`private.is_staff()`, so `/admin/analytics` reads as the signed-in user and the database decides —
rather than the service role plus a guard in route code, where one forgotten check exposes the
subscriber list. That also cleared the last three security advisories, by granting the access that
was always intended instead of by adding a hole.

### First-touch attribution, and why it needed an RPC

A visitor's referrer and UTM tags are pinned on their **first** hit and must survive every visit
after. PostgREST's upsert writes every column it is given, so through REST the choice is overwrite
the attribution or do two round trips with a race between them. `record_events` (0009) is
`on conflict (anon_id) do update set last_seen = now()` and nothing else.

Without it, a reader who arrives from a newsletter and comes back directly a week later is recorded
as having arrived directly — and the newsletter loses credit for a signup it earned.

### The privacy page is a set of assertions

`/privacy` makes four claims, and `checks/site-beacon.js` checks each against a real browser loading
the real build:

| claim | assertion |
| --- | --- |
| no third parties | zero requests to any host but ours from a report page |
| Do Not Track | **no beacon AND no identifier** — un-recorded, not merely un-reported |
| no fingerprint | the payload contains no user-agent, no IP, no screen or canvas data |
| never a wall | the form is a real POST that works with JS off, consent is not pre-ticked, and nothing fixed covers more than 60% of the viewport |

DNT is honoured *first*, before an id is generated or storage is touched. Respecting it afterwards
would be a gesture rather than a choice, and the check fails if the id appears anyway.

The identifier lives in **localStorage, not a cookie** — 0003's comment says cookie, which was the
plan. The pages it runs on are prerendered static files, so a cookie would ride along on every asset
request and no server would read it; the beacon posts the id in its body regardless.

### /api/track answers 204 to everything, which is why the validation is a function

A beacon has nobody to report an error to, and an endpoint whose status varies with the input is an
oracle for whoever is probing it. The consequence is that **none of its validation is observable over
HTTP** — a check that POSTs rubbish and gets 204 proves only that the server is running.

So it lives in `src/lib/track-validate.ts` as a pure function, and `checks/site-funnel.js` tests it
directly: the uuid, the event allowlist, the batch and body caps, the meta flattening, and that the
country comes from the edge header rather than from anything the client said.

One of those is worth knowing about: **the beacon's `EventKind` and the endpoint's `KINDS` are in
different files and drift silently.** A new event added to one and not the other is dropped forever,
and nothing says so because the endpoint answers 204 either way. There is an assertion that reads
both lists and compares them.

### Still needed before any of it records anything

`SUPABASE_SERVICE_ROLE_KEY` on the deployment. Without it `/api/track` accepts every beacon and
discards it, saying so once per cold start rather than once per reader, and `/admin/analytics` says
plainly that nothing is being recorded. Nothing breaks; nothing is measured either.

## Two checks that were passing while looking at nothing

Both found in Phase 3, both the same shape, and worth knowing about because the shape recurs.

**The site checks were serving a directory that no longer existed.** Adding the first server-rendered
page made Astro restructure `dist/` into `dist/client/` — and `checks/run-site.js` served `dist/`.
Every request 404'd. `site-overflow` then reported **196/196 clean**, because a 404 page does not
scroll sideways either. It now serves `.vercel/output/static` (the artifact that actually deploys,
which does not move when the rendering mode changes), refuses to start if there is no `index.html`,
and fails any page that does not return 200.

**The admin checks were talking to a stale server.** Astro auto-detects an "AI agent environment"
and runs `astro dev` as a detached background daemon, which survives killing the child process and
keeps its port. A leftover daemon answered a later run on code from before the edit under test, and
a deliberately broken auth guard passed all fifteen assertions. `checks/run-admin.js` now sets
`ASTRO_DEV_BACKGROUND=0` to force foreground, picks a random port, and refuses to run if anything is
already listening on it.

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
| Sourced figures | 14/14 — `EQ_IR` and `EQ_FIN` ship empty, so the deck is identical without them and correct with them. Injected fixture: the block appears only with data, figures scale, a loss is coloured, nulls render as a dash, the Source row switches from tab-wide to per-name, every outbound link is https with `rel="noopener"`, and a `javascript:` URL is refused rather than rendered |
| Splice | 12/12, offline — the refresh script rewrites the deck in place, so: round-trip, idempotency, nothing outside the markers moves, and a hostile provider value cannot escape the literal. Then it loads the rewritten deck and asserts the figures reach the panel. This is the check that found the `</script>` bug |
| CIK resolution | 25/25, offline — the registrant-name matcher against the thirteen real titles and against collisions it must refuse, plus `sources.json` held to `EQUITIES`: every name has a source, no `expect` has drifted, no malformed CIK can land |
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

The 25 Aug audit produced six findings and a menu of 52 improvements with stable IDs. **All six
findings are closed and thirty of the menu are built.** The equities tab then went further than
the audit asked: it now has the machinery to carry each company's own reported figures, and the
next step is data rather than code.

### The one thing standing in the way

**Two credentials, and neither can be set from a Claude Code session.** There is no MCP tool for
repository variables or secrets, and the proxy refuses that API path outright
(`GET /actions/variables → 403, "not permitted through this proxy"`). Settings → Secrets and
variables → Actions, by hand:

| Name | Kind | Value |
| --- | --- | --- |
| `SEC_USER_AGENT` | Variable | SEC asks for a contact, and it travels in a header on every request to them. The repo URL works and carries no personal data; a role address is better if this outlives one inbox |
| `FMP_API_KEY` | Secret | Only needed once `"fmp"` is added to `providers`. From the Financial Modeling Prep account; nothing else can supply it |

Then **Actions → Refresh reported figures → Run workflow with dry run ticked.** That resolves the
CIKs and prints every figure it would write, touching nothing. Read that log before running it for
real.

**It is EDGAR-only right now, and that is a switch rather than an accident.** `providers` in
`scripts/sources.json` lists which providers run, and it holds `["edgar"]`. That is deliberately a
decision recorded in the repo instead of a side effect of which secrets happen to be set —
otherwise setting `FMP_API_KEY` for anything else would quietly switch ten names on. Only
`SEC_USER_AGENT` is needed to run as it stands.

It covers the 13 US-listed names and leaves the other ten showing nothing, which is the correct
behaviour rather than a gap: a name with no entry renders no block and keeps saying it is
indicative. Ten names showing nothing beats ten showing something wrong. **To turn the rest on**,
add `"fmp"` to `providers` and set `FMP_API_KEY` — the symbol mapping for all ten is kept intact
so that is a one-line change.

### Then, in order

| What | Note |
| --- | --- |
| **23 IR landing pages** into `EQ_IR` | Editorial and hand-curated. Each one has to be opened by a human first — a Claude Code session cannot reach them (see below), and a dead IR link on a public deck is worse than none |
| **C4 (second half)** | Hovering a table row lights its scatter point. The other direction is done |
| **E4** | Make the table a `grid` with `aria-selected` rather than `role="button"` per `<tr>`, on the roving tabindex already in place |
| **E6** | A visually hidden table behind the scatter — the marks are clickable but not focusable, and this is the proper keyboard route in |
| **D10 / A7** | Values on the row sparklines; exchange and segment inlined beside the ticker |

**B6's table column** keeps its own section above, with the measurement that argues against it.

### What a session here can and cannot reach

Worth knowing before designing anything that fetches, because it cost this session a detour:

| Host | |
| --- | --- |
| `raw.githubusercontent.com`, `api.github.com` | ✅ reachable — enough to fetch the published deck and read deployments |
| `sec.gov`, `data.sec.gov` | ❌ blocked — the CIKs cannot be resolved from here, which is why `resolve-ciks.js` runs on the Actions runner instead |
| `vercel.app`, `github.io` | ❌ blocked — the live pages cannot be opened; verify by fetching the file from `raw.githubusercontent.com` and checking that, and by reading deployment states from the API |
| `api.github.com/repos/…/actions/variables` or `/secrets` | ❌ 403 at the proxy |

The pattern that works: fetch the exact file at the head of `main`, confirm its hash matches, serve
it locally and run `checks/` against **that** copy rather than the working tree.

### These need data that does not exist yet

- **D4** an 8 / 13 / 52-week window switch — `h` holds eight weekly closes and nothing else.
- **F5** a constituent change log — no field for it. (**F3**, per-name as-of stamps, is solved: the
  reported block carries the filing date.)
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
- `EQ_IR` is empty, so no name yet offers a way through to the company itself. Twenty-three
  landing pages, each needing a human to open it once.
- EBITDA from EDGAR is derived rather than filed, and only where operating income and D&A share a
  period. Where they do not, the figure is null and the panel shows a dash — correct, but it means
  a name can carry three headline figures rather than four.
- The refresh job has never run against a live provider. The splice, the resolver's matcher and the
  rendering are all checked offline against fixtures; what no check covers is what EDGAR and the
  aggregator actually return for these particular issuers. Expect the first dry run to be where
  that is found out — which is what the dry run is for.
- The scatter's tickers cross its own faint dashed gridlines in places. Left as it is: they are
  background rules at low contrast, and a label crossing one reads as ordinary chart practice
  rather than as the clash a 2.4px series line makes.
