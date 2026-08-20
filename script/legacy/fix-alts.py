#!/usr/bin/env python3
"""Rewrite generic/empty img alt text in public/content/*.html with descriptive,
model-specific, US-framed alts. Idempotent.

Usage:
  fix-alts.py                   rewrite bad alts in place, report leftovers
  fix-alts.py --check           audit only (no writes); exit 1 if any fixable or
                                suspicious alts are found (used by verify-removals.sh)
  fix-alts.py --check DIR ...   audit the given directories (recursively) instead
                                of the default public/content/ — used to audit
                                built HTML in dist/public as well.
"""
import re, sys, glob, html, os

CHECK_ONLY = "--check" in sys.argv[1:]
DIR_ARGS = [a for a in sys.argv[1:] if a != "--check"]

CONTENT = os.path.join(os.path.dirname(__file__), "..", "public", "content")

def html_files():
    """All HTML files to process, sorted."""
    if DIR_ARGS:
        files = []
        for d in DIR_ARGS:
            if not os.path.isdir(d):
                print(f"ERROR: not a directory: {d}", file=sys.stderr)
                sys.exit(2)
            files += glob.glob(os.path.join(d, "**", "*.html"), recursive=True)
        return sorted(set(files))
    return sorted(glob.glob(os.path.join(CONTENT, "*.html")))

# ---------- helpers ----------
def titlecase(s):
    small = {"and", "or", "with", "for", "the", "a", "an", "of", "in", "to"}
    words = re.sub(r"\s+", " ", s.strip()).split(" ")
    out = []
    for i, w in enumerate(words):
        lw = w.lower()
        if lw in ("led", "usb", "eec", "gps", "lsv", "nev"):
            out.append(w.upper())
        elif i > 0 and lw in small:
            out.append(lw)
        else:
            out.append(lw.capitalize())
    return " ".join(out)

# model name + vehicle type from filename
MODEL_PATTERNS = [
    (r"^harmony", ("Harmony", "electric golf cart")),
    (r"^spirit-pro", ("Spirit Pro", "electric golf cart")),
    (r"^spirit-plus", ("Spirit Plus", "electric golf cart")),
    (r"^roadster-2-2", ("Roadster 2+2", "electric golf cart")),
    (r"^explorer-2-2", ("Explorer 2+2", "electric golf cart")),
    (r"^horizon-4", ("Horizon 4", "electric golf cart")),
    (r"^horizon-6", ("Horizon 6", "electric golf cart")),
    (r"^lander-4", ("Lander 4", "electric golf cart")),
    (r"^lander-6", ("Lander 6", "electric golf cart")),
    (r"^t3-2-?2-lifted", ("T3 2+2 Lifted", "electric golf cart")),
    (r"^t3-2-?2", ("T3 2+2", "electric golf cart")),
    (r"^turfman-450", ("Turfman 450", "electric utility vehicle")),
    (r"^turfman-700-eec", ("Turfman 700 EEC", "electric utility vehicle")),
    (r"^turfman-700", ("Turfman 700", "electric utility vehicle")),
    (r"^turfman-1000", ("Turfman 1000", "electric utility vehicle")),
    (r"^vogue-2-2", ("Vogue 2+2", "electric golf cart")),
    (r"^vogue-se2", ("Vogue SE2", "electric golf cart")),
    (r"^vogue-2", ("Vogue 2", "electric golf cart")),
    (r"^rambler-se2", ("Rambler SE2", "electric golf cart")),
    (r"^rambler-2", ("Rambler 2", "electric golf cart")),
]

def model_for_file(fname):
    base = os.path.basename(fname)
    for pat, mv in MODEL_PATTERNS:
        if re.match(pat, base):
            return mv
    return (None, None)

