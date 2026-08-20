/**
 * Client-side site search.
 *
 * The cloned site posted its search box to /search.php. Static hosting has no
 * PHP, so the build ships a small search index (data/search-index.json) and
 * this module scores it in the browser.
 */
import type { SearchDoc } from '@shared/site.ts';

const MAX_RESULTS = 40;

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((term) => term.length > 1);
}

function score(doc: SearchDoc, terms: string[]): number {
  const title = doc.t.toLowerCase();
  const description = doc.d.toLowerCase();
  let total = 0;
  for (const term of terms) {
    let termScore = 0;
    if (title.includes(term)) termScore += 10;
    if (description.includes(term)) termScore += 4;
    const bodyHits = doc.b.split(term).length - 1;
    termScore += Math.min(bodyHits, 5);
    if (termScore === 0) return 0; // every term must appear somewhere
    total += termScore;
  }
  return total;
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render(container: HTMLElement, base: string, query: string, results: SearchDoc[]) {
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  if (results.length === 0) {
    container.innerHTML =
      `<p class="tara-search-empty">No pages matched <strong>${escape(query)}</strong>. ` +
      'Try a model name such as “Turfman 700”, or call us at 1-844-844-3432.</p>';
    return;
  }
  container.innerHTML =
    `<p class="tara-search-count">${results.length} result${results.length === 1 ? '' : 's'} for ` +
    `<strong>${escape(query)}</strong></p><ul class="tara-search-list">` +
    results
      .map(
        (doc) =>
          `<li><a href="${prefix}${doc.u}">${escape(doc.t)}</a><p>${escape(doc.d)}</p></li>`,
      )
      .join('') +
    '</ul>';
}

/** Wire up the /search/ page: read ?s=, score the index, render results. */
export async function initSearchPage(base: string): Promise<void> {
  const container = document.getElementById('tara-search-results');
  if (!container) return;

  const query = (new URLSearchParams(window.location.search).get('s') ?? '').trim();
  const input = document.getElementById('tara-search-input') as HTMLInputElement | null;
  if (input) input.value = query;
  if (!query) return;

  document.title = `Search: ${query} | TARA Dealership`;
  container.innerHTML = '<p class="tara-search-loading">Searching…</p>';

  const terms = tokenize(query);
  if (terms.length === 0) {
    render(container, base, query, []);
    return;
  }

  try {
    const response = await fetch(`${base}data/search-index.json`);
    const docs = (await response.json()) as SearchDoc[];
    const results = docs
      .map((doc) => ({ doc, value: score(doc, terms) }))
      .filter((hit) => hit.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, MAX_RESULTS)
      .map((hit) => hit.doc);
    render(container, base, query, results);
  } catch {
    container.innerHTML =
      '<p class="tara-search-empty">Search is unavailable right now. ' +
      'Call us at 1-844-844-3432 and we will help you find it.</p>';
  }
}
