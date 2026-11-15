const DB = 'map-canvas-offline-v1';
const CACHE_PREFIX = 'map-canvas-area-';
const BASE_CACHE = 'map-canvas-offline-base-v1';

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('areas', {keyPath:'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction(mode, fn) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('areas', mode);
    const request = fn(tx.objectStore('areas'));
    tx.oncomplete = () => { db.close(); resolve(request?.result); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Offline storage was interrupted.')); };
  });
}
export const savedAreas = () => transaction('readonly', store => store.getAll());
const putArea = area => transaction('readwrite', store => store.put(area));
const withAreaStorage = operation => navigator.locks
  ? navigator.locks.request(DB, operation)
  : operation();
async function removeArea(id) {
  await withAreaStorage(async () => {
    await transaction('readwrite', store => store.delete(id));
    await caches.delete(CACHE_PREFIX + id);
    if (!(await savedAreas()).length) await caches.delete(BASE_CACHE);
  });
}

async function fetchPhoto(url, mode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {mode, signal:controller.signal, referrerPolicy:'no-referrer'});
    if (response.type === 'opaque') return response;
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return null;
    const blob = await response.blob();
    return new Response(blob, {headers:{'Content-Type':blob.type}});
  } finally {
    clearTimeout(timer);
  }
}

function imageDecodes(url) {
  return new Promise(resolve => {
    const image = new Image();
    const timer = setTimeout(finish, 4000, false);
    function finish(ok) {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      resolve(ok);
    }
    image.onload = () => finish(image.naturalWidth > 0);
    image.onerror = () => finish(false);
    image.src = url;
  });
}

