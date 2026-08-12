#!/usr/bin/env bash
# Fails if client-requested removals reappear anywhere in the site:
# Mautic inquiry form scripts/markup, floating contact sidebar, WhatsApp
# widget, web footer, or inquiry form section. See replit.md
# "Client-requested removals". These have been restored accidentally by
# past merges (e.g. offline localization) — this script guards against that.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

check() {
  local label="$1" pattern="$2"
  local hits
  hits=$(grep -rlE "$pattern" public/content/ src/ index.html public/js/ 2>/dev/null | sort -u || true)
  if [ -n "$hits" ]; then
    echo "REMOVED CONTENT REAPPEARED — $label:"
    echo "$hits" | head -20
    fail=1
  fi
}

# Vendored Mautic form scripts must not exist at all
for f in public/js/form-generate.js public/js/mautic-form.js; do
  if [ -e "$f" ]; then
    echo "REMOVED FILE REAPPEARED: $f"
    fail=1
  fi
done

check "Mautic form references (mauticform / form-generate.js / mautic-form.js)" \
  'mauticform|form-generate\.js|mautic-form\.js'
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

if [ "$fail" -eq 0 ]; then
  echo "OK: no removed inquiry form, popups, widgets, or footer found"
fi
exit $fail
