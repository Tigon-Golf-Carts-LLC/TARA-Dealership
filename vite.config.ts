import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { basePath } from './shared/site.ts';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// GitHub Pages base path. "/" for a custom domain or <user>.github.io,
// "/<repo-name>/" for a project site. Everything downstream (asset URLs,
// internal links, prerendered HTML) is derived from this single value.
const base = basePath(process.env);

export default defineConfig({
  base,
  root: path.resolve(rootDir, 'client'),
  publicDir: path.resolve(rootDir, 'client/public'),
  appType: 'spa',
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'client/src'),
      '@shared': path.resolve(rootDir, 'shared'),
    },
    dedupe: ['react', 'react-dom'],
  },
  plugins: [react()],
  build: {
    outDir: path.resolve(rootDir, 'dist'),
    emptyOutDir: true,
    // Minify JS with esbuild and CSS with lightningcss-free esbuild pipeline.
    minify: 'esbuild',
    cssMinify: true,
    sourcemap: false,
    assetsInlineLimit: 4096,
    // Warn early if a chunk creeps past a size that would hurt first paint.
    chunkSizeWarningLimit: 300,
    rollupOptions: {
      output: {
        // Split the React runtime away from app code so a content edit does
        // not invalidate the vendor chunk.
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'react-vendor';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    host: '0.0.0.0',
  },
  preview: {
    port: Number(process.env.PORT) || 4173,
    host: '0.0.0.0',
  },
});
