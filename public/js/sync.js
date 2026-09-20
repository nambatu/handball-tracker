// ===================================================================
// OFFLINE-FIRST SYNC
// ===================================================================
// Grundregel: localStorage ist die Wahrheit, der Server ist das Backup.
//
// Jede Aktion landet SOFORT und synchron im localStorage. Der Server-Push
// laeuft gebuendelt im Hintergrund und wird bei Netzproblemen mit
// wachsendem Abstand wiederholt. Dadurch geht in der Halle nichts mehr
// verloren, wenn das WLAN wegbricht.
//
// Reihenfolge wird ueber ein monoton steigendes "rev" abgesichert: ein
// verspaetet eintreffender aelterer Request kann einen neueren Stand
// nicht mehr ueberschreiben (der Server lehnt ihn mit 409 ab).
// ===================================================================

(function () {
    'use strict';

    const DEBOUNCE_MS = 1200;   // so lange nach der letzten Aenderung warten
    const MAX_WAIT_MS = 5000;   // spaetestens aber nach 5 s schreiben
    const RETRY_BASE_MS = 2000;
    const RETRY_MAX_MS = 30000;

    // Zeitgrenzen fuer den Server. Ohne sie ist ein totes Netz schlimmer
    // als gar keins: eine Anfrage, die weder ankommt noch scheitert,
    // bleibt einfach offen. Beim Start hiesse das, dass die App ewig
    // "Lade Spieler..." zeigt; beim Push, dass nach dem ersten Haenger nie
    // wieder etwas gesichert wird, weil pushing dauerhaft true bleibt.
    const START_GEDULD_MS = 4000;
    const PUSH_GEDULD_MS = 15000;

    function holen(url, optionen, ms) {
        const abbruch = new AbortController();
        const uhr = setTimeout(function () { abbruch.abort(); }, ms);
        return fetch(url, Object.assign({}, optionen || {}, { signal: abbruch.signal }))
            .finally(function () { clearTimeout(uhr); });
    }

    let storageKey = 'ht_state_v2:anon';
    let state = emptyState();
    let lastPushedRev = 0;

    let pushTimer = null;
    let retryTimer = null;
    let retryDelay = RETRY_BASE_MS;
    let firstDirtyAt = 0;
    let pushing = false;
    let initialised = false;

    const statusListeners = [];
    let status = {
        online: navigator.onLine,
        pending: false,
        pushing: false,
        error: null,
        lastSyncAt: null
    };

    function emptyState() {
        return { rev: 0, updatedAt: 0, spielId: null, spieler: [], aktionen: [], tickerMarken: [], aktiverTorwartId: null, teamHeim: null, teamGast: null, halbzeitSekunden: null };
    }

    function normalize(raw) {
        return {
            rev: Number(raw && raw.rev) || 0,
            updatedAt: Number(raw && raw.updatedAt) || 0,
            // Kennung des laufenden Spiels. Gebraucht fuer die Ticker-
            // Zeitmarken: ohne sie hiesse die Marke in jedem Spiel gleich,
            // und der Merkzettel auf dem Server wuerde sie ab dem zweiten
            // Spiel als "schon getickert" abtun.
            spielId: (raw && raw.spielId) || null,
            spieler: (raw && Array.isArray(raw.spieler)) ? raw.spieler : [],
            aktionen: (raw && Array.isArray(raw.aktionen)) ? raw.aktionen : [],
            // Zeitmarken des Tickers ("Noch 5 Minuten"). Bewusst NICHT in
            // aktionen: sie haengen an keinem Spieler und haetten in
            // Verlauf, Statistik und CSV nichts zu suchen.
            tickerMarken: (raw && Array.isArray(raw.tickerMarken)) ? raw.tickerMarken : [],
            aktiverTorwartId: (raw && raw.aktiverTorwartId) || null,
            teamHeim: (raw && raw.teamHeim) || null,
            teamGast: (raw && raw.teamGast) || null,
            // Der Server braucht die Halbzeitlaenge fuer die Ticker-Regel
            // "letzte 5 Minuten". Ohne sie rechnet er mit 2x30 und die
            // Regel greift bei 2x25 funf Minuten zu spaet.
            halbzeitSekunden: Number(raw && raw.halbzeitSekunden) || null
        };
    }

    function payload() {
        return {
            rev: state.rev,
            updatedAt: state.updatedAt,
            spielId: state.spielId,
            spieler: state.spieler,
            aktionen: state.aktionen,
            tickerMarken: state.tickerMarken,
            aktiverTorwartId: state.aktiverTorwartId,
            teamHeim: state.teamHeim,
            teamGast: state.teamGast,
            halbzeitSekunden: state.halbzeitSekunden
        };
    }

    // ---------------------------------------------------------------
    // Zwei Staende zusammenfuehren
    // ---------------------------------------------------------------
    // Frueher wurde bei einem Konflikt (HTTP 409) der komplette lokale
    // Stand durch den Serverstand ERSETZT. Was auf diesem Geraet gerade
    // entstanden war, verschwand dabei kommentarlos: ein neu angelegter
    // Spieler war nach "Zurueck zum Spiel" wieder weg - und in der Halle
    // haetten es genauso gut die letzten Aktionen sein koennen.
    //
    // Jetzt wird vereinigt. Grundsatz: lieber ein Eintrag zu viel als
    // einer zu wenig. Preis dafuer: eine Loeschung auf Geraet A kann
    // zurueckkommen, solange Geraet B den Spieler noch kennt. Ein wieder
    // aufgetauchter Spieler ist in zwei Sekunden geloescht - ein
    // verlorenes Tor laesst sich nach dem Spiel nicht rekonstruieren.

    function aktionsSchluessel(a) {
        if (a && a.id !== undefined && a.id !== null) return 'id:' + a.id;
        return [a && a.timestamp, a && a.spielerId, a && a.typ].join('|');
    }

    function merge(lokal, fern) {
        // Bei Feldern, die es nur einmal gibt, gewinnt der juengere Stand.
        const juenger = (fern.updatedAt || 0) >= (lokal.updatedAt || 0) ? fern : lokal;
        const aelter = juenger === fern ? lokal : fern;

        // Spieler ueber die id vereinigen. Bei gleicher id gewinnt die
        // Fassung des juengeren Standes (Einsatzzeit, Zeitstrafe).
        const spieler = [];
        const stelleVonId = new Map();
        [aelter, juenger].forEach(function (quelle) {
            quelle.spieler.forEach(function (p) {
                const key = String(p.id);
                if (stelleVonId.has(key)) {
                    spieler[stelleVonId.get(key)] = p;
                } else {
                    stelleVonId.set(key, spieler.length);
                    spieler.push(p);
                }
            });
        });

        // Aktionen vereinigen und chronologisch ordnen.
        const aktionen = fern.aktionen.slice();
        const gesehen = new Set(aktionen.map(aktionsSchluessel));
        lokal.aktionen.forEach(function (a) {
            const key = aktionsSchluessel(a);
            if (!gesehen.has(key)) {
                gesehen.add(key);
                aktionen.push(a);
            }
        });
        aktionen.sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });

        // Zeitmarken genauso vereinigen: sie sind jede genau einmal da
        // und haben eine feste id, doppelte kann es also nicht geben.
        const marken = (fern.tickerMarken || []).slice();
        const markenIds = new Set(marken.map(function (m) { return String(m.id); }));
        (lokal.tickerMarken || []).forEach(function (m) {
            if (!markenIds.has(String(m.id))) { markenIds.add(String(m.id)); marken.push(m); }
        });

        return {
            // Hoeher als beide Seiten, damit der zusammengefuehrte Stand
            // beim naechsten Push gewinnt und nicht in einer 409-Schleife
            // haengen bleibt.
            rev: Math.max(lokal.rev || 0, fern.rev || 0) + 1,
            updatedAt: Date.now(),
            spielId: juenger.spielId,
            spieler: spieler,
            aktionen: aktionen,
            tickerMarken: marken,
            aktiverTorwartId: juenger.aktiverTorwartId,
            teamHeim: juenger.teamHeim,
            teamGast: juenger.teamGast,
            halbzeitSekunden: juenger.halbzeitSekunden
        };
    }

    // Stillschweigend zusammenfuehren waere genauso verwirrend wie
    // stillschweigend wegwerfen - also kurz sagen, was dazugekommen ist.
    function meldeZusammenfuehrung(vorher, nachher) {
        const neueSpieler = nachher.spieler.length - vorher.spieler.length;
        const neueAktionen = nachher.aktionen.length - vorher.aktionen.length;
        if (neueSpieler <= 0 && neueAktionen <= 0) return;
        if (!window.Toast) return;
        const teile = [];
        if (neueSpieler > 0) teile.push('+' + neueSpieler + ' Spieler');
        if (neueAktionen > 0) teile.push('+' + neueAktionen + (neueAktionen === 1 ? ' Aktion' : ' Aktionen'));
        window.Toast('Stand eines anderen Geräts übernommen (' + teile.join(', ') + ').',
            { type: 'warn', duration: 6000 });
    }

    // ---------------------------------------------------------------
    // localStorage (defensiv: kann im Privatmodus werfen oder voll sein)
    // ---------------------------------------------------------------

    function writeLocal() {
        try {
            localStorage.setItem(storageKey, JSON.stringify(
                Object.assign(payload(), { pushedRev: lastPushedRev })
            ));
            return true;
        } catch (e) {
            console.error('[Sync] Konnte lokal nicht speichern', e);
            setStatus({ error: 'Lokaler Speicher voll oder blockiert' });
            return false;
        }
    }

    function readLocal() {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const s = normalize(parsed);
            s.pushedRev = Number(parsed.pushedRev) || 0;
            return s;
        } catch (e) {
            console.error('[Sync] Lokaler Stand unlesbar', e);
            return null;
        }
    }

    // ---------------------------------------------------------------
    // Status
    // ---------------------------------------------------------------

    function setStatus(patch) {
        status = Object.assign({}, status, patch);
        status.pending = state.rev > lastPushedRev;
        status.pushing = pushing;
        statusListeners.forEach(function (cb) {
            try { cb(status); } catch (e) { console.error(e); }
        });
        renderBadge();
    }

    function renderBadge() {
        const el = document.getElementById('sync-status');
        if (!el) return;

        let icon, text, cls, title;

        if (!status.online) {
            icon = '⚡'; cls = 'sync-offline';
            text = status.pending ? 'Offline · ungesichert' : 'Offline';
            title = 'Keine Verbindung. Alle Aktionen werden lokal gespeichert und automatisch nachgereicht.';
        } else if (status.error && status.pending) {
            icon = '⚠️'; cls = 'sync-error';
            text = 'Ungesichert';
            title = 'Server nicht erreichbar (' + status.error + '). Daten liegen lokal sicher, erneuter Versuch laeuft.';
        } else if (status.pending || status.pushing) {
            icon = '⟳'; cls = 'sync-pending';
            text = 'Sichere…';
            title = 'Aenderungen werden zum Server uebertragen.';
        } else {
            icon = '✓'; cls = 'sync-ok';
            text = 'Gesichert';
            title = status.lastSyncAt
                ? 'Zuletzt gesichert: ' + new Date(status.lastSyncAt).toLocaleTimeString()
                : 'Alle Daten gesichert.';
        }

        el.className = 'sync-badge ' + cls;
        el.title = title;
        el.innerHTML = '<span class="sync-icon">' + icon + '</span><span class="sync-text">' + text + '</span>';
    }

    // ---------------------------------------------------------------
    // Push-Steuerung
    // ---------------------------------------------------------------

    function schedulePush() {
        if (!initialised) return;

        const now = Date.now();
        if (!firstDirtyAt) firstDirtyAt = now;

        // Bei Dauerfeuer (viele Aktionen hintereinander) nicht ewig warten
        if (now - firstDirtyAt >= MAX_WAIT_MS) {
            clearTimeout(pushTimer);
            pushTimer = null;
            push();
            return;
        }

        clearTimeout(pushTimer);
        pushTimer = setTimeout(function () {
            pushTimer = null;
            push();
        }, DEBOUNCE_MS);
    }

    function scheduleRetry() {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(function () {
            retryTimer = null;
            push();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    }

    async function push() {
        if (pushing) return;
        if (state.rev <= lastPushedRev) {
            firstDirtyAt = 0;
            setStatus({});
            return;
        }
        if (!navigator.onLine) {
            setStatus({ online: false });
            return;
        }

        const revAtPush = state.rev;
        pushing = true;
        setStatus({});

        try {
            const res = await holen('/api/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload())
            }, PUSH_GEDULD_MS);

            if (res.status === 409) {
                // Serverstand ist neuer (anderes Geraet). NICHT ersetzen,
                // sondern zusammenfuehren - sonst verliert dieses Geraet
                // genau das, was gerade hier eingetragen wurde.
                const data = await res.json().catch(function () { return {}; });
                const fern = normalize(data.state);
                const vorher = state;
                state = merge(state, fern);
                writeLocal();
                meldeZusammenfuehrung(vorher, state);
                notifyChange();
                firstDirtyAt = 0;
                retryDelay = RETRY_BASE_MS;
                setStatus({ online: true, error: null, lastSyncAt: Date.now() });
                // Der vereinigte Stand ist neuer als beide Seiten und muss
                // jetzt hoch, sonst kennt ihn nur dieses Geraet.
                schedulePush();
            } else if (res.ok) {
                // Der Server sagt in der Antwort, was der Ticker getan hat.
                // Wichtig ist vor allem "ausgelassen": Aktionen, die zu
                // lange her waren. Sonst glaubt die tickernde Person, die
                // Gruppe haette alles bekommen.
                res.json().then(function (d) {
                    if (d && d.ticker && window.Ticker) window.Ticker.meldeLauf(d.ticker);
                }).catch(function () { /* Antwort ohne Rumpf ist ok */ });
                lastPushedRev = Math.max(lastPushedRev, revAtPush);
                writeLocal();
                firstDirtyAt = 0;
                retryDelay = RETRY_BASE_MS;
                setStatus({ online: true, error: null, lastSyncAt: Date.now() });
            } else if (res.status === 401) {
                // Der globale fetch-Wrapper kuemmert sich um den Logout.
                setStatus({ error: 'Sitzung abgelaufen' });
            } else {
                throw new Error('HTTP ' + res.status);
            }
        } catch (e) {
            setStatus({ online: navigator.onLine, error: e.message || 'Netzwerkfehler' });
            scheduleRetry();
        } finally {
            pushing = false;
            setStatus({});
            // Waehrend des Pushs sind neue Aenderungen dazugekommen
            if (state.rev > lastPushedRev && !retryTimer) schedulePush();
        }
    }

    // ---------------------------------------------------------------
    // Change-Benachrichtigung (damit die UI neu zeichnen kann)
    // ---------------------------------------------------------------

    const changeListeners = [];
    function notifyChange() {
        changeListeners.forEach(function (cb) {
            try { cb(state); } catch (e) { console.error(e); }
        });
    }

    // ---------------------------------------------------------------
    // Oeffentliche API
    // ---------------------------------------------------------------

    // Serverstand mit dem lokalen zusammenbringen. "hatteLokal" entscheidet,
    // ob es hier ueberhaupt etwas zu schuetzen gibt.
    function uebernimmServerstand(server, hatteLokal) {
        const ungesichert = state.rev > (lastPushedRev || 0);
        if (!hatteLokal) {
            // Frisches Geraet: Serverstand uebernehmen
            state = server;
            lastPushedRev = state.rev;
        } else if (server.rev > state.rev && !ungesichert) {
            // Anderes Geraet war neuer und wir haben nichts Offenes -
            // hier geht nichts verloren.
            state = server;
            lastPushedRev = state.rev;
        } else if (server.rev > state.rev) {
            // Anderes Geraet war neuer, ABER hier liegen noch nicht
            // uebertragene Aenderungen (z.B. in der Halle ohne Netz
            // erfasst). Ersetzen wuerde sie wegwerfen.
            const vorher = state;
            state = merge(state, server);
            lastPushedRev = 0;
            meldeZusammenfuehrung(vorher, state);
            console.log('[Sync] Lokaler und Serverstand zusammengefuehrt (rev ' + state.rev + ').');
        } else if (state.rev > server.rev) {
            // Wir haben ungesicherte Aenderungen (z.B. offline erfasst)
            console.log('[Sync] Lokaler Stand ist neuer (rev ' + state.rev + ' > ' + server.rev + ') - wird hochgeladen.');
        } else {
            lastPushedRev = state.rev;
        }
        setStatus({ online: true, error: null });
    }

    async function holeServerstand() {
        try {
            const res = await holen('/api/state', null, START_GEDULD_MS);
            if (res.ok) return normalize(await res.json());
        } catch (e) {
            console.warn('[Sync] Server beim Start nicht erreichbar - arbeite lokal weiter.');
            setStatus({ online: false });
        }
        return null;
    }

    async function init(username) {
        storageKey = 'ht_state_v2:' + (username || 'anon');

        const local = readLocal();
        if (local) {
            // normalize() statt handgebautem Objekt: sonst faellt beim
            // naechsten neuen State-Feld wieder still etwas heraus.
            state = normalize(local);
            lastPushedRev = local.pushedRev;
        }

        if (local) {
            // Es liegt ein vollstaendiger Stand auf dem Geraet. Damit laesst
            // sich sofort weiterarbeiten - auf den Server zu warten heisst
            // nur, in der Halle vier Sekunden lang "Lade Spieler..." zu
            // lesen. Der Abgleich laeuft nach und zeichnet die Oberflaeche
            // ueber onChange neu, wenn er etwas mitbringt.
            initialised = true;
            writeLocal();
            setStatus({});
            if (state.rev > lastPushedRev) schedulePush();

            holeServerstand().then(function (server) {
                if (!server) return;
                const vorherRev = state.rev;
                uebernimmServerstand(server, true);
                writeLocal();
                setStatus({});
                if (state.rev !== vorherRev) notifyChange();
                if (state.rev > lastPushedRev) schedulePush();
            });

            return state;
        }

        // Kein lokaler Stand: hier MUSS gewartet werden. Sonst legt der
        // Store seine drei Beispielspieler an und der Serverstand kommt
        // Sekunden spaeter obendrauf - doppelte Mannschaft.
        const server = await holeServerstand();
        if (server) uebernimmServerstand(server, false);

        initialised = true;
        writeLocal();
        setStatus({});

        if (state.rev > lastPushedRev) schedulePush();
        return state;
    }

    /**
     * Aenderung anmelden: sofort lokal sichern, Server-Push einplanen.
     * Der Aufrufer hat das State-Objekt bereits mutiert.
     */
    function touch() {
        state.rev += 1;
        state.updatedAt = Date.now();
        writeLocal();
        setStatus({});
        schedulePush();
    }

    function flush() {
        clearTimeout(pushTimer);
        pushTimer = null;
        clearTimeout(retryTimer);
        retryTimer = null;
        retryDelay = RETRY_BASE_MS;
        return push();
    }

    /** Nach dem Archivieren: lokalen Stand hart zuruecksetzen. */
    function reset(newState) {
        const next = normalize(newState || {});
        next.rev = state.rev + 1;
        next.updatedAt = Date.now();
        state = next;
        writeLocal();
        setStatus({});
        return flush();
    }

    // ---------------------------------------------------------------
    // Netz- und Lebenszyklus-Ereignisse
    // ---------------------------------------------------------------

    window.addEventListener('online', function () {
        setStatus({ online: true, error: null });
        retryDelay = RETRY_BASE_MS;
        flush();
    });

    window.addEventListener('offline', function () {
        setStatus({ online: false });
    });

    // Beim Wegschalten der App (Handy gesperrt, Tab gewechselt) sofort sichern
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden' && state.rev > lastPushedRev) {
            try {
                fetch('/api/state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload()),
                    keepalive: true
                }).then(function (res) {
                    if (res.ok) {
                        lastPushedRev = state.rev;
                        writeLocal();
                    }
                }).catch(function () { /* kommt beim naechsten Versuch */ });
            } catch (e) { /* ignorieren */ }
        } else if (document.visibilityState === 'visible') {
            setStatus({ online: navigator.onLine });
            if (state.rev > lastPushedRev) flush();
        }
    });

    // Warnen, wenn beim Schliessen noch etwas nicht beim Server ist.
    // Lokal ist alles sicher, aber der Nutzer soll es wissen.
    window.addEventListener('beforeunload', function (e) {
        if (state.rev > lastPushedRev) {
            e.preventDefault();
            e.returnValue = '';
            return '';
        }
    });

    window.Sync = {
        init: init,
        touch: touch,
        flush: flush,
        reset: reset,
        getState: function () { return state; },
        getStatus: function () { return status; },
        isPending: function () { return state.rev > lastPushedRev; },
        onStatusChange: function (cb) { statusListeners.push(cb); },
        onChange: function (cb) { changeListeners.push(cb); },
        renderBadge: renderBadge
    };
})();

// ===================================================================
// TOAST - nicht blockierende Hinweise statt alert()
// ===================================================================

(function () {
    'use strict';

    let container = null;

    function ensureContainer() {
        if (container && document.body.contains(container)) return container;
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
        return container;
    }

    /**
     * @param {string} message
     * @param {object} [opts] - {type: 'info'|'success'|'warn'|'error', duration: ms,
     *                           actionLabel: string, onAction: fn}
     */
    function toast(message, opts) {
        opts = opts || {};
        const host = ensureContainer();

        const el = document.createElement('div');
        el.className = 'toast toast-' + (opts.type || 'info');

        const text = document.createElement('span');
        text.className = 'toast-text';
        text.textContent = message;
        el.appendChild(text);

        let timer = null;
        function dismiss() {
            clearTimeout(timer);
            el.classList.add('toast-out');
            setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
        }

        if (opts.actionLabel && typeof opts.onAction === 'function') {
            const btn = document.createElement('button');
            btn.className = 'toast-action';
            btn.textContent = opts.actionLabel;
            btn.onclick = function () { dismiss(); opts.onAction(); };
            el.appendChild(btn);
        }

        const close = document.createElement('button');
        close.className = 'toast-close';
        close.setAttribute('aria-label', 'Schliessen');
        close.textContent = '×';
        close.onclick = dismiss;
        el.appendChild(close);

        host.appendChild(el);

        // Hoechstens drei gleichzeitig - gestapelte Hinweise verdecken sonst
        // das halbe Spielfeld. Der aelteste weicht.
        while (host.children.length > 3) {
            host.removeChild(host.firstChild);
        }

        requestAnimationFrame(function () { el.classList.add('toast-in'); });

        timer = setTimeout(dismiss, opts.duration || 4000);
        return dismiss;
    }

    window.Toast = toast;
})();
