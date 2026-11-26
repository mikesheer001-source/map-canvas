import { createBoardStore, MapError } from "./board.mjs";
import { createResourceStore } from "./resources.mjs";
import { imageType } from "./image-type.ts";

const prefix = "/api/shared-map";
const allowedOrigin = "https://mikesheer001-source.github.io";
const maxPhotoBytes = 5 * 1024 * 1024;

async function readBytes(request: Request, limit: number) {
  if (!request.body) throw new MapError("Request body required.");
  if (Number(request.headers.get("Content-Length")) > limit) throw new MapError("Request too large.", 413);
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new MapError("Request too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks);
}

async function readJSON(request: Request, limit: number) {
  const payload = JSON.parse(await (await readBytes(request, limit)).text());
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new MapError("Invalid request.");
  return payload;
}

async function upload(request: Request, bucket: R2Bucket, url: URL) {
  const body = await readBytes(request, maxPhotoBytes + 32768);
  const form = await new Response(body, {
    headers: { "Content-Type": request.headers.get("Content-Type") || "" }
  }).formData().catch(() => { throw new MapError("Send a photo as multipart form data."); });
  const file = form.get("photo");
  if (!(file instanceof File) || !file.size) throw new MapError("Choose a photo first.");
  if (file.size > maxPhotoBytes) throw new MapError("Photos can be up to 5 MB.", 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = imageType(bytes);
  if (!contentType) throw new MapError("Use a JPG, PNG, WebP, or GIF image.", 415);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const id = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  await bucket.put(`shared-map/${id}`, bytes, { httpMetadata: { contentType } });
  return { photo: new URL(`${prefix}/photo/${id}`, url).href };
}

export default {
  async fetch(request: Request, env: { DB: D1Database; BUCKET: R2Bucket; MAP_WRITES_ENABLED?: string }) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
      "X-Content-Type-Options": "nosniff"
    });
    const json = (value: unknown, status = 200) => Response.json(value, { headers, status });
    if (origin && origin !== allowedOrigin && origin !== url.origin) return json({ error: "Origin unavailable." }, 403);
    if (origin) headers.set("Access-Control-Allow-Origin", origin);

    const { method } = request;
    const path = url.pathname;
    const pin = path.match(/^\/api\/shared-map\/pins\/([a-f0-9-]+|hostel-[0-9]+)$/i);
    const trash = path.match(/^\/api\/shared-map\/trash\/([a-f0-9-]+|hostel-[0-9]+)$/i);
    const photo = path.match(/^\/api\/shared-map\/photo\/([a-f0-9]{64})$/);
    const resourceCollection = path.match(/^\/api\/shared-map\/(routes|itineraries)$/);
    const resourceItem = path.match(/^\/api\/shared-map\/(routes|itineraries)\/([a-z0-9_-]{1,80})$/i);
    const store = createBoardStore(env.DB);
    const resources = createResourceStore(env.DB);
    const writesEnabled = env.MAP_WRITES_ENABLED === "true";
    try {
      if (method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (method === "GET" && path === prefix + "/pins") return json(await store.list());
      if (method === "GET" && resourceCollection) return json(await resources.list(resourceCollection[1] === "routes" ? "route" : "itinerary"));
      if (method === "GET" && path === prefix + "/trash") return json(await store.listDeleted(writesEnabled));
      if (method === "GET" && photo) {
        const object = await env.BUCKET.get(`shared-map/${photo[1]}`);
        if (!object) return json({ error: "Photo unavailable." }, 404);
        object.writeHttpMetadata(headers);
        headers.set("Cache-Control", "public, max-age=31536000, immutable");
        return new Response(object.body, { headers });
      }

      if (["POST", "PUT", "DELETE"].includes(method) && !writesEnabled)
        return json({ error: "Map editing is temporarily paused." }, 503);
      if (method === "PUT" && resourceItem) {
        const { item, expectedVersion } = await readJSON(request, 270000);
        return json(await resources.put(resourceItem[1] === "routes" ? "route" : "itinerary", resourceItem[2], item, expectedVersion));
      }
      if (method === "DELETE" && resourceItem) {
        const { expectedVersion } = await readJSON(request, 1000);
        return json(await resources.remove(resourceItem[1] === "routes" ? "route" : "itinerary", resourceItem[2], expectedVersion));
      }
      if (method === "POST" && path === prefix + "/photo") return json(await upload(request, env.BUCKET, url));
      if (method === "POST" && trash) {
        const { expectedVersion } = await readJSON(request, 1000);
        return json(await store.restore(trash[1], expectedVersion));
      }
      if (method === "POST" && path === prefix + "/import") {
        const { entries, mode, expectedRevision } = await readJSON(request, 1800000);
        return json(await store.import(entries, mode, expectedRevision));
      }
      if (method === "PUT" && pin) {
        const { entry, expectedVersion } = await readJSON(request, 120000);
        return json(await store.put(pin[1], entry, expectedVersion));
      }
      if (method === "DELETE" && pin) {
        const { expectedVersion } = await readJSON(request, 1000);
        return json(await store.remove(pin[1], expectedVersion));
      }
      return json({ error: "Map endpoint unavailable." }, 404);
    } catch (error) {
      if (error instanceof MapError) return json({ error: error.message }, error.status);
      if (error instanceof SyntaxError) return json({ error: "Invalid request." }, 400);
      console.error("Shared map request failed", error);
      return json({ error: "Shared map storage is temporarily unavailable." }, 503);
    }
  }
};
