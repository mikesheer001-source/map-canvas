import { createHash } from "node:crypto";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { lstat, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const production = "https://map-canvas-api.mikesheer001.workers.dev/api/shared-map";
const pinId = /^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|hostel-[0-9]+)$/i;
const photoFile = /^publish\/photos\/[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:jpe?g|png|webp|gif)$/i;
const fields = new Set("id kind category title lat lng price rating bookingRating breakfast link notes photo source icon color gallery layer group canvas".split(" "));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const legacyPhotoSources = new Set(["vpt-en.b-cdn.net","www.asiatouradvisor.com","authentikvietnam.com","upload.wikimedia.org","cdn-i.vtcnews.vn","bucketlist2life.com","sapa-tourism.com","lilystravelagency.com","cdn.getyourguide.com","kampatour.com","vietnamdiscovery.com","duaelbluiumc3.cloudfront.net","d3rftsiup4wf15.cloudfront.net","img1.daumcdn.net"]);
function imageMime(bytes){
  if(bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255)return "image/jpeg";
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return "image/png";
  if(bytes.toString("ascii",0,4)==="RIFF" && bytes.toString("ascii",8,12)==="WEBP")return "image/webp";
  if(/^GIF8[79]a$/.test(bytes.toString("ascii",0,6)))return "image/gif";
  return "";
}

async function request(call, url, options) {
  const response = await call(url, options);
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(`Map API HTTP ${response.status}: ${detail.error ?? response.statusText}`);
  }
  return response;
}

async function storeVerifiedImage(bytes, name, mime, {base,call}) {
  if (!bytes.length || bytes.length > 5*1024*1024) throw new Error("Photo must be an image up to 5 MiB.");
  const hash=digest(bytes), url=base+"/photo/"+hash;
  let response=await call(url);
  if(response.status===404){
    const body=new FormData();
    body.append("photo",new Blob([bytes],{type:mime}),name);
    await request(call,base+"/photo",{method:"POST",body});
    response=await request(call,url);
  }
  if(!response.ok || digest(Buffer.from(await response.arrayBuffer()))!==hash)throw new Error("Stored photo verification failed.");
  return url;
}
async function resolvePhoto(photo, { base, root, call, mirrorPhoto=false, legacyRepair=false }) {
  if (photo === "") return photo;
  if (typeof photo === "string" && photoFile.test(photo)) {
    const file = resolve(root, photo);
    const info = await lstat(file);
    if (!info.isFile() || info.size === 0 || info.size > 5 * 1024 * 1024) {
      throw new Error("A photo file must be a regular image file of up to 5 MiB.");
    }
    const bytes = await readFile(file);
    const hash = digest(bytes);
    const url = base + "/photo/" + hash;
    let response = await call(url);
    if (response.status === 404) {
      const body = new FormData();
      body.append("photo", new Blob([bytes]), basename(photo));
      await request(call, base + "/photo", { method: "POST", body });
      response = await request(call, url);
    }
    if (!response.ok || digest(Buffer.from(await response.arrayBuffer())) !== hash) {
      throw new Error("The published photo could not be verified.");
    }
    return url;
  }
  const url = typeof photo === "string" ? URL.parse(photo) : null;
  if (url?.protocol === "https:" && !url.username && !url.password) {
    if(photo.startsWith(base+"/photo/") && /^[a-f0-9]{64}$/.test(photo.slice((base+"/photo/").length))){
      const response=await request(call,photo);
      const bytes=Buffer.from(await response.arrayBuffer());
      if(!imageMime(bytes)||digest(bytes)!==photo.slice(-64))throw new Error("Stored image is invalid.");
      return photo;
    }
    if(!mirrorPhoto)throw new Error("External hotlinks are not permitted; commit an image file or explicitly mirror a licensed Wikimedia image.");
    if(url.hostname!=="upload.wikimedia.org" && !(legacyRepair && legacyPhotoSources.has(url.hostname)))throw new Error("Unapproved image origin; commit a permitted image file instead.");
    const response=await request(call,photo,{redirect:"error",signal:AbortSignal.timeout(20000),headers:{"User-Agent":"MapCanvasImageImport/1.0","Accept":"image/jpeg,image/png,image/webp,image/gif"}});
    if(Number(response.headers.get("content-length"))>5*1024*1024)throw new Error("Photo exceeds 5 MiB.");
    const bytes=Buffer.from(await response.arrayBuffer()),mime=imageMime(bytes);
    if(!mime)throw new Error("Source returned no supported image bytes.");
    return storeVerifiedImage(bytes,"photo."+({ "image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif"}[mime]),mime,{base,call});
  }
  throw new Error("Use an HTTPS photo URL or an image committed under publish/photos/.");
}

