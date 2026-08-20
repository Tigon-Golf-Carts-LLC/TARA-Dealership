/**
 * verify-dist.ts — post-build gate.
 *
 * Confirms the build output is actually hostable on GitHub Pages: the
 * required files exist, no file or the total is over budget, images ship as
 * WebP/AVIF with srcset, and nothing in the bundle points at a local API or
 * leaks a secret name.
 *
 * Exits non-zero on any hard failure.
 */
import fs from 'node:fs';
import path from 'node:path';

import { basePath, siteOrigin } from '../shared/site.ts';
import { DIST_DIR } from './lib/paths.ts';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const HARD_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const FLAG_FILE_BYTES = 1024 * 1024;

const BASE = basePath(process.env);
const ORIGIN = siteOrigin(process.env);

/** Secret names that must never appear in shipped output. */
const SECRET_NAMES = [
  'CONTENT_API_KEY',
  'DATABASE_URL',
  'SESSION_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'GMAIL_REFRESH_TOKEN',
  'REPLIT_DB_URL',
  'GITHUB_TOKEN',
  'NPM_TOKEN',
];

const failures: string[] = [];
const warnings: string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function human(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

if (!fs.existsSync(DIST_DIR)) {
  console.error('[verify] dist/ does not exist — run `npm run build` first.');
  process.exit(1);
}

const files = walk(DIST_DIR);
const totalBytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);

// ─── 1. Required files ───────────────────────────────────────────────────────

const required = [
  'index.html',
  '404.html',
  '.nojekyll',
  'sitemap.xml',
  'robots.txt',
  'data/routes.json',
  'data/search-index.json',
  'data/models.json',
  'data/site.json',
  'data/image-manifest.json',
];
for (const rel of required) {
  if (!fs.existsSync(path.join(DIST_DIR, rel))) failures.push(`missing required file: dist/${rel}`);
}

// Every prerendered route is a folder holding its own index.html.
const routeDirs = files.filter(
  (f) => path.basename(f) === 'index.html' && path.dirname(f) !== DIST_DIR,
);
if (routeDirs.length < 100) {
  failures.push(`only ${routeDirs.length} prerendered route folders — expected hundreds`);
}

const htmlFiles = files.filter((f) => f.endsWith('.html'));

console.log('── Required output ──────────────────────────────────────────────');
console.log(`  html pages            ${htmlFiles.length}`);
console.log(`  prerendered folders   ${routeDirs.length}`);
console.log(`  base path             ${BASE}`);
console.log(`  origin                ${ORIGIN}`);
console.log(
  `  CNAME                 ${fs.existsSync(path.join(DIST_DIR, 'CNAME'))
    ? fs.readFileSync(path.join(DIST_DIR, 'CNAME'), 'utf8').trim()
    : '(none — using github.io)'}`,
);

// ─── 2. Size budget ──────────────────────────────────────────────────────────

const bySize = files
  .map((f) => ({ file: path.relative(DIST_DIR, f), bytes: fs.statSync(f).size }))
  .sort((a, b) => b.bytes - a.bytes);

console.log('');
console.log('── Size ─────────────────────────────────────────────────────────');
console.log(`  total dist/           ${human(totalBytes)} across ${files.length} files`);
console.log('  20 largest files:');
for (const entry of bySize.slice(0, 20)) {
  console.log(`    ${human(entry.bytes).padStart(9)}  ${entry.file}`);
}

const overFlag = bySize.filter((e) => e.bytes > FLAG_FILE_BYTES);
if (overFlag.length > 0) {
  console.log('');
  console.log(`  ⚠ ${overFlag.length} file(s) over 1 MB:`);
  for (const entry of overFlag.slice(0, 20)) {
    console.log(`    ${human(entry.bytes).padStart(9)}  ${entry.file}`);
  }
  warnings.push(`${overFlag.length} file(s) over 1 MB`);
} else {
  console.log('  ✓ no single file over 1 MB');
}

for (const entry of bySize) {
  if (entry.bytes > HARD_FILE_BYTES) {
    failures.push(`${entry.file} is ${human(entry.bytes)} — over the 100 MB GitHub Pages hard cap`);
  } else if (entry.bytes > MAX_FILE_BYTES) {
    failures.push(`${entry.file} is ${human(entry.bytes)} — over the 25 MB budget`);
  }
}
if (totalBytes > MAX_TOTAL_BYTES) {
  failures.push(`dist/ is ${human(totalBytes)} — over the 500 MB budget`);
}

// ─── 3. Images ───────────────────────────────────────────────────────────────

