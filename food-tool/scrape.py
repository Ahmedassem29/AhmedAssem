"""Collect the best Talabat deals near Al Zahya (Ajman) for a few food types.

Runs in GitHub Actions on a schedule and writes food/data.json, which the
page at /food reads. Personal use only: a few dozen page loads per run,
with a pause between each.
"""
import json, re, time, urllib.request, datetime, os, html

AREA_ID = 3986
AREA_SLUG = "al-zahya"
BASE = "https://www.talabat.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0 Safari/537.36")
PAUSE = 1.2          # seconds between requests
MAX_MENUS = 170      # restaurant menus to open per run
OUT = os.path.join(os.path.dirname(__file__), "..", "food", "data.json")

# Rules learned from real carts (talabat pro):
PRO_FREE_DELIVERY_MIN = 30.0   # pro gets free delivery from this subtotal
DELIVERY_FALLBACK = 6.90       # what the cart charged when listing said "Free"
SMALL_ORDER_LIMIT = 20.0       # below this a small-order fee applies
SMALL_ORDER_FEE = 2.0
SERVICE_RATE, SERVICE_CAP = 0.10, 3.25  # 1.80 on 18, 3.25 on 35

CATEGORIES = {
    "egyptian": {
        "label": "أكل مصري",
        "cuisines": ["egyptian", "koshary"],
        "extra_cuisines": ["grills", "arabic"],  # kofta / bechamel often live here
        "keywords": ["bechamel", "béchamel", "bashamel", "macaroni", "makarona",
                     "kofta", "kufta", "koshary", "koshari", "kushari", "molokhia",
                     "mulukhiyah", "hawawshi", "feteer", "fiteer", "mahshi",
                     "مكرونة", "مكرونه", "بشاميل", "كفتة", "كفته", "كشري", "ملوخية",
                     "حواوشي", "فطير", "محشي"],
    },
    "burger": {
        "label": "برجر",
        "cuisines": ["burgers"],
        "keywords": ["burger", "برجر", "برغر"],
    },
    "pizza": {
        "label": "بيتزا",
        "cuisines": ["pizza"],
        "keywords": ["pizza", "بيتزا", "margherita", "pepperoni"],
    },
    "mandi": {
        "label": "مندي",
        "cuisines": ["mandi"],
        "keywords": ["mandi", "mandhi", "مندي", "madfoon", "madghut", "مظبي",
                     "madhbi", "kabsa", "كبسة"],
    },
    "seafood": {
        "label": "سي فود",
        "cuisines": ["seafood", "fishseafood"],
        "keywords": ["fish", "shrimp", "prawn", "seafood", "hammour", "hamour",
                     "salmon", "calamari", "sayadieh", "sayadiya", "crab",
                     "سمك", "جمبري", "روبيان", "هامور", "صيادية", "كاليماري",
                     "سلمون", "مأكولات بحرية"],
    },
}

SKIP_SECTIONS = re.compile(
    r"drink|beverage|juice|dip|sauce|extra|add[- ]?on|dessert|sweet|soft|water|"
    r"مشروب|عصير|صوص|اضاف|إضاف|حلو", re.I)
MIN_ITEM_PRICE = 8.0
# snacks and sides that share a keyword with a real meal
NOT_A_MEAL = re.compile(r"cracker|chips|slice|salad|sauce|dip\b|soup|spring roll|"
                        r"rice only|without rice|seasoning|pie\b", re.I)
COMBO = re.compile(r"deal|meal|combo|box|offer|bundle|duo|trio|feast|وجبة|عرض|كومبو", re.I)
EXTRA_CUISINE_LIMIT = 12   # how many grills/arabic places to open for kofta etc.


def get(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=40) as r:
        body = r.read().decode("utf-8", "replace")
    time.sleep(PAUSE)
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body, re.S)
    if not m:
        raise ValueError("no page data")
    return json.loads(m.group(1))["props"]["pageProps"]


def listing(cuisine):
    vendors, page = [], 1
    while page <= 4:
        url = f"{BASE}/uae/restaurants/{AREA_ID}/{AREA_SLUG}?cuisine={cuisine}&page={page}"
        try:
            data = get(url)["data"]
        except Exception as e:
            print("listing fail", cuisine, page, e)
            break
        vs = data.get("vendors") or []
        vendors += vs
        total = data.get("totalVendors") or 0
        if not vs or len(vendors) >= total:
            break
        page += 1
    return vendors


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def estimate(subtotal, listed_fee):
    delivery = 0.0 if subtotal >= PRO_FREE_DELIVERY_MIN else (listed_fee or DELIVERY_FALLBACK)
    small = SMALL_ORDER_FEE if subtotal < SMALL_ORDER_LIMIT else 0.0
    service = round(min(subtotal * SERVICE_RATE, SERVICE_CAP), 2)
    total = round(subtotal + delivery + small + service, 2)
    return {"delivery": round(delivery, 2), "small": small, "service": service, "total": total}