# ---------- src-based overrides (menu images, shared assets) ----------
SRC_ALTS = {
    "/images/Harmony-no-light.webp": "TARA Harmony 2-passenger electric golf cart",
    "/images/harmony250626.webp": "TARA Harmony 2-passenger electric golf cart",
    "/images/spirit-pro.webp": "TARA Spirit Pro fleet electric golf cart",
    "/images/spirit-plus.webp": "TARA Spirit Plus fleet electric golf cart",
    "/images/roadster-2+2.webp": "TARA Roadster 2+2 electric golf cart",
    "/images/9777f2ea1.webp": "TARA Explorer 2+2 electric golf cart",
    "/images/c4b0bca2.webp": "TARA Horizon 4 4-passenger electric golf cart",
    "/images/7e8a1ea6.webp": "TARA Lander 4 4-passenger electric golf cart",
    "/images/f17feac2.webp": "TARA Horizon 6 6-passenger electric golf cart",
    "/images/f41c61551.webp": "TARA Lander 6 6-passenger electric golf cart",
    "/images/turfman-450.webp": "TARA Turfman 450 electric utility vehicle",
    "/images/turfman-700.webp": "TARA Turfman 700 electric utility vehicle",
    "/images/TURFMAN-700-EEC.webp": "TARA Turfman 700 EEC electric utility vehicle",
    "/images/TURFMAN-1000.webp": "TARA Turfman 1000 heavy-duty electric utility vehicle",
    # share/nav icons (functional)
    "/images/email.png": "Share by email",
    "/images/whatsapp.png": "Share on WhatsApp",
    "/images/weixin.png": "Share on WeChat",
    "/images/top.png": "Back to top",
    # header banner slide
    "/images/block.png": "TARA Golf Cart Dealership promotional banner",
    "/images/block.webp": "TARA Golf Cart Dealership promotional banner",
    # empty-alt gallery photos
    "/images/asdzxcxz.webp": "TARA fleet electric golf carts lined up at a golf course",
    "/images/asdad11.webp": "TARA fleet electric golf carts staged for course operations",
    "/images/1Z5A29971.webp": "TARA electric golf cart on the fairway at a golf course",
    "/images/home-pic-d-012.webp": "TARA electric golf carts on a golf course at sunset",
    # CTA banners
    "/images/RAQ1.webp": "Request a quote from TARA Golf Cart Dealership",
}

DECORATIVE_SRC_RE = re.compile(r"/images/(single_icon_\d+1?\.webp|banner_3_icon\d+\.webp)$")

