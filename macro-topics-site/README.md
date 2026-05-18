# Affinity Macro Topics

Static single-page HTML reader for the Affinity Research weekly macro brief.

## Deploy

Push to GitHub, then import the repo in [Vercel](https://vercel.com/new). Vercel auto-detects static sites — no build step needed.

### Manual preview

```bash
# any static server works
npx serve .
```

## Structure

```
index.html      — self-contained reader (CSS + JS inline)
vercel.json     — caching / header config for Vercel
```
