/**
 * optimize-assets.ts — image pipeline.
 *
 * Reads the raw originals in assets-src/images (never deployed) and writes
 * optimized derivatives into client/public/images (git-ignored, copied into
 * dist/ by Vite). Also mints the favicon set from the site icon.
 *
 * For every referenced raster image it emits:
 *   - responsive WebP widths (400/800/1200, capped at the source width)
 *   - matching AVIF widths (skip with AVIF=0)
 *   - an optimized same-format copy for images that must stay PNG/JPEG
 *     (social preview images, the logo, the favicons)
 *
 * SVGs go through SVGO. All metadata/EXIF is stripped (sharp's default).
 * Results are recorded in client/public/data/image-manifest.json, which
 * script/prerender.ts uses to rewrite <img> tags and CSS url() references.
 *
 * Re-runs are incremental: an image whose source hash and settings are
 * unchanged, and whose outputs all still exist, is skipped.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { optimize as svgo } from 'svgo';

import { SITE_ICON_SOURCE, type ImageManifest, type ImageVariant } from '../shared/site.ts';
import { buildIco } from './lib/ico.ts';
import {
  CONTENT_DIR,
  DATA_DIR,
  IMAGE_MANIFEST,
  IMAGE_OUT_DIR,
  IMAGE_SOURCE_DIR,
  PUBLIC_DIR,
  ROOT,
  ROUTES_SOURCE,
} from './lib/paths.ts';

// ─── Settings ────────────────────────────────────────────────────────────────

/** Bump when encoder settings change so cached outputs are regenerated. */
const SETTINGS_VERSION = 'v2';

/** Responsive widths emitted for images wide enough to need them. */
const WIDTHS = [400, 800, 1200];

/**
 * Widest derivative emitted. The site's widest layout container is 1440px and
 * almost every image slot is well under 1280px, so 1200px is the largest size
 * any viewport actually needs — nothing here is a zoomable gallery image.
 */
const MAX_WIDTH = 1200;

const WEBP_QUALITY = 75;
const AVIF_QUALITY = 45;
const JPEG_QUALITY = 82;

const EMIT_AVIF = process.env.AVIF !== '0';

/** Files that must keep their original format (social scrapers, icons). */
const KEEP_FORMAT = new Set<string>([
  '/images/og-image.png',
  '/images/tara-dealership-logo.png',
  '/images/favicon.png',
  '/images/apple-touch-icon.png',
]);

const RASTER_RE = /\.(jpe?g|png|webp)$/i;

// ─── Source discovery ────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function sitePathOf(file: string): string {
  return `/images/${path.relative(IMAGE_SOURCE_DIR, file).split(path.sep).join('/')}`;
}

/**
 * File name used to match a `/uploads/...` reference against a localised
 * source file: directory dropped, `<hex>-` prefix stripped, extension dropped.
 */
