// أرخص أكلة — live Talabat prices for any UAE area.
// Runs on Cloudflare Workers. The page at aahmedassem.com/food calls:
//   GET /food?area=<id>&slug=<slug>&cat=<pizza|burger|egyptian|mandi|seafood>
//   GET /grocery?area=<id>&slug=<slug>&items=<لبن,بيض,دقيق,...>
// Results are cached for a few hours per area so repeat opens are instant and
// Talabat only sees a handful of page loads.

const BASE = "https://www.talabat.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const ALLOWED_ORIGINS = ["https://aahmedassem.com", "https://www.aahmedassem.com"];
const FOOD_TTL = 3 * 3600;      // seconds
const GROCERY_TTL = 6 * 3600;
const MAX_MENUS = 24;            // free plan allows 50 outbound requests per call
const MAX_STORES = 5;
const REQUEST_BUDGET = 46;       // keep under the 50 outbound requests limit

// talabat pro rules learned from real carts
const PRO_FREE_DELIVERY_MIN = 30, DELIVERY_FALLBACK = 6.9;
const SMALL_ORDER_LIMIT = 20, SMALL_ORDER_FEE = 2;
const SERVICE_RATE = 0.10, SERVICE_CAP = 3.25;

const CATEGORIES = {
  egyptian: { label: "أكل مصري", cuisines: ["egyptian", "koshary"], extra: ["grills", "arabic"],
    keywords: ["bechamel", "béchamel", "bashamel", "macaroni", "makarona", "kofta", "kufta", "koshary", "koshari",
      "kushari", "molokhia", "mulukhiyah", "hawawshi", "feteer", "fiteer", "mahshi",
      "مكرونة", "مكرونه", "بشاميل", "كفتة", "كفته", "كشري", "ملوخية", "حواوشي", "فطير", "محشي"] },
  burger: { label: "برجر", cuisines: ["burgers"], keywords: ["burger", "برجر", "برغر"] },
  pizza: { label: "بيتزا", cuisines: ["pizza"], keywords: ["pizza", "بيتزا", "margherita", "pepperoni"] },
  mandi: { label: "مندي", cuisines: ["mandi"],
    keywords: ["mandi", "mandhi", "مندي", "madfoon", "madghut", "مظبي", "madhbi", "kabsa", "كبسة"] },
  seafood: { label: "سي فود", cuisines: ["seafood", "fishseafood"],
    keywords: ["fish", "shrimp", "prawn", "seafood", "hammour", "hamour", "salmon", "calamari", "sayadieh",
      "sayadiya", "crab", "سمك", "جمبري", "روبيان", "هامور", "صيادية", "كاليماري", "سلمون"] },
};
const SKIP_SECTIONS = /drink|beverage|juice|dip|sauce|extra|add[- ]?on|dessert|sweet|soft|water|مشروب|عصير|صوص|اضاف|إضاف|حلو/i;
const NOT_A_MEAL = /cracker|chips|slice|salad|sauce|dip\b|soup|spring roll|rice only|without rice|seasoning|pie\b/i;
const COMBO = /deal|meal|combo|box|offer|bundle|duo|trio|feast|وجبة|عرض|كومبو/i;
const MIN_ITEM_PRICE = 8;

