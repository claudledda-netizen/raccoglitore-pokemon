// Service worker: tiene in memoria l'app per usarla senza rete e per non riscaricare il lettore.
// Due memorie separate: quella del lettore (28 MB, non cambia e non va riscaricata a ogni
// aggiornamento) e quella della pagina, che si rinnova quando cambia la versione.
const PESANTE = 'raccoglitore-v1';
const VERSIONE = 'raccoglitore-guscio-v4';
const GUSCIO = ['./', 'index.html', 'css/app.css', 'js/vision.js', 'js/match.js', 'js/recog.js', 'js/ocr-engine.js', 'js/db.js', 'js/prices.js', 'js/export.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icona-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(GUSCIO)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSIONE && k !== PESANTE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // immagini e prezzi esterni: sempre dalla rete
  const pesante = /\/(vendor|data)\//.test(url.pathname);
  if (pesante) {
    // lettore ed elenco carte: prima la memoria, la rete solo la prima volta
    e.respondWith(caches.open(PESANTE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) c.put(req, res.clone());
      return res;
    }));
  } else {
    // pagina e codice: prima la rete (per ricevere gli aggiornamenti), la memoria se manca la connessione
    e.respondWith(fetch(req).then((res) => {
      if (res.ok && res.status === 200) { const copia = res.clone(); caches.open(VERSIONE).then((c) => c.put(req, copia)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))));
  }
});
