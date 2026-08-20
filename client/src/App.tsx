/**
 * Static-site boot logic.
 *
 * Every route is prerendered to a real HTML file at build time, so the page
 * content is already in the DOM when this runs. This module only *enhances*
 * what is already there: it loads the site's original behaviour script
 * (menus, sliders, tabs), wires the product colour picker, and injects the
 * JSON-LD graph.
 *
 * It makes no same-origin API calls. The only fetches are for static JSON and
 * static HTML shipped in the build output, and they only happen on the 404
 * fallback path — when a URL was not prerendered.
 */
import { basePath, isRedirect, type RouteMeta, type RoutesSnapshot } from '@shared/site.ts';
import { initSearchPage } from './search.ts';
import { callNowHtml, pageChromeHtml } from './siteChrome.ts';
import { injectStructuredData, setSiteUrl } from './structuredData.ts';

const BASE = basePath({ BASE_PATH: import.meta.env.BASE_URL });
const BASE_PREFIX = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;

/** Strip the deploy base path and normalise to a trailing-slash route key. */
export function normalizePath(pathname: string): string {
  let route = pathname;
  if (BASE_PREFIX && route.startsWith(BASE_PREFIX)) {
    route = route.slice(BASE_PREFIX.length) || '/';
  }
  if (!route.startsWith('/')) route = `/${route}`;
  if (route !== '/' && !route.endsWith('/')) route += '/';
  return route;
}

function lookupRoute(routes: RoutesSnapshot, route: string) {
  if (routes[route]) return routes[route];
  let decoded: string;
  try {
    decoded = decodeURIComponent(route);
  } catch {
    return null;
  }
  for (const key of Object.keys(routes)) {
    try {
      if (decodeURIComponent(key) === decoded) return routes[key];
    } catch {
      /* skip malformed keys */
    }
  }
  return null;
}

/**
 * Load the original jQuery bundle that powers the cloned site's menus,
 * sliders and tabs. It binds on DOMContentLoaded/load, both of which have
 * already fired, so replay them once it is ready.
 */
function loadBehaviourScripts() {
  const script = document.createElement('script');
  script.src = `${BASE}js/jquery.min_index.js`;
  script.async = false;
  script.onload = () => {
    document.dispatchEvent(new Event('DOMContentLoaded'));
    window.dispatchEvent(new Event('load'));
  };
  document.body.appendChild(script);

  if (document.getElementById('fin-price')) {
    const financing = document.createElement('script');
    financing.src = `${BASE}js/financing.js`;
    financing.defer = true;
    document.body.appendChild(financing);
  }
}

/**
 * Product pages show one vehicle image per colour. The original site drove
 * this with a Swiper instance the cloned bundle never initialises, so wire the
 * colour list to the slides directly.
 */
function initProductColorPicker(root: ParentNode) {
  const slides = root.querySelectorAll<HTMLElement>('.pro_img .swiper-slide');
  const colors = root.querySelectorAll<HTMLElement>('.pro_color li');
  if (slides.length === 0) return;

  const select = (index: number) => {
    slides.forEach((slide, i) => slide.classList.toggle('color-active', i === index));
    colors.forEach((color, i) => color.classList.toggle('color-active', i === index));
  };
  select(0);
  colors.forEach((li, i) => li.addEventListener('click', () => select(i)));
}

/** Append the shared chrome when a page was not prerendered with it. */
function ensureChrome(container: HTMLElement) {
  if (!document.getElementById('tara-footer')) {
    container.insertAdjacentHTML('beforeend', pageChromeHtml(BASE, new Date().getFullYear()));
  }
  if (!document.getElementById('tara-call-now')) {
    document.body.insertAdjacentHTML('beforeend', callNowHtml());
  }
}

function setMeta(attribute: 'name' | 'property' | 'itemprop', key: string, content: string) {
  let element = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

/** Fallback path: a URL that was served by 404.html. */
async function renderFromSnapshot(container: HTMLElement, route: string) {
  const response = await fetch(`${BASE}data/routes.json`);
  const routes = (await response.json()) as RoutesSnapshot;
  const entry = lookupRoute(routes, route);

  if (!entry) {
    container.innerHTML =
      '<main class="tara-notfound"><h1>Page not found</h1>' +
      '<p>That page is not part of TARA Dealership. Try the <a href="' +
      `${BASE}">home page</a> or <a href="${BASE}search/">search the site</a>.</p></main>`;
    ensureChrome(container);
    return;
  }

  if (isRedirect(entry)) {
    window.location.replace(`${BASE_PREFIX}${entry.redirect}${window.location.search}`);
    return;
  }

  const meta = entry as RouteMeta;
  const page = await fetch(`${BASE}content/${encodeURIComponent(meta.file)}`);
  if (!page.ok) {
    window.location.replace(BASE);
    return;
  }

  container.innerHTML = await page.text();
  document.title = meta.title;
  if (meta.description) {
    setMeta('name', 'description', meta.description);
    setMeta('property', 'og:description', meta.description);
    setMeta('name', 'twitter:description', meta.description);
  }
  setMeta('property', 'og:title', meta.title);
  setMeta('name', 'twitter:title', meta.title);
  if (meta.bodyClass) document.body.className = meta.bodyClass;

  ensureChrome(container);
  injectStructuredData(route, meta.title);
  initProductColorPicker(container);
  loadBehaviourScripts();
}

export async function initApp(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) return;

  const route = normalizePath(window.location.pathname);
  setSiteUrl(`${window.location.origin}${BASE_PREFIX}`);

  // The happy path: this URL was prerendered, so the content, the chrome and
  // the head metadata are already correct. Nothing is fetched.
  if (container.dataset.prerendered === '1' && container.dataset.route === route) {
    injectStructuredData(route, document.title);
    initProductColorPicker(container);
    if (route === '/search/') await initSearchPage(BASE);
    loadBehaviourScripts();
    return;
  }

  // 404.html served this URL. Resolve it against the snapshot.
  try {
    await renderFromSnapshot(container, route);
  } catch (error) {
    console.error('[tara] could not resolve route', route, error);
    window.location.replace(BASE);
  }
}
