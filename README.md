# TARA Dealership

**TARA Dealership. Your Local TARA Golf Cart Dealership.**

A 100% static website — no Node server, no API routes, no runtime database.
Everything dynamic is resolved at **build time** and baked into plain
HTML/CSS/JS that GitHub Pages can serve as files.

Contact: **taradealership@gmail.com** · **1-844-844-3432**

---

## Quick start

```bash
npm ci
npm run build      # snapshot → SEO → images → bundle → prerender
npm run verify     # size/report gate on dist/
npm run preview    # serve dist/ at http://localhost:4173
```

`npm run dev` starts Vite on the raw sources. Run `npm run fetch-data` and
`npm run optimize-assets` once first — dev reads the generated snapshot and
image derivatives from `client/public/`.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | Vite dev server |
| `build` | `fetch-data` → `generate-seo` → `optimize-assets` → `vite build` → `prerender` |
| `build:site` | Same, but skips the network data fetch |
| `preview` | Serves `dist/` locally |
| `fetch-data` | Writes the build-time JSON snapshot into `client/public/data/` |
| `generate-seo` | Regenerates sitemaps, robots.txt, feeds and the web manifest |
| `optimize-assets` | WebP/AVIF derivatives, social images, favicons |
| `prerender` | Writes a real `index.html` for every route, plus 404/CNAME/.nojekyll |
| `verify` | Post-build gate: required files, size budget, image formats, leak scan |
| `typecheck` | `tsc --noEmit` |

## Layout

```
assets-src/images/      raw image originals — never deployed
content-src/routes.json route table (path → content file + SEO metadata)
client/
  index.html            HTML shell (per-page head is written by prerender)
  public/               static files copied verbatim into dist/
    content/*.html      one extracted HTML file per page
    css/ js/ fonts/     the original site's stylesheets and behaviour bundle
    data/               GENERATED — build-time snapshot (git-ignored)
    images/             GENERATED — optimized derivatives (git-ignored)
  src/                  boot script: enhances the prerendered DOM
script/                 build pipeline (TypeScript, run with tsx)
shared/site.ts          constants + types shared by client and build scripts
dist/                   build output — this is what GitHub Pages serves
```

## Deployment

`.github/workflows/deploy.yml` builds on every push to `main` and on
`workflow_dispatch`, then publishes `dist/` with
`actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4`.

Two values in the workflow's `env:` block control the target:

| | Custom domain | `<user>.github.io` | Project site |
| --- | --- | --- | --- |
| `SITE_DOMAIN` | `taradealership.com` | `<user>.github.io` | `<user>.github.io` |
| `BASE_PATH` | `/` | `/` | `/<repo-name>/` |

`SITE_DOMAIN` drives canonical URLs, OG tags and sitemaps. `BASE_PATH` is
threaded through every asset URL, internal link, stylesheet `url()`, favicon
and prerendered page — nothing is hard-coded to `/`.

**Repository setting:** Settings → Pages → Source → **GitHub Actions**.

**Custom domain:** the root `CNAME` file holds the bare domain and the build
copies it into `dist/` on every run, because Pages wipes it otherwise. Delete
`CNAME` (or empty it) if you are not using a custom domain.

## How the static conversion works

- **No runtime API.** `script/fetch-data.ts` resolves all data once at build
  time into minified JSON under `client/public/data/`. It can pull from a
  remote content API via `CONTENT_API_URL`/`CONTENT_API_KEY`; with neither set
  it reads the checked-in content mirror and needs no network at all. API keys
  are read in that script only and never reach the browser bundle.
- **Every URL is a real file.** `script/prerender.ts` writes
  `dist/<route>/index.html` for all 544 routes with the page content already in
  the body and per-page title/description/canonical/OG/Twitter/JSON-LD in the
  head. Alias routes get redirect stubs; `404.html` boots the app for anything
  unknown; `.nojekyll` keeps `_`-prefixed paths servable.
- **Images.** `script/optimize-assets.ts` turns the originals in `assets-src/`
  into WebP + AVIF at 400/800/1200px (capped at the source width), strips
  metadata, and records everything in an image manifest. Prerender rewrites
  every `<img>` to `srcset`/`sizes` with explicit width/height, and lazy-loads
  everything below the first two images.
- **Search.** The original `/search.php` is replaced by `/search/`, which
  scores a prebuilt index (`data/search-index.json`) in the browser.
- **Forms.** There is no form endpoint. The contact CTA on every page is a
  `mailto:` and a `tel:` link.

## Notes

- `TARA Golf Cart Models/` is reference material for the vehicle catalog
  snapshot (`data/models.json`); it is not deployed.
- `attached_assets/` and `screenshots/` are working files; they are not
  deployed either.
- Content edits go in `client/public/content/*.html`; route metadata (title,
  description, social image) lives in `content-src/routes.json`.