# ---------- exact alt-based replacements (global) ----------
ALT_ALTS = {
    "TURFMAN-700-EEC": "TARA Turfman 700 EEC electric utility vehicle",
    "turfman 700": "TARA Turfman 700 electric utility vehicle",
    "turfman 450": "TARA Turfman 450 electric utility vehicle",
    "TURFMAN-1000": "TARA Turfman 1000 heavy-duty electric utility vehicle",
    "TARA T3 2+2 GOLF CART": "TARA T3 2+2 electric golf cart",
    "tara-spirit-pro-menu-image": "TARA Spirit Pro fleet electric golf cart",
    "tara-spirit-plus-menu-image": "TARA Spirit Plus fleet electric golf cart",
    "tara-harmony-menu-image": "TARA Harmony 2-passenger electric golf cart",
    "tara roadster 2+2 golf cart": "TARA Roadster 2+2 electric golf cart",
    "tara explorer 2+2 golf cart": "TARA Explorer 2+2 electric golf cart",
    "Harmony-no light": "TARA Harmony 2-passenger electric golf cart",
    "T3 2+2": "TARA T3 2+2 electric golf cart",
    "T3 2+2 Lifted-tara": "TARA T3 2+2 Lifted electric golf cart",
    "roadster 2+2": "TARA Roadster 2+2 electric golf cart",
    "explorer 2+2": "TARA Explorer 2+2 electric golf cart",
    "spirit pro": "TARA Spirit Pro fleet electric golf cart",
    "spirit plus": "TARA Spirit Plus fleet electric golf cart",
    "2+2product_show": "TARA Explorer 2+2 electric golf cart",
    "D7 product_show-1": "TARA Horizon 4 4-passenger electric golf cart",
    "D7 product_show-4": "TARA Lander 4 4-passenger electric golf cart",
    "D7-product_show": "TARA Horizon 6 6-passenger electric golf cart",
    "D7-product_show1": "TARA Lander 6 6-passenger electric golf cart",
    "faq": "TARA Golf Cart Dealership frequently asked questions",
    "Request a Quote": "Request a quote from TARA Golf Cart Dealership",
    "Order Now": "Order a TARA electric golf cart",
    "Build and Price": "Build and price your TARA electric golf cart",
    "block": "TARA Golf Cart Dealership promotional banner",
    "/accessories/": None,  # handled via src filename below
    "stash": "TARA Vogue 2+2 electric golf cart storage compartment detail",
    "detail-r": "TARA Vogue 2 electric golf cart rear detail view",
    "product_show6234": "TARA Vogue SE2 electric golf cart product view",
    "hunting-buggy-outdoor": "TARA electric hunting buggy on rugged outdoor terrain",
    "electric-farm-utility-vehicle": "TARA electric utility vehicle working on a farm",
    "weixin": "Share on WeChat",
    "未命名": None,
    "The Perfect Companion for Fall Outings-1": "TARA electric golf cart on an autumn outing",
    # filename-style leftovers with known context
    "1Z5A388": "TARA electric golf cart delivered for a customer installation",
    "1Z5A4096": "TARA electric golf carts on an environmentally sustainable golf course",
    "spirit plus 20240925": "TARA Spirit Plus electric golf cart parked on the course",
    "tara golf cart news01": "TARA electric golf cart lineup at the dealership",
    "TARAZHU": "TARA electric golf cart parked in covered storage",
    "Tarazhu1": "TARA electric golf cart on a leisure ride through green surroundings",
    "tara golf cart cases1": "TARA electric golf carts staged for a customer fleet delivery",
    "tara golf carts2": "Row of TARA electric golf carts ready for customer pickup",
    "tara golf cart custom case2": "Custom-built TARA electric golf cart for a client project",
    "tara golf cart custom case3": "Custom TARA electric golf cart configuration for a resort client",
    "tara golf cart customer case4": "TARA electric golf cart in service at a customer property",
    "TURFMAN 450": "TARA Turfman 450 electric utility vehicle",
    "TURFMAN 700": "TARA Turfman 700 electric utility vehicle",
    "Turfman 700": "TARA Turfman 700 electric utility vehicle",
    "How Golf Carts Have Revolutionized the Sports World-1":
        "TARA electric golf cart on a golf course fairway",
    "The Surprising Reason More Golf Carts Are Becoming Car Replacements-1":
        "TARA electric golf cart used for neighborhood transportation",
}

# src-keyed fixes for images whose alts were previously generic placeholders
SRC_ALTS.update({
    "/images/ext/d602ad4e-_____20240814102943.png":
        "TARA Spirit Plus electric golf cart – exterior side view on the course",
    "/images/ext/38677613-_____20240814162556.png":
        "TARA Spirit Plus electric golf cart – premium seating and cabin detail",
    "/images/ext/c0218dae-___1.jpg":
        "TARA Golf Cart Dealership booth showcasing electric golf carts at the PGA Show",
})

