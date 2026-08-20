#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getLocalOgImageDimensions,
  MIN_OG_IMAGE_HEIGHT,
  MIN_OG_IMAGE_WIDTH,
  resolveOgImage,
} from './og-image.mjs';

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(artifactDir, 'public');
const routesPath = path.join(publicDir, 'content', 'routes.json');

const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
const checkedImages = new Map();
let checkedRoutes = 0;
let failed = false;

for (const [routePath, routeMeta] of Object.entries(routes)) {
  if (routeMeta.redirect || !routeMeta.file) continue;
  checkedRoutes += 1;

  const contentPath = path.join(publicDir, 'content', routeMeta.file);
  if (!fs.existsSync(contentPath)) {
    console.error(
      `[og-images] ${routePath}: content file does not exist: "${routeMeta.file}"`,
    );
    failed = true;
    continue;
  }

  const contentHtml = fs.readFileSync(contentPath, 'utf8');
  const ogImage = resolveOgImage(routeMeta.ogImage, contentHtml, publicDir);
  if (!ogImage.startsWith('/')) {
    console.error(
      `[og-images] ${routePath}: effective ogImage must be a local public path, got "${ogImage}"`,
    );
    failed = true;
    continue;
  }

  const imagePath = path.resolve(publicDir, `.${ogImage}`);
  if (!imagePath.startsWith(`${publicDir}${path.sep}`)) {
    console.error(
      `[og-images] ${routePath}: effective ogImage escapes public/: "${ogImage}"`,
    );
    failed = true;
    continue;
  }

  let result = checkedImages.get(imagePath);
  if (!result) {
    try {
      if (!fs.existsSync(imagePath)) {
        throw new Error('file does not exist');
      }
      const dimensions = getLocalOgImageDimensions(ogImage, publicDir);
      if (!dimensions) throw new Error('image dimensions could not be read');
      result = { ...dimensions };
    } catch (error) {
      result = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
    checkedImages.set(imagePath, result);
  }

  if (result.error) {
    console.error(
      `[og-images] ${routePath}: cannot inspect "${ogImage}": ${result.error}`,
    );
    failed = true;
    continue;
  }

  if (result.width < MIN_OG_IMAGE_WIDTH || result.height < MIN_OG_IMAGE_HEIGHT) {
    console.error(
      `[og-images] ${routePath}: "${ogImage}" is ${result.width}x${result.height}; ` +
        `shared-link images must be at least ${MIN_OG_IMAGE_WIDTH}x${MIN_OG_IMAGE_HEIGHT}`,
    );
    failed = true;
  }
}

if (failed) process.exit(1);

console.log(
  `[og-images] OK: ${checkedRoutes} effective route images (${checkedImages.size} unique) ` +
    `are at least ${MIN_OG_IMAGE_WIDTH}x${MIN_OG_IMAGE_HEIGHT}`,
);