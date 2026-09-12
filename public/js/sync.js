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
        return { rev: 0, updatedAt: 0, spieler: [], aktionen: [], aktiverTorwartId: null, teamHeim: null, teamGast: null };
    }

    function normalize(raw) {
        return {
            rev: Number(raw && raw.rev) || 0,
            updatedAt: Number(raw && raw.updatedAt) || 0,
            spieler: (raw && Array.isArray(raw.spieler)) ? raw.spieler : [],
            aktionen: (raw && Array.isArray(raw.aktionen)) ? raw.aktionen : [],
            aktiverTorwartId: (raw && raw.aktiverTorwartId) || null,
            teamHeim: (raw && raw.teamHeim) || null,
            teamGast: (raw && raw.teamGast) || null
        };
    }

    function payload() {
        return {
            rev: state.rev,
            updatedAt: state.updatedAt,
            spieler: state.spieler,
            aktionen: state.aktionen,
            aktiverTorwartId: state.aktiverTorwartId,
            teamHeim: state.teamHeim,
            teamGast: state.teamGast
        };
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
            const res = await fetch('/api/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload())
            });

            if (res.status === 409) {
                // Serverstand ist neuer (anderes Geraet). Nur uebernehmen,
                // wenn wir selbst nichts Neueres in der Hand haben.
                const data = await res.json().catch(function () { return {}; });
                const remote = normalize(data.state);
                if (remote.rev > state.rev) {
                    state = remote;
                    lastPushedRev = state.rev;
                    writeLocal();
                    notifyChange();
                } else {
                    lastPushedRev = Math.max(lastPushedRev, revAtPush);
                }
                firstDirtyAt = 0;
                retryDelay = RETRY_BASE_MS;
                setStatus({ online: true, error: null, lastSyncAt: Date.now() });
            } else if (res.ok) {
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

    async function init(username) {
        storageKey = 'ht_state_v2:' + (username || 'anon');

        const local = readLocal();
        if (local) {
            // normalize() statt handgebautem Objekt: sonst faellt beim
            // naechsten neuen State-Feld wieder still etwas heraus.
            state = normalize(local);
            lastPushedRev = local.pushedRev;
        }

        let server = null;
        try {
            const res = await fetch('/api/state');
            if (res.ok) server = normalize(await res.json());
        } catch (e) {
            console.warn('[Sync] Server beim Start nicht erreichbar - arbeite lokal weiter.');
            setStatus({ online: false });
        }

        if (server) {
            if (!local) {
                // Frisches Geraet: Serverstand uebernehmen
                state = server;
                lastPushedRev = state.rev;
            } else if (server.rev > state.rev) {
                // Anderes Geraet war neuer
                state = server;
                lastPushedRev = state.rev;
            } else if (state.rev > server.rev) {
                // Wir haben ungesicherte Aenderungen (z.B. offline erfasst)
                console.log('[Sync] Lokaler Stand ist neuer (rev ' + state.rev + ' > ' + server.rev + ') - wird hochgeladen.');
            } else {
                lastPushedRev = state.rev;
            }
            setStatus({ online: true, error: null });
        }

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
        requestAnimationFrame(function () { el.classList.add('toast-in'); });

        timer = setTimeout(dismiss, opts.duration || 4000);
        return dismiss;
    }

    window.Toast = toast;
})();
