/**
 * Shared site constants and types.
 *
 * Imported by both the client bundle and the build scripts, so it must stay
 * free of any Node-only imports.
 */

/** Canonical site name — used for <title>, og:site_name and schema.org. */
export const SITE_NAME = 'TARA Dealership';

/** Default document title. */
export const SITE_TITLE = 'TARA Dealership';

/** Default meta/OG description. */
export const SITE_DESCRIPTION =
  'TARA Dealership. Your Local TARA Golf Cart Dealership.';

/** Public-facing sales email (used for every mailto: on the site). */
export const CONTACT_EMAIL = 'taradealership@gmail.com';

/** Public-facing phone number, display form. */
export const CONTACT_PHONE_DISPLAY = '1-844-844-3432';

/** Public-facing phone number, tel: href form. */
export const CONTACT_PHONE_HREF = 'tel:+18448443432';

/** Public-facing phone number, schema.org / E.164-ish form. */
export const CONTACT_PHONE_E164 = '+1-844-844-3432';

/** Social preview image (relative to the site root, before base-path rewrite). */
export const DEFAULT_OG_IMAGE = '/images/og-image.png';

/** Favicon source image — the site icon, also used to mint favicon.ico. */
export const SITE_ICON_SOURCE = 'assets-src/images/tara-dealership-logo.png';

/**
 * Production origin. Overridden at build time by the SITE_DOMAIN env var so
 * the GitHub Actions workflow can point canonical/OG URLs at the live host.
 */
export function siteOrigin(env: Record<string, string | undefined> = {}): string {
  const domain = env.SITE_DOMAIN?.trim();
  if (!domain) return 'https://taradealership.com';
  if (/^https?:\/\//i.test(domain)) return domain.replace(/\/+$/, '');
  return `https://${domain.replace(/\/+$/, '')}`;
}

/**
 * Base path the site is served from. "/" for a custom domain or
 * <user>.github.io; "/<repo-name>/" for a project site.
 */
export function basePath(env: Record<string, string | undefined> = {}): string {
  const raw = env.BASE_PATH?.trim() || '/';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

/** Route metadata as stored in the build-time snapshot. */
export type RouteMeta = {
  file: string;
  title: string;
  description: string;
  ogImage: string;
  ogImageSource?: string;
  bodyClass: string;
};

/** Alias routes that redirect to a canonical URL. */
export type RouteRedirect = { redirect: string };

export type RouteEntry = RouteMeta | RouteRedirect;

export type RoutesSnapshot = Record<string, RouteEntry>;

export function isRedirect(entry: RouteEntry): entry is RouteRedirect {
  return 'redirect' in entry;
}

/** One responsive derivative of a source image. */
export type ImageVariant = {
  /** Rendered width in pixels. */
  w: number;
  /** Site-root-relative WebP path. */
  webp: string;
  /** Site-root-relative AVIF path, when one was generated. */
  avif?: string;
};

/** Optimized-image manifest entry, keyed by the original `/images/...` path. */
export type ImageManifestEntry = {
  /** Largest WebP derivative — the `src` fallback. */
  src: string;
  /** Intrinsic width of `src`. */
  width: number;
  /** Intrinsic height of `src`. */
  height: number;
  /** Responsive derivatives, ascending by width. */
  variants: ImageVariant[];
};

export type ImageManifest = Record<string, ImageManifestEntry>;

/** One entry of the client-side search index. */
export type SearchDoc = {
  /** Route path, e.g. "/about-us/". */
  u: string;
  /** Title. */
  t: string;
  /** Short description. */
  d: string;
  /** Lower-cased searchable body text. */
  b: string;
};

/** A vehicle model from the TARA model catalog snapshot. */
export type ModelSnapshot = {
  slug: string;
  name: string;
  series?: string;
  specs: Record<string, string>;
  colors: string[];
  route?: string;
};