function fuzzyKey(sitePath: string): string {
  const name = sitePath.split('/').pop() ?? sitePath;
  return name
    .replace(/^[0-9a-f]{6,}-/i, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase();
}

/**
 * Every image path referenced anywhere in the shipped site: page content,
 * stylesheets, the route table's social images, and the manifest/browserconfig.
 *
 * The mirrored markup also still carries some `/uploads/...` paths from the
 * original media library; those are matched by file name so their localised
 * source still gets optimized instead of 404-ing.
 */
function collectReferenced(): { paths: Set<string>; names: Set<string> } {
  const referenced = new Set<string>();
  const names = new Set<string>();
  const add = (raw: string) => {
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      /* keep the raw form for malformed escapes */
    }
    referenced.add(value);
  };

  const scan = (text: string) => {
    for (const m of text.matchAll(/\/images\/[^"'()\s\\>]+/g)) add(m[0]);
    for (const m of text.matchAll(/\/uploads\/[^"'()\s\\>]+/g)) {
      let value = m[0];
      try {
        value = decodeURIComponent(value);
      } catch {
        /* keep the raw form */
      }
      names.add(fuzzyKey(value));
    }
  };

  for (const file of walk(CONTENT_DIR)) {
    if (file.endsWith('.html')) scan(fs.readFileSync(file, 'utf8'));
  }
  for (const file of walk(path.join(PUBLIC_DIR, 'css'))) {
    if (file.endsWith('.css')) scan(fs.readFileSync(file, 'utf8'));
  }
  for (const name of ['manifest.json', 'browserconfig.xml', 'schema.json']) {
    const file = path.join(PUBLIC_DIR, name);
    if (fs.existsSync(file)) scan(fs.readFileSync(file, 'utf8'));
  }
  if (fs.existsSync(ROUTES_SOURCE)) scan(fs.readFileSync(ROUTES_SOURCE, 'utf8'));
  scan(fs.readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8'));
  for (const file of walk(path.join(ROOT, 'client', 'src'))) scan(fs.readFileSync(file, 'utf8'));

  for (const keep of KEEP_FORMAT) referenced.add(keep);
  return { paths: referenced, names };
}

// ─── Output naming ───────────────────────────────────────────────────────────

/**
 * Derivative base name for a source path. Two sources that differ only by
 * extension (foo.png / foo.webp) would collide, so the second one gets a
 * short content-addressed suffix.
 */
function buildOutputBases(sources: string[]): Map<string, string> {
  const taken = new Set<string>();
  const bases = new Map<string, string>();
  for (const file of sources) {
    const rel = path.relative(IMAGE_SOURCE_DIR, file).split(path.sep).join('/');
    let base = rel.replace(/\.[^./]+$/, '');
    if (taken.has(base.toLowerCase())) {
      const suffix = crypto.createHash('sha1').update(rel).digest('hex').slice(0, 6);
      base = `${base}-${suffix}`;
    }
    taken.add(base.toLowerCase());
    bases.set(file, base);
  }
  return bases;
}

// ─── Per-image work ──────────────────────────────────────────────────────────

type Job = { file: string; sitePath: string; base: string };

type Result = {
  sitePath: string;
  srcBytes: number;
  outBytes: number;
  entry: { src: string; width: number; height: number; variants: ImageVariant[] };
  skipped: boolean;
};

function hashFile(file: string): string {
  return crypto
    .createHash('sha1')
    .update(fs.readFileSync(file))
    .update(SETTINGS_VERSION)
    .update(EMIT_AVIF ? 'avif' : 'noavif')
    .digest('hex')
    .slice(0, 16);
}

async function processImage(job: Job, cache: Record<string, unknown>): Promise<Result> {
  const srcBytes = fs.statSync(job.file).size;
  const hash = hashFile(job.file);
  const cached = cache[job.sitePath] as
    | { hash: string; entry: Result['entry']; outBytes: number }
    | undefined;

  const outputsExist = (entry: Result['entry']) =>
    entry.variants.every(
      (v) =>
        fs.existsSync(path.join(PUBLIC_DIR, v.webp.replace(/^\//, ''))) &&
        (!v.avif || fs.existsSync(path.join(PUBLIC_DIR, v.avif.replace(/^\//, '')))),
    );

  if (cached?.hash === hash && outputsExist(cached.entry)) {
    return { sitePath: job.sitePath, srcBytes, outBytes: cached.outBytes, entry: cached.entry, skipped: true };
  }

  const input = fs.readFileSync(job.file);
  const meta = await sharp(input).metadata();
  const srcWidth = meta.width ?? 0;
  const srcHeight = meta.height ?? 0;
  if (!srcWidth || !srcHeight) throw new Error(`no dimensions: ${job.file}`);

  const targetWidths = [...new Set(
    WIDTHS.filter((w) => w < srcWidth).concat(Math.min(srcWidth, MAX_WIDTH)),
  )].sort((a, b) => a - b);

  const variants: ImageVariant[] = [];
  let outBytes = 0;

  for (const width of targetWidths) {
    const suffix = width === targetWidths[targetWidths.length - 1] ? '' : `-${width}`;
    const pipeline = () =>
      sharp(input).rotate().resize({ width, withoutEnlargement: true });

    const webpRel = `images/${job.base}${suffix}.webp`;
    const webpAbs = path.join(PUBLIC_DIR, webpRel);
    fs.mkdirSync(path.dirname(webpAbs), { recursive: true });
    const webpBuf = await pipeline().webp({ quality: WEBP_QUALITY, effort: 4, smartSubsample: true }).toBuffer();
    fs.writeFileSync(webpAbs, webpBuf);
    outBytes += webpBuf.length;

    const variant: ImageVariant = { w: width, webp: `/${webpRel}` };

    if (EMIT_AVIF) {
      const avifRel = `images/${job.base}${suffix}.avif`;
      const avifBuf = await pipeline().avif({ quality: AVIF_QUALITY, effort: 2 }).toBuffer();
      fs.writeFileSync(path.join(PUBLIC_DIR, avifRel), avifBuf);
      outBytes += avifBuf.length;
      variant.avif = `/${avifRel}`;
    }

    variants.push(variant);
  }

  // Images consumed by social scrapers / OS icons keep their original format
  // at their original path, losslessly recompressed.
  if (KEEP_FORMAT.has(job.sitePath)) {
    const outAbs = path.join(PUBLIC_DIR, job.sitePath.replace(/^\//, ''));
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    const capped = sharp(input).rotate().resize({ width: Math.min(srcWidth, 2000), withoutEnlargement: true });
    const buf = /\.jpe?g$/i.test(job.sitePath)
      ? await capped.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
      : await capped.png({ compressionLevel: 9, effort: 10, adaptiveFiltering: true }).toBuffer();
    fs.writeFileSync(outAbs, buf);
    outBytes += buf.length;
  }

  const largest = variants[variants.length - 1];
  const scale = Math.min(srcWidth, MAX_WIDTH) / srcWidth;
  const entry = {
    src: largest.webp,
    width: Math.round(srcWidth * scale),
    height: Math.round(srcHeight * scale),
    variants,
  };

  cache[job.sitePath] = { hash, entry, outBytes };
  return { sitePath: job.sitePath, srcBytes, outBytes, entry, skipped: false };
}

// ─── SVG ─────────────────────────────────────────────────────────────────────

function optimizeSvgs(files: string[], bases: Map<string, string>) {
  let srcBytes = 0;
  let outBytes = 0;
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    srcBytes += Buffer.byteLength(raw);
    const result = svgo(raw, {
      multipass: true,
      plugins: [
        { name: 'preset-default', params: { overrides: { removeViewBox: false } } },
        'removeDimensions',
      ],
    });
    const rel = `images/${bases.get(file)}.svg`;
    const abs = path.join(PUBLIC_DIR, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, result.data, 'utf8');
    outBytes += Buffer.byteLength(result.data);
  }
  return { srcBytes, outBytes, count: files.length };
}

// ─── Social preview images ───────────────────────────────────────────────────

/**
 * Social scrapers are not uniformly happy with WebP or AVIF, and they want a
 * 1200x630 frame. So every distinct og:image in the route table gets a
 * dedicated JPEG derivative at exactly that size, recorded in
 * data/og-manifest.json for the prerenderer to point og:image/twitter:image at.
 */
async function buildSocialImages(): Promise<number> {
  if (!fs.existsSync(ROUTES_SOURCE)) return 0;
  const routes = JSON.parse(fs.readFileSync(ROUTES_SOURCE, 'utf8')) as Record<
    string,
    { ogImage?: string }
  >;
  const wanted = [...new Set(Object.values(routes).map((r) => r.ogImage).filter(Boolean))] as string[];

  const outDir = path.join(IMAGE_OUT_DIR, 'social');
  fs.mkdirSync(outDir, { recursive: true });

  const map: Record<string, string> = {};
  let bytes = 0;
  const missing: string[] = [];

  for (const sitePath of wanted) {
    const source = path.join(ROOT, 'assets-src', sitePath.replace(/^\//, ''));
    if (!fs.existsSync(source)) {
      missing.push(sitePath);
      continue;
    }
    const id = crypto.createHash('sha1').update(sitePath).digest('hex').slice(0, 16);
    const rel = `/images/social/${id}.jpg`;
    const abs = path.join(PUBLIC_DIR, rel.replace(/^\//, ''));
    if (!fs.existsSync(abs)) {
      const buf = await sharp(source)
        .resize(1200, 630, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 70, mozjpeg: true })
        .toBuffer();
      fs.writeFileSync(abs, buf);
    }
    bytes += fs.statSync(abs).size;
    map[sitePath] = rel;
  }

  fs.writeFileSync(path.join(DATA_DIR, 'og-manifest.json'), JSON.stringify(map), 'utf8');
  if (missing.length > 0) {
    console.warn(`[optimize-assets] ${missing.length} og:image sources missing, e.g. ${missing[0]}`);
  }
  console.log(
    `[optimize-assets] ${Object.keys(map).length} social preview images (1200x630 JPEG, ${mb(bytes)})`,
  );
  return bytes;
}

// ─── Favicons ────────────────────────────────────────────────────────────────

/**
 * Mint the whole favicon set from the site icon so the browser tab, the
 * bookmark icon and the PWA icon all show the TARA Dealership badge.
 */
async function buildFavicons() {
  const source = path.join(ROOT, SITE_ICON_SOURCE);
  if (!fs.existsSync(source)) {
    throw new Error(`[optimize-assets] site icon not found: ${SITE_ICON_SOURCE}`);
  }

  // Trim the flat background so the badge fills the (tiny) favicon box, then
  // letterbox it back onto a transparent square canvas.
  const trimmed = await sharp(source).trim({ threshold: 12 }).png().toBuffer();

  const square = async (size: number) =>
    sharp(trimmed)
      .resize({
        width: size,
        height: size,
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer();

  const icoSizes = [16, 32, 48];
  const ico = buildIco(
    await Promise.all(icoSizes.map(async (size) => ({ size, data: await square(size) }))),
  );
  fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon.ico'), ico);

  const pngs: [string, number][] = [
    ['favicon-32.png', 32],
    ['favicon.png', 192],
    ['favicon-512.png', 512],
    ['apple-touch-icon.png', 180],
  ];
  for (const [name, size] of pngs) {
    fs.writeFileSync(path.join(PUBLIC_DIR, name), await square(size));
  }
  // /images/favicon.png and /images/apple-touch-icon.png are referenced by the
  // cloned page markup — keep them in lockstep with the root copies.
  fs.mkdirSync(IMAGE_OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(IMAGE_OUT_DIR, 'favicon.png'), await square(192));
  fs.writeFileSync(path.join(IMAGE_OUT_DIR, 'apple-touch-icon.png'), await square(180));

  console.log(`[optimize-assets] favicons minted from ${SITE_ICON_SOURCE} (ico: ${icoSizes.join('/')})`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

async function main() {
  if (!fs.existsSync(IMAGE_SOURCE_DIR)) {
    throw new Error(`[optimize-assets] no image sources at ${IMAGE_SOURCE_DIR}`);
  }

  const allSources = walk(IMAGE_SOURCE_DIR);
  const { paths: referenced, names: referencedNames } = collectReferenced();
  const bases = buildOutputBases(allSources);

  const rasterJobs: Job[] = [];
  const svgFiles: string[] = [];
  let unreferenced = 0;
  let unreferencedBytes = 0;

  for (const file of allSources) {
    const sitePath = sitePathOf(file);
    if (!referenced.has(sitePath) && !referencedNames.has(fuzzyKey(sitePath))) {
      unreferenced += 1;
      unreferencedBytes += fs.statSync(file).size;
      continue;
    }
    if (file.toLowerCase().endsWith('.svg')) svgFiles.push(file);
    else if (RASTER_RE.test(file)) rasterJobs.push({ file, sitePath, base: bases.get(file)! });
  }

  // Encoder settings changed? Wipe the derivatives so no stale width or
  // format from a previous run survives into dist/.
  const stamp = `${SETTINGS_VERSION}:${WIDTHS.join('-')}:${MAX_WIDTH}:${WEBP_QUALITY}:${EMIT_AVIF ? AVIF_QUALITY : 'off'}`;
  const stampFile = path.join(IMAGE_OUT_DIR, '.settings');
  if (fs.existsSync(IMAGE_OUT_DIR)) {
    const previous = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8') : '';
    if (previous !== stamp) {
      console.log('[optimize-assets] settings changed — clearing previous derivatives');
      fs.rmSync(IMAGE_OUT_DIR, { recursive: true, force: true });
    }
  }

  fs.mkdirSync(IMAGE_OUT_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(stampFile, stamp, 'utf8');

  const cacheFile = path.join(ROOT, '.cache', 'image-cache.json');
  const cache: Record<string, unknown> = fs.existsSync(cacheFile)
    ? JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    : {};

  const results: Result[] = [];
  const pool = Math.max(1, Math.min(os.cpus().length, 8));
  // One libvips thread per worker: the pool already saturates the CPU.
  sharp.concurrency(1);
  sharp.cache(false);

  let cursor = 0;
  let done = 0;
  const started = Date.now();

  async function worker() {
    while (cursor < rasterJobs.length) {
      const job = rasterJobs[cursor++];
      try {
        results.push(await processImage(job, cache));
      } catch (err) {
        throw new Error(`[optimize-assets] ${job.sitePath}: ${(err as Error).message}`);
      }
      done += 1;
      if (done % 100 === 0 || done === rasterJobs.length) {
        const elapsed = ((Date.now() - started) / 1000).toFixed(0);
        console.log(`[optimize-assets] ${done}/${rasterJobs.length} images (${elapsed}s)`);
      }
    }
  }

  await Promise.all(Array.from({ length: pool }, worker));

  const svg = optimizeSvgs(svgFiles, bases);
  const socialBytes = await buildSocialImages();
  await buildFavicons();

  const manifest: ImageManifest = {};
  for (const result of results) manifest[result.sitePath] = result.entry;
  fs.writeFileSync(IMAGE_MANIFEST, JSON.stringify(manifest), 'utf8');

  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(cache), 'utf8');

  const srcTotal = results.reduce((sum, r) => sum + r.srcBytes, 0) + svg.srcBytes;
  const outTotal = results.reduce((sum, r) => sum + r.outBytes, 0) + svg.outBytes + socialBytes;
  const reused = results.filter((r) => r.skipped).length;

  console.log('');
  console.log('[optimize-assets] image pipeline summary');
  console.log(`  raster images      ${results.length} (${reused} reused from cache)`);
  console.log(`  svg images         ${svg.count}`);
  console.log(`  unreferenced       ${unreferenced} skipped (${mb(unreferencedBytes)} never shipped)`);
  console.log(`  source bytes       ${mb(srcTotal)}`);
  console.log(`  optimized bytes    ${mb(outTotal)}`);
  console.log(`  reduction          ${(100 - (outTotal / srcTotal) * 100).toFixed(1)}%`);
  console.log(`  formats            WebP q${WEBP_QUALITY}${EMIT_AVIF ? ` + AVIF q${AVIF_QUALITY}` : ' (AVIF disabled)'}`);
  console.log(`  widths             ${WIDTHS.join('/')} (capped at source width, max ${MAX_WIDTH}px)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