# banner alts like "tara t3 2+2 lifted golf cart banner1" / "Tara Horizon 6 golf cart banner  02"
BANNER_RE = re.compile(r"^\s*(?:tara\s+)?(.+?)(?:\s+golf\s*cart)?\s+banner\s*0*(\d+)(?:-\d+)?\s*$", re.I)
BANNER_MODELS = {
    "harmony-light": ("Harmony", "with light package"),
    "harmony-no light": ("Harmony", ""),
    "harmony": ("Harmony", ""),
    "harmony golf cart-no light": ("Harmony", ""),
    "roadster 2+2": ("Roadster 2+2", ""),
    "explorer 2+2": ("Explorer 2+2", ""),
    "spirit plus": ("Spirit Plus", ""),
    "spirit pro": ("Spirit Pro", ""),
    "t3 2+2": ("T3 2+2", ""),
    "t3 2+2 lifted": ("T3 2+2 Lifted", ""),
    "horizon 4": ("Horizon 4", ""),
    "horizon 6": ("Horizon 6", ""),
    "lander 4": ("Lander 4", ""),
    "lander 6": ("Lander 6", ""),
}

def banner_alt(alt):
    m = BANNER_RE.match(alt)
    if not m:
        return None
    key = re.sub(r"\s+", " ", m.group(1).strip().lower())
    key = re.sub(r"^tara\s+", "", key)
    if key not in BANNER_MODELS:
        return None
    model, suffix = BANNER_MODELS[key]
    extra = f" {suffix}" if suffix else ""
    return f"TARA {model} electric golf cart{extra} – hero banner {m.group(2)}"

COLOR_ICON_RE = re.compile(r"^\s*(.+?)\s+COLOR ICON\s*$", re.I)
# alts that are pure ALL-CAPS feature labels / color names (with a few symbols)
FEATUREY_RE = re.compile(r'^[\sA-Z0-9&/+.,\'"“”\-–—;:%()]+$')
COLORS = {"portimao blue", "arctic gray", "black sapphire", "mediterranean blue",
          "mineral white", "green", "beige", "flamenco red", "white", "sliver",
          "silver", "sandstone", "sky blue"}

IMG_RE = re.compile(r"<img\b[^>]*>", re.I)
ALT_RE = re.compile(r'alt=(["\'])(.*?)\1', re.I | re.S)
SRC_RE = re.compile(r'src=(["\'])\s*(.*?)\s*\1', re.I)

def fix_color_name(c):
    c = c.strip()
    if c.upper() == "SLIVER":
        c = "Silver"
    return titlecase(c)

def accessory_alt_from_src(src):
    m = re.search(r"/([^/]+)\.(png|jpe?g|webp)$", src)
    name = m.group(1) if m else "accessory"
    name = re.sub(r"^[0-9a-f]{8}-", "", name)
    name = re.sub(r"[-_]+", " ", name).strip()
    name = re.sub(r"\d+$", "", name).strip()
    return f"TARA golf cart accessory – {titlecase(name)}"