async function snapshotPhotos(entries, id, progress, cache) {
  let completed = 0, total = 0, opaque = 0;
  const urls = [...new Set(entries.flatMap(entry => [entry.photo, ...(entry.gallery || [])])
    .filter(url => typeof url === 'string' && /^https?:\/\//i.test(url)))];
  const images = new Map();

  async function saveImage(url, index) {
    let response;
    try { response = await fetchPhoto(url, 'cors'); }
    catch { response = await fetchPhoto(url, 'no-cors'); }
    if (!response) return '';
    if (response.type === 'opaque') {
      if (++opaque > 40) return '';
    } else {
      const size = (await response.clone().blob()).size;
      if (total + size > 50 * 1024 * 1024) return '';
      total += size;
    }
    const key = new URL('./data/offline/photos/' + id + '/' + index, location.href).href;
    await cache.put(key, response);
    if (await imageDecodes(key)) return key;
    await cache.delete(key);
    return '';
  }
  for (let start = 0; start < urls.length; start += 4) {
    await Promise.all(urls.slice(start, start + 4).map(async (url, index) => {
      images.set(url, await saveImage(url, start + index).catch(() => ''));
      progress(++completed, urls.length);
    }));
  }
  const local = url => typeof url === 'string' && (url.startsWith('data:image/') ? url : images.get(url));
  return {
    entries:entries.map(entry => ({
      ...entry,
      photo:local(entry.photo) || '',
      gallery:(entry.gallery || []).map(local).filter(Boolean)
    })),
    missing:[...images.values()].filter(value => !value).length
  };
}

async function cacheBasemap(manifest, status) {
  const cache = await caches.open(BASE_CACHE);
  const files = ['./data/offline/hanoi.pmtiles', './data/offline/style.json',
    './data/offline/manifest.json', ...(manifest.assets || [])];
  for (let i = 0; i < files.length; i++) {
    const url = new URL(files[i], location.href);
    if (await cache.match(url.href)) continue;
    status.textContent = `Downloading map (${i + 1}/${files.length})…`;
    const response = await fetch(url, {cache:'no-store'});
    if (!response.ok) throw new Error(`Map resource could not be downloaded: ${files[i]}`);
    await cache.put(new Request(url), response);
  }
}

async function downloadArea({id,bounds,entries,manifest,status}) {
  return withAreaStorage(async () => {
    const cacheName = CACHE_PREFIX + id;
    try {
      const cache = await caches.open(cacheName);
      await cacheBasemap(manifest, status);
      status.textContent = 'Saving pins and photos…';
      const saved = await snapshotPhotos(entries, id, (count, total) => {
        status.textContent = `Saving photos (${count}/${total})…`;
      }, cache);
      await putArea({id,bounds,entries:saved.entries,missing:saved.missing,created:Date.now()});
      return saved;
    } catch (error) {
      await caches.delete(cacheName);
      if (!(await savedAreas()).length) await caches.delete(BASE_CACHE);
      throw error;
    }
  });
}

function selectedBounds(map) {
  const mapRect = map.getContainer().getBoundingClientRect();
  const rect = document.getElementById('offlineBox').getBoundingClientRect();
  const corners = [[rect.left,rect.top], [rect.right,rect.top],
    [rect.right,rect.bottom], [rect.left,rect.bottom]]
    .map(([x,y]) => map.unproject([x-mapRect.left,y-mapRect.top]));
  return [Math.min(...corners.map(p=>p.lng)), Math.min(...corners.map(p=>p.lat)),
    Math.max(...corners.map(p=>p.lng)), Math.max(...corners.map(p=>p.lat))];
}

export function setupAreaDownload({getMap, getEntries, isReady, notify, viewArea}) {
  const panel = document.getElementById('offlinePanel');
  const frame = document.getElementById('offlineFrame');
  const status = document.getElementById('offlineDownloadStatus');
  const list = document.getElementById('offlineAreas');
  let selecting = false, busy = false;

  async function refresh() {
    list.replaceChildren();
    for (const area of (await savedAreas()).sort((a,b)=>b.created-a.created)) {
      const row = document.createElement('div');
      row.className = 'offline-area-row';
      const label = document.createElement('span');
      label.textContent = `${new Date(area.created).toLocaleString()} · ${area.entries.length} pins` +
        (area.missing ? ` · ${area.missing} photos unavailable` : '');
      const view = document.createElement('button');
      view.textContent = 'View'; view.className = 'secondary';
      view.onclick = () => {
        viewArea(area);
        getMap()?.fitBounds([[area.bounds[0],area.bounds[1]], [area.bounds[2],area.bounds[3]]], {padding:35});
        panel.close();
      };
      const remove = document.createElement('button');
      remove.textContent = 'Remove'; remove.className = 'secondary';
      remove.onclick = async () => { await removeArea(area.id); await refresh(); };
      row.append(label, view, remove); list.append(row);
    }
    if (!list.childNodes.length) list.textContent = 'No saved areas yet.';
  }

  document.getElementById('offlineButton').onclick = async () => { await refresh(); panel.showModal(); };
  document.getElementById('offlineClose').onclick = () => panel.close();
  document.getElementById('offlineChoose').onclick = () => {
    if (!getMap()) { notify('Wait for the map to load.', true); return; }
    panel.close(); selecting = true; frame.classList.remove('hidden');
  };
  const cancel = document.getElementById('offlineCancel');
  cancel.onclick = () => { selecting = false; frame.classList.add('hidden'); };
  document.getElementById('offlineDownload').onclick = async () => {
    if (!selecting || busy) return;
    if (!isReady()) { notify('Connect to the internet before downloading.', true); return; }
    busy = true;
    const button = document.getElementById('offlineDownload');
    button.disabled = cancel.disabled = true;
    navigator.storage?.persist?.().catch(() => {});
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    try {
      if (!('serviceWorker' in navigator)) throw new Error('Offline storage is unavailable in this browser.');
      await Promise.race([navigator.serviceWorker.ready, new Promise((_,reject) =>
        setTimeout(() => reject(new Error('Offline setup did not finish. Reload and retry.')), 10000))]);
      if (!navigator.serviceWorker.controller) throw new Error('Reload this page once before downloading.');
      const bounds = selectedBounds(getMap());
      const response = await fetch('./data/offline/manifest.json', {cache:'no-store'});
      if (!response.ok) throw new Error('The offline map package is unavailable.');
      const manifest = await response.json(), b = manifest.bounds;
      if (!b || bounds[0]<b[0] || bounds[1]<b[1] || bounds[2]>b[2] || bounds[3]>b[3])
        throw new Error('Move and zoom the selection inside the available Hanoi map.');
      const entries = getEntries().filter(e => e.lng>=bounds[0] && e.lng<=bounds[2] && e.lat>=bounds[1] && e.lat<=bounds[3]);
      const saved = await downloadArea({id,bounds,entries,manifest,status});
      selecting = false; frame.classList.add('hidden'); status.textContent = '';
      notify(saved.missing ? `Area saved. ${saved.missing} photos could not be saved.` : 'Offline area saved on this device.');
      await refresh(); panel.showModal();
    } catch (error) {
      status.textContent = error.message; notify(error.message, true);
    } finally { busy = false; button.disabled = cancel.disabled = false; }
  };
  return {refresh};
}
