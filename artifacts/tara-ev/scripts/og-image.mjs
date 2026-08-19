import fs from 'node:fs';
import path from 'node:path';
import { readImageDimensions } from './image-dimensions.mjs';

export const DEFAULT_OG_IMAGE = '/images/hero-black-golf-cart-course.webp';
export const MIN_OG_IMAGE_WIDTH = 1200;
export const MIN_OG_IMAGE_HEIGHT = 630;

export function getLocalOgImageDimensions(ogImage, publicDir) {
  if (!ogImage.startsWith('/')) return null;
  const imagePath = path.resolve(publicDir, `.${ogImage}`);
  if (!imagePath.startsWith(`${publicDir}${path.sep}`) || !fs.existsSync(imagePath)) {
    return null;
  }
  return readImageDimensions(imagePath);
}

export function isLargeOgImage(ogImage, publicDir) {
  const dimensions = getLocalOgImageDimensions(ogImage, publicDir);
  return Boolean(
    dimensions &&
      dimensions.width >= MIN_OG_IMAGE_WIDTH &&
      dimensions.height >= MIN_OG_IMAGE_HEIGHT,
  );
}

export function extractOgImage(contentHtml, publicDir) {
  const skip = /logo|favicon|menu-image|icon/i;
  for (const match of contentHtml.matchAll(/src=["']([^"']+\.(?:webp|jpg|jpeg|png))["']/gi)) {
    const src = match[1];
    if (skip.test(src)) continue;
    if (
      (src.startsWith('/images/') || src.startsWith('/uploads/')) &&
      isLargeOgImage(src, publicDir)
    ) {
      return src;
    }
  }
  return DEFAULT_OG_IMAGE;
}

export function resolveOgImage(routeOgImage, contentHtml, publicDir) {
  return routeOgImage || extractOgImage(contentHtml, publicDir);
}