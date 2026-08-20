import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Vite root — the frontend. */
export const CLIENT_DIR = path.join(ROOT, 'client');

/** Static files copied verbatim into dist/. */
export const PUBLIC_DIR = path.join(CLIENT_DIR, 'public');

/** Build-time snapshot JSON written by script/fetch-data.ts. */
export const DATA_DIR = path.join(PUBLIC_DIR, 'data');

/** Extracted page HTML for the content mirror (one file per route). */
export const CONTENT_DIR = path.join(PUBLIC_DIR, 'content');

/** Source of truth for the route table (never shipped as-is). */
export const ROUTES_SOURCE = path.join(ROOT, 'content-src', 'routes.json');

/** Raw, unoptimized image originals. Never deployed. */
export const IMAGE_SOURCE_DIR = path.join(ROOT, 'assets-src', 'images');

/** Optimized image derivatives, generated into publicDir (git-ignored). */
export const IMAGE_OUT_DIR = path.join(PUBLIC_DIR, 'images');

/** Image manifest written by optimize-assets and read by prerender. */
export const IMAGE_MANIFEST = path.join(DATA_DIR, 'image-manifest.json');

/** Vite build output. */
export const DIST_DIR = path.join(ROOT, 'dist');

/** Reference catalog of TARA vehicle models (specs.json per model). */
export const MODEL_CATALOG_DIR = path.join(ROOT, 'TARA Golf Cart Models');
