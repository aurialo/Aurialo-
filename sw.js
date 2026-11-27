/* Service worker mínimo: permite instalar la app en el móvil. No guarda nada en caché,
   así siempre se ven los datos y la versión más recientes. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
