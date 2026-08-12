import { useEffect, useRef, useState } from 'react';
import { mountInquiryForm } from './inquiryForm';

const BASE = import.meta.env.BASE_URL; // e.g. "/"

type RouteMeta = { file: string; title: string; bodyClass: string };
type Routes = Record<string, RouteMeta>;

function normalizePath(p: string): string {
  let path = p;
  if (BASE !== '/' && path.startsWith(BASE.replace(/\/$/, ''))) {
    path = path.slice(BASE.replace(/\/$/, '').length) || '/';
  }
  if (!path.startsWith('/')) path = '/' + path;
  if (path !== '/' && !path.endsWith('/')) path += '/';
  return path;
}

function lookupRoute(routes: Routes, path: string): RouteMeta | null {
  if (routes[path]) return routes[path];
  // tolerate percent-encoding case differences
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
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

/** Pages that should show the self-hosted inquiry form. */
const FORM_PAGES = new Set(['/contact/']);

/** Wire the product color list to the vehicle image slides (one image per color). */
function initProductColorPicker(root: HTMLElement) {
  const slides = root.querySelectorAll<HTMLElement>('.pro_img .swiper-slide');
  const colors = root.querySelectorAll<HTMLElement>('.pro_color li');
  if (slides.length === 0) return;

  const select = (idx: number) => {
    slides.forEach((s, i) => s.classList.toggle('color-active', i === idx));
    colors.forEach((c, i) => c.classList.toggle('color-active', i === idx));
  };
  select(0);
  colors.forEach((li, i) => li.addEventListener('click', () => select(i)));
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>(
    'loading',
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const path = normalizePath(window.location.pathname);
      try {
        const routesRes = await fetch(`${BASE}content/routes.json`);
        const routes: Routes = await routesRes.json();
        const meta = lookupRoute(routes, path);
        if (!meta) {
          // No 404 page — send unknown URLs to the home page.
          if (!cancelled && path !== '/') window.location.replace(BASE);
          if (!cancelled) setStatus('notfound');
          return;
        }
        const res = await fetch(
          `${BASE}content/${encodeURIComponent(meta.file)}`,
        );
        if (!res.ok) {
          if (!cancelled) setStatus('notfound');
          return;
        }
        const html = await res.text();
        if (cancelled || !containerRef.current) return;

        document.title = meta.title;
        if (meta.bodyClass) document.body.className = meta.bodyClass;
        containerRef.current.innerHTML = html;
        setStatus('ready');

        // Load the site's original behavior script (menus, sliders, tabs).
        const siteScript = document.createElement('script');
        siteScript.src = `${BASE}js/jquery.min_index.js`;
        siteScript.async = false;
        // The site script attaches its menu/slider handlers on
        // DOMContentLoaded / load, which already fired before we injected
        // the page content — so re-dispatch them once the script is ready.
        siteScript.onload = () => {
          document.dispatchEvent(new Event('DOMContentLoaded'));
          window.dispatchEvent(new Event('load'));
        };
        document.body.appendChild(siteScript);

        // Product pages: show one vehicle image per selected color.
        // The original site used a Swiper synced to the color list; the
        // cloned bundle doesn't initialize it, so wire it up directly.
        initProductColorPicker(containerRef.current);

        // On contact (and similar) pages, inject the self-hosted inquiry form
        // after the article content. The original Mautic embed was removed at
        // the client's request; this replaces it with a form routed through
        // the project's api-server → Gmail.
        if (FORM_PAGES.has(path) && containerRef.current) {
          const article = containerRef.current.querySelector(
            'article.entry, .web_main .layout',
          );
          if (article) {
            const slot = document.createElement('div');
            slot.id = 'tara-inquiry-form';
            article.insertAdjacentElement('afterend', slot);
            mountInquiryForm(slot);
          }
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setStatus('notfound');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div ref={containerRef} />
      {status === 'loading' && (
        <div style={{ padding: '80px 20px', textAlign: 'center' }}>
          Loading…
        </div>
      )}
    </>
  );
}
