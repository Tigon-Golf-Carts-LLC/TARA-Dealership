#!/usr/bin/env node
/**
 * Turns route images that are too small for social previews into 1200×630
 * letterboxed JPEGs. Route metadata stores the original in ogImageSource and
 * the generated file in ogImage, preserving article-specific imagery while
 * satisfying Facebook, LinkedIn, and X preview requirements.
 *
 * Run after changing route images:
 *   node scripts/social-og-images.mjs
 * Verify without writing:
 *   node scripts/social-og-images.mjs --check
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isLargeOgImage,
  MIN_OG_IMAGE_HEIGHT,
  MIN_OG_IMAGE_WIDTH,
  socialDerivativePath,
} from './og-image.mjs';

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(artifactDir, 'public');
const routesPath = path.join(publicDir, 'content', 'routes.json');
const checkOnly = process.argv.includes('--check');
const generatedDir = path.join(publicDir, 'images', 'og');

function isLocalImage(imagePath) {
  return typeof imagePath === 'string' && imagePath.startsWith('/');
}

function createDerivative(sourceImage, outputImage) {
  const inputPath = path.resolve(publicDir, `.${sourceImage}`);
  const outputPath = path.resolve(publicDir, `.${outputImage}`);
  if (!inputPath.startsWith(`${publicDir}${path.sep}`) || !fs.existsSync(inputPath)) {
    throw new Error(`source image does not exist: ${sourceImage}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  // Keep the image’s complete subject visible and pad with brand-black rather
  // than cropping an article photo into an arbitrary social-card frame.
  execFileSync(
    'magick',
    [
      inputPath,
      '-resize',
      '1150x560',
      '-background',
      '#000000',
      '-gravity',
      'center',
      '-extent',
      `${MIN_OG_IMAGE_WIDTH}x${MIN_OG_IMAGE_HEIGHT}`,
      '-quality',
      '88',
      outputPath,
    ],
    { stdio: 'inherit' },
  );
}

const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
let generated = 0;
let remapped = 0;
let removed = 0;
const expectedDerivatives = new Set();

for (const [routePath, routeMeta] of Object.entries(routes)) {
  if (routeMeta.redirect || !routeMeta.file || !isLocalImage(routeMeta.ogImage)) continue;

  const sourceImage = routeMeta.ogImageSource || routeMeta.ogImage;
  if (!isLocalImage(sourceImage)) {
    throw new Error(`${routePath}: ogImageSource must be a local image path`);
  }

  if (isLargeOgImage(sourceImage, publicDir)) {
    if (routeMeta.ogImageSource) {
      delete routeMeta.ogImageSource;
      routeMeta.ogImage = sourceImage;
      remapped += 1;
    }
    continue;
  }

  const outputImage = socialDerivativePath(sourceImage, publicDir);
  expectedDerivatives.add(outputImage);
  const outputPath = path.resolve(publicDir, `.${outputImage}`);
  if (!fs.existsSync(outputPath)) {
    if (checkOnly) {
      throw new Error(`${routePath}: social derivative is missing: ${outputImage}`);
    }
    createDerivative(sourceImage, outputImage);
    generated += 1;
  }

  if (routeMeta.ogImage !== outputImage || routeMeta.ogImageSource !== sourceImage) {
    routeMeta.ogImageSource = sourceImage;
    routeMeta.ogImage = outputImage;
    remapped += 1;
  }
}

if (fs.existsSync(generatedDir)) {
  for (const fileName of fs.readdirSync(generatedDir)) {
    if (!/^[a-f0-9]{16}\.jpg$/.test(fileName)) continue;
    const publicPath = `/images/og/${fileName}`;
    if (expectedDerivatives.has(publicPath)) continue;
    if (checkOnly) {
      throw new Error(`orphaned social derivative must be removed: ${publicPath}`);
    }
    fs.unlinkSync(path.join(generatedDir, fileName));
    removed += 1;
  }
}

const serialized = `${JSON.stringify(routes, null, 2)}\n`;
const current = fs.readFileSync(routesPath, 'utf8');
if (checkOnly) {
  if (current !== serialized) {
    throw new Error('routes.json has stale social-image metadata; run social-og-images.mjs');
  }
  console.log('[social-og] OK: all routes use social-preview-safe images.');
} else {
  fs.writeFileSync(routesPath, serialized, 'utf8');
  console.log(
    `[social-og] generated ${generated}, removed ${removed}, and remapped ${remapped} routes.`,
  );
}