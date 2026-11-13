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

const CACHE = 'handball-tracker-v20261116';

// Wie lange auf den Server gewartet wird, bevor der Cache uebernimmt.
//
// Das ist der Kern des Problems: ein Netz, das nichts mehr durchlaesst,
// sagt das nicht. Die Anfrage scheitert nicht, sie HAENGT - und der
// Browser zeigt derweil den blauen Startbildschirm der installierten App.
// Ohne Zeitgrenze wartet er, bis das Netz zurueckkommt. Genau so war es.
const NETZ_GEDULD_MS = 2000;

function mitZeitgrenze(versprechen, ms) {
    return Promise.race([
        versprechen,
        new Promise(function (_, ablehnen) {
            setTimeout(function () { ablehnen(new Error('Zeitgrenze')); }, ms);
        })
    ]);
}

const SHELL = [
    './',
    'index.html',
    'style.css',
    'manifest.json',
    'js/config.js',
    'vendor/supabase.js',
    'js/api.js',
    'js/sync.js',
    'js/wakelock.js',
    'js/store.js',
    'js/timer.js',
    'js/stats.js',
    'js/report.js',
    'js/whatsapp.js',
    'js/tickerui.js',
    'js/ui.js',
    'js/start.js',
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
//
// Der Stempel kann auf zwei Wegen kommen: als Header X-App-Shell (eigener
// Server) oder als <meta name="app-shell"> in der Seite selbst. Letzteres
// braucht es, weil GitHub Pages keine eigenen Header senden kann. Das
// Portal oder die ngrok-Seite kennen unser Meta-Tag nicht, die Schutzwirkung
// bleibt also dieselbe.
//
// Liest den Rumpf nur von einer KOPIE: ein Response-Rumpf laesst sich nur
// einmal lesen, und das Original muss fuer cache.put bzw. den Browser
// unberuehrt bleiben.
const STEMPEL_META = '<meta name="app-shell" content="handball-tracker">';

async function istAppHuelle(res) {
    if (!res || !res.ok) return false;
    if (res.headers.get('X-App-Shell') === 'handball-tracker') return true;
    try {
        const text = await res.clone().text();
        return text.indexOf(STEMPEL_META) !== -1;
    } catch (e) {
        return false;
    }
}

// Startseite im Hintergrund pruefen und ablegen. Die Kopie wird SOFORT
// gezogen (vor dem await), solange das Original noch niemand gelesen hat -
// danach darf der Browser die Antwort ruhig verbrauchen.
function merkeStartseite(res, cache) {
    const kopie = res.clone();
    return istAppHuelle(kopie).then(function (ok) {
        if (ok) return cache.put('index.html', kopie);
    }).catch(function () { /* Ablegen ist nur ein Bonus */ });
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
                if (istSeite && !(await istAppHuelle(res))) {
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

function aktualisiereImHintergrund(req, cache) {
    fetch(req).then(function (res) {
        return merkeStartseite(res, cache);
    }).catch(function () { /* weiterhin kein Netz - nicht schlimm */ });
}

self.addEventListener('fetch', function (event) {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;   // Fremde Hosts nicht anfassen
    if (url.pathname.startsWith('/api/')) return;      // Daten regelt der Sync
    if (url.pathname.startsWith('/uploads/')) return;  // Avatare: immer frisch

    if (req.mode === 'navigate') {
        event.respondWith((async function () {
            const cache = await caches.open(CACHE);
            const gespeichert = (await cache.match('index.html', TREFFER))
                             || (await cache.match('./', TREFFER));

            // Ohne gespeicherte Fassung bleibt nur das Netz - dann aber
            // ohne Zeitgrenze, sonst landet man auf der Notseite, obwohl
            // die Verbindung nur langsam ist.
            if (!gespeichert) {
                try {
                    const netz = await fetch(req);
                    merkeStartseite(netz, cache);
                    return netz;
                } catch (e) {
                    return notseite();
                }
            }

            // Der Browser meldet selbst, dass kein Netz da ist: gar nicht
            // erst fragen, sofort starten.
            if (!self.navigator.onLine) {
                aktualisiereImHintergrund(req, cache);
                return gespeichert;
            }

            try {
                const netz = await mitZeitgrenze(fetch(req), NETZ_GEDULD_MS);
                merkeStartseite(netz, cache);
                return netz;
            } catch (e) {
                // Kein Netz, oder es antwortet nicht schnell genug. Die App
                // startet aus dem Cache; die Antwort vom Server wird - falls
                // sie doch noch kommt - fuer den naechsten Start gespeichert.
                aktualisiereImHintergrund(req, cache);
                return gespeichert;
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
        // Nichts gespeichert: aufs Netz warten, aber nicht endlos - eine
        // haengende Datei wuerde den Start der App genauso blockieren.
        const netz = await mitZeitgrenze(ausDemNetz, NETZ_GEDULD_MS * 3).catch(function () { return null; });
        return netz || new Response('', { status: 504 });
    })());
});

// Erlaubt der Seite, ein wartendes Update sofort zu uebernehmen.
self.addEventListener('message', function (event) {
    if (event.data === 'skipWaiting') self.skipWaiting();
});