export async function publishPin(manifest, { base = production, root = process.cwd(), call = fetch } = {}) {
  const { expectedVersion, entry } = manifest ?? {};
  if (!entry || !pinId.test(entry.id ?? "") || Object.keys(entry).some((name) => !fields.has(name)) ||
      (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1))) {
    throw new Error("Supply a pin ID, supported fields, and an expectedVersion (null for a new pin).");
  }
  if ("gallery" in entry && (!Array.isArray(entry.gallery) || entry.gallery.length > 12)) {
    throw new Error("Gallery must be an array of at most 12 photos.");
  }
  const read = async () => {
    const { entries } = await (await request(call, base + "/pins")).json();
    return entries.find(({ id }) => id === entry.id);
  };
  const current = await read();
  if (!current && expectedVersion === null && manifest.checkDuplicate === true) {
    const { entries } = await (await request(call, base + "/pins")).json();
    const normalize = (value) => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/đ/g, "d").replace(/[^a-z0-9]/g, "");
    const existing = entries.find(pin => normalize(pin.title) === normalize(entry.title) && Math.hypot(pin.lat-entry.lat, pin.lng-entry.lng) < 0.025);
    if (existing) { console.log("Existing matching pin: " + existing.title + " (" + existing.id + ")"); return existing; }
  }
  const changes = { ...entry };
  if ("photo" in entry) changes.photo = await resolvePhoto(entry.photo, { base, root, call, mirrorPhoto:manifest.mirrorPhoto===true, legacyRepair:manifest.legacyPhotoRepair===true });
  if ("gallery" in entry) {
    changes.gallery = [];
    for (const photo of entry.gallery) changes.gallery.push(await resolvePhoto(photo, { base, root, call, mirrorPhoto:manifest.mirrorPhoto===true }));
  }
  const matches = (pin) => pin && Object.entries(changes).every(([key, value]) => isDeepStrictEqual(pin[key], value));
  if (matches(current)) return current;
  if ((current?.version ?? null) !== expectedVersion) {
    throw new Error(`Pin ${entry.id} changed. Read its live version and review before retrying.`);
  }
  await request(call, base + "/pins/" + entry.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry: { ...current, ...changes, ...(!current ? { createdAt: Date.now() } : {}) }, expectedVersion }),
  });
  const saved = await read();
  if (!matches(saved)) throw new Error(`Pin ${entry.id} did not match after publishing.`);
  return saved;
}

async function main() {
  const { values, positionals } = parseArgs({ options: { check: { type: "boolean" } }, allowPositionals: true });
  if (values.check || positionals.length === 0) {
    const { entries, revision } = await (await request(fetch, production + "/pins")).json();
    if (!Array.isArray(entries) || !Number.isSafeInteger(revision)) throw new Error("Unexpected live map response.");
    console.log(`Live map reachable, revision ${revision}, ${entries.length} pins. No pin submissions in this run.`);
    return;
  }
  let failures = 0;
  for (const path of positionals) {
    try {
      if (!/^publish\/pins\/[A-Za-z0-9][A-Za-z0-9_.-]*\.json$/.test(path)) throw new Error("Unexpected submission path.");
      const saved = await publishPin(JSON.parse(await readFile(path, "utf8")));
      console.log(JSON.stringify({ path, id: saved.id, version: saved.version, result: "verified on the live map" }));
    } catch (error) {
      failures++;
      console.error(JSON.stringify({ path, error: error.message }));
    }
  }
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
