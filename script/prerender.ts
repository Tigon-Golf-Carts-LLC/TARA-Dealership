/**
 * prerender.ts — turns the built SPA into a fully static, crawlable site.
 *
 * Runs after `vite build`, over dist/ only. For every route in the build-time
 * snapshot it writes a real HTML file — `/about-us/` becomes
 * `dist/about-us/index.html` — with the page content already in the body and
 * per-page <title>, description, canonical, OG and Twitter tags in the head.
 *
 * It also:
 *   - rewrites every <img> to responsive WebP/AVIF derivatives
 *   - rewrites stylesheets to the optimized images and woff2-only fonts
 *   - honours BASE_PATH on every asset URL and internal link
 *   - emits 404.html, .nojekyll, CNAME and alias redirect pages
 *   - minifies every HTML file it writes
 *
 * Fails loudly: a missing content file, a stale shell, or malformed SEO
 * metadata aborts the build rather than shipping a broken site.
 */
import fs from 'node:fs';
import path from 'node:path';

import { compress as toWoff2 } from 'wawoff2';

import {
  DEFAULT_OG_IMAGE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  basePath,
  isRedirect,
  siteOrigin,
  type ImageManifest,
  type RouteMeta,
  type RoutesSnapshot,
} from '../shared/site.ts';
import { pageChromeHtml, callNowHtml } from '../client/src/siteChrome.ts';
import { buildSchema, setSiteUrl } from '../client/src/structuredData.ts';
import { escHtml, minifyHtml, unescHtml, upsertMeta } from './lib/html.ts';
import { DIST_DIR, ROOT } from './lib/paths.ts';
import {
  addPictureCompat,
  applyBasePath,
  applyContactDetails,
  makeImageResolver,
  relativizeOrigin,
  rewriteCssImages,
  rewriteFontFaces,
  rewriteImages,
  rewriteLegacyAssetPaths,
  rewriteLooseImageRefs,
  rewriteSearchForms,
} from './lib/rewrite.ts';

const BASE = basePath(process.env);
const ORIGIN = siteOrigin(process.env);
const BASE_PREFIX = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
const YEAR = new Date().getFullYear();

// Structured data must carry the same origin + base path as the canonical URLs.
setSiteUrl(`${ORIGIN}${BASE_PREFIX}`);

const DIST_CONTENT = path.join(DIST_DIR, 'content');
const DIST_DATA = path.join(DIST_DIR, 'data');

const withBase = (target: string) => `${BASE_PREFIX}${target}`;

