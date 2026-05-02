/* ================================================================
   Service Worker — 蔵書 (My Personal Library)
   - App shell: cache-first
   - Fonts / CDN libs: stale-while-revalidate
   - Book APIs (openbd / google books): network-first w/ short cache
   - Cover images: cache-first
================================================================ */
const VERSION = "v1.0.1";
const SHELL_CACHE = `library-shell-${VERSION}`;
const RUNTIME_CACHE = `library-runtime-${VERSION}`;
const IMAGE_CACHE = `library-images-${VERSION}`;
const API_CACHE = `library-api-${VERSION}`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
];

/* ---------- install ---------- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(SHELL_ASSETS.map((asset) =>
        cache.add(asset).catch((err) => console.warn("SW shell cache skipped:", asset, err))
      ))
    )
      .then(() => self.skipWaiting())
  );
});

/* ---------- activate ---------- */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![SHELL_CACHE, RUNTIME_CACHE, IMAGE_CACHE, API_CACHE].includes(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ---------- helpers ---------- */
const isNavRequest = (req) => req.mode === "navigate";
const isImageReq   = (req) => req.destination === "image";
const matchesHost  = (url, hosts) => hosts.some((h) => url.hostname === h || url.hostname.endsWith("." + h));

const FONT_HOSTS  = ["fonts.googleapis.com", "fonts.gstatic.com"];
const CDN_HOSTS   = ["cdn.tailwindcss.com", "unpkg.com", "cdn.jsdelivr.net"];
const API_HOSTS   = ["api.openbd.jp", "www.googleapis.com"];

/* ---------- fetch routing ---------- */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 1) Navigations → app shell (network-first, fallback to cache)
  if (isNavRequest(req)) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put("./index.html", copy)).catch(()=>{});
        }
        return res;
      }).catch(() =>
        caches.match("./index.html").then((r) => r || caches.match("./"))
      )
    );
    return;
  }

  // 2) Same-origin shell assets → cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached ||
        fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(()=>{});
          }
          return res;
        })
      )
    );
    return;
  }

  // 3) Fonts & CDN libs → stale-while-revalidate
  if (matchesHost(url, FONT_HOSTS) || matchesHost(url, CDN_HOSTS)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 4) Book APIs → network-first w/ cache fallback
  if (matchesHost(url, API_HOSTS)) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(API_CACHE).then((c) => c.put(req, copy)).catch(()=>{});
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // 5) Cover images → cache-first
  if (isImageReq(req)) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        } catch {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // 6) Default → try network, fall back to cache
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
