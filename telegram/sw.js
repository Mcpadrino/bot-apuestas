// Service worker mínimo: permite instalar la app. Guarda solo la página e íconos para que abra
// rápido; los datos (/api) siempre van a internet para que nunca veas apuestas viejas.
const CACHE = "bitacora-v50";
const BASICOS = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== "compartido").map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 📤 "Compartir" desde otra app (Draftea, Caliente, galería…): guardamos la captura y el link y abrimos la app
  if (e.request.method === "POST" && url.pathname === "/compartir") {
    e.respondWith((async () => {
      try {
        const fd = await e.request.formData(), img = fd.get("imagen");
        const texto = ["title", "text", "url"].map((k) => fd.get(k)).filter(Boolean).join(" ").slice(0, 2000);
        const c = await caches.open("compartido");
        await c.put("/compartido/meta", new Response(JSON.stringify({ texto, img: !!(img && img.size), t: Date.now() })));
        if (img && img.size) await c.put("/compartido/img", new Response(img, { headers: { "content-type": img.type || "image/jpeg" } }));
      } catch (err) {}
      return Response.redirect("/?compartido=1#comunidad", 303);
    })());
    return;
  }
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Primero internet (para tener siempre la última versión); si no hay señal, lo guardado.
  e.respondWith(
    fetch(e.request).then((r) => {
      const copia = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copia));
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("/")))
  );
});
