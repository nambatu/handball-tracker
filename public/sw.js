// ===================================================================
// SERVICE WORKER - die App startet auch ohne Netz
// ===================================================================
// Bisher war nur der DATENSTAND offlinefaehig (localStorage + Sync). Die
// App selbst kam weiterhin vom Server: ohne Empfang in der Halle liess
// sie sich schlicht nicht mehr oeffnen. Dieser Worker legt die
// Programmdateien lokal ab, damit der Start unabhaengig vom Netz ist.
//
// Zwei verschiedene Strategien, mit Absicht:
//
//   Seitenaufruf (navigate)  -> erst Netz, dann Cache
//       So kommt ein Update sofort an, solange Empfang da ist, und in der
//       Halle oeffnet sich trotzdem die zuletzt gespeicherte Fassung.
//
//   Programmdateien (js/css) -> erst Cache, Netz im Hintergrund
//       Startet sofort, auch bei zaehem Hallen-WLAN. Die im Hintergrund
//       geholte Fassung greift beim naechsten Start.
//
// /api/... wird NIE angefasst. Der Sync-Layer entscheidet selbst, was
// offline passiert; ein zwischengespeicherter Spielstand waere genau die
// Art von stillem Datenverlust, gegen die der Sync gebaut wurde.

const CACHE = 'handball-tracker-v20260918';

const SHELL = [
    './',
    'index.html',
    'style.css',
    'manifest.json',
    'js/sync.js',
    'js/wakelock.js',
    'js/store.js',
    'js/timer.js',
    'js/stats.js',
    'js/report.js',
    'js/whatsapp.js',
    'js/ui.js',
    'js/app.js',
    'vendor/touch-drag.js',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
    event.waitUntil((async function () {
        const cache = await caches.open(CACHE);
        // Einzeln statt addAll: eine fehlende Datei (z.B. ein Icon) soll
        // nicht die komplette Installation scheitern lassen und die App
        // damit dauerhaft offline-untauglich machen.
        await Promise.all(SHELL.map(async function (pfad) {
            try {
                const res = await fetch(pfad, { cache: 'reload' });
                if (res.ok) await cache.put(pfad, res);
            } catch (e) {
                console.warn('[SW] nicht vorgeladen:', pfad);
            }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', function (event) {
    event.waitUntil((async function () {
        const namen = await caches.keys();
        await Promise.all(namen.map(function (n) {
            return n === CACHE ? null : caches.delete(n);
        }));
        await self.clients.claim();
    })());
});

// Suchparameter beim Nachschlagen ignorieren: die Dateien haengen in
// index.html mit "?v=..." drin, im Cache liegen sie ohne.
const TREFFER = { ignoreSearch: true };

self.addEventListener('fetch', function (event) {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;   // Fremde Hosts nicht anfassen
    if (url.pathname.startsWith('/api/')) return;      // Daten regelt der Sync
    if (url.pathname.startsWith('/uploads/')) return;  // Avatare: immer frisch

    if (req.mode === 'navigate') {
        event.respondWith((async function () {
            try {
                const netz = await fetch(req);
                const cache = await caches.open(CACHE);
                cache.put('index.html', netz.clone());
                return netz;
            } catch (e) {
                const cache = await caches.open(CACHE);
                return (await cache.match('index.html', TREFFER))
                    || (await cache.match('./', TREFFER))
                    || new Response('Offline und keine gespeicherte Fassung vorhanden.',
                        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
            }
        })());
        return;
    }

    event.respondWith((async function () {
        const cache = await caches.open(CACHE);
        const treffer = await cache.match(req, TREFFER);

        const ausDemNetz = fetch(req).then(function (res) {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
        }).catch(function () { return null; });

        if (treffer) return treffer;
        const netz = await ausDemNetz;
        return netz || new Response('', { status: 504 });
    })());
});

// Erlaubt der Seite, ein wartendes Update sofort zu uebernehmen.
self.addEventListener('message', function (event) {
    if (event.data === 'skipWaiting') self.skipWaiting();
});
