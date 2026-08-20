/**
 * fetch-data.ts — build-time data snapshot.
 *
 * GitHub Pages serves files only, so nothing may be fetched from an API at
 * runtime. This script resolves every piece of data the app needs ONCE, at
 * build time, and writes plain minified JSON into client/public/data/:
 *
 *   data/routes.json        route table (path → content file + SEO metadata)
 *   data/search-index.json  client-side search corpus (replaces /search.php)
 *   data/models.json        TARA vehicle catalog (specs, colors, galleries)
 *   data/site.json          site name, contact details, CTA targets
 *
 * Data sources, in priority order:
 *   1. CONTENT_API_URL  — optional remote JSON API (e.g. a headless CMS).
 *      Credentials come from process.env in THIS SCRIPT ONLY and are never
 *      written into the snapshot or the client bundle.
 *   2. content-src/routes.json + client/public/content/*.html — the checked-in
 *      content mirror. This is the default and needs no network access.
 *
 * Run standalone with:  npm run fetch-data
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  CONTACT_EMAIL,
  CONTACT_PHONE_DISPLAY,
  CONTACT_PHONE_E164,
  CONTACT_PHONE_HREF,
  DEFAULT_OG_IMAGE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  isRedirect,
  siteOrigin,
  type ModelSnapshot,
  type RouteEntry,
  type RoutesSnapshot,
  type SearchDoc,
} from '../shared/site.ts';
import {
  CONTENT_DIR,
  DATA_DIR,
  MODEL_CATALOG_DIR,
  ROUTES_SOURCE,
} from './lib/paths.ts';

const ORIGIN = siteOrigin(process.env);

/** Fields the client actually reads. Everything else is stripped. */
const CLIENT_ROUTE_FIELDS = [
  'file',
  'title',
  'description',
  'ogImage',
  'bodyClass',
  'redirect',
] as const;

// ─── Route table ─────────────────────────────────────────────────────────────

async function loadRoutes(): Promise<RoutesSnapshot> {
  const apiUrl = process.env.CONTENT_API_URL?.trim();
  if (apiUrl) {
    // Secrets are read here and here only — never emitted into the snapshot.
    const apiKey = process.env.CONTENT_API_KEY?.trim();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    console.log(`[fetch-data] pulling route table from ${apiUrl}`);
    const res = await fetch(apiUrl, { headers });
    if (!res.ok) {
      throw new Error(`[fetch-data] ${apiUrl} responded ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as RoutesSnapshot;
  }

  if (!fs.existsSync(ROUTES_SOURCE)) {
    throw new Error(`[fetch-data] route source not found: ${ROUTES_SOURCE}`);
  }
  console.log('[fetch-data] using local content mirror (no network fetch)');
  return JSON.parse(fs.readFileSync(ROUTES_SOURCE, 'utf8')) as RoutesSnapshot;
}

/** Drop build-only fields so the shipped JSON carries nothing unused. */
function slimRoutes(routes: RoutesSnapshot): RoutesSnapshot {
  const out: RoutesSnapshot = {};
  for (const [routePath, entry] of Object.entries(routes)) {
    const slim: Record<string, unknown> = {};
    for (const field of CLIENT_ROUTE_FIELDS) {
      const value = (entry as Record<string, unknown>)[field];
      if (value !== undefined && value !== '') slim[field] = value;
    }
    out[routePath] = slim as unknown as RouteEntry;
  }
  return out;
}

// ─── Search index (replaces the server-side /search.php) ─────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style|noscript|nav|header|footer)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchIndex(routes: RoutesSnapshot): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const [routePath, entry] of Object.entries(routes)) {
    if (isRedirect(entry)) continue;
    const file = path.join(CONTENT_DIR, entry.file);
    if (!fs.existsSync(file)) continue;
    const text = stripHtml(fs.readFileSync(file, 'utf8'));
    docs.push({
      u: routePath,
      t: entry.title,
      d: entry.description ?? '',
      // Cap the body at ~900 chars: enough for relevance, small enough that
      // the whole index stays a fast single download.
      b: text.slice(0, 900).toLowerCase(),
    });
  }
  return docs;
}

// ─── Vehicle model catalog ───────────────────────────────────────────────────

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\+/g, '-plus-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildModels(routes: RoutesSnapshot): ModelSnapshot[] {
  if (!fs.existsSync(MODEL_CATALOG_DIR)) return [];
  const routePaths = Object.keys(routes);
  const models: ModelSnapshot[] = [];

  for (const dirent of fs.readdirSync(MODEL_CATALOG_DIR, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const specsFile = path.join(MODEL_CATALOG_DIR, dirent.name, 'specs.json');
    if (!fs.existsSync(specsFile)) continue;

    const raw = JSON.parse(fs.readFileSync(specsFile, 'utf8')) as {
      model?: string;
      category?: string;
      colors?: { name?: string }[];
      spec_sections?: { section?: string; content?: string }[];
      source_page?: string;
    };

    const specs: Record<string, string> = {};
    for (const section of raw.spec_sections ?? []) {
      if (section.section && section.content) {
        specs[section.section] = section.content.replace(/\s+/g, ' ').trim();
      }
    }

    // Link the catalog entry to its live route when the mirror has one.
    const sourceSlug = raw.source_page?.replace(/\.html$/, '');
    const route = sourceSlug
      ? routePaths.find((p) => p === `/${sourceSlug}/`)
      : undefined;

    models.push({
      slug: slugify(raw.model ?? dirent.name),
      name: raw.model ?? dirent.name,
      series: raw.category,
      specs,
      colors: (raw.colors ?? [])
        .map((c) => (c.name ?? '').trim())
        .filter(Boolean),
      ...(route ? { route } : {}),
    });
  }

  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function writeJson(file: string, value: unknown): number {
  // Minified — no pretty-printing anywhere in the shipped snapshot.
  const json = JSON.stringify(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, json, 'utf8');
  return Buffer.byteLength(json);
}

async function main() {
  const routes = await loadRoutes();
  const routeCount = Object.keys(routes).length;

  const sizes: Record<string, number> = {};
  sizes['routes.json'] = writeJson(path.join(DATA_DIR, 'routes.json'), slimRoutes(routes));
  sizes['search-index.json'] = writeJson(
    path.join(DATA_DIR, 'search-index.json'),
    buildSearchIndex(routes),
  );
  sizes['models.json'] = writeJson(path.join(DATA_DIR, 'models.json'), buildModels(routes));
  sizes['site.json'] = writeJson(path.join(DATA_DIR, 'site.json'), {
    name: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    origin: ORIGIN,
    ogImage: DEFAULT_OG_IMAGE,
    email: CONTACT_EMAIL,
    phone: CONTACT_PHONE_DISPLAY,
    phoneHref: CONTACT_PHONE_HREF,
    phoneE164: CONTACT_PHONE_E164,
  });

  console.log(`[fetch-data] ${routeCount} routes snapshotted → client/public/data/`);
  for (const [name, bytes] of Object.entries(sizes)) {
    console.log(`  ${name.padEnd(20)} ${(bytes / 1024).toFixed(1)} KB`);
  }
}

main().catch((err) => {
  console.error('[fetch-data] failed:', err);
  process.exit(1);
});
