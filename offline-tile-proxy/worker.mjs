const APP_ORIGIN = "https://mikesheer001-source.github.io";
const APP_REFERER = APP_ORIGIN + "/map-canvas/";
const APP_USER_AGENT = "MapCanvas/1.0 (+https://mikesheer001-source.github.io/map-canvas/)";

function isAllowedOrigin(origin) {
  if (origin === APP_ORIGIN) return true;
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol);
  } catch { return false; }
}

function corsHeaders(origin) {
  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "Cache-Control, ETag, Last-Modified, Expires, Content-Length",
    "Vary": "Origin"
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    if (!isAllowedOrigin(origin)) return new Response("Origin not allowed.", { status: 403 });
    const headers = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "GET") return new Response("Method not allowed.", { status: 405, headers });

    const requestUrl = new URL(request.url);
    if (requestUrl.pathname !== "/proxy") return new Response("Not found.", { status: 404, headers });
    let target;
    try { target = new URL(requestUrl.searchParams.get("url") || ""); }
    catch { return new Response("Invalid upstream URL.", { status: 400, headers }); }
    if (target.protocol !== "https:" || target.hostname !== "tiles.openfreemap.org" ||
        target.username || target.password || (target.port && target.port !== "443")) {
      return new Response("Only OpenFreeMap tile resources are allowed.", { status: 400, headers });
    }
    target.hash = "";

    try {
      const upstream = await fetch(target.href, {
        headers: {
          "User-Agent": APP_USER_AGENT,
          "Referer": APP_REFERER,
          "Accept": request.headers.get("Accept") || "*/*"
        },
        redirect: "manual"
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        return new Response("OpenFreeMap returned an unexpected redirect.", { status: 502, headers });
      }
      for (const name of ["Content-Type", "Cache-Control", "ETag", "Last-Modified", "Expires", "Content-Length"]) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
      }
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
    } catch {
      return new Response("Could not retrieve the OpenFreeMap resource.", { status: 502, headers });
    }
  }
};
