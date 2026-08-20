#!/usr/bin/env node
/**
 * prerender.mjs — Static HTML pre-renderer for TARA EV SPA
 *
 * For each route in public/content/routes.json this script generates a
 * complete HTML file (proper <head> meta tags + the page content HTML
 * embedded in the body) and writes it into the Vite output directory:
 *
 *   <outDir>/<route-slug>/index.html
 *
 * IMPORTANT: the shell HTML must be the *already-built* index.html
 * (i.e. dist/public/index.html after `vite build`) so that the generated
 * files reference the hashed JS/CSS asset bundles, not the source
 * /src/main.tsx entry point.  Pass --shellHtml <path> to provide it.
 *
 * Usage:
 *   node scripts/prerender.mjs \
 *     --shellHtml <path-to-built-index.html> \
 *     --outDir    <output-directory> \
 *     --origin    <https://site-domain.com>
 *
 * On any error (missing files, assertion failures) the script exits with a
 * non-zero code so `vite build` fails loudly rather than silently shipping
 * broken prerendered pages.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readImageDimensions } from './image-dimensions.mjs';
import { getLocalOgImageDimensions, resolveOgImage } from './og-image.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(__dirname, '..');
const publicDir = path.join(artifactDir, 'public');

// ─── CLI args ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function getArg(name) {
  const idx = argv.indexOf(name);
  return idx !== -1 ? argv[idx + 1] : null;
}

const shellHtmlPath =
  getArg('--shellHtml') ?? path.join(artifactDir, 'dist', 'public', 'index.html');
const outDir =
  getArg('--outDir') ?? path.join(artifactDir, 'dist', 'public');
const origin =
  getArg('--origin') ?? 'https://taradealership.com';

// ─── Validation ───────────────────────────────────────────────────────────────

if (!fs.existsSync(shellHtmlPath)) {
  console.error(
    `[prerender] ERROR: shell HTML not found at "${shellHtmlPath}".\n` +
      '  Run `vite build` before running this script, or pass --shellHtml <path>.',
  );
  process.exit(1);
}

const shellHtml = fs.readFileSync(shellHtmlPath, 'utf8');

// Assert that the shell references a compiled JS bundle (not the TS source).
// This catches the case where the script is accidentally pointed at the
// development index.html which still has <script src="/src/main.tsx">.
if (/src=["']\/src\/main\.tsx["']/.test(shellHtml)) {
  console.error(
    '[prerender] ERROR: The shell HTML still references /src/main.tsx.\n' +
      '  Pre-rendering requires the *built* dist/public/index.html, not the\n' +
      '  source index.html.  Run `vite build` first and pass --shellHtml to\n' +
      '  the correct path.',
  );
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Extract a ~160-character plain-text description from the content HTML.
 * Prefers the first non-trivial <p> whose text is clearly page content
 * (not a nav breadcrumb or a widget label).
 */
function extractDescription(html) {
  const cleaned = html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const pMatches = [...cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  for (const m of pMatches) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length < 50 || text.includes(' / ')) continue;
    return text.length > 158 ? text.slice(0, 157) + '…' : text;
  }

  const fallback = cleaned.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return fallback.length > 158 ? fallback.slice(0, 157) + '…' : fallback;
}

function upsertMeta(html, matcher, tag) {
  return matcher.test(html)
    ? html.replace(matcher, tag)
    : html.replace('</head>', `  ${tag}\n</head>`);
}

// ─── Per-route HTML builder ───────────────────────────────────────────────────

