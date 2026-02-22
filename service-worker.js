"use strict";

const CACHE_NAME = "kintai-pwa-cache-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./stylesheet.css",
  "./javascript.js",
  "./manifest.webmanifest",
  "./service-worker.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSETS);
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
          return Promise.resolve();
        })
      );
      self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // ナビゲーションは index.html を返す（オフライン対応）
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match("./index.html");
        if (cached) return cached;
        return fetch(req);
      })()
    );
    return;
  }

  // static assets: cache-first
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const fresh = await fetch(req);
        // 同一オリジンのみキャッシュ
        const url = new URL(req.url);
        if (url.origin === self.location.origin) {
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        // オフラインで未キャッシュの場合はそのまま失敗（画面に文言は出さない）
        return cached || Response.error();
      }
    })()
  );
});