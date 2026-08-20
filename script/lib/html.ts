import { minify } from 'html-minifier-terser';

/** Escape a string for use inside an HTML attribute or text node. */
export function escHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Reverse of escHtml, for reading values back out of generated markup. */
export function unescHtml(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Escape a string for XML text/attribute content. */
export function escXml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Replace a matching tag if present, otherwise insert it before </head>. */
export function upsertMeta(html: string, matcher: RegExp, tag: string): string {
  return matcher.test(html)
    ? html.replace(matcher, tag)
    : html.replace('</head>', `  ${tag}\n</head>`);
}

/**
 * Minify a full HTML document. Conservative settings: the site's cloned
 * markup relies on inline-element whitespace, so only safe collapsing is on.
 */
export async function minifyHtml(html: string): Promise<string> {
  return minify(html, {
    // The mirrored markup contains literal "<<" / "Next >" pagination glyphs
    // that are not valid tags; recover from those instead of aborting.
    continueOnParseError: true,
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
    removeRedundantAttributes: false,
    minifyCSS: true,
    minifyJS: true,
    keepClosingSlash: true,
    sortAttributes: false,
    sortClassName: false,
  });
}