const imageExts = new Map<string, { count: number; bytes: number }>();
for (const entry of bySize) {
  if (!entry.file.startsWith('images/')) continue;
  const ext = path.extname(entry.file).slice(1).toLowerCase();
  const current = imageExts.get(ext) ?? { count: 0, bytes: 0 };
  imageExts.set(ext, { count: current.count + 1, bytes: current.bytes + entry.bytes });
}

console.log('');
console.log('── Images ───────────────────────────────────────────────────────');
for (const [ext, stats] of [...imageExts].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`  ${ext.padEnd(6)} ${String(stats.count).padStart(5)} files  ${human(stats.bytes).padStart(9)}`);
}

const home = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');
const imgTags = [...home.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
const withSrcset = imgTags.filter((tag) => /srcset=/.test(tag));
const webpSrc = imgTags.filter((tag) => /src="[^"]+\.webp"/.test(tag));
const avifSources = [...home.matchAll(/<source[^>]+type="image\/avif"/gi)].length;
const legacySrc = imgTags.filter((tag) => /src="[^"]+\.(png|jpe?g)"/i.test(tag));

console.log(`  home <img> tags       ${imgTags.length}`);
console.log(`  with srcset           ${withSrcset.length}`);
console.log(`  WebP src              ${webpSrc.length}`);
console.log(`  AVIF <source>         ${avifSources}`);
console.log(`  still PNG/JPEG src    ${legacySrc.length}`);

if (imgTags.length > 0 && withSrcset.length / imgTags.length < 0.9) {
  failures.push(`only ${withSrcset.length}/${imgTags.length} home images carry a srcset`);
}
if (avifSources === 0) warnings.push('no AVIF <source> found on the home page');
if (legacySrc.length > 0) warnings.push(`${legacySrc.length} home image(s) still served as PNG/JPEG`);

const missingDimensions = imgTags.filter(
  (tag) => !/\bwidth=/.test(tag) || !/\bheight=/.test(tag),
).length;
if (missingDimensions > 0) {
  warnings.push(`${missingDimensions} home image(s) missing width/height`);
}
const lazyCount = imgTags.filter((tag) => /loading="lazy"/.test(tag)).length;
console.log(`  loading="lazy"        ${lazyCount}`);

// ─── 4. Runtime-backend leakage ──────────────────────────────────────────────

console.log('');
console.log('── Backend references ───────────────────────────────────────────');

const scanned = files.filter(
  (f) => /\.(html|js|css|json|txt|xml)$/i.test(f) && !f.includes(`${path.sep}content${path.sep}`),
);

type Hit = { pattern: string; file: string; sample: string };
const hits: Hit[] = [];
const patterns: [string, RegExp][] = [
  ['localhost', /localhost(?::\d+)?/i],
  ['/api/', /(?:fetch|axios|href|src|action)\s*[=(]\s*["'`][^"'`]*\/api\//i],
  ['search.php', /\/search\.php/i],
  ...SECRET_NAMES.map((name) => [name, new RegExp(name)] as [string, RegExp]),
];

for (const file of scanned) {
  const text = fs.readFileSync(file, 'utf8');
  for (const [label, pattern] of patterns) {
    const match = text.match(pattern);
    if (match) {
      hits.push({
        pattern: label,
        file: path.relative(DIST_DIR, file),
        sample: match[0].slice(0, 80),
      });
    }
  }
}

if (hits.length === 0) {
  console.log('  ✓ no "localhost", same-origin "/api/", "/search.php" or secret names found');
} else {
  for (const hit of hits.slice(0, 40)) {
    console.log(`  ✗ ${hit.pattern.padEnd(14)} ${hit.file} → ${hit.sample}`);
  }
  if (hits.length > 40) console.log(`  … and ${hits.length - 40} more`);
  failures.push(`${hits.length} backend/secret reference(s) in build output`);
}

// Content mirror is scanned separately: it is data, not code, and a false
// positive there should be reported rather than silently ignored.
const contentHits = walk(path.join(DIST_DIR, 'content')).filter((f) => {
  const text = fs.readFileSync(f, 'utf8');
  return /localhost|\/search\.php|\/api\//i.test(text);
});
console.log(
  contentHits.length === 0
    ? '  ✓ content mirror clean'
    : `  ✗ ${contentHits.length} content file(s) still reference a backend, e.g. ${path.relative(DIST_DIR, contentHits[0])}`,
);
if (contentHits.length > 0) failures.push(`${contentHits.length} content file(s) reference a backend`);

// ─── 5. Result ───────────────────────────────────────────────────────────────

console.log('');
if (warnings.length > 0) {
  console.log('── Warnings ─────────────────────────────────────────────────────');
  for (const warning of warnings) console.log(`  ⚠ ${warning}`);
  console.log('');
}

if (failures.length > 0) {
  console.error('── FAILED ───────────────────────────────────────────────────────');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('✓ dist/ is ready for GitHub Pages');
