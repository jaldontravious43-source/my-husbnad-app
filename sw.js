// 应用壳缓存版本号：每次更新核心文件后请手动 +1，确保新版本生效。
const CACHE_NAME = "laogongbiepao-shell-v7";

// 仅缓存小体积壳资源；人物图片全部走云端实时请求，不进入 SW 缓存。
const APP_SHELL = [
  "./",
  "./index.html",
  "./upload.html",
  "./game.html",
  "./game.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Supabase 图片不缓存：防止本地占用增大，并保证替换图片后立刻生效。
  if (url.hostname.endsWith("supabase.co") && url.pathname.includes("/storage/v1/object/public/game-images/")) {
    event.respondWith(fetch(req));
    return;
  }

  // 对壳资源使用 cache-first，提升 iPhone 打开速度。
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // 只缓存同源 GET 请求，避免把第三方资源塞进本地缓存。
        if (req.method === "GET" && url.origin === self.location.origin) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      });
    }).catch(() => caches.match("./index.html"))
  );
});
