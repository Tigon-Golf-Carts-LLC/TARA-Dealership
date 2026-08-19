#!/usr/bin/env bash
# Fails if client-requested removals reappear anywhere in the site:
# Mautic inquiry form scripts/markup, floating contact sidebar, WhatsApp
# widget, web footer, or inquiry form section. See replit.md
# "Client-requested removals". These have been restored accidentally by
# past merges (e.g. offline localization) — this script guards against that.
# Scans source files, and also the production build output (dist/public)
# when it exists, so a build step or vendored dependency can't reintroduce
# removed content into the published site. Pass --require-dist to fail if
# dist/public is missing (used by the production build before publish).
set -euo pipefail
cd "$(dirname "$0")/.."

require_dist=0
if [ "${1:-}" = "--require-dist" ]; then
  require_dist=1
fi

scan_dirs=(public/content/ src/ index.html public/js/)
if [ -d dist/public ]; then
  scan_dirs+=(dist/public/)
elif [ "$require_dist" -eq 1 ]; then
  echo "ERROR: dist/public not found — build output must exist for pre-publish verification"
  exit 1
fi

fail=0

check() {
  local label="$1" pattern="$2"
  shift 2
  local hits
  hits=$(grep -rlE "$@" "$pattern" "${scan_dirs[@]}" 2>/dev/null | sort -u || true)
  if [ -n "$hits" ]; then
    echo "REMOVED CONTENT REAPPEARED — $label:"
    echo "$hits" | head -20
    fail=1
  fi
}

# Vendored Mautic form scripts must not exist at all
for f in public/js/form-generate.js public/js/mautic-form.js \
         dist/public/js/form-generate.js dist/public/js/mautic-form.js; do
  if [ -e "$f" ]; then
    echo "REMOVED FILE REAPPEARED: $f"
    fail=1
  fi
done

# "mauticform" appears in dead CSS selectors (styling for the deleted form),
# which are harmless — exclude .css files for this text token only.
check "Mautic form markup/scripts (mauticform outside CSS)" \
  'mauticform' --exclude='*.css'
check "Mautic form script files (form-generate.js / mautic-form.js)" \
  'form-generate\.js|mautic-form\.js'
check "external inquiry-form script source (formcs.globalso.com)" \
  'formcs\.globalso\.com'
check "floating contact sidebar (ul.right_nav)" \
  '<ul[^>]*class="[^"]*right_nav'
check "inquiry popup (div.inquiry-pop-bd)" \
  '<div[^>]*class="[^"]*inquiry-pop-bd'
check "WhatsApp widget (#whatsapp / #whatsappMain)" \
  'id="whatsapp(Main)?"'
check "web footer (<footer class=\"web-footer\">)" \
  '<footer[^>]*class="[^"]*web-footer'
check "inquiry form section (section.inquiry-form-wrap)" \
  '<section[^>]*class="[^"]*inquiry-form-wrap'
check "Online Service floating sidebar (aside.scrollsidebar)" \
  '<aside[^>]*class="[^"]*scrollsidebar'

# --- Old branding guard (TARA Dealership rebrand) ---
# The brand is TARA Dealership / taradealership.com. Old domains and brand
# names must never reappear. Scans all of public/ (not just content/) plus
# src/ and index.html, and dist/public when present. Notes:
# - grep -I skips binary files: old logo images are task-tracked separately,
#   and PNG metadata can incidentally contain old-domain strings.
# - scripts/localize-assets.mjs legitimately references www.taragolfcart.com
#   in its source-domain regexes; scripts/ is not scanned.
# - Brand-name checks are case-sensitive: descriptive prose like
#   "TARA electric vehicles are quiet" is fine; the Title Case brand
#   "TARA Electric Vehicles" is not.
brand_scan_dirs=(public/ src/ index.html)
if [ -d dist/public ]; then
  brand_scan_dirs+=(dist/public/)
fi

brand_check() {
  local label="$1" pattern="$2"
  shift 2
  local hits
  hits=$(grep -rlI "$@" -e "$pattern" "${brand_scan_dirs[@]}" 2>/dev/null | sort -u || true)
  if [ -n "$hits" ]; then
    echo "OLD BRANDING REAPPEARED — $label:"
    echo "$hits" | head -20
    fail=1
  fi
}

brand_check "old domain taragolfcart.com" 'taragolfcart\.com' -iE
brand_check "old domain taranev.com" 'taranev\.com' -iE
brand_check "old brand name \"TARA Electric Vehicles\"" 'TARA Electric Vehicles' -F
brand_check "old brand name \"TARA Neighborhood Electric Vehicles\"" 'TARA Neighborhood Electric Vehicles' -F

# --- Shared-link image audit ---
# Facebook and LinkedIn recommend at least 1200x630 for large link previews.
# This also exceeds X's 300x157 minimum for summary_large_image cards.
if ! node scripts/social-og-images.mjs --check; then
  echo "SOCIAL IMAGE MAPPING REGRESSION — generated social images or source mappings are stale"
  echo "Fix with: node scripts/social-og-images.mjs"
  fail=1
fi
if ! node scripts/verify-og-images.mjs; then
  echo "SOCIAL IMAGE REGRESSION — curated ogImage entries must be at least 1200x630"
  fail=1
fi

# --- Image alt-text audit ---
# Merges have also reintroduced generic/empty alts (e.g. "D7 product_show-1").
# fix-alts.py --check audits public/content/*.html without writing and exits
# nonzero if any fixable or suspicious alts are present.
if ! python3 scripts/fix-alts.py --check; then
  echo "ALT REGRESSION — generic/empty image alts reappeared in public/content/"
  echo "Fix with: python3 scripts/fix-alts.py"
  fail=1
fi

# Blog/news share images are derived from article bodies and stored in
# routes.json. Fail if a merge drops or stales any of those mappings.
if ! node scripts/derive-article-og-images.mjs --check; then
  echo "ARTICLE SHARE IMAGE REGRESSION — routes.json is missing derived ogImage metadata"
  echo "Fix with: node scripts/derive-article-og-images.mjs"
  fail=1
fi

# Also audit the production build output when it exists (required with
# --require-dist), so a build step can't ship generic/empty alts even
# when the source files are clean.
if [ -d dist/public ]; then
  if ! python3 scripts/fix-alts.py --check dist/public; then
    echo "ALT REGRESSION — generic/empty image alts found in built HTML (dist/public/)"
    echo "The build step reintroduced bad alts; fix the source or the build, then rebuild."
    fail=1
  fi
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: no removed content, old branding, social image, or alt regressions found"
fi
exit $fail
