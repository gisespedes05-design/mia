// Service worker de MÍA: solo sirve para funcionar offline y sentirse como
// app. Nunca cachea /api/ — los datos del directorio siempre deben venir
// frescos del servidor. Para todo lo demás usa "red primero, caché de
// respaldo": si hay internet, siempre se pide lo más nuevo (evita el mismo
// problema de CSS/JS viejos que ya se corrigió una vez en este sitio); el
// caché solo entra cuando de plano no hay conexión.
const CACHE = 'mia-v1';
const CASCARON = ['/', '/css/estilos.css', '/js/app.js', '/manifest.json'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCARON)));
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((nombres) => Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  evento.respondWith(
    fetch(request)
      .then((respuesta) => {
        const copia = respuesta.clone();
        caches.open(CACHE).then((c) => c.put(request, copia));
        return respuesta;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match('/')))
  );
});
