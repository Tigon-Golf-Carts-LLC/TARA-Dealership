---
name: Image alt text conventions
description: Alt text policy for tara-ev content pages
---

Every meaningful image in tara-ev content pages must carry a descriptive, model-specific, US-framed alt (e.g. "TARA Horizon 4 4-passenger electric golf cart"); decorative icons are explicitly marked `alt="" role="presentation"`; share icons get functional alts ("Share by email"). Filename/slug-style alts (camera codes, "banner01", "product_show", CJK filenames) are banned.

**Why:** the legacy clone shipped filename-derived alts that hurt image-search ranking and accessibility, and merges have restored old markup before.

**How to apply:** after any merge or content re-import, re-run the alt auditor script in the artifact's scripts directory and resolve anything it flags. The auditor also accepts directory arguments to audit built HTML (dist/public), and the post-merge check runs it on both source and build output — a stale dist can fail the check even when source is clean; rebuild to clear it.
