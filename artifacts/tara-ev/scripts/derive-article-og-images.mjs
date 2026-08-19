#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLargeOgImage, socialDerivativePath } from './og-image.mjs';

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(artifactDir, 'public');
const contentDir = path.join(publicDir, 'content');
const routesPath = path.join(contentDir, 'routes.json');
const checkOnly = process.argv.includes('--check');

const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
const blogNewsRoutePattern = /^\/(blog|news)\//;
const articleImageByRoute = new Map();

function listPublicImages(dir, publicPath = '') {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(dir, entry.name);
    const routePath = `${publicPath}/${entry.name}`;
    return entry.isDirectory()
      ? listPublicImages(filePath, routePath)
      : [routePath];
  });
}

const publicImages = [
  ...listPublicImages(path.join(publicDir, 'images'), '/images'),
  ...listPublicImages(path.join(publicDir, 'uploads'), '/uploads'),
];
const localImageByBasename = new Map(
  publicImages.map((imagePath) => [path.basename(imagePath).toLowerCase(), imagePath]),
);

function socialPreviewImage(sourceImage) {
  return isLargeOgImage(sourceImage, publicDir)
    ? sourceImage
    : socialDerivativePath(sourceImage, publicDir);
}

function contentFor(routePath, routeMeta) {
  if (!routeMeta.file) {
    throw new Error(`Route "${routePath}" has no content file`);
  }

  const contentPath = path.join(contentDir, routeMeta.file);
  if (!fs.existsSync(contentPath)) {
    throw new Error(`Content file does not exist for "${routePath}": ${routeMeta.file}`);
  }
  return fs.readFileSync(contentPath, 'utf8');
}

function firstImage(html) {
  return html.match(/<img\b[^>]*\bsrc=["']([^"']+)/i)?.[1] ?? null;
}

function normalizeLocalImage(routePath, imageSrc) {
  let pathname;
  try {
    pathname = new URL(imageSrc, 'https://taradealership.com').pathname;
  } catch {
    pathname = imageSrc.split(/[?#]/, 1)[0];
  }

  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    // Keep the original path when legacy filenames contain invalid escapes.
  }

  const directPath = path.join(publicDir, decodedPathname.replace(/^\//, ''));
  if (
    (decodedPathname.startsWith('/images/') || decodedPathname.startsWith('/uploads/')) &&
    fs.existsSync(directPath)
  ) {
    return decodedPathname;
  }

  const sourceBasename = path.basename(decodedPathname).toLowerCase();
  const localMatch =
    localImageByBasename.get(sourceBasename) ??
    publicImages.find((imagePath) =>
      path.basename(imagePath).toLowerCase().endsWith(`-${sourceBasename}`),
    );
  if (localMatch) return localMatch;

  throw new Error(
    `Could not map article image to a local file for "${routePath}": ${imageSrc}`,
  );
}

for (const [routePath, routeMeta] of Object.entries(routes)) {
  if (!blogNewsRoutePattern.test(routePath)) continue;

  const contentHtml = contentFor(routePath, routeMeta);
  const articleHtml = contentHtml.match(/<article\b[\s\S]*?<\/article>/i)?.[0];
  if (!articleHtml) continue;

  const imageSrc = firstImage(articleHtml);
  if (!imageSrc) {
    throw new Error(`Article "${routePath}" has no image inside its <article> block`);
  }
  articleImageByRoute.set(
    routePath,
    normalizeLocalImage(routePath, imageSrc),
  );
}

let changed = 0;
let covered = 0;

for (const [routePath, routeMeta] of Object.entries(routes)) {
  if (!blogNewsRoutePattern.test(routePath)) continue;

  const contentHtml = contentFor(routePath, routeMeta);
  let sourceImage = articleImageByRoute.get(routePath);

  if (!sourceImage) {
    const firstLinkedArticle = contentHtml.match(
      /<li\b[^>]*class=["'][^"']*\bblog-item\b[^"']*["'][\s\S]*?href=["'](\/(?:blog|news)\/[^"']+)/i,
    )?.[1];
    sourceImage = firstLinkedArticle
      ? articleImageByRoute.get(firstLinkedArticle)
      : (routeMeta.ogImageSource ?? routeMeta.ogImage);
  }

  if (!sourceImage) {
    throw new Error(
      `Could not derive an ogImage for blog/news route "${routePath}"`,
    );
  }

  const ogImage = socialPreviewImage(sourceImage);
  const ogFile = path.join(publicDir, ogImage.replace(/^\//, ''));
  if (!fs.existsSync(ogFile)) {
    throw new Error(`Derived ogImage does not exist for "${routePath}": ${ogImage}`);
  }

  covered++;
  if (routeMeta.ogImage !== ogImage) changed++;

  const { title, ...metaBeforeTitle } = routeMeta;
  if (ogImage === sourceImage) {
    delete metaBeforeTitle.ogImageSource;
  } else {
    metaBeforeTitle.ogImageSource = sourceImage;
  }
  routes[routePath] = { ...metaBeforeTitle, ogImage, title };
}

const serialized = `${JSON.stringify(routes, null, 2)}\n`;
const current = fs.readFileSync(routesPath, 'utf8');

if (checkOnly) {
  if (current !== serialized) {
    console.error(
      `[article-og] ${changed} blog/news route(s) have missing or stale ogImage metadata.`,
    );
    console.error('Run: node scripts/derive-article-og-images.mjs');
    process.exit(1);
  }
  console.log(`[article-og] OK: ${covered} blog/news routes have derived local images.`);
} else {
  fs.writeFileSync(routesPath, serialized, 'utf8');
  console.log(`[article-og] Updated ${changed} of ${covered} blog/news routes.`);
}