import re, json, urllib.request, os, sys
os.makedirs("food-tool/out", exist_ok=True)
sys.stdout = open("food-tool/out/log.txt","w")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", "Accept": "text/html,application/json"})
    try:
        r = urllib.request.urlopen(req, timeout=30)
        return r.status, r.read().decode("utf-8", "replace")
    except Exception as e:
        return getattr(e, "code", 0), str(e)[:300]
def nd(html):
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    return json.loads(m.group(1)) if m else None
def keys(o, depth=0, path="", out=None, maxd=6):
    out = [] if out is None else out
    if depth > maxd: return out
    if isinstance(o, dict):
        for k, v in o.items():
            p = f"{path}.{k}"
            out.append(f"{p} : {type(v).__name__}{'['+str(len(v))+']' if isinstance(v,(list,dict)) else ''}")
            keys(v, depth+1, p, out, maxd)
    elif isinstance(o, list) and o:
        keys(o[0], depth+1, path+"[0]", out, maxd)
    return out
for name, url in [
  ("tlist", "https://www.talabat.com/uae/restaurants/3986/al-zahya?cuisine=pizza"),
  ("tmenu", "https://www.talabat.com/uae/restaurant/786351/pizzaro-italian-pizza-pasta-dh-kitchen-al-jurfal-jurf-2?aid=3986"),
  ("noon", "https://food.noon.com/uae-en/"),
  ("noonsearch", "https://food.noon.com/search/?f%5Bcuisines%5D=pizza&type=outlet"),
  ("noonoutlet", "https://food.noon.com/outlet/MSTRPZXDQ7/"),
]:
    s, h = get(url)
    print("=====", name, s, len(h))
    d = nd(h) if s == 200 else None
    if d:
        ks = keys(d)
        print("\n".join(ks[:250]))
        open(f"food-tool/out/{name}.json","w").write(json.dumps(d))
    else:
        print(h[:1500])
        open(f"food-tool/out/{name}.html","w").write(h[:400000])
        print("API-like urls:", sorted(set(re.findall(r'https?://[a-z0-9.-]*(?:api|noon)[a-z0-9./_-]*', h)))[:40])
