/**
 * Build-time rewriters for the cloned page markup and stylesheets.
 *
 * Everything here runs over the *built* output in dist/, never over the
 * sources in client/public/.
 */
import {
  CONTACT_EMAIL,
  CONTACT_PHONE_DISPLAY,
  type ImageManifest,
  type ImageManifestEntry,
} from '../../shared/site.ts';

/** Legacy addresses replaced site-wide by the dealership contact address. */
const LEGACY_EMAILS = [
  'info@taradealership.com',
  'sales@taradealership.com',
  'marketing01@taradealership.com',
  'sales@taragolfcart.com',
  'info@taragolfcart.com',
];

/**
 * Responsive `sizes` for a full-width-ish content image. Phones fetch the
 * 400/800 derivative; desktops go up to 1200.
 */
const DEFAULT_SIZES = '(max-width: 600px) 100vw, (max-width: 1200px) 90vw, 1200px';

/** Images declared this small are icons/thumbnails — size them exactly. */
const FIXED_SIZE_THRESHOLD = 200;

export type ImageResolver = (sitePath: string) => ImageManifestEntry | undefined;

/**
 * Normalised file name for fuzzy matching: directory dropped, the localiser's
 * `<hex>-` prefix stripped, extension dropped, lower-cased.
 */
function fuzzyKey(sitePath: string): string {
  const name = sitePath.split('/').pop() ?? sitePath;
  return name
    .replace(/^[0-9a-f]{6,}-/i, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase();
}

/**
 * Manifest lookup that tolerates percent-encoded and base-prefixed paths, and
 * falls back to a file-name match for the `/uploads/...` references the
 * original site left behind when its media library was localised.
 */
export function makeImageResolver(manifest: ImageManifest, base: string): ImageResolver {
  const decoded = new Map<string, ImageManifestEntry>();
  const byName = new Map<string, ImageManifestEntry>();
  for (const [key, entry] of Object.entries(manifest)) {
    decoded.set(key, entry);
    let plain = key;
    try {
      plain = decodeURIComponent(key);
      decoded.set(plain, entry);
    } catch {
      /* malformed escapes stay under their raw key */
    }
    const name = fuzzyKey(plain);
    if (name && !byName.has(name)) byName.set(name, entry);
  }
  const basePrefix = base.endsWith('/') ? base.slice(0, -1) : base;

  return (raw: string) => {
    let sitePath = raw.trim().split('?')[0].split('#')[0];
    if (basePrefix && sitePath.startsWith(basePrefix)) sitePath = sitePath.slice(basePrefix.length);
    if (decoded.has(sitePath)) return decoded.get(sitePath);

    let plain = sitePath;
    try {
      plain = decodeURIComponent(sitePath);
    } catch {
      /* keep the raw form */
    }
    const direct = decoded.get(plain);
    if (direct) return direct;

    return byName.get(fuzzyKey(plain));
  };
}

// ─── Attribute parsing ───────────────────────────────────────────────────────

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttrs(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  // Skip the tag name.
  const body = tag.replace(/^<\s*[a-zA-Z0-9-]+/, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(ATTR_RE)) {
    attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function serializeAttrs(attrs: Map<string, string>): string {
  const parts: string[] = [];
  for (const [name, value] of attrs) {
    parts.push(value === '' ? name : `${name}="${value.replace(/"/g, '&quot;')}"`);
  }
  return parts.join(' ');
}

// ─── <img> rewriting ─────────────────────────────────────────────────────────

function srcsetFrom(variants: { w: number; webp: string; avif?: string }[], kind: 'webp' | 'avif') {
  return variants
    .map((v) => (kind === 'webp' ? v.webp : v.avif))
    .map((url, i) => (url ? `${url} ${variants[i].w}w` : ''))
    .filter(Boolean)
    .join(', ');
}

/**
 * Rewrite one <img> to serve optimized derivatives.
 *
 * - `src` points at the largest WebP derivative, `srcset`/`sizes` let the
 *   browser pick a smaller width on small screens
 * - an AVIF <source> is added (wrapped in <picture>) when AVIF was generated
 * - width/height are always present so the layout never shifts
 * - everything past the first two images gets loading="lazy" decoding="async"
 */
export function rewriteImgTag(tag: string, resolve: ImageResolver, index: number): string {
  const attrs = parseAttrs(tag);
  const original = attrs.get('src') || attrs.get('data-src') || '';
  if (!original || /^(https?:)?\/\//i.test(original) || original.startsWith('data:')) {
    return tag;
  }

  const entry = resolve(original);
  const aboveFold = index < 2;

  if (!entry) {
    // Unknown image (not in the manifest): still stop layout shift and defer.
    if (!aboveFold) {
      attrs.set('loading', attrs.get('loading') ?? 'lazy');
      attrs.set('decoding', attrs.get('decoding') ?? 'async');
    }
    return `<img ${serializeAttrs(attrs)} />`;
  }

  const declaredWidth = Number(attrs.get('width'));
  const sizes =
    Number.isFinite(declaredWidth) && declaredWidth > 0 && declaredWidth <= FIXED_SIZE_THRESHOLD
      ? `${declaredWidth}px`
      : DEFAULT_SIZES;

  attrs.set('src', entry.src);
  if (attrs.has('data-src')) attrs.set('data-src', entry.src);
  attrs.set('srcset', srcsetFrom(entry.variants, 'webp'));
  attrs.set('sizes', sizes);
  if (!attrs.get('width')) attrs.set('width', String(entry.width));
  if (!attrs.get('height')) attrs.set('height', String(entry.height));
  attrs.set('decoding', aboveFold ? 'sync' : 'async');
  if (aboveFold) {
    attrs.delete('loading');
    if (index === 0) attrs.set('fetchpriority', 'high');
  } else {
    attrs.set('loading', 'lazy');
  }

  const img = `<img ${serializeAttrs(attrs)} />`;

  const avifSrcset = srcsetFrom(entry.variants, 'avif');
  if (!avifSrcset) return img;

  return `<picture><source type="image/avif" srcset="${avifSrcset}" sizes="${sizes}" />${img}</picture>`;
}

// ─── Whole-document rewriting ────────────────────────────────────────────────

/**
 * The mirrored markup hard-codes the old production origin in some links
 * (pagination, in-body cross-links). Make them root-relative so they follow
 * whatever domain and base path the build is deployed to.
 */
export function relativizeOrigin(html: string, origins: string[]): string {
  let out = html;
  for (const origin of origins) {
    out = out.split(`${origin}/`).join('/').split(origin).join('/');
  }
  return out;
}

/** Prefix every site-root-relative URL with the deploy base path. */
export function applyBasePath(html: string, base: string): string {
  if (base === '/') return html;
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  return (
    html
      // URL attributes starting with a single "/". The mirrored markup mixes
      // single and double quotes, so both are matched.
      .replace(
        /\b(href|src|data-src|action|poster|data-thumb|data-large_image)=(["'])\/(?!\/)/g,
        `$1=$2${prefix}/`,
      )
      // srcset lists: prefix each candidate URL
      .replace(/\bsrcset=(["'])([^"']*)\1/g, (_m, quote: string, list: string) =>
        `srcset=${quote}${list
          .split(',')
          .map((candidate) => candidate.trim())
          .filter(Boolean)
          .map((candidate) => (candidate.startsWith('/') ? `${prefix}${candidate}` : candidate))
          .join(', ')}${quote}`,
      )
      // inline style="background: url(/images/...)"
      .replace(/url\((['"]?)\/(?!\/)/g, `url($1${prefix}/`)
  );
}

/**
 * The mirrored pages still link a couple of WordPress plugin assets by their
 * original CMS path. Point them at the localized copies that actually ship.
 */
const LEGACY_ASSET_PATHS: [RegExp, string][] = [
  [/\/wp-content\/plugins\/menu-image\/menu-image\.css(\?[^"'\s>]*)?/g, '/css/menu-image.css'],
];

export function rewriteLegacyAssetPaths(html: string): string {
  let out = html;
  for (const [pattern, replacement] of LEGACY_ASSET_PATHS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Swap in the dealership's email and phone everywhere they appear. */
export function applyContactDetails(html: string): string {
  let out = html;
  for (const legacy of LEGACY_EMAILS) {
    out = out.split(legacy).join(CONTACT_EMAIL);
  }
  // Normalize the bare number to the dealership's published form, without
  // double-prefixing anything already written as 1-844-…
  out = out.replace(/(?<![\d-])844-844-3432/g, CONTACT_PHONE_DISPLAY);
  return out;
}

/**
 * The cloned markup posts its site search to a PHP endpoint. Static hosting
 * has no PHP, so point the form at the client-side search page instead.
 */
export function rewriteSearchForms(html: string): string {
  return html
    .replace(/<form([^>]*)action=(["'])\/search\.php\2([^>]*)>/gi, '<form$1action="/search/"$3>')
    .replace(/<input[^>]*\bname=(["'])cat\1[^>]*>/gi, '');
}

/** Rewrite every <img> in a document, numbering them for the lazy heuristic. */
export function rewriteImages(html: string, resolve: ImageResolver): string {
  let index = 0;
  return html.replace(/<img\b[^>]*>/gi, (tag) => rewriteImgTag(tag, resolve, index++));
}

/**
 * Rewrite bare `/images/...` references that are not <img> attributes —
 * inline styles, data attributes, <meta content>, and so on.
 */
export function rewriteLooseImageRefs(html: string, resolve: ImageResolver): string {
  return html.replace(/\/(?:images|uploads)\/[^"'()\s\\>]+\.(?:png|jpe?g|webp)/gi, (match) => {
    const entry = resolve(match);
    return entry ? entry.src : match;
  });
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

/** Point url() image references at the optimized WebP derivatives. */
export function rewriteCssImages(css: string, resolve: ImageResolver): string {
  return css.replace(/url\((\s*['"]?)([^'")]+)(['"]?\s*)\)/g, (match, open, url: string, close) => {
    if (!url.startsWith('/images/') && !url.startsWith('/uploads/')) return match;
    const entry = resolve(url);
    return entry ? `url(${open}${entry.src}${close})` : match;
  });
}

/**
 * Keep only the woff2 source in every @font-face and force font-display:swap.
 * `converted` maps a legacy font URL to a build-generated woff2 replacement.
 */
export function rewriteFontFaces(css: string, converted: Record<string, string>): string {
  return css.replace(/@font-face\s*\{[^}]*\}/gi, (block) => {
    const urls = [...block.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
    if (urls.length === 0) return block; // local()-only fallback face

    const woff2 =
      urls.find((u) => u.split('?')[0].endsWith('.woff2')) ??
      urls.map((u) => converted[u.split('?')[0]]).find(Boolean);
    if (!woff2) return block;

    let out = block.replace(/src\s*:[^;}]*;?/gi, '');
    out = out.replace(/font-display\s*:[^;}]*;?/gi, '');
    out = out.replace(
      /\}$/,
      `src:url("${woff2}") format("woff2");font-display:swap;}`,
    );
    return out;
  });
}

/**
 * `<picture>` wrappers must not change layout or break the cloned CSS, so:
 * make the wrapper transparent to layout, and teach every `> img` selector to
 * also match `> picture > img`.
 */
export function addPictureCompat(css: string): string {
  const withPictureSelectors = css.replace(/([^{}@;]+)\{/g, (match, selectorList: string) => {
    if (!/>\s*img\b/.test(selectorList)) return match;
    const extra = selectorList
      .split(',')
      .map((s) => s.trim())
      .filter((s) => />\s*img\b/.test(s))
      .map((s) => s.replace(/>\s*img\b/g, '>picture>img'));
    if (extra.length === 0) return match;
    return `${selectorList.trimEnd()},${extra.join(',')}{`;
  });
  return `picture{display:contents}\n${withPictureSelectors}`;
}

export { CONTACT_EMAIL, CONTACT_PHONE_DISPLAY, DEFAULT_SIZES };
