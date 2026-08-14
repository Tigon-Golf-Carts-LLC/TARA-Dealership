#!/usr/bin/env node
/**
 * Generates the extended SEO/AI XML file suite for taradealership.com
 * from public/content/routes.json. Rerun after route changes:
 *   node scripts/generate-seo-files.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = resolve(ROOT, 'public');
const ORIGIN = 'https://taradealership.com';
const TODAY = new Date().toISOString().slice(0, 10);
const BRAND = 'TARA Dealership';
const PHONE = '+1-844-844-3432';

const routes = JSON.parse(readFileSync(resolve(PUB, 'content/routes.json'), 'utf8'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const entries = Object.entries(routes).map(([path, meta]) => ({
  path,
  url: ORIGIN + path,
  title: meta.title || BRAND,
  description: meta.description || '',
}));

const isPost = (p) => p.startsWith('/blog/') || p.startsWith('/news/');
const isProduct = (p) => /-(product|series)\/$/.test(p) || /^\/(t1|t2|t3)-series\//.test(p) || p.includes('-golf-cart-product');
const isCategory = (p) => /^\/(blog|news|cases|accessories)\/$/.test(p);
const posts = entries.filter((e) => isPost(e.path) && e.path !== '/blog/' && e.path !== '/news/');
const products = entries.filter((e) => isProduct(e.path));
const pages = entries.filter((e) => !isPost(e.path) && !isProduct(e.path));

function priority(p) {
  if (p === '/') return '1.0';
  if (isProduct(p)) return '0.9';
  if (p.includes('contact')) return '0.8';
  if (isPost(p)) return '0.6';
  if (p.includes('about')) return '0.5';
  return '0.7';
}
function changefreq(p) {
  if (p === '/' || isPost(p) || isProduct(p)) return 'weekly';
  if (p.includes('about')) return 'yearly';
  return 'monthly';
}

function urlset(list, extraNs = '') {
  const body = list
    .map((e) => `  <url>\n    <loc>${esc(e.url)}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>${changefreq(e.path)}</changefreq>\n    <priority>${priority(e.path)}</priority>\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${extraNs}>\n${body}\n</urlset>\n`;
}

const files = {};

// Category-specific sitemaps
files['sitemap-blog.xml'] = urlset(posts);
files['post-sitemap.xml'] = urlset(posts);
files['sitemap-brands.xml'] = urlset(products);
files['page-sitemap.xml'] = urlset(pages);
files['category-sitemap.xml'] = urlset(entries.filter((e) => isCategory(e.path)));
files['tag-sitemap.xml'] = urlset(entries.filter((e) => isCategory(e.path)));
files['author-sitemap.xml'] = urlset(entries.filter((e) => e.path === '/about-us/'));
files['mobile-sitemap.xml'] = urlset(entries, ' xmlns:mobile="http://www.google.com/schemas/sitemap-mobile/1.0"').replace(/<\/priority>/g, '</priority>\n    <mobile:mobile/>').replace('<mobile:mobile/>\n  </url>\n</urlset>', '<mobile:mobile/>\n  </url>\n</urlset>');
files['dynamic-sitemap.xml'] = urlset(entries);
files['xhtml-sitemap.xml'] = files['hreflang-sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.map((e) => `  <url>\n    <loc>${esc(e.url)}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <xhtml:link rel="alternate" hreflang="en-US" href="${esc(e.url)}"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(e.url)}"/>\n  </url>`).join('\n')}\n</urlset>\n`;

// Geo sitemap
files['geo-sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:geo="http://www.google.com/geo/schemas/sitemap/1.0">\n  <url>\n    <loc>${ORIGIN}/contact/</loc>\n    <lastmod>${TODAY}</lastmod>\n    <geo:geo>\n      <geo:format>kml</geo:format>\n    </geo:geo>\n  </url>\n</urlset>\n`;

// News sitemap (Google News format, most recent 100 posts)
files['news-sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${posts.slice(0, 100).map((e) => `  <url>\n    <loc>${esc(e.url)}</loc>\n    <news:news>\n      <news:publication>\n        <news:name>${esc(BRAND)}</news:name>\n        <news:language>en</news:language>\n      </news:publication>\n      <news:publication_date>${TODAY}</news:publication_date>\n      <news:title>${esc(e.title)}</news:title>\n    </news:news>\n  </url>`).join('\n')}\n</urlset>\n`;

// image-sitemap.xml — mirror of sitemap-images.xml
try {
  files['image-sitemap.xml'] = readFileSync(resolve(PUB, 'sitemap-images.xml'), 'utf8');
} catch {}

// RSS / Atom / generic feeds
const rssItems = posts.slice(0, 50).map((e) => `    <item>\n      <title>${esc(e.title)}</title>\n      <link>${esc(e.url)}</link>\n      <guid>${esc(e.url)}</guid>\n      <description>${esc(e.description)}</description>\n      <pubDate>${new Date(TODAY).toUTCString()}</pubDate>\n    </item>`).join('\n');
const rss = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n    <title>${esc(BRAND)} — Golf Cart News &amp; Guides</title>\n    <link>${ORIGIN}/</link>\n    <description>News, buying guides, and maintenance tips from ${esc(BRAND)} — your US golf cart dealership. ${PHONE}</description>\n    <language>en-us</language>\n    <lastBuildDate>${new Date(TODAY).toUTCString()}</lastBuildDate>\n    <atom:link href="${ORIGIN}/rss.xml" rel="self" type="application/rss+xml"/>\n${rssItems}\n  </channel>\n</rss>\n`;
files['rss.xml'] = rss;
files['feed.xml'] = rss;
files['atom.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>${esc(BRAND)} — Golf Cart News &amp; Guides</title>\n  <link href="${ORIGIN}/"/>\n  <link rel="self" href="${ORIGIN}/atom.xml"/>\n  <updated>${TODAY}T00:00:00Z</updated>\n  <id>${ORIGIN}/</id>\n  <author><name>${esc(BRAND)}</name></author>\n${posts.slice(0, 50).map((e) => `  <entry>\n    <title>${esc(e.title)}</title>\n    <link href="${esc(e.url)}"/>\n    <id>${esc(e.url)}</id>\n    <updated>${TODAY}T00:00:00Z</updated>\n    <summary>${esc(e.description)}</summary>\n  </entry>`).join('\n')}\n</feed>\n`;

// Podcast placeholder feed (no episodes yet)
files['podcast.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">\n  <channel>\n    <title>${esc(BRAND)} Podcast</title>\n    <link>${ORIGIN}/</link>\n    <language>en-us</language>\n    <itunes:author>${esc(BRAND)}</itunes:author>\n    <description>Audio content from ${esc(BRAND)}. No episodes published yet.</description>\n  </channel>\n</rss>\n`;

// Product feeds
const productItems = products.map((e) => `    <item>\n      <g:id>${esc(e.path.replace(/\W+/g, '-').replace(/^-|-$/g, ''))}</g:id>\n      <g:title>${esc(e.title)}</g:title>\n      <g:description>${esc(e.description)}</g:description>\n      <g:link>${esc(e.url)}</g:link>\n      <g:condition>new</g:condition>\n      <g:availability>in_stock</g:availability>\n      <g:brand>TARA</g:brand>\n    </item>`).join('\n');
const gfeed = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n  <channel>\n    <title>${esc(BRAND)} Product Feed</title>\n    <link>${ORIGIN}/</link>\n    <description>TARA electric golf carts, NEVs, and utility vehicles available from ${esc(BRAND)}. Call ${PHONE} for current pricing.</description>\n${productItems}\n  </channel>\n</rss>\n`;
files['product_feed.xml'] = gfeed;
files['google-shopping-feed.xml'] = gfeed;
files['local-inventory-feed.xml'] = gfeed;
files['api-feed.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>${esc(BRAND)} Data Feed</title>\n  <link href="${ORIGIN}/api-feed.xml" rel="self"/>\n  <updated>${TODAY}T00:00:00Z</updated>\n  <id>${ORIGIN}/api-feed.xml</id>\n${entries.map((e) => `  <entry>\n    <title>${esc(e.title)}</title>\n    <link href="${esc(e.url)}"/>\n    <id>${esc(e.url)}</id>\n    <updated>${TODAY}T00:00:00Z</updated>\n  </entry>`).join('\n')}\n</feed>\n`;

// urllist.xml + data.xml — simple URL lists
files['urllist.xml'] = urlset(entries);
files['data.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<site>\n  <name>${esc(BRAND)}</name>\n  <url>${ORIGIN}</url>\n  <phone>${PHONE}</phone>\n  <email>info@taradealership.com</email>\n  <serviceArea>United States (nationwide)</serviceArea>\n  <pages>\n${entries.map((e) => `    <page url="${esc(e.url)}" title="${esc(e.title)}"/>`).join('\n')}\n  </pages>\n</site>\n`;

// Sitemap index — every sitemap-format file
const sitemapChildren = [
  'sitemap-pages.xml', 'sitemap-news.xml', 'sitemap-images.xml', 'image-sitemap.xml',
  'sitemap-blog.xml', 'sitemap-brands.xml', 'page-sitemap.xml', 'post-sitemap.xml',
  'category-sitemap.xml', 'tag-sitemap.xml', 'author-sitemap.xml', 'news-sitemap.xml',
  'mobile-sitemap.xml', 'geo-sitemap.xml', 'hreflang-sitemap.xml', 'xhtml-sitemap.xml',
  'dynamic-sitemap.xml', 'urllist.xml',
];
files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapChildren.map((f) => `  <sitemap>\n    <loc>${ORIGIN}/${f}</loc>\n    <lastmod>${TODAY}</lastmod>\n  </sitemap>`).join('\n')}\n</sitemapindex>\n`;

for (const [name, content] of Object.entries(files)) {
  writeFileSync(resolve(PUB, name), content);
}
console.log(`Wrote ${Object.keys(files).length} files (${entries.length} routes, ${posts.length} posts, ${products.length} products).`);