// Shopping-list words -> Talabat aisles (+ words the product title must / must not contain)
const GROCERY = [
  { k: ["لبن", "حليب", "milk"], label: "لبن", aisles: ["fresh-milk", "long-life-milk"], must: ["milk"], not: ["chocolate", "strawberry", "banana", "flavour", "flavored", "coffee", "condensed"], typical: [900, 2500, "ml"] },
  { k: ["بيض", "egg", "eggs"], label: "بيض", aisles: ["eggs"], must: ["egg"], typical: [12, 30, "pc"] },
  { k: ["دقيق", "طحين", "flour"], label: "دقيق", aisles: ["baking-ingredients"], must: ["flour"], not: ["besan", "corn", "rice", "gram", "chickpea", "self raising", "tapioca", "almond", "coconut"], typical: [900, 2500, "g"] },
  { k: ["ملح", "salt"], label: "ملح", aisles: ["salt"], must: ["salt"], not: ["pepper", "himalayan", "rock"], typical: [500, 1100, "g"] },
  { k: ["خبز", "عيش", "bread", "توست"], label: "عيش", aisles: ["flatbread", "toast"] },
  { k: ["رز", "أرز", "ارز", "rice"], label: "رز", aisles: ["rice"], must: ["rice"], not: ["powder", "flour", "cake", "noodle", "vermicelli"], typical: [900, 5100, "g"] },
  { k: ["سكر", "sugar"], label: "سكر", aisles: ["sugar-sweeteners"], must: ["sugar"], not: ["free", "stevia", "brown", "icing"], typical: [900, 2100, "g"] },
  { k: ["زيت", "oil"], label: "زيت", aisles: ["frying-oil", "olive-oil"], must: ["oil"], typical: [750, 1900, "ml"] },
  { k: ["مكرونة", "مكرونه", "باستا", "pasta"], label: "مكرونة", aisles: ["pastas"] },
  { k: ["جبنة", "جبنه", "جبن", "cheese"], label: "جبنة", aisles: ["cheese", "cheese-labneh"] },
  { k: ["زبدة", "زبده", "butter"], label: "زبدة", aisles: ["butter", "cream-butter"], must: ["butter"], not: ["peanut"] },
  { k: ["زبادي", "روب", "yoghurt", "yogurt"], label: "زبادي", aisles: ["labneh-yog-desserts"], must: ["yog"] },
  { k: ["فراخ", "دجاج", "chicken"], label: "فراخ", aisles: ["chicken-poultry"] },
  { k: ["لحمة", "لحم", "meat", "beef"], label: "لحمة", aisles: ["beef-veal", "lamb-goat"] },
  { k: ["سمك", "fish"], label: "سمك", aisles: ["fish-seafood"] },
  { k: ["طماطم", "قوطة", "tomato"], label: "طماطم", aisles: ["fresh-vegetables"], must: ["tomato"] },
  { k: ["بطاطس", "potato"], label: "بطاطس", aisles: ["fresh-vegetables"], must: ["potato"], not: ["sweet"] },
  { k: ["بصل", "onion"], label: "بصل", aisles: ["fresh-vegetables"], must: ["onion"] },
  { k: ["خيار", "cucumber"], label: "خيار", aisles: ["fresh-vegetables"], must: ["cucumber"] },
  { k: ["موز", "banana"], label: "موز", aisles: ["fresh-fruit"], must: ["banana"] },
  { k: ["تفاح", "apple"], label: "تفاح", aisles: ["fresh-fruit"], must: ["apple"] },
  { k: ["شاي", "tea"], label: "شاي", aisles: ["tea"] },
  { k: ["قهوة", "بن", "coffee"], label: "قهوة", aisles: ["coffee"] },
  { k: ["مية", "مياه", "ماء", "water"], label: "مية", aisles: ["water"], must: ["water"], not: ["sparkling", "coconut", "flavour"] },
  { k: ["عدس", "lentil"], label: "عدس", aisles: ["pulses-grains"], must: ["lentil"] },
  { k: ["فول", "fava", "foul"], label: "فول", aisles: ["pulses-grains", "canned-vegetables"], must: ["fava", "foul", "ful "] },
  { k: ["تونة", "تونه", "tuna"], label: "تونة", aisles: ["canned-seafood"], must: ["tuna"] },
  { k: ["صابون مواعين", "سائل غسيل", "dishwashing"], label: "صابون مواعين", aisles: ["dishwashing"] },
  { k: ["مناديل", "tissue"], label: "مناديل", aisles: ["tissues-paper-rolls"] },
];