def clean(s):
    return html.unescape(s or "").strip()


def main():
    vendors = {}   # branchId -> vendor
    tags = {}      # branchId -> set(category)
    prio = {}      # branchId -> 0 for main cuisine, 1 for extra
    for key, cat in CATEGORIES.items():
        for cu in cat["cuisines"] + cat.get("extra_cuisines", []):
            extra = cu not in cat["cuisines"]
            found = listing(cu)
            if extra:
                found = found[:EXTRA_CUISINE_LIMIT]
            for v in found:
                bid = v["branchId"]
                vendors[bid] = v
                tags.setdefault(bid, set()).add(key)
                prio[bid] = min(prio.get(bid, 1), 1 if extra else 0)
    print("vendors", len(vendors))
    from collections import Counter
    print("status", Counter(str(v.get("statusCode")) for v in vendors.values()))
    print("pizzaro?", [v["name"] for v in vendors.values() if "izzaro" in v["name"]])

    # Open the menus, primary-cuisine restaurants first.
    order = sorted(vendors, key=lambda b: (prio[b], -len(tags[b])))[:MAX_MENUS]
    results = {k: [] for k in CATEGORIES}
    searchable = []
    for bid in order:
        v = vendors[bid]
        try:
            ms = get(BASE + v["menuUrl"] + f"?aid={AREA_ID}")["initialMenuState"]
        except Exception as e:
            print("menu fail", v.get("name"), e)
            continue
        items = ms.get("menuData", {}).get("items") or []
        listed_fee = num(v.get("deliveryFee"))
        rest = {
            "name": clean(v.get("name")),
            "url": f"{BASE}{v['menuUrl']}?aid={AREA_ID}",
            "rating": v.get("rate"),
            "logo": v.get("logo"),
            "time": v.get("avgDeliveryTime"),
            "min": num(v.get("minimumOrderAmount")),
            "promo": clean(v.get("discountText") or v.get("promotionText")),
            "open": v.get("statusCode") in (0, None, "0"),
        }
        good = []
        for it in items:
            price = num(it.get("price"))
            if price < MIN_ITEM_PRICE:
                continue
            sec = (it.get("originalSection") or it.get("sectionName") or "")
            if isinstance(sec, dict):
                sec = sec.get("name", "")
            if SKIP_SECTIONS.search(str(sec)):
                continue
            old = num(it.get("oldPrice"))
            good.append({
                "name": clean(it.get("name")),
                "desc": clean(it.get("description"))[:140],
                "price": price,
                "old": old if old > price else None,
                "img": (it.get("image") or "").replace("&amp;", "&"),
            })
        # dedupe same item listed in several sections
        seen, uniq = set(), []
        for g in good:
            if g["name"] in seen:
                continue
            seen.add(g["name"]); uniq.append(g)
        cheap_addons = sorted(uniq, key=lambda g: g["price"])[:3]

        for g in uniq:
            text = g["name"].lower()
            if NOT_A_MEAL.search(text):
                text = ""
            row = None
            desc = g["desc"].lower() if COMBO.search(g["name"]) else ""
            for key, cat in CATEGORIES.items():
                if not any(k in text or (text and k in desc) for k in cat["keywords"]):
                    continue
                if row is None:
                    est = estimate(g["price"], listed_fee)
                    row = dict(g, r=rest, est=est)
                    if g["price"] < PRO_FREE_DELIVERY_MIN:
                        # cheapest add-on that unlocks free delivery
                        need = PRO_FREE_DELIVERY_MIN - g["price"]
                        adds = [a for a in uniq if a["name"] != g["name"] and a["price"] >= need]
                        if adds:
                            a = min(adds, key=lambda a: a["price"])
                            row["boost"] = {"name": a["name"], "price": a["price"],
                                            "total": estimate(g["price"] + a["price"], listed_fee)["total"]}
                results[key].append(row)
            if g["old"] and row is None:
                searchable.append(dict(g, r=rest, est=estimate(g["price"], listed_fee)))

    out = {"updated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="minutes"),
           "area": "Al Zahya, Ajman", "categories": {}, "other": []}
    for key, rows in results.items():
        rows.sort(key=lambda r: (r["est"]["total"], -(r["old"] or r["price"])))
        # keep at most 3 items per restaurant so one place doesn't fill the list
        per, kept = {}, []
        for r in rows:
            n = per.get(r["r"]["name"], 0)
            if n >= 3:
                continue
            per[r["r"]["name"]] = n + 1
            kept.append(r)
        out["categories"][key] = {"label": CATEGORIES[key]["label"], "items": kept[:40]}
        print(key, len(rows), "->", len(kept[:40]))
    searchable.sort(key=lambda r: r["est"]["total"])
    out["other"] = searchable[:150]

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