function fail(message: string): never {
  console.error(`[prerender] ${message}`);
  process.exit(1);
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

const shellPath = path.join(DIST_DIR, 'index.html');
if (!fs.existsSync(shellPath)) {
  fail(`built shell not found at ${shellPath} — run \`vite build\` first.`);
}
const shellHtml = fs.readFileSync(shellPath, 'utf8');
if (/src=["'][^"']*\/src\/main\.tsx["']/.test(shellHtml)) {
  fail('the shell still references /src/main.tsx — prerender needs the built index.html.');
}

const routesFile = path.join(DIST_DATA, 'routes.json');
if (!fs.existsSync(routesFile)) {
  fail(`route snapshot missing at ${routesFile} — run \`npm run fetch-data\` first.`);
}
const routes = JSON.parse(fs.readFileSync(routesFile, 'utf8')) as RoutesSnapshot;

const manifestFile = path.join(DIST_DATA, 'image-manifest.json');
const manifest: ImageManifest = fs.existsSync(manifestFile)
  ? (JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as ImageManifest)
  : {};
if (Object.keys(manifest).length === 0) {
  fail('image manifest is empty — run `npm run optimize-assets` first.');
}
const resolveImage = makeImageResolver(manifest, BASE);

// Social scrapers get a dedicated 1200x630 JPEG per og:image (WebP/AVIF are
// not universally supported by link-preview crawlers).
const ogManifestFile = path.join(DIST_DATA, 'og-manifest.json');
const ogManifest: Record<string, string> = fs.existsSync(ogManifestFile)
  ? (JSON.parse(fs.readFileSync(ogManifestFile, 'utf8')) as Record<string, string>)
  : {};
const socialImage = (ogImage: string) => ogManifest[ogImage] ?? ogImage;

// ─── Stylesheets and fonts ───────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Convert any legacy font the CSS still needs to woff2, then delete every
 * non-woff2 font file and the faces nothing references.
 */
async function processFonts(): Promise<Record<string, string>> {
  const fontsDir = path.join(DIST_DIR, 'fonts');
  if (!fs.existsSync(fontsDir)) return {};

  const cssText = walk(path.join(DIST_DIR, 'css'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');

  const converted: Record<string, string> = {};

  for (const file of walk(fontsDir)) {
    const rel = `/${path.relative(DIST_DIR, file).split(path.sep).join('/')}`;
    const referenced = cssText.includes(path.basename(file, path.extname(file)));
    if (!referenced) {
      fs.rmSync(file); // e.g. the unused Nunito Sans family
      continue;
    }
    if (file.endsWith('.woff2')) continue;
    // A referenced face with no woff2 sibling: mint one.
    const woff2Path = file.replace(/\.[^.]+$/, '.woff2');
    if (!fs.existsSync(woff2Path)) {
      const out = Buffer.from(await toWoff2(fs.readFileSync(file)));
      fs.writeFileSync(woff2Path, out);
      converted[rel] = `/${path.relative(DIST_DIR, woff2Path).split(path.sep).join('/')}`;
    }
    fs.rmSync(file); // drop the eot/ttf/woff original
  }

  // Remove font folders left empty by the pruning above.
  for (const entry of fs.readdirSync(fontsDir, { withFileTypes: true })) {
    const dir = path.join(fontsDir, entry.name);
    if (entry.isDirectory() && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }

  return converted;
}

async function processStylesheets(converted: Record<string, string>) {
  for (const file of walk(path.join(DIST_DIR, 'css'))) {
    if (!file.endsWith('.css')) continue;
    let css = fs.readFileSync(file, 'utf8');
    css = rewriteCssImages(css, resolveImage);
    css = rewriteFontFaces(css, converted);
    if (path.basename(file) === 'site.css') css = addPictureCompat(css);
    // Base-path the remaining absolute url() references (fonts, sprites).
    if (BASE !== '/') css = css.replace(/url\((['"]?)\/(?!\/)/g, `url($1${BASE_PREFIX}/`);
    fs.writeFileSync(file, css, 'utf8');
  }
}

// ─── Page content ────────────────────────────────────────────────────────────

const contentCache = new Map<string, string>();

/** Marks a content file as already rewritten, so a re-run is a no-op. */
const REWRITE_SENTINEL = '<!--tara:rewritten-->';

/** Origins baked into the mirrored markup that must become relative links. */
const LEGACY_ORIGINS = [
  'https://taradealership.com',
  'https://www.taradealership.com',
  'https://taragolfcart.com',
  'https://www.taragolfcart.com',
];

/** Load a content file, rewrite it once, and cache the result. */
function loadContent(file: string): string {
  const cached = contentCache.get(file);
  if (cached !== undefined) return cached;

  const source = path.join(DIST_CONTENT, file);
  if (!fs.existsSync(source)) fail(`content file missing: ${file}`);

  let html = fs.readFileSync(source, 'utf8');
  if (html.startsWith(REWRITE_SENTINEL)) {
    // Already processed by an earlier prerender against this same dist/.
    contentCache.set(file, html);
    return html;
  }
  html = relativizeOrigin(html, LEGACY_ORIGINS);
  html = rewriteLegacyAssetPaths(html);
  html = applyContactDetails(html);
  html = rewriteSearchForms(html);
  html = rewriteImages(html, resolveImage);
  html = rewriteLooseImageRefs(html, resolveImage);
  html = applyBasePath(html, BASE);

  // Write the rewritten copy back so the SPA fetches the same markup at
  // runtime that the prerendered page already contains.
  html = REWRITE_SENTINEL + html;
  fs.writeFileSync(source, html, 'utf8');
  contentCache.set(file, html);
  return html;
}

// ─── Head metadata ───────────────────────────────────────────────────────────

/**
 * Every page carries the brand. Titles that already name TARA are left alone
 * so each route keeps a unique, non-truncated title.
 */
function brandedTitle(title: string, routePath: string): string {
  if (routePath === '/') return SITE_TITLE;
  return /TARA/i.test(title) ? title : `${title} | ${SITE_NAME}`;
}

function absoluteUrl(target: string): string {
  if (/^https?:\/\//i.test(target)) return target;
  return `${ORIGIN}${withBase(target)}`;
}

type HeadOptions = {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
  ogType: 'website' | 'article';
  noindex?: boolean;
};

function injectHead(shell: string, options: HeadOptions): string {
  const { title, description, canonical, ogImage, ogType } = options;
  const image = absoluteUrl(ogImage);
  const dimensions = manifestDimensions(ogImage);

  let html = shell.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(title)}</title>`);

  const meta: [RegExp, string][] = [
    [/<meta\s+name="title"[^>]*\/?>/i, `<meta name="title" content="${escHtml(title)}" />`],
    [/<meta\s+name="description"[^>]*\/?>/i, `<meta name="description" content="${escHtml(description)}" />`],
    [/<meta\s+name="image"[^>]*\/?>/i, `<meta name="image" content="${image}" />`],
    [/<meta\s+itemprop="name"[^>]*\/?>/i, `<meta itemprop="name" content="${escHtml(title)}" />`],
    [/<meta\s+itemprop="description"[^>]*\/?>/i, `<meta itemprop="description" content="${escHtml(description)}" />`],
    [/<meta\s+itemprop="image"[^>]*\/?>/i, `<meta itemprop="image" content="${image}" />`],
    [/<meta\s+property="og:site_name"[^>]*\/?>/i, `<meta property="og:site_name" content="${SITE_NAME}" />`],
    [/<meta\s+property="og:type"[^>]*\/?>/i, `<meta property="og:type" content="${ogType}" />`],
    [/<meta\s+property="og:title"[^>]*\/?>/i, `<meta property="og:title" content="${escHtml(title)}" />`],
    [/<meta\s+property="og:description"[^>]*\/?>/i, `<meta property="og:description" content="${escHtml(description)}" />`],
    [/<meta\s+property="og:image"[^>]*\/?>/i, `<meta property="og:image" content="${image}" />`],
    [/<meta\s+property="og:image:alt"[^>]*\/?>/i, `<meta property="og:image:alt" content="${escHtml(title)}" />`],
    [/<meta\s+property="og:url"[^>]*\/?>/i, `<meta property="og:url" content="${canonical}" />`],
    [/<meta\s+name="twitter:card"[^>]*\/?>/i, '<meta name="twitter:card" content="summary_large_image" />'],
    [/<meta\s+name="twitter:title"[^>]*\/?>/i, `<meta name="twitter:title" content="${escHtml(title)}" />`],
    [/<meta\s+name="twitter:description"[^>]*\/?>/i, `<meta name="twitter:description" content="${escHtml(description)}" />`],
    [/<meta\s+name="twitter:image"[^>]*\/?>/i, `<meta name="twitter:image" content="${image}" />`],
    [/<meta\s+name="twitter:image:alt"[^>]*\/?>/i, `<meta name="twitter:image:alt" content="${escHtml(title)}" />`],
    [/<link\s+rel="canonical"[^>]*\/?>/i, `<link rel="canonical" href="${canonical}" />`],
    [
      /<meta\s+name="robots"[^>]*\/?>/i,
      `<meta name="robots" content="${options.noindex ? 'noindex, follow' : 'index, follow'}" />`,
    ],
  ];
  if (dimensions) {
    meta.push([
      /<meta\s+property="og:image:width"[^>]*\/?>/i,
      `<meta property="og:image:width" content="${dimensions.width}" />`,
    ]);
    meta.push([
      /<meta\s+property="og:image:height"[^>]*\/?>/i,
      `<meta property="og:image:height" content="${dimensions.height}" />`,
    ]);
  }

  for (const [matcher, tag] of meta) html = upsertMeta(html, matcher, tag);
  return html;
}

/**
 * Bake the JSON-LD graph into <head> so crawlers see it without running any
 * JavaScript. The client replaces this same tag on boot.
 */
function injectSchema(html: string, routePath: string, title: string): string {
  const json = JSON.stringify(buildSchema(routePath, title)).replace(/</g, '\\u003c');
  return html.replace(
    '</head>',
    `  <script id="tara-ld-json" type="application/ld+json">${json}</script>\n</head>`,
  );
}

function manifestDimensions(ogImage: string): { width: number; height: number } | null {
  // Every social derivative is minted at exactly 1200x630.
  if (ogImage.startsWith('/images/social/')) return { width: 1200, height: 630 };
  const entry = resolveImage(ogImage);
  return entry ? { width: entry.width, height: entry.height } : null;
}

// ─── Page assembly ───────────────────────────────────────────────────────────

function buildPage(routePath: string, meta: RouteMeta): string {
  const contentHtml = loadContent(meta.file);
  const title = brandedTitle(meta.title, routePath);
  const description = routePath === '/' ? SITE_DESCRIPTION : meta.description;
  const canonical = `${ORIGIN}${withBase(routePath)}`;
  const ogType: 'website' | 'article' = /^\/(blog|news)\/.+/.test(routePath) ? 'article' : 'website';

  let html = injectHead(shellHtml, {
    title,
    description,
    canonical,
    ogImage: socialImage(meta.ogImage || DEFAULT_OG_IMAGE),
    ogType,
  });
  html = injectSchema(html, routePath, title);

  const body = `${contentHtml}\n${pageChromeHtml(BASE, YEAR)}`;
  html = html.replace(
    /<div id="root"><\/div>/,
    `<div id="root" data-prerendered="1" data-route="${escHtml(routePath)}">${body}</div>\n    ${callNowHtml()}`,
  );
  if (meta.bodyClass) {
    html = html.replace('<body>', `<body class="${escHtml(meta.bodyClass)}">`);
  }
  return html;
}

// ─── SEO assertions ──────────────────────────────────────────────────────────

function assertPage(html: string, routePath: string, expectedTitle: string, expectedDescription: string) {
  const bad = (msg: string) => fail(`SEO check failed for "${routePath}": ${msg}`);

  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  if (!titleMatch) bad('no <title>');
  if (unescHtml(titleMatch![1]) !== expectedTitle) {
    bad(`title mismatch: "${unescHtml(titleMatch![1])}" vs "${expectedTitle}"`);
  }

  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  if (!descMatch) bad('no meta description');
  const description = unescHtml(descMatch![1]);
  if (!description) bad('empty meta description');
  if (description.length > 160) bad(`description is ${description.length} chars (max 160)`);
  if (description !== expectedDescription) bad('description does not match the snapshot');

  const canonicals = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]*)"/gi)];
  if (canonicals.length !== 1) bad(`expected 1 canonical link, found ${canonicals.length}`);
  if (canonicals[0][1] !== `${ORIGIN}${withBase(routePath)}`) {
    bad(`canonical mismatch: ${canonicals[0][1]}`);
  }

  for (const [property, expected] of [
    ['og:title', expectedTitle],
    ['og:description', expectedDescription],
  ] as const) {
    const m = html.match(new RegExp(`<meta\\s+property="${property}"\\s+content="([^"]*)"`, 'i'));
    if (!m) bad(`missing ${property}`);
    if (unescHtml(m![1]) !== expected) bad(`${property} mismatch`);
  }
  for (const [name, expected] of [
    ['twitter:title', expectedTitle],
    ['twitter:description', expectedDescription],
  ] as const) {
    const m = html.match(new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, 'i'));
    if (!m) bad(`missing ${name}`);
    if (unescHtml(m![1]) !== expected) bad(`${name} mismatch`);
  }

  const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i);
  if (!ogImage) bad('missing og:image');
  const ogPath = ogImage![1].replace(ORIGIN, '');
  const ogFile = path.join(DIST_DIR, ogPath.replace(BASE_PREFIX, '').replace(/^\//, ''));
  if (!fs.existsSync(ogFile)) bad(`og:image file not in dist: ${ogPath}`);

  const script = html.match(/src="([^"]*\/assets\/[^"]+\.js)"/);
  if (!script) bad('no built JS bundle referenced');
  const scriptFile = path.join(DIST_DIR, script![1].replace(BASE_PREFIX, '').replace(/^\//, ''));
  if (!fs.existsSync(scriptFile)) bad(`JS bundle missing from dist: ${script![1]}`);
}

// ─── Extra pages ─────────────────────────────────────────────────────────────

function searchPageContent(): string {
  return `<main id="tara-search-page" class="tara-search">
  <h1>Search TARA Dealership</h1>
  <form id="tara-search-form" class="tara-search-form" action="${withBase('/search/')}" method="get" role="search">
    <label class="sr-only" for="tara-search-input">Search</label>
    <input id="tara-search-input" name="s" type="search" placeholder="Search golf carts, parts, support…" />
    <button type="submit">Search</button>
  </form>
  <div id="tara-search-results" class="tara-search-results">
    <p>Enter a search term to look through every TARA Dealership page.</p>
  </div>
</main>`;
}

function redirectPage(from: string, to: string): string {
  const target = `${ORIGIN}${withBase(to)}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Redirecting to ${escHtml(to)} | ${SITE_NAME}</title>
    <meta name="robots" content="noindex, follow" />
    <link rel="canonical" href="${target}" />
    <meta http-equiv="refresh" content="0; url=${withBase(to)}" />
  </head>
  <body>
    <p>This page moved to <a href="${withBase(to)}">${escHtml(to)}</a>.</p>
    <script>location.replace(${JSON.stringify(withBase(to))} + location.search + location.hash);</script>
  </body>
</html>`;
}

// ─── Output ──────────────────────────────────────────────────────────────────

async function writePage(routePath: string, html: string) {
  const slug = routePath === '/' ? '' : routePath.replace(/^\/|\/$/g, '');
  const file = slug ? path.join(DIST_DIR, slug, 'index.html') : path.join(DIST_DIR, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await minifyHtml(html), 'utf8');
}

async function main() {
  const converted = await processFonts();
  await processStylesheets(converted);

  const seenTitles = new Map<string, string>();
  const seenDescriptions = new Map<string, string>();
  let pages = 0;
  let redirects = 0;

  for (const [routePath, entry] of Object.entries(routes)) {
    if (isRedirect(entry)) {
      const slug = entry.redirect === '/' ? '' : routePath.replace(/^\/|\/$/g, '');
      const file = path.join(DIST_DIR, slug, 'index.html');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, await minifyHtml(redirectPage(routePath, entry.redirect)), 'utf8');
      redirects += 1;
      continue;
    }

    const meta = entry as RouteMeta;
    if (!meta.title?.trim()) fail(`${routePath} has no title`);
    if (!meta.description?.trim()) fail(`${routePath} has no description`);
    if (!meta.ogImage?.trim()) fail(`${routePath} has no ogImage`);

    const title = brandedTitle(meta.title, routePath);
    const description = routePath === '/' ? SITE_DESCRIPTION : meta.description;

    const priorTitle = seenTitles.get(title);
    if (priorTitle) fail(`duplicate title on ${priorTitle} and ${routePath}: "${title}"`);
    seenTitles.set(title, routePath);
    const priorDescription = seenDescriptions.get(description);
    if (priorDescription) fail(`duplicate description on ${priorDescription} and ${routePath}`);
    seenDescriptions.set(description, routePath);

    const html = buildPage(routePath, meta);
    assertPage(html, routePath, title, description);
    await writePage(routePath, html);
    pages += 1;
  }

  // Client-side search page (replaces the removed server-side /search.php).
  const searchHtml = injectHead(shellHtml, {
    title: `Search | ${SITE_NAME}`,
    description: `Search every ${SITE_NAME} page — golf cart models, accessories, financing, support and news.`,
    canonical: `${ORIGIN}${withBase('/search/')}`,
    ogImage: socialImage(DEFAULT_OG_IMAGE),
    ogType: 'website',
    noindex: true,
  }).replace(
    /<div id="root"><\/div>/,
    `<div id="root" data-prerendered="1" data-route="/search/">${searchPageContent()}\n${pageChromeHtml(BASE, YEAR)}</div>\n    ${callNowHtml()}`,
  );
  await writePage('/search/', searchHtml);

  // 404: the SPA shell, so an unknown deep link still boots the app and can
  // route itself. Marked noindex so search engines never keep it.
  const notFound = injectHead(shellHtml, {
    title: `Page not found | ${SITE_NAME}`,
    description: SITE_DESCRIPTION,
    canonical: `${ORIGIN}${BASE}`,
    ogImage: socialImage(DEFAULT_OG_IMAGE),
    ogType: 'website',
    noindex: true,
  });
  fs.writeFileSync(path.join(DIST_DIR, '404.html'), await minifyHtml(notFound), 'utf8');

  // Serve files and folders that start with "_".
  fs.writeFileSync(path.join(DIST_DIR, '.nojekyll'), '', 'utf8');

  // GitHub Pages wipes the custom-domain setting on every deploy unless the
  // artifact carries a CNAME, so copy it in on every build.
  const cnameSource = path.join(ROOT, 'CNAME');
  if (fs.existsSync(cnameSource)) {
    const domain = fs.readFileSync(cnameSource, 'utf8').trim();
    if (domain) {
      fs.writeFileSync(path.join(DIST_DIR, 'CNAME'), `${domain}\n`, 'utf8');
      console.log(`[prerender] CNAME → ${domain}`);
    }
  }

  // The route table ships as data/routes.json; drop the duplicate that the
  // content mirror would otherwise leave behind.
  const strayRoutes = path.join(DIST_CONTENT, 'routes.json');
  if (fs.existsSync(strayRoutes)) fs.rmSync(strayRoutes);

  // Content files no route points at are unreachable — and unrewritten, so
  // they would still carry the old /search.php markup. Drop them.
  let orphans = 0;
  for (const file of walk(DIST_CONTENT)) {
    if (!file.endsWith('.html')) continue;
    if (contentCache.has(path.basename(file))) continue;
    fs.rmSync(file);
    orphans += 1;
  }
  if (orphans > 0) console.log(`[prerender] removed ${orphans} unreferenced content file(s)`);

  console.log(
    `[prerender] ${pages} pages + ${redirects} redirect stubs + search + 404 → dist/ (base "${BASE}", origin ${ORIGIN})`,
  );
}

main().catch((err) => {
  console.error('[prerender] fatal:', err);
  process.exit(1);
});