// ---------- helpers ----------
let ERRORS = [];   // per request, returned when ?debug=1
const num = x => { const n = parseFloat(x); return Number.isFinite(n) ? n : 0; };
const unescape = s => String(s || "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();

async function page(url, ctx, ttl) {
  // HTML page -> __NEXT_DATA__.props.pageProps. Cached by Cloudflare's own fetch cache, which
  // (unlike the Cache API) doesn't count extra against the 50-requests-per-search limit.
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9" },
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  if (!res.ok) { ERRORS.push(`${res.status} ${url.slice(25, 110)}`); throw new Error(`talabat ${res.status}`); }
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no page data");
  return JSON.parse(m[1]).props.pageProps;
}

function estimate(subtotal, listedFee) {
  const delivery = subtotal >= PRO_FREE_DELIVERY_MIN ? 0 : (listedFee || DELIVERY_FALLBACK);
  const small = subtotal < SMALL_ORDER_LIMIT ? SMALL_ORDER_FEE : 0;
  const service = Math.round(Math.min(subtotal * SERVICE_RATE, SERVICE_CAP) * 100) / 100;
  return { delivery, small, service, total: Math.round((subtotal + delivery + small + service) * 100) / 100 };
}

async function inBatches(list, size, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(...await Promise.all(list.slice(i, i + size).map(fn)));
  return out;
}

// ---------- restaurants ----------
async function listing(area, slug, cuisine, ctx, maxPages = 3) {
  const vendors = [];
  for (let p = 1; p <= maxPages; p++) {
    const d = (await page(`${BASE}/uae/restaurants/${area}/${slug}?cuisine=${cuisine}${p > 1 ? `&page=${p}` : ""}`, ctx, FOOD_TTL)).data;
    vendors.push(...(d.vendors || []));
    if (!d.vendors?.length || vendors.length >= (d.totalVendors || 0)) break;
  }
  return vendors;
}

async function food(area, slug, catKey, ctx) {
  const cat = CATEGORIES[catKey];
  if (!cat) throw new Error("unknown category");
  const byId = new Map();
  for (const cu of cat.cuisines) for (const v of await listing(area, slug, cu, ctx)) byId.set(v.branchId, { v, prio: 0 });
  for (const cu of cat.extra || []) for (const v of (await listing(area, slug, cu, ctx, 1)).slice(0, 8)) if (!byId.has(v.branchId)) byId.set(v.branchId, { v, prio: 1 });
  const chosen = [...byId.values()].sort((a, b) => a.prio - b.prio).slice(0, MAX_MENUS).map(x => x.v);

  const rows = (await inBatches(chosen, 12, async v => {
    let ms;
    try { ms = (await page(`${BASE}${v.menuUrl}?aid=${area}`, ctx, FOOD_TTL)).initialMenuState; } catch (e) { ERRORS.push("menu: " + e.message); return []; }
    const fee = num(v.deliveryFee);
    const rest = {
      name: unescape(v.name), url: `${BASE}${v.menuUrl}?aid=${area}`,
      app: v.branchUrl ? `${BASE}${v.branchUrl}` : null,
      rating: v.rate, logo: v.logo, time: v.avgDeliveryTime,
      open: v.statusCode === 0 || v.statusCode == null || v.statusCode === "0",
    };
    const seen = new Set(), items = [];
    for (const it of ms?.menuData?.items || []) {
      const price = num(it.price), name = unescape(it.name);
      if (price < MIN_ITEM_PRICE || seen.has(name)) continue;
      let sec = it.originalSection || it.sectionName || ""; if (typeof sec === "object") sec = sec?.name || "";
      if (SKIP_SECTIONS.test(String(sec))) continue;
      seen.add(name);
      const old = num(it.oldPrice);
      items.push({ name, desc: unescape(it.description).slice(0, 140), price, old: old > price ? old : null,
        img: (it.image || "").replace(/&amp;/g, "&") });
    }
    const out = [];
    for (const g of items) {
      const text = NOT_A_MEAL.test(g.name) ? "" : g.name.toLowerCase();
      const desc = COMBO.test(g.name) ? g.desc.toLowerCase() : "";
      if (!text || !cat.keywords.some(k => text.includes(k) || desc.includes(k))) continue;
      const row = { ...g, r: rest, est: estimate(g.price, fee) };
      if (g.price < PRO_FREE_DELIVERY_MIN) {
        const need = PRO_FREE_DELIVERY_MIN - g.price;
        const add = items.filter(a => a.name !== g.name && a.price >= need).sort((a, b) => a.price - b.price)[0];
        if (add) row.boost = { name: add.name, price: add.price, total: estimate(g.price + add.price, fee).total };
      }
      out.push(row);
    }
    return out;
  })).flat();

  rows.sort((a, b) => a.est.total - b.est.total);
  const per = {}, kept = [];
  for (const r of rows) { if ((per[r.r.name] = (per[r.r.name] || 0) + 1) <= 4) kept.push(r); }
  return { label: cat.label, items: kept.slice(0, 40) };
}

// ---------- groceries ----------
const SIZE = /(\d+(?:[.,]\d+)?)\s*(?:x\s*(\d+(?:[.,]\d+)?)\s*)?(kg|g|gm|gms|grams?|l|ltr|litre|liter|ml|pcs|pieces|piece|pc|eggs|rolls|sheets)\b/i;
function sizeOf(title) {
  const t = title.toLowerCase().replace(/,/g, ".");
  const m = t.match(SIZE); if (!m) return null;
  let mult = 1; const mm = t.match(/(\d+)\s*[x×]\s*(?=\d)/); if (mm && !m[2]) mult = +mm[1];
  const a = parseFloat(m[1]) * (m[2] ? parseFloat(m[2]) : 1) * mult, u = m[3].toLowerCase();
  if (u === "kg") return [a * 1000, "g"];
  if (/^(g|gm|gms|grams?)$/.test(u)) return [a, "g"];
  if (/^(l|ltr|litre|liter)$/.test(u)) return [a * 1000, "ml"];
  if (u === "ml") return [a, "ml"];
  return [a, "pc"];
}
function unitPrice(price, size) {
  if (!size || !size[0]) return null;
  const [q, u] = size;
  if (u === "g") return { v: price / q * 1000, u: "كيلو" };
  if (u === "ml") return { v: price / q * 1000, u: "لتر" };
  return { v: price / q, u: "حبة" };
}
function parseList(text) {
  const words = String(text).split(/[,،\n+]| و /).map(w => w.trim().toLowerCase()).filter(Boolean);
  return words.map(w => ({ word: w, rule: GROCERY.find(g => g.k.some(k => w === k || w.includes(k))) || null }));
}

async function grocery(area, slug, list, ctx) {
  const wanted = parseList(list);
  const known = wanted.filter(w => w.rule);
  const pp = await page(`${BASE}/uae/groceries/${area}/${slug}`, ctx, GROCERY_TTL);
  const mart = pp.talabatMartData?.branchId;
  const stores = (pp.vendors || [])
    .filter(v => !/pet|paws|sweet|bakery|pharm|flower|fruits? & veg|just fruits/i.test(`${v.name} ${v.branchSlug}`))
    .sort((a, b) => (a.branchId === mart ? 0 : 1) - (b.branchId === mart ? 0 : 1))
    ;
  const aislesNeeded = [...new Set(known.flatMap(w => w.rule.aisles))];
  // each store costs 1 request for its aisles list + 1 per aisle
  stores.splice(Math.max(1, Math.min(MAX_STORES, Math.floor((REQUEST_BUDGET - 1) / (aislesNeeded.length + 1)))));

  const perStore = await Promise.all(stores.map(async v => {
    const root = `${BASE}/uae/grocery/${v.branchId}/${v.branchSlug}`;
    const store = {
      name: unescape(v.name), logo: v.logo, min: num(v.minimumOrderAmount), fee: num(v.deliveryFee),
      time: v.avgDeliveryTime, open: v.statusCode === 0 || v.statusCode == null,
      url: `${root}?aid=${area}`, app: v.branchUrl ? `${BASE}${v.branchUrl}` : null,
    };
    let cats;
    try { cats = (await page(`${root}?aid=${area}`, ctx, GROCERY_TTL)).initialState.categories; } catch (e) { ERRORS.push("store: " + e.message); return { store, products: [] }; }
    const where = {};
    for (const c of cats) for (const s of c.subCategories || []) if (aislesNeeded.includes(s.slug) && !where[s.slug]) where[s.slug] = c.slug;
    const products = [];
    await Promise.all(Object.entries(where).map(async ([sub, catSlug]) => {
      try {
        const d = (await page(`${root}/${catSlug}/${sub}?aid=${area}`, ctx, GROCERY_TTL)).initialState.itemsData;
        for (const it of d.items || []) {
          if (it.stockAmount === 0) continue;
          const title = unescape(it.title), price = num(it.price), orig = num(it.originalPrice);
          products.push({ aisle: sub, title, price, old: orig > price ? orig : null, img: it.image, size: sizeOf(title) });
        }
      } catch (e) { ERRORS.push("aisle: " + e.message); }
    }));
    return { store, products };
  }));

  const results = known.map(w => {
    const r = w.rule;
    const matches = [];
    perStore.forEach(({ store, products }, si) => {
      for (const p of products) {
        if (!r.aisles.includes(p.aisle)) continue;
        const t = p.title.toLowerCase();
        if (r.must && !r.must.some(m => t.includes(m))) continue;
        if (r.not && r.not.some(m => t.includes(m))) continue;
        matches.push({ ...p, store: si, unit: unitPrice(p.price, p.size) });
      }
    });
    const cheapest = [...matches].sort((a, b) => a.price - b.price).slice(0, 5);
    const bestValue = matches.filter(m => m.unit).sort((a, b) => a.unit.v - b.unit.v).slice(0, 5);
    // basket pick per store: cheapest normal-size pack (e.g. 1-2L milk, not a 180ml carton)
    const normal = m => !r.typical || (m.size && m.size[1] === r.typical[2] && m.size[0] >= r.typical[0] && m.size[0] <= r.typical[1]);
    const perStoreCheapest = perStore.map((_, si) => {
      const mine = matches.filter(m => m.store === si);
      return mine.filter(normal).sort((a, b) => a.price - b.price)[0]
        || mine.filter(m => m.unit).sort((a, b) => a.unit.v - b.unit.v)[0]
        || mine.sort((a, b) => a.price - b.price)[0] || null;
    });
    return { word: w.word, label: r.label, cheapest, bestValue, perStoreCheapest };
  });

  const baskets = perStore.map(({ store }, si) => {
    const picks = results.map(r => r.perStoreCheapest[si]);
    const found = picks.filter(Boolean);
    const subtotal = Math.round(found.reduce((s, p) => s + p.price, 0) * 100) / 100;
    return { store: si, found: found.length, of: results.length, subtotal, belowMin: subtotal < store.min };
  }).sort((a, b) => (b.found - a.found) || (a.subtotal - b.subtotal));

  return { stores: perStore.map(s => s.store), results, baskets,
    unknown: wanted.filter(w => !w.rule).map(w => w.word),
    supported: GROCERY.map(g => g.label) };
}

// ---------- http ----------
function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "");
  return { "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0], "Vary": "Origin" };
}
const json = (data, origin, status = 200, maxAge = 600) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${maxAge}`, ...cors(origin) } });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), origin = req.headers.get("Origin");
    ERRORS = [];
    const debug = url.searchParams.get("debug") === "1";
    if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors(origin), "Access-Control-Allow-Methods": "GET" } });
    const area = parseInt(url.searchParams.get("area"), 10);
    const slug = (url.searchParams.get("slug") || "").replace(/[^a-z0-9-]/g, "");
    try {
      if (url.pathname === "/") return json({ ok: true, service: "arkhas-akla" }, origin);
      if (!area || !slug) return json({ error: "area and slug are required" }, origin, 400);
      if (url.pathname === "/food") {
        const cat = url.searchParams.get("cat") || "pizza";
        const t0 = Date.now(), data = await food(area, slug, cat, ctx);
        return json({ updated: new Date().toISOString(), ...data, ...(debug ? { ms: Date.now() - t0, errors: ERRORS.slice(0, 30) } : {}) }, origin, 200, debug ? 0 : 1800);
      }
      if (url.pathname === "/grocery") {
        const items = (url.searchParams.get("items") || "").slice(0, 300);
        const t0 = Date.now(), data = await grocery(area, slug, items, ctx);
        return json({ updated: new Date().toISOString(), ...data, ...(debug ? { ms: Date.now() - t0, errors: ERRORS.slice(0, 30) } : {}) }, origin, 200, debug ? 0 : 1800);
      }
      return json({ error: "not found" }, origin, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, origin, 502, 0);
    }
  },
};
