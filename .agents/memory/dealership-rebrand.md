---
name: Dealership rebrand
description: Brand/domain rules after the Aug 2026 rebrand to TARA Dealership
---

Site brand is **TARA Dealership**, domain **taradealership.com**, SEO focus keyword **"TARA Golf Cart Dealership"** (used as the main site-name suffix in titles/descriptions/content).

**Why:** Client requested a full rebrand away from taragolfcart.com / "TARA (Neighborhood) Electric Vehicles" in Aug 2026.

**How to apply:**
- Never reintroduce `taragolfcart.com` (or `taragolfcarts.com`), "TARA Electric Vehicles", or "TARA Neighborhood Electric Vehicles" when regenerating content or after merges — re-grep after every merge (same risk pattern as the client-requested removals).
- "TARA NEV Roadster" and generic "Neighborhood Electric Vehicles (NEVs)" vehicle-class references are product terms, not branding — keep them.
- Site-name suffix stripping regex in `src/structuredData.ts` must keep matching the Dealership suffixes.

**SEO keyword coverage (Aug 2026):** every route's title, meta description, and main on-page heading (`fl-heading-text`) must include "TARA Dealership" / "TARA GOLF CART DEALERSHIP" (match the heading's casing). Descriptions are capped at 160 chars by the build's assertSeoMeta — reserve suffix length before trimming, and trim at sentence/word boundaries, never mid-phrase. Watch for double-branding ("TARA Dealership TARA ...") when scripting these edits; case-sensitive greps miss all-caps "DEALERSHIP".
