/**
 * generate-seo.ts — regenerates the origin-dependent SEO files from the
 * build-time route snapshot, so sitemaps, feeds and robots.txt always match
 * the domain and base path the site is actually deployed to.
 *
 * Writes into client/public/ (Vite copies the whole folder into dist/).
 * Run after script/fetch-data.ts.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  CONTACT_EMAIL,
  CONTACT_PHONE_E164,
  DEFAULT_OG_IMAGE,
  SITE_DESCRIPTION,
  SITE_NAME,
  basePath,
  isRedirect,
  siteOrigin,
  type RoutesSnapshot,
} from '../shared/site.ts';
import { escXml } from './lib/html.ts';
import { DATA_DIR, PUBLIC_DIR } from './lib/paths.ts';

const ORIGIN = siteOrigin(process.env);
const BASE = basePath(process.env);
const BASE_PREFIX = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
const TODAY = new Date().toISOString().slice(0, 10);
const NOW = new Date().toUTCString();

const routesFile = path.join(DATA_DIR, 'routes.json');
if (!fs.existsSync(routesFile)) {
  console.error('[generate-seo] data/routes.json missing — run `npm run fetch-data` first.');
  process.exit(1);
}
const routes = JSON.parse(fs.readFileSync(routesFile, 'utf8')) as RoutesSnapshot;

const url = (routePath: string) => `${ORIGIN}${BASE_PREFIX}${routePath}`;

type Entry = { path: string; url: string; title: string; description: string; image: string };

const entries: Entry[] = Object.entries(routes)
  .filter(([, meta]) => !isRedirect(meta))
  .map(([routePath, meta]) => {
    const route = meta as Exclude<typeof meta, { redirect: string }>;
    return {
      path: routePath,
      url: url(routePath),
      title: route.title || SITE_NAME,
      description: route.description || SITE_DESCRIPTION,
      image: `${ORIGIN}${BASE_PREFIX}${route.ogImage || DEFAULT_OG_IMAGE}`,
    };
  });

const isPost = (p: string) => (p.startsWith('/blog/') || p.startsWith('/news/')) && p.split('/').length > 3;
const isProduct = (p: string) => /-product\/$/.test(p) || /^\/(t1|t2|t3)-series\/$/.test(p);

const posts = entries.filter((e) => isPost(e.path));
const products = entries.filter((e) => isProduct(e.path));
const pages = entries.filter((e) => !isPost(e.path) && !isProduct(e.path));

function priority(p: string): string {
  if (p === '/') return '1.0';
  if (isProduct(p)) return '0.9';
  if (p.includes('contact') || p.includes('financing')) return '0.8';
  if (isPost(p)) return '0.6';
  return '0.7';
}

function changefreq(p: string): string {
  if (p === '/' || isPost(p) || isProduct(p)) return 'weekly';
  if (p.includes('about')) return 'yearly';
  return 'monthly';
}

function urlset(list: Entry[]): string {
  const body = list
    .map(
      (e) =>
        `  <url>\n    <loc>${escXml(e.url)}</loc>\n    <lastmod>${TODAY}</lastmod>\n` +
        `    <changefreq>${changefreq(e.path)}</changefreq>\n    <priority>${priority(e.path)}</priority>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function imageSitemap(list: Entry[]): string {
  const body = list
    .map(
      (e) =>
        `  <url>\n    <loc>${escXml(e.url)}</loc>\n    <image:image>\n` +
        `      <image:loc>${escXml(e.image)}</image:loc>\n` +
        `      <image:title>${escXml(e.title)}</image:title>\n    </image:image>\n  </url>`,
    )
    .join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
    'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
    `${body}\n</urlset>\n`
  );
}

const CHILD_SITEMAPS = [
  'sitemap-pages.xml',
  'sitemap-products.xml',
  'sitemap-blog.xml',
  'sitemap-news.xml',
  'sitemap-images.xml',
];

function sitemapIndex(): string {
  const body = CHILD_SITEMAPS.map(
    (name) =>
      `  <sitemap>\n    <loc>${ORIGIN}${BASE_PREFIX}/${name}</loc>\n    <lastmod>${TODAY}</lastmod>\n  </sitemap>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

function robots(): string {
  return [
    `# ${SITE_NAME} — robots.txt`,
    '# All legitimate crawlers are welcome.',
    '',
    'User-agent: *',
    'Allow: /',
    '',
    '# The client-side search page has no indexable content of its own.',
    `Disallow: ${BASE_PREFIX}/search/`,
    '',
    '# Build-time snapshots. Every page here is already served as real HTML at',
    '# its own URL, so indexing these would only create duplicate content.',
    `Disallow: ${BASE_PREFIX}/content/`,
    `Disallow: ${BASE_PREFIX}/data/`,
    '',
    '# AI crawlers — welcome for discovery and recommendations',
    ...['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai',
      'Google-Extended', 'CCBot', 'PerplexityBot', 'Applebot', 'Applebot-Extended', 'Amazonbot',
    ].flatMap((agent) => [`User-agent: ${agent}`, 'Allow: /']),
    '',
    ...CHILD_SITEMAPS.map((name) => `Sitemap: ${ORIGIN}${BASE_PREFIX}/${name}`),
    `Sitemap: ${ORIGIN}${BASE_PREFIX}/sitemap.xml`,
    '',
  ].join('\n');
}

function rss(): string {
  const items = posts
    .slice(0, 50)
    .map(
      (e) =>
        `    <item>\n      <title>${escXml(e.title)}</title>\n      <link>${escXml(e.url)}</link>\n` +
        `      <guid isPermaLink="true">${escXml(e.url)}</guid>\n` +
        `      <description>${escXml(e.description)}</description>\n      <pubDate>${NOW}</pubDate>\n    </item>`,
    )
    .join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n' +
    `    <title>${escXml(SITE_NAME)}</title>\n    <link>${ORIGIN}${BASE}</link>\n` +
    `    <description>${escXml(SITE_DESCRIPTION)}</description>\n` +
    `    <language>en-US</language>\n    <lastBuildDate>${NOW}</lastBuildDate>\n${items}\n  </channel>\n</rss>\n`
  );
}

function manifest(): string {
  return JSON.stringify(
    {
      name: SITE_NAME,
      short_name: SITE_NAME,
      start_url: BASE,
      scope: BASE,
      display: 'standalone',
      background_color: '#101210',
      theme_color: '#101210',
      description: SITE_DESCRIPTION,
      icons: [
        { src: `${BASE_PREFIX}/favicon.ico`, sizes: '16x16 32x32 48x48', type: 'image/x-icon' },
        { src: `${BASE_PREFIX}/favicon-32.png`, sizes: '32x32', type: 'image/png' },
        { src: `${BASE_PREFIX}/favicon.png`, sizes: '192x192', type: 'image/png' },
        { src: `${BASE_PREFIX}/favicon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        { src: `${BASE_PREFIX}/apple-touch-icon.png`, sizes: '180x180', type: 'image/png' },
      ],
    },
    null,
    2,
  );
}

function llms(): string {
  return [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    `Contact: ${CONTACT_EMAIL} · ${CONTACT_PHONE_E164}`,
    '',
    '## Key pages',
    ...pages.slice(0, 60).map((e) => `- [${e.title}](${e.url}): ${e.description}`),
    '',
    '## Vehicles',
    ...products.map((e) => `- [${e.title}](${e.url}): ${e.description}`),
    '',
  ].join('\n');
}

const files: Record<string, string> = {
  'sitemap.xml': sitemapIndex(),
  'sitemap-pages.xml': urlset(pages),
  'sitemap-products.xml': urlset(products),
  'sitemap-blog.xml': urlset(posts.filter((e) => e.path.startsWith('/blog/'))),
  'sitemap-news.xml': urlset(posts.filter((e) => e.path.startsWith('/news/'))),
  'sitemap-images.xml': imageSitemap(entries),
  'robots.txt': robots(),
  'rss.xml': rss(),
  'feed.xml': rss(),
  'manifest.json': manifest(),
  'llms.txt': llms(),
};

for (const [name, contents] of Object.entries(files)) {
  fs.writeFileSync(path.join(PUBLIC_DIR, name), contents, 'utf8');
}

console.log(
  `[generate-seo] ${Object.keys(files).length} files for ${ORIGIN}${BASE} ` +
    `(${pages.length} pages, ${products.length} products, ${posts.length} posts)`,
);
