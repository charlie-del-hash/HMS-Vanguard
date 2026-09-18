# Affinity Research — handoff

How the site works, and why each part is shaped the way it is. The faults are recorded alongside
the fixes on purpose: most of what looks like an odd decision here is the scar of something that
failed silently.

For the ops deck's own internals — its layout model, tables, colour rules and known gaps — see
[`docs/ops-deck.md`](docs/ops-deck.md). For what every check asserts, see
[`checks/README.md`](checks/README.md). For getting it running, see [`README.md`](README.md).

**Live:** the **`hms-vanguard`** Vercel project is production, and its domain is the link to
circulate. (This used to say `affinity`; it was wrong, and a hard-coded copy of that URL was
deciding every canonical link on the site until it was found.)

## Contents

- [Publishing](#publishing) — one publisher, one address
- [The deploy build is not the build you run](#the-deploy-build-is-not-the-build-you-run)
- [The report system](#the-report-system)
- [The admin](#the-admin-and-the-one-thing-you-must-do-by-hand-first) — and the one thing you must do by hand first
- [The funnel](#the-funnel-what-is-measured-and-what-measures-it)
- [Two checks that were passing while looking at nothing](#two-checks-that-were-passing-while-looking-at-nothing)
- [Verification](#verification)

---

## Publishing

**Vercel is the only publisher.** It builds from its own git integration on every push, so a
deployment is a push and nothing in Actions is in the path.

### GitHub Pages is retired

`.github/workflows/static.yml` used to publish the deck as the site ROOT on every push to `main`.
That was right when the deck WAS the site. It stopped being right the moment `src/pages/index.astro`
existed: merging this work with that workflow in place would have put a second, stale copy of the
site at `https://charlie-del-hash.github.io/HMS-Vanguard/`, each address canonicalising to itself,
which is the same two-projects problem described below and for the same reason.

The workflow has been deleted. **The Pages site itself is not deleted by that** — disable it in
**Settings → Pages** (set Source to *None*), or the last build it made goes on being served from
that address indefinitely.

Its history is kept here because it is a useful record: push events stopped creating Pages runs in
August 2026 while `workflow_dispatch` worked every time, run #22 wedged in a pre-*queued* state
that accepted neither re-run nor cancel, and a long-delayed push run once fired late and won the
race, leaving Pages on `4e90e04` while `main` was `007ed4c`. None of that applies any more, and
none of it ever touched Vercel — which is not therefore trouble-free; see **The deploy build is
not the build you run**, below.

Two Vercel projects (`affinity` and `hms-vanguard`) build this repo, both rooted at the repo root
rather than a subfolder — which is why a `vercel.json` in a subdirectory, as an earlier iteration
of this repo had, never took effect. **`hms-vanguard` is production.** Vercel builds every branch, so its previews show a branch
before `main` does, which is how a branch gets tested before it is merged.

**A second project building the same repo is not free, now that the repo has a build.** Each one
canonicalised to its own production domain, so two domains served the same site, each claiming to
be the original — the same fault GitHub Pages was retired for, surviving the retirement.

**That is now decided in the repo rather than in the dashboard**, because the Vercel API answers
403 from a session here (see below) and a fix that needs a dashboard login is a fix nobody can
apply from where the work happens.

- `scripts/hosts.mjs` holds `CANONICAL_HOST` and `MIRROR_HOSTS`. `astro.config.mjs` builds `site`
  from it, so canonical links, `og:url`, the sitemap and the feed name one domain on **both**
  projects, in previews as well as production.
- `scripts/vercel-config.mjs` prepends a catch-all `308` to the canonical origin when, and only
  when, this is a **production** deployment of a host named in `MIRROR_HOSTS`. The route is built
  by `getTransformedRoutes` like the header routes, so it is the platform's own regex rather than
  one guessed at, and it is deduplicated by the same deep-equality rule.
- `PUBLIC_SITE_URL` still overrides everything, which is what a custom domain will use.

**`MIRROR_HOSTS` is an allowlist on purpose, and this is the part to not "simplify".** The obvious
version — *redirect whenever this build is not the canonical host* — turns a project rename into a
production site that 308s itself to a domain that no longer exists. Naming the mirrors means the
same mistake degrades to a stale canonical, which is visible and survivable.
`checks/vercel-output.js` tests all six cases as a pure function, including the renamed one.

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

## Verification

Four suites, and the rule they are built on: **a check you cannot make fail has not been
verified.** [`checks/README.md`](checks/README.md) has what each one asserts and the current
counts; this is the order to run them in and what each is for.

```
npx astro check        # types, 0 errors
npm test               # the deck — the regression net for the shared chart and token layers
npm run check:site     # builds, then drives .vercel/output/static
npm run check:admin    # starts a real dev server; SSR routes have no file to serve
npm run check:db       # needs egress and a key
```

`npm run check:all` chains all five. The first four need no credentials: with Supabase
unconfigured the content resolver renders the committed seed and says so, and the admin checks
assert the guard **refuses** when the database is unreachable, which is the interesting case rather
than a degraded one. CI runs those four on every push and pull request.

`check:db` is the exception and is deliberately not in CI. It exits **2** rather than 1 when it
cannot reach the database, because every assertion in it reads "refused" as a pass and a request
that never left the machine is also refused — the first time it ran, from a sandbox whose egress
allowlist did not include the project, it reported twelve passes for a database it could not see.
Exit 2 means *could not test*. Its companion `checks/db-rls.sql` runs the same assertions inside
the database and needs no egress.

### What cannot be verified from a sandbox here

Recorded so nobody reports a clean sweep that was not one:

- **The mirror redirect firing.** Asserted against the generated routing config and the pure
  function behind it, never against a live request — the Vercel API answers 403 from here and
  `vercel.app` is unreachable. `curl -sI https://affinity-wine.vercel.app/` after a production
  deploy is the real check.
- **Anything needing a Supabase connection**, including `check:db`.
- **The admin editor's layout.** `admin-overflow` reaches 1 of 6 routes without a staff session and
  names the five it cannot. `ADMIN_SESSION_COOKIE` closes that.
- **How a share card unfurls** on Slack, X or LinkedIn.
