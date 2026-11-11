// Service worker mínimo: permite instalar la app. Guarda solo la página e íconos para que abra
// rápido; los datos (/api) siempre van a internet para que nunca veas apuestas viejas.
const CACHE = "bitacora-v66";
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
        const fd = await e.request.formData(), imgs = fd.getAll("imagen").filter((f) => f && f.size).slice(0, 20);
        const texto = ["title", "text", "url"].map((k) => fd.get(k)).filter(Boolean).join(" ").slice(0, 2000);
        const c = await caches.open("compartido");
        await c.put("/compartido/meta", new Response(JSON.stringify({ texto, img: imgs.length > 0, n: imgs.length, t: Date.now() })));
        for (let i = 0; i < imgs.length; i++)
          await c.put("/compartido/img/" + i, new Response(imgs[i], { headers: { "content-type": imgs[i].type || "image/jpeg" } }));
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

// 🔔 Notificaciones al celular: llegan aunque la app esté cerrada.
// Cada tipo trae su ícono, una tarjeta grande (se ve al desplegarla), botones de acción y su propia vibración.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { t: "Bitácora", b: e.data ? e.data.text() : "" }; }
  const acc = (d.acc || []).slice(0, 2);
  // si la app está abierta, que la campanita se actualice sola
  self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((vs) => vs.forEach((v) => v.postMessage({ tipo: "aviso" })));
  e.waitUntil(self.registration.showNotification(d.t || "Bitácora de Apuestas", {
    body: d.b || "", icon: d.ic || "/icon-192.png", badge: "/badge-96.png", image: d.img || undefined,
    tag: d.tag || undefined, renotify: !!d.tag, vibrate: d.vib || [60], timestamp: d.ts || Date.now(), lang: "es-MX",
    actions: acc.map((a, i) => ({ action: "a" + i, title: a.t })),
    data: { u: d.u || "/", acc: acc.map((a) => a.u) },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const dd = e.notification.data || {}, i = /^a(\d)$/.exec(e.action || "");
  const destino = new URL((i && dd.acc && dd.acc[Number(i[1])]) || dd.u || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const vent = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const v of vent) {
      if (new URL(v.url).origin === self.location.origin) {
        // la app ya está abierta: la llevamos a la sección sin recargar
        await v.focus(); v.postMessage({ tipo: "ir", u: destino }); return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});