def process_file(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    model, vtype = model_for_file(path)
    changes = []

    def repl(m):
        tag = m.group(0)
        srcm = SRC_RE.search(tag)
        src = srcm.group(2) if srcm else ""
        altm = ALT_RE.search(tag)
        alt = html.unescape(altm.group(2)).strip() if altm else None
        new = None

        if src in SRC_ALTS:
            new = SRC_ALTS[src]
        elif DECORATIVE_SRC_RE.search(src):
            # decorative icon: empty alt + explicit presentation role
            newtag = tag
            if altm:
                newtag = newtag[:altm.start()] + 'alt=""' + newtag[altm.end():]
            if "role=" not in newtag:
                newtag = newtag[:-2].rstrip("/ ").rstrip() + ' role="presentation" />'
            if newtag != tag:
                changes.append((alt, "[decorative]"))
            return newtag
        elif alt is not None:
            raw = altm.group(2).strip()
            if raw in ALT_ALTS and ALT_ALTS[raw]:
                new = ALT_ALTS[raw]
            elif alt in ALT_ALTS and ALT_ALTS[alt]:
                new = ALT_ALTS[alt]
            elif raw == "/accessories/":
                new = accessory_alt_from_src(src)
            elif re.match(r"^(未命名|微信图片)", alt):
                base = model or "electric golf cart"
                new = f"TARA {base} {vtype}" if model else "TARA Golf Cart Dealership photo"
            elif alt == "" :
                pass  # unknown empty alt: leave for report
            elif banner_alt(alt):
                new = banner_alt(alt)
            else:
                cim = COLOR_ICON_RE.match(alt)
                if cim:
                    new = f"{fix_color_name(cim.group(1))} color option swatch"
                elif alt.lower().strip() in COLORS and model:
                    new = f"TARA {model} {vtype} in {fix_color_name(alt)}"
                elif alt.lower().strip() in COLORS:
                    new = f"TARA electric golf cart in {fix_color_name(alt)}"
                elif model and FEATUREY_RE.match(alt) and alt.upper() == alt and len(alt) >= 4 and re.search(r"[A-Z]{3}", alt):
                    feat = titlecase(alt)
                    feat = feat.replace("Havy-Duty", "Heavy-Duty")
                    new = f"TARA {model} {vtype} – {feat}"
        if new and new != alt and altm:
            newtag = tag[:altm.start()] + 'alt="%s"' % html.escape(new, quote=True) + tag[altm.end():]
            changes.append((alt, new))
            return newtag
        return tag

    newtext = IMG_RE.sub(repl, text)
    if newtext != text and not CHECK_ONLY:
        with open(path, "w", encoding="utf-8") as f:
            f.write(newtext)
    return changes

total = 0
for path in html_files():
    ch = process_file(path)
    total += len(ch)
if CHECK_ONLY:
    print(f"Fixable alt regressions: {total}")
else:
    print(f"Total alt updates: {total}")

# report remaining suspicious alts
print("\n=== Remaining suspicious alts ===")
susp = {}
for path in html_files():
    with open(path, encoding="utf-8") as f:
        text = f.read()
    for tag in IMG_RE.findall(text):
        altm = ALT_RE.search(tag)
        tagl = tag.lower()
        if not altm:
            susp.setdefault("(missing alt)", set()).add(os.path.basename(path))
            continue
        alt = html.unescape(altm.group(2)).strip()
        if alt == "":
            # decorative images must be explicitly marked
            if 'role="presentation"' not in tagl and "aria-hidden" not in tagl:
                srcm = SRC_RE.search(tag)
                susp.setdefault(f'(empty) {srcm.group(2) if srcm else ""}', set()).add(os.path.basename(path))
            continue  # marked decorative: OK, not suspicious
        generic = (
            re.search(r"(_|product_show|menu-image|icon\d)", alt, re.I)
            or re.match(r"^(img|image|photo|picture|banner|logo)\d*$", alt, re.I)
            # generic fallback labels
            or re.search(r"\b(photo|image|picture)$", alt, re.I) and len(alt.split()) <= 5
            # filename-derived: trailing digit sequences like "banner01", "case2", "news01"
            or (re.search(r"[a-z]\d+$", alt, re.I) and not re.search(r"LiFePO4$|48V$|72V$|Horizon [46]$|Lander [46]$", alt))
            or re.search(r"\bbanner\s*\d", alt, re.I)
            # camera-style codes like 1Z5A4096, DSC_1234
            or re.match(r"^[0-9A-Z]{5,}$", alt) and re.search(r"\d", alt)
            # CJK filename leftovers
            or re.search(r"未命名|微信图片|副本", alt)
        )
        # allow deliberate "hero banner N" phrasing
        if generic and not re.search(r"hero banner \d+$", alt):
            susp.setdefault(alt, set()).add(os.path.basename(path))
for k, v in sorted(susp.items()):
    print(f"  {k!r}  -> {sorted(v)[:4]}{'...' if len(v)>4 else ''}")

if CHECK_ONLY and (total or susp):
    print(f"\nALT AUDIT FAILED: {total} fixable, {len(susp)} suspicious alt(s). "
          "Run scripts/fix-alts.py (no --check) to auto-fix, then review leftovers.")
    sys.exit(1)
