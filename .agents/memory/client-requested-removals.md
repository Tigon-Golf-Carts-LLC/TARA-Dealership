---
name: Client-requested removals on tara-ev
description: Elements the client deleted that task-agent merges keep restoring — check after every merge.
---

The client explicitly deleted these from the tara-ev site; do NOT restore them, and re-check after every task-agent merge (a merge has already restored them once):

- Mautic inquiry form (`form#mauticform_daierle`) and its generator script — no `formcs.globalso.com` script, no vendored `public/js/form-generate.js` / `mautic-form.js`, no form-script loading in `src/App.tsx`, no `section.inquiry-form-wrap` in content pages.
- Floating right-edge contact sidebar `ul.right_nav` + `div.inquiry-pop-bd` popup.
- Floating WhatsApp widget `div#whatsapp.footer-whatsapp` / `#whatsappMain`.
- Site footer `<footer class="web-footer">`.
- Custom 404 view in App.tsx (unknown URLs redirect to home instead).

**Why:** the offline-localization task agent vendored external assets wholesale and re-added the form scripts and widget markup on ~630 pages; had to strip them again.
**How to apply:** guard script `artifacts/tara-ev/scripts/verify-removals.sh` (validation step `verify-removals`) now fails when these reappear — run it after merges. Manually, grep for `mauticform|form-generate|right_nav|inquiry-pop-bd|footer-whatsapp|web-footer">` before declaring done. `site.css` has `display:none` safeguards for these selectors — keep them.

Also: Press section was replaced by `/blog/` (12 original posts, files `content/blog*.html`); all `/news/`* routes were deleted — don't reintroduce them.
