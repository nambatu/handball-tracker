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

const CACHE = 'handball-tracker-v20260919';

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
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon.png'
];

// Nur eine Antwort MIT diesem Stempel ist wirklich unsere App.
//
// Ohne die Pruefung speichert der Worker auch alles, was sich zwischen
// Browser und Server schiebt: die ngrok-Warnseite, ein WLAN-Anmelde-
// portal, eine Fehlerseite des Proxys. Online faellt das nicht auf -
// offline zeigt die App dann genau diese fremde Seite statt sich selbst.
function istAppHuelle(res) {
    return !!res && res.ok && res.headers.get('X-App-Shell') === 'handball-tracker';
}

// Wenn gar nichts Brauchbares da ist, lieber eine ehrliche Seite als eine
// leere. Sonst steht man in der Halle vor einem weissen Bildschirm.
function notseite() {
    return new Response(
        '<!doctype html><html lang="de"><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Offline</title><style>body{font-family:system-ui,sans-serif;background:#0f172a;' +
        'color:#f8fafc;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;' +
        'padding:24px;text-align:center}div{max-width:22rem}h1{font-size:1.25rem;margin:0 0 12px}' +
        'p{color:#94a3b8;line-height:1.6;margin:0 0 8px}</style>' +
        '<div><h1>Keine Verbindung</h1>' +
        '<p>Die App wurde auf diesem Gerät noch nicht vollständig gespeichert.</p>' +
        '<p>Einmal mit Internet öffnen — danach startet sie auch in der Halle ohne Netz.</p></div></html>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
}

self.addEventListener('install', function (event) {
    event.waitUntil((async function () {
        const cache = await caches.open(CACHE);
        // Einzeln statt addAll: eine fehlende Datei (z.B. ein Icon) soll
        // nicht die komplette Installation scheitern lassen und die App
        // damit dauerhaft offline-untauglich machen.
        await Promise.all(SHELL.map(async function (pfad) {
            try {
                const res = await fetch(pfad, { cache: 'reload' });
                const istSeite = pfad === 'index.html' || pfad === './';
                if (istSeite && !istAppHuelle(res)) {
                    console.warn('[SW] Startseite ohne Stempel - nicht gespeichert:', pfad);
                    return;
                }
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
                // Nur die echte App speichern - siehe istAppHuelle().
                if (istAppHuelle(netz)) {
                    const cache = await caches.open(CACHE);
                    cache.put('index.html', netz.clone());
                }
                return netz;
            } catch (e) {
                const cache = await caches.open(CACHE);
                return (await cache.match('index.html', TREFFER))
                    || (await cache.match('./', TREFFER))
                    || notseite();
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
