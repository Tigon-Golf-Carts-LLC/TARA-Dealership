/** Minimal ambient types for build-only dependencies that ship no .d.ts. */

declare module 'html-minifier-terser' {
  export interface Options {
    [option: string]: unknown;
  }
  export function minify(value: string, options?: Options): Promise<string>;
}

declare module 'wawoff2' {
  /** TTF/OTF → WOFF2. */
  export function compress(input: Uint8Array): Promise<Uint8Array>;
  /** WOFF2 → TTF. */
  export function decompress(input: Uint8Array): Promise<Uint8Array>;
}
