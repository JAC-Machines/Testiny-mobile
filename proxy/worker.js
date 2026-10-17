const UPSTREAM = "https://app.testiny.io/api/v1";
const ALLOWED_ORIGIN = "https://YOUR-USERNAME.github.io";

const CORS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "X-Api-Key, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    const headers = { "X-Api-Key": req.headers.get("X-Api-Key") || "" };
    const type = req.headers.get("Content-Type");
    if (type) headers["Content-Type"] = type;

    const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
    });

    const res = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  },
};
