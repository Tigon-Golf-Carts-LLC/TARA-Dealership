import { useEffect, useRef, useState } from 'react';

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

        // Load the site's original behavior script (menus, sliders, tabs)
        // and the inquiry-form generator, exactly as the original site does.
        for (const src of [
          `${BASE}js/jquery.min_index.js`,
          'https://formcs.globalso.com/form/generate.js?id=1425',
        ]) {
          const s = document.createElement('script');
          s.src = src;
          s.async = false;
          document.body.appendChild(s);
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
      {status === 'notfound' && (
        <div
          style={{
            padding: '120px 20px',
            textAlign: 'center',
            fontFamily: 'Poppins-Regular, Arial, sans-serif',
          }}
        >
          <h1 style={{ fontSize: 42, marginBottom: 16 }}>404</h1>
          <p style={{ marginBottom: 24 }}>
            The page you are looking for could not be found.
          </p>
          <a href={BASE} style={{ color: '#8dc63f', fontWeight: 700 }}>
            Back to Home
          </a>
        </div>
      )}
    </>
  );
}
