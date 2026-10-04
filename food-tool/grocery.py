"""Collect supermarket prices from the grocery stores Talabat delivers to each area.

For every area in areas.json it writes food/grocery-<areaId>.json: the stores
plus their everyday items (milk, eggs, flour, salt, bread, rice ...). The page
at /food searches this file for a shopping list and finds the cheapest store.
"""
import json, os, re, time, datetime, html, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
AREAS = json.load(open(os.path.join(HERE, "areas.json"), encoding="utf-8"))
OUT_DIR = os.path.join(HERE, "..", "food")
BASE = "https://www.talabat.com"
IMG_PREFIX = "https://talabat.dhmedia.io/image/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0 Safari/537.36")
PAUSE = 1.0
MAX_STORES = 7       # biggest supermarkets per area (listing order)
MAX_PAGES = 2        # 20 items a page, per aisle

# Everyday aisles, by Talabat's own sub-category slugs (shared across stores).
AISLES = {
    "eggs", "fresh-milk", "long-life-milk", "powdered-milk", "evaporated-milk",
    "toast", "flatbread", "buns-rolls", "baking-ingredients", "salt", "rice",
    "sugar-sweeteners", "frying-oil", "olive-oil", "ghee", "pastas", "pulses-grains",
    "cheese", "cheese-labneh", "labneh-yog-desserts", "butter", "cream-butter",
    "chicken-poultry", "beef-veal", "lamb-goat", "fish-seafood",
    "fresh-vegetables", "fresh-fruit", "tea", "coffee", "water",
    "spices-seasonings", "pizza-pasta-sauces", "canned-seafood", "canned-vegetables",
    "noodles-soups", "cereals", "spreads", "honey-jams",
    "dishwashing", "detergents", "laundry", "tissues-paper-rolls", "garbage-bags",
}
NOT_A_SUPERMARKET = re.compile(r"pet|paws|sweet|bakery|pharm|flower|fruits? & veg|just fruits", re.I)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html",
                                               "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=40) as r:
        body = r.read().decode("utf-8", "replace")
    time.sleep(PAUSE)
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body, re.S)
    if not m:
        raise ValueError("no page data")
    return json.loads(m.group(1))["props"]["pageProps"]


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


SIZE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:x\s*(\d+(?:[.,]\d+)?)\s*)?(kg|g|gm|gms|grams?|l|ltr|litre|liter|ml|pcs|pieces|piece|pc|eggs|rolls|sheets)\b", re.I)


def size_of(title):
    """'Almarai Milk 2L' -> (2000, 'ml'); '30 Eggs' -> (30, 'pc'). Used for price per kg / litre / piece."""
    t = title.lower().replace(",", ".")
    mult = 1.0
    mm = re.search(r"(\d+)\s*[x×]\s*(?=\d)", t)       # '6 x 1L'
    if mm:
        mult = float(mm.group(1))
    m = SIZE.search(t)
    if not m:
        return None
    if m.group(2):          # '6 x 1L' matched in one go
        mult = 1.0
    a = float(m.group(1)) * (float(m.group(2)) if m.group(2) else 1)
    u = m.group(3).lower()
    if u in ("kg",):
        return [a * 1000 * mult, "g"]
    if u in ("g", "gm", "gms", "gram", "grams"):
        return [a * mult, "g"]
    if u in ("l", "ltr", "litre", "liter"):
        return [a * 1000 * mult, "ml"]
    if u == "ml":
        return [a * mult, "ml"]
    return [a * mult, "pc"]


def stores_for(area):
    pp = get(f"{BASE}/uae/groceries/{area['id']}/{area['slug']}")
    out = []
    mart = (pp.get("talabatMartData") or {}).get("branchId")
    for v in pp.get("vendors") or []:
        if NOT_A_SUPERMARKET.search(v.get("name", "") + " " + (v.get("branchSlug") or "")):
            continue
        out.append(v)
    # talabat mart first, then the listing's own order
    out.sort(key=lambda v: 0 if v.get("branchId") == mart else 1)
    return out[:MAX_STORES]


def run_area(area):
    aid = area["id"]
    stores, items = [], []
    for v in stores_for(area):
        bid, slug = v["branchId"], v.get("branchSlug") or "store"
        root = f"{BASE}/uae/grocery/{bid}/{slug}"
        try:
            cats = get(f"{root}?aid={aid}")["initialState"]["categories"]
        except Exception as e:
            print("store fail", v.get("name"), e)
            continue
        si = len(stores)
        stores.append({
            "name": html.unescape(v.get("name", "")).strip(),
            "logo": v.get("logo"),
            "min": num(v.get("minimumOrderAmount")),
            "fee": num(v.get("deliveryFee")),
            "time": v.get("avgDeliveryTime"),
            "open": v.get("statusCode") in (0, None, "0"),
            "url": f"{root}?aid={aid}",
            "app": f"{BASE}{v['branchUrl']}" if v.get("branchUrl") else None,
        })
        seen = set()
        n0 = len(items)
        for c in cats:
            for sub in c.get("subCategories") or []:
                if sub.get("slug") not in AISLES:
                    continue
                for page in range(1, MAX_PAGES + 1):
                    url = f"{root}/{c['slug']}/{sub['slug']}?aid={aid}" + (f"&page={page}" if page > 1 else "")
                    try:
                        d = get(url)["initialState"]["itemsData"]
                    except Exception as e:
                        print("aisle fail", v.get("name"), sub["slug"], e)
                        break
                    for it in d.get("items") or []:
                        if it.get("id") in seen or not it.get("stockAmount", 1):
                            continue
                        seen.add(it.get("id"))
                        title = html.unescape(it.get("title") or "").strip()
                        price, orig = num(it.get("price")), num(it.get("originalPrice"))
                        img = it.get("image") or ""
                        if img.startswith(IMG_PREFIX):
                            img = img[len(IMG_PREFIX):]
                        # [store, aisle, title, price, old price, image, size]
                        items.append([si, sub["slug"], title, price,
                                      orig if orig > price else 0, img, size_of(title)])
                    if page >= (d.get("pageCount") or 1):
                        break
        print(stores[-1]["name"], len(items) - n0, "items")

    out = {"updated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="minutes"),
           "area": area["name"], "img": IMG_PREFIX, "stores": stores, "items": items}
    path = os.path.join(OUT_DIR, f"grocery-{aid}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", path, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for a in AREAS:
        try:
            run_area(a)
        except Exception as e:
            print("area failed", a["slug"], e)
