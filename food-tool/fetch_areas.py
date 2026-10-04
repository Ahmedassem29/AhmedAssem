"""Save Talabat's list of UAE areas (id, slug, name, city, centre) for the page's 'nearest area' lookup."""
import json, os, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
req = urllib.request.Request("https://www.talabat.com/nextLocationApi/location/country-areas/4",
                             headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
areas = json.load(urllib.request.urlopen(req, timeout=40))["areas"]
slim = [[a["id"], a["slug"], a["name"], a["cityName"], round(a["lat"], 5), round(a["lng"], 5)] for a in areas]
with open(os.path.join(HERE, "..", "food", "talabat-areas.json"), "w", encoding="utf-8") as f:
    json.dump(slim, f, ensure_ascii=False, separators=(",", ":"))
print(len(slim), "areas")
