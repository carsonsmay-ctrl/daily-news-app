// Service worker: app shell cached up front; briefing JSON is network-first with cache fallback,
// so the last briefing(s) you opened are readable offline.
const VERSION = "v1";
const SHELL_CACHE = `shell-${VERSION}`;
const DATA_CACHE = "briefing-data";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const res = await fetch(request, { cache: "no-store" });
    if (res.ok) {
      await cache.put(request.url.split("?")[0], res.clone());
      await trim(cache, 15);
    }
    return res;
  } catch {
    const cached = (await cache.match(request.url.split("?")[0])) || (await cache.match(new URL("data/latest.json", self.registration.scope).href));
    if (!cached) throw new Error("offline and not cached");
    const headers = new Headers(cached.headers);
    headers.set("x-sw-cache", "1");
    return new Response(await cached.blob(), { status: 200, headers });
  }
}

// Keep only the newest dated briefings (plus index/latest) in the offline cache.
async function trim(cache, maxDays) {
  const dated = (await cache.keys()).filter((r) => /\/data\/\d{4}-\d{2}-\d{2}\.json$/.test(r.url)).sort((a, b) => (a.url < b.url ? 1 : -1));
  await Promise.all(dated.slice(maxDays).map((r) => cache.delete(r)));
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.includes("/data/") && url.pathname.endsWith(".json")) {
    event.respondWith(networkFirst(event.request));
  } else {
    event.respondWith(staleWhileRevalidate(event.request));
  }
});
