// Minimal service worker: makes HQ installable and shows a friendly page when offline.
// Live data always comes from the network.
const SHELL = "hq-shell-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/icons/icon-192.png"])).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(
    fetch(e.request).catch(
      () =>
        new Response(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#0a0b0f;color:#ece9e2;font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0"><p>HQ is offline. Reconnect and pull to refresh.</p></body>',
          { headers: { "content-type": "text/html; charset=utf-8" } }
        )
    )
  );
});
