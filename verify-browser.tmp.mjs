import { chromium } from 'playwright';

const base = 'http://localhost:4173';
const pages = [
  ['home', '/'],
  ['deep link (static page)', '/about-us/'],
  ['dynamic detail (product)', '/turfman-450-utility-vehicle-product/'],
  ['dynamic detail (article)', '/blog/choosing-right-tara/'],
  ['search', '/search/?s=turfman'],
  ['unknown url (404 fallback)', '/definitely-not-a-page/'],
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let failures = 0;

for (const [label, path] of pages) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('request', (r) => requests.push(r.url()));

  const response = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);

  const title = await page.title();
  const desc = await page.getAttribute('meta[name="description"]', 'content');
  const canonical = await page.getAttribute('link[rel="canonical"]', 'content').catch(() => null)
    ?? await page.getAttribute('link[rel="canonical"]', 'href');
  const ogTitle = await page.getAttribute('meta[property="og:title"]', 'content');
  const ogImage = await page.getAttribute('meta[property="og:image"]', 'content');
  const favicon = await page.getAttribute('link[rel="icon"]', 'href');
  const h = await page.evaluate(() => ({
    imgs: document.querySelectorAll('img').length,
    srcset: document.querySelectorAll('img[srcset]').length,
    avif: document.querySelectorAll('source[type="image/avif"]').length,
    footer: !!document.getElementById('tara-footer'),
    cta: !!document.getElementById('tara-contact-cta'),
    call: !!document.getElementById('tara-call-now'),
    ld: !!document.getElementById('tara-ld-json'),
    mailto: document.querySelectorAll('a[href^="mailto:"]').length,
    tel: document.querySelectorAll('a[href^="tel:"]').length,
    searchResults: document.querySelectorAll('.tara-search-list li').length,
    bodyText: document.body.innerText.trim().length,
  }));

  const apiCalls = requests.filter((u) => /\/api\//.test(u) || /localhost:(3000|5000|8000|19130)/.test(u));

  console.log(`\n### ${label}  ${path}`);
  console.log(`  status        ${response.status()}`);
  console.log(`  title         ${title}`);
  console.log(`  description   ${(desc ?? '').slice(0, 80)}`);
  console.log(`  canonical     ${canonical}`);
  console.log(`  og:title      ${ogTitle}`);
  console.log(`  og:image      ${ogImage}`);
  console.log(`  favicon       ${favicon}`);
  console.log(`  imgs ${h.imgs} / srcset ${h.srcset} / avif-source ${h.avif}`);
  console.log(`  chrome        footer=${h.footer} contactCTA=${h.cta} callNow=${h.call} jsonld=${h.ld}`);
  console.log(`  mailto=${h.mailto} tel=${h.tel} bodyChars=${h.bodyText} searchResults=${h.searchResults}`);
  console.log(`  api calls     ${apiCalls.length ? apiCalls.join(', ') : 'none'}`);
  console.log(`  console errs  ${errors.length ? errors.slice(0,5).join(' | ') : 'none'}`);

  if (errors.length) failures++;
  if (apiCalls.length) failures++;
  await page.screenshot({ path: `/tmp/claude-0/-home-user-TARA-Dealership/581e8b2f-3bec-5680-934b-89a5ff887189/scratchpad/shot-${label.replace(/[^a-z0-9]+/gi,'-')}.png`, fullPage: false });
  await context.close();
}

await browser.close();
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} page(s) with console errors or API calls`);
process.exit(failures === 0 ? 0 : 1);
