/**
 * Site chrome injected below every page's content: the 0% financing CTA, the
 * contact CTA, the footer, and the floating "Call Now" button.
 *
 * These are plain HTML strings so the exact same markup can be baked into the
 * prerendered HTML at build time (script/prerender.ts) and re-created by the
 * SPA at runtime. Keeping one source avoids the two drifting apart.
 */
import {
  CONTACT_EMAIL,
  CONTACT_PHONE_DISPLAY,
  CONTACT_PHONE_HREF,
} from '@shared/site.ts';

/** Join the base path with a site-root-relative path. */
export function withBase(base: string, target: string): string {
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${prefix}${target}`;
}

export function financingCtaHtml(base: string): string {
  return `<section id="tara-financing-cta">
  <div class="tfc-inner">
    <div class="tfc-rate">
      <span class="tfc-rate-num">0<sup>%</sup></span>
      <span class="tfc-rate-label">APR Financing</span>
    </div>
    <div class="tfc-copy">
      <p class="tfc-kicker">&#9733; Limited-Time Offer</p>
      <h2 class="tfc-title">0% Financing on TARA Golf Carts At Your Local Dealership</h2>
      <p class="tfc-sub">Drive home your TARA today &mdash; 0% financing options for up to <strong>36 months</strong>.</p>
    </div>
    <div class="tfc-action">
      <a class="tfc-button" href="${withBase(base, '/financing/')}">Get 0% Financing &#8594;</a>
      <span class="tfc-note">On approved credit</span>
    </div>
  </div>
</section>`;
}

/**
 * Contact CTA. A static site has no backend to post a form to, so the two
 * actions are a mailto: and a tel: link straight to the dealership.
 */
export function contactCtaHtml(): string {
  return `<section id="tara-contact-cta">
  <div class="tcc-inner">
    <h2 class="tcc-title">Talk to TARA Dealership</h2>
    <p class="tcc-sub">Questions on pricing, availability, financing, or service? Reach us directly &mdash; we answer every message.</p>
    <div class="tcc-actions">
      <a class="tcc-button tcc-button-primary" href="${CONTACT_PHONE_HREF}">&#9742; Call ${CONTACT_PHONE_DISPLAY}</a>
      <a class="tcc-button" href="mailto:${CONTACT_EMAIL}?subject=TARA%20Dealership%20Inquiry">&#9993; Email ${CONTACT_EMAIL}</a>
    </div>
  </div>
</section>`;
}

export function footerHtml(base: string, year: number): string {
  const link = (target: string, label: string) =>
    `<a href="${withBase(base, target)}">${label}</a>`;
  return `<footer id="tara-footer">
  <div class="tf-inner">
    <div class="tf-col tf-brand">
      <img src="${withBase(base, '/images/tara-dealership-logo-400.webp')}" srcset="${withBase(base, '/images/tara-dealership-logo-400.webp')} 400w, ${withBase(base, '/images/tara-dealership-logo.webp')} 800w" sizes="180px" width="180" height="180" loading="lazy" decoding="async" alt="TARA Dealership" />
      <p>TARA Dealership &mdash; sales, service, and support for electric golf carts, NEVs, and utility vehicles.</p>
      <p class="tf-disclaimer">We are an independent, authorized dealership selling TARA vehicles. We are not TARA, the manufacturer.</p>
      <a class="tf-phone" href="${CONTACT_PHONE_HREF}">&#9742; ${CONTACT_PHONE_DISPLAY}</a>
      <a class="tf-email" href="mailto:${CONTACT_EMAIL}">&#9993; ${CONTACT_EMAIL}</a>
    </div>
    <div class="tf-col">
      <h4>Vehicles</h4>
      ${link('/t1-series/', 'T1 Golf Cart Series')}
      ${link('/t2-series/', 'T2 Utility Golf Cart Series')}
      ${link('/t3-series/', 'T3 Street Legal Series')}
      ${link('/fleet-golf-carts/', 'Fleet Golf Carts')}
      ${link('/accessories/', 'Accessories')}
    </div>
    <div class="tf-col">
      <h4>Popular Models</h4>
      ${link('/harmony-fleet-golf-cart-product/', 'Harmony')}
      ${link('/spirit-pro-fleet-golf-cart-product/', 'Spirit Pro')}
      ${link('/spirit-plus-fleet-golf-cart-product/', 'Spirit Plus')}
      ${link('/roadster-2-2-golf-cart-product/', 'Roadster 2+2')}
      ${link('/explorer-2-2-golf-cart-product/', 'Explorer 2+2')}
      ${link('/turfman-700-utility-vehicle-product/', 'Turfman 700')}
      ${link('/t3-2-2-golf-cart-product/', 'T3 2+2')}
    </div>
    <div class="tf-col">
      <h4>Support</h4>
      ${link('/technical-support/', 'Technical Support')}
      ${link('/maintenance-support/', 'Maintenance')}
      ${link('/warranty-terms/', 'Warranty Terms')}
      ${link('/safety-information/', 'Safety Information')}
      ${link('/recall-information/', 'Recall Information')}
      ${link('/emergency-response-guides/', 'Emergency Guides')}
      ${link('/faqs/', 'FAQs')}
      ${link('/financing/', 'Financing')}
    </div>
    <div class="tf-col">
      <h4>Company</h4>
      ${link('/', 'Home')}
      ${link('/about-us/', 'About Us')}
      ${link('/cases/', 'Customer Cases')}
      ${link('/blog/', 'Blog')}
      ${link('/contact/', 'Contact')}
    </div>
  </div>
  <div class="tf-bottom">
    <span>&copy; ${year} <a href="${withBase(base, '/')}">TARA Dealership</a>. All rights reserved.</span>
    <span class="tf-legal">
      ${link('/privacy-policy/', 'Privacy Policy')}
      ${link('/terms-and-conditions/', 'Terms &amp; Conditions')}
    </span>
  </div>
</footer>`;
}

export function callNowHtml(): string {
  return `<a id="tara-call-now" href="${CONTACT_PHONE_HREF}" aria-label="Call TARA Dealership at ${CONTACT_PHONE_DISPLAY}"><span class="call-icon">&#9742;</span> Call Now</a>`;
}

/** Everything appended after a page's content, in order. */
export function pageChromeHtml(base: string, year: number): string {
  return [contactCtaHtml(), financingCtaHtml(base), footerHtml(base, year)].join('\n');
}
