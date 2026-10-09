// Zayyi — shared store for school dress-up dates that parents confirm from circulars.
// GET  /reports?school=<id>                -> { reports: [...] }
// POST /reports {school,event,date,note}   -> { ok: true, report }
const ORIGINS = ["https://aahmedassem.com", "https://www.aahmedassem.com"];
const EVENTS = ["career","football","pink","halloween","flag","diwali","oddsocks","national","arabic","sports","haqallaila","international","worldbook","childrensday","autism","earth"];
const SCHOOL_RE = /^[a-z0-9-]{2,40}$/;
const DATE_MIN = "2026-08-31", DATE_MAX = "2027-07-02";
const MAX_WRITES_PER_HOUR = 20;

function cors(req) {
  const o = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
const json = (req, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(req) } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    if (url.pathname !== "/reports") return json(req, { error: "not_found" }, 404);

    if (req.method === "GET") {
      const school = url.searchParams.get("school") || "";
      if (!SCHOOL_RE.test(school)) return json(req, { error: "bad_school" }, 400);
      const list = await env.REPORTS.list({ prefix: `r:${school}:` });
      const reports = (await Promise.all(list.keys.map(k => env.REPORTS.get(k.name, "json")))).filter(Boolean);
      return json(req, { reports });
    }

    if (req.method === "POST") {
      const origin = req.headers.get("Origin") || "";
      if (!ORIGINS.includes(origin)) return json(req, { error: "forbidden" }, 403);
      let b;
      try { b = await req.json(); } catch { return json(req, { error: "bad_json" }, 400); }
      const school = String(b.school || ""), event = String(b.event || ""), date = String(b.date || "");
      const note = String(b.note || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 140);
      if (!SCHOOL_RE.test(school) || !EVENTS.includes(event)) return json(req, { error: "bad_input" }, 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < DATE_MIN || date > DATE_MAX) return json(req, { error: "bad_date" }, 400);

      const ip = req.headers.get("CF-Connecting-IP") || "unknown";
      const rlKey = `ip:${ip}:${new Date().toISOString().slice(0, 13)}`;
      const count = parseInt((await env.REPORTS.get(rlKey)) || "0", 10);
      if (count >= MAX_WRITES_PER_HOUR) return json(req, { error: "rate_limited" }, 429);
      await env.REPORTS.put(rlKey, String(count + 1), { expirationTtl: 3700 });

      const report = { school, event, date, note, at: new Date().toISOString() };
      await env.REPORTS.put(`r:${school}:${event}`, JSON.stringify(report));
      return json(req, { ok: true, report });
    }
    return json(req, { error: "method_not_allowed" }, 405);
  },
};