function buildPageHtml(routePath, routeMeta, contentHtml) {
  const title = routeMeta.title || 'TARA Golf Cart Dealership';
  // Prefer curated SEO description from routes.json; extraction is a fallback only.
  const description = routeMeta.description || extractDescription(contentHtml);
  // Curated images take priority. Automatic selection skips undersized page
  // images and falls back to a compliant site-wide image for large previews.
  const ogImage = resolveOgImage(routeMeta.ogImage, contentHtml, publicDir);
  const canonicalUrl = `${origin}${routePath}`;
  const absoluteOgImage = ogImage.startsWith('http')
    ? ogImage
    : `${origin}${ogImage}`;
  const ogImageDimensions = getLocalOgImageDimensions(ogImage, publicDir);
  const ogType = /^\/(blog|news)\/.+/.test(routePath) ? 'article' : 'website';

  let html = shellHtml;

  // Replace <title>
  html = html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escHtml(title)}</title>`,
  );

  html = upsertMeta(
    html,
    /<meta\s+name="title"[^>]*\/?>/i,
    `<meta name="title" content="${escHtml(title)}" />`,
  );
  html = upsertMeta(
    html,
    /<meta\s+name="description"[^>]*\/?>/i,
    `<meta name="description" content="${escHtml(description)}" />`,
  );
  html = upsertMeta(
    html,
    /<meta\s+name="image"[^>]*\/?>/i,
    `<meta name="image" content="${absoluteOgImage}" />`,
  );
  html = upsertMeta(
    html,
    /<meta\s+itemprop="name"[^>]*\/?>/i,
    `<meta itemprop="name" content="${escHtml(title)}" />`,
  );
  html = upsertMeta(
    html,
    /<meta\s+itemprop="description"[^>]*\/?>/i,
    `<meta itemprop="description" content="${escHtml(description)}" />`,
  );
  html = upsertMeta(
    html,
    /<meta\s+itemprop="image"[^>]*\/?>/i,
    `<meta itemprop="image" content="${absoluteOgImage}" />`,
  );
  html = upsertMeta(
    html,
    /<meta\s+property="og:type"[^>]*\/?>/i,
    `<meta property="og:type" content="${ogType}" />`,
  );
  html = upsertMeta(
    html,
    /<meta\s+property="og:title"[^>]*\/?>/i,
    `<meta property="og:title" content="${escHtml(title)}" />`,
  );
  html = upsertMeta(
    html,
    /<meta\s+property="og:description"[^>]*\/?>/i,
    `<meta property="og:description" content="${escHtml(description)}" />`,
  );
  html = upsertMeta(
    html,
    /<meta\s+property="og:image"[^>]*\/?>/i,
    `<meta property="og:image" content="${absoluteOgImage}" />`,
  );
  html = upsertMeta(
    html,
    /<meta\s+property="og:image:alt"[^>]*\/?>/i,
    `<meta property="og:image:alt" content="${escHtml(title)}" />`,
  );

  if (ogImageDimensions) {
    html = upsertMeta(
      html,
      /<meta\s+property="og:image:width"[^>]*\/?>/i,
      `<meta property="og:image:width" content="${ogImageDimensions.width}" />`,
    );
    html = upsertMeta(
      html,
      /<meta\s+property="og:image:height"[^>]*\/?>/i,
      `<meta property="og:image:height" content="${ogImageDimensions.height}" />`,
    );
  }

  html = upsertMeta(
    html,
    /<meta\s+name="twitter:card"[^>]*\/?>/i,
    '<meta name="twitter:card" content="summary_large_image" />',
  );
  html = upsertMeta(
    html,
    /<meta\s+name="twitter:title"[^>]*\/?>/i,
    `<meta name="twitter:title" content="${escHtml(title)}" />`,
  );
  html = upsertMeta(
    html,
    /<meta\s+name="twitter:description"[^>]*\/?>/i,
    `<meta name="twitter:description" content="${escHtml(description)}" />`,
  );
  html = upsertMeta(
    html,
    /<meta\s+name="twitter:image"[^>]*\/?>/i,
    `<meta name="twitter:image" content="${absoluteOgImage}" />`,
  );
  html = upsertMeta(
    html,
    /<meta\s+name="twitter:image:alt"[^>]*\/?>/i,
    `<meta name="twitter:image:alt" content="${escHtml(title)}" />`,
  );
  html = upsertMeta(
    html,
    /<link\s+rel="canonical"[^>]*\/?>/i,
    `<link rel="canonical" href="${canonicalUrl}" />`,
  );
  html = upsertMeta(
    html,
    /<meta\s+property="og:url"[^>]*\/?>/i,
    `<meta property="og:url" content="${canonicalUrl}" />`,
  );

  // Embed page content inside #root so crawlers that don't execute JS
  // still see the full page content, headings, product specs, and links.
  // Browsers load the React bundle (referenced in the built shell) and the
  // SPA re-renders, replacing this static content seamlessly.
  html = html.replace(
    '<div id="root"></div>',
    `<div id="root" data-prerendered="1">${contentHtml}</div>`,
  );

  return html;
}

// ─── Post-generation assertion ────────────────────────────────────────────────

/**
 * Verify that the generated HTML references at least one built JS asset
 * that actually exists in outDir/assets/.  Exits non-zero on failure.
 */
function assertJsAssetPresent(generatedHtml, routePath) {
  // The built shell should have something like: /assets/index-Abc123.js
  const match = generatedHtml.match(/src=["'](\/assets\/[^"']+\.js)["']/);
  if (!match) {
    console.error(
      `[prerender] ASSERTION FAILED for "${routePath}": generated HTML has no` +
        ' <script src="/assets/...js"> tag.  The shell may be stale or corrupt.',
    );
    process.exit(1);
  }
  // Confirm the referenced asset file actually exists on disk.
  const assetRel = match[1].replace(/^\//, ''); // strip leading /
  const assetPath = path.join(outDir, assetRel);
  if (!fs.existsSync(assetPath)) {
    console.error(
      `[prerender] ASSERTION FAILED for "${routePath}": referenced asset` +
        ` "${match[1]}" does not exist at "${assetPath}".`,
    );
    process.exit(1);
  }
}

/**
 * Verify the generated HTML carries the exact curated <title> and meta
 * description from routes.json, that the description is nonempty, at most
 * 160 characters, and not ellipsis-truncated.  Exits non-zero on failure.
 */
function assertSeoMeta(generatedHtml, routePath, routeMeta) {
  const fail = (msg) => {
    console.error(`[prerender] SEO ASSERTION FAILED for "${routePath}": ${msg}`);
    process.exit(1);
  };
  const unesc = (s) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  const readMeta = (attribute, value) => {
    const match = generatedHtml.match(
      new RegExp(`<meta\\s+${attribute}="${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+content="([^"]*)"`, 'i'),
    );
    return match ? unesc(match[1]) : null;
  };
  const assertMetaEquals = (attribute, value, expected) => {
    const actual = readMeta(attribute, value);
    if (actual === null) fail(`no ${attribute}="${value}" meta in generated HTML`);
    if (actual !== expected) {
      fail(`${value} mismatch: emitted "${actual}" vs expected "${expected}"`);
    }
  };

  const titleMatch = generatedHtml.match(/<title>([^<]*)<\/title>/);
  if (!titleMatch) fail('no <title> tag in generated HTML');
  const emittedTitle = unesc(titleMatch[1]);
  const expectedTitle = routeMeta.title || 'TARA Golf Cart Dealership';
  if (emittedTitle !== expectedTitle) {
    fail(`title mismatch: emitted "${emittedTitle}" vs routes.json "${expectedTitle}"`);
  }

  const descMatch = generatedHtml.match(
    /<meta\s+name="description"\s+content="([^"]*)"/i,
  );
  if (!descMatch) fail('no meta description in generated HTML');
  const emittedDesc = unesc(descMatch[1]);
  if (!emittedDesc) fail('empty meta description');
  if (emittedDesc.length > 160) {
    fail(`description is ${emittedDesc.length} chars (max 160)`);
  }
  if (/(\.\.\.|…)\s*$/.test(emittedDesc)) fail('description ends with ellipsis (truncated)');
  if (routeMeta.description && emittedDesc !== routeMeta.description) {
    fail('description does not match curated routes.json description');
  }
  const canonicalMatches = [
    ...generatedHtml.matchAll(
      /<link\s+rel="canonical"\s+href="([^"]*)"[^>]*\/?>/gi,
    ),
  ];
  if (canonicalMatches.length !== 1) {
    fail(`expected exactly one canonical link, found ${canonicalMatches.length}`);
  }
  const expectedCanonical = `${origin}${routePath}`;
  if (canonicalMatches[0][1] !== expectedCanonical) {
    fail(
      `canonical mismatch: emitted "${canonicalMatches[0][1]}" vs expected "${expectedCanonical}"`,
    );
  }

  // Copy/branding rules: every curated description must carry the
  // "TARA Dealership" (or "TARA Golf Cart Dealership") brand, explicit
  // US framing, and no overseas/global framing or legacy brand names.
  if (routePath === '/') {
    if (emittedTitle !== 'TARA Dealership') {
      fail('homepage title must be exactly "TARA Dealership"');
    }
    if (
      emittedDesc !==
      'lithium-powered electric golf carts. Find a local TARA Dealership near you today.'
    ) {
      fail('homepage description does not match the client-approved copy');
    }
    if (routeMeta.ogImage !== '/images/og-image.png') {
      fail('homepage ogImage must use the TARA Dealership social icon');
    }
  } else {
    if (!/TARA (Golf Cart )?Dealership/.test(emittedDesc)) {
      fail('description lacks "TARA Dealership" branding');
    }
    if (!/\bUS\b|U\.S\.|American|United States|nationwide/.test(emittedDesc)) {
      fail('description lacks explicit US framing (US / American / nationwide)');
    }
  }
  if (/overseas|global|worldwide|export|international|taragolfcart/i.test(emittedDesc)) {
    fail('description contains banned overseas/global framing or legacy brand');
  }

  // og:image: if routes.json curates one, the emitted tag must carry it and
  // the referenced file must exist under public/ so shares never 404.
  const ogMatch = generatedHtml.match(
    /<meta\s+property="og:image"\s+content="([^"]*)"/i,
  );
  if (!ogMatch) fail('no og:image meta in generated HTML');
  const emittedOg = unesc(ogMatch[1]);
  const expectedOgType = /^\/(blog|news)\/.+/.test(routePath)
    ? 'article'
    : 'website';
  assertMetaEquals('name', 'title', expectedTitle);
  assertMetaEquals('name', 'image', emittedOg);
  assertMetaEquals('itemprop', 'name', expectedTitle);
  assertMetaEquals('itemprop', 'description', emittedDesc);
  assertMetaEquals('itemprop', 'image', emittedOg);
  assertMetaEquals('property', 'og:type', expectedOgType);
  assertMetaEquals('property', 'og:title', expectedTitle);
  assertMetaEquals('property', 'og:description', emittedDesc);
  assertMetaEquals('property', 'og:image:alt', expectedTitle);
  assertMetaEquals('name', 'twitter:title', expectedTitle);
  assertMetaEquals('name', 'twitter:description', emittedDesc);
  assertMetaEquals('name', 'twitter:image:alt', expectedTitle);
  // Every route must have a curated ogImage. Blog/news metadata is derived
  // from each article body ahead of the build so shared navigation images
  // can never become an article's social preview.
  const isArticle = /^\/(blog|news)\/.+/.test(routePath);
  if (!routeMeta.ogImage) {
    fail(
      isArticle
        ? 'blog/news route is missing a derived ogImage in routes.json'
        : 'non-article route is missing a curated ogImage in routes.json',
    );
  }
  const twMatch = generatedHtml.match(
    /<meta\s+name="twitter:image"\s+content="([^"]*)"/i,
  );
  if (!twMatch) fail('no twitter:image meta in generated HTML');
  if (unesc(twMatch[1]) !== emittedOg) {
    fail(
      `twitter:image ("${unesc(twMatch[1])}") does not match og:image ("${emittedOg}")`,
    );
  }
  const twitterCardMatch = generatedHtml.match(
    /<meta\s+name="twitter:card"\s+content="([^"]*)"/i,
  );
  if (!twitterCardMatch || twitterCardMatch[1] !== 'summary_large_image') {
    fail('twitter:card is not "summary_large_image"');
  }
  if (routeMeta.ogImage) {
    if (!emittedOg.endsWith(routeMeta.ogImage)) {
      fail(
        `og:image mismatch: emitted "${emittedOg}" vs curated "${routeMeta.ogImage}"`,
      );
    }
    const ogFile = path.join(artifactDir, 'public', routeMeta.ogImage.replace(/^\//, ''));
    if (!fs.existsSync(ogFile)) {
      fail(`curated ogImage file does not exist: ${routeMeta.ogImage}`);
    }
    const expectedDimensions = readImageDimensions(ogFile);
    const emittedWidth = generatedHtml.match(
      /<meta\s+property="og:image:width"\s+content="(\d+)"/i,
    );
    const emittedHeight = generatedHtml.match(
      /<meta\s+property="og:image:height"\s+content="(\d+)"/i,
    );
    if (!emittedWidth || Number(emittedWidth[1]) !== expectedDimensions.width) {
      fail(`og:image:width does not match image width ${expectedDimensions.width}`);
    }
    if (!emittedHeight || Number(emittedHeight[1]) !== expectedDimensions.height) {
      fail(`og:image:height does not match image height ${expectedDimensions.height}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const routesPath = path.join(
    artifactDir,
    'public',
    'content',
    'routes.json',
  );
  if (!fs.existsSync(routesPath)) {
    console.error(`[prerender] ERROR: routes.json not found at "${routesPath}"`);
    process.exit(1);
  }

  const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
  const seenTitles = new Map();
  const seenDescriptions = new Map();
  for (const [routePath, routeMeta] of Object.entries(routes)) {
    if (routeMeta.redirect || !routeMeta.file) continue;
    if (!routeMeta.title?.trim()) {
      throw new Error(`[prerender] ${routePath} is missing a curated title`);
    }
    if (!routeMeta.description?.trim()) {
      throw new Error(`[prerender] ${routePath} is missing a curated description`);
    }
    if (!routeMeta.ogImage?.trim()) {
      throw new Error(`[prerender] ${routePath} is missing a curated ogImage`);
    }
    const priorTitle = seenTitles.get(routeMeta.title);
    if (priorTitle) {
      throw new Error(
        `[prerender] duplicate title on ${priorTitle} and ${routePath}: "${routeMeta.title}"`,
      );
    }
    const priorDescription = seenDescriptions.get(routeMeta.description);
    if (priorDescription) {
      throw new Error(
        `[prerender] duplicate description on ${priorDescription} and ${routePath}`,
      );
    }
    seenTitles.set(routeMeta.title, routePath);
    seenDescriptions.set(routeMeta.description, routePath);
  }

  // Determine if the built assets directory exists so we can run the
  // JS-asset assertion (it won't exist in unit-test / dry-run contexts).
  const assetsDir = path.join(outDir, 'assets');
  const canAssert = fs.existsSync(assetsDir);

  let generated = 0;

  for (const [routePath, routeMeta] of Object.entries(routes)) {
    // Redirect-only routes have no content file to prerender; they are
    // handled as HTTP 301s by the server config.
    if (routeMeta.redirect || !routeMeta.file) continue;
    const contentFile = path.join(
      artifactDir,
      'public',
      'content',
      routeMeta.file,
    );
    if (!fs.existsSync(contentFile)) {
      // Hard failure — a missing content file means the prerender output
      // would be incomplete.  Fail the build so the gap is caught early.
      console.error(
        `[prerender] ERROR: content file missing for route "${routePath}": ${routeMeta.file}`,
      );
      process.exit(1);
    }

    const contentHtml = fs.readFileSync(contentFile, 'utf8');
    const pageHtml = buildPageHtml(routePath, routeMeta, contentHtml);

    // Validate the generated page references an existing JS bundle.
    if (canAssert) {
      assertJsAssetPresent(pageHtml, routePath);
    }

    // Validate emitted SEO metadata matches routes.json and is well-formed.
    assertSeoMeta(pageHtml, routePath, routeMeta);

    // Write output: "/" → outDir/index.html, "/about-us/" → outDir/about-us/index.html
    const slug = routePath === '/' ? '' : routePath.replace(/^\/|\/$/g, '');
    const outFile = slug
      ? path.join(outDir, slug, 'index.html')
      : path.join(outDir, 'index.html');

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, pageHtml, 'utf8');
    generated++;
  }

  console.log(`[prerender] Generated ${generated} page(s) → ${outDir}`);
}

main().catch((err) => {
  console.error('[prerender] Fatal error:', err);
  process.exit(1);
});
