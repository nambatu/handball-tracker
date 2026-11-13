// ===================================================================
// API-SCHICHT - ein fetch, zwei Gegenstellen
// ===================================================================
// Der Rest der App ruft ueberall fetch('/api/...') auf. Das bleibt so.
// Diese Datei ersetzt window.fetch und entscheidet, wer antwortet:
//
//   'server'   -> der alte Express-Server (Raspberry Pi), wie bisher
//   'supabase' -> Supabase; die Antworten werden so nachgebaut, dass
//                 Statuscode und JSON-Rumpf genau denen des alten Servers
//                 entsprechen. sync.js, store.js usw. merken nichts.
//
// Warum so und nicht in jeder Datei umbauen: Der Pi muss bis zum Umzug mit
// demselben Code weiterlaufen, und der Offline-Weg in sync.js (Zeitgrenzen,
// Wiederholungen) ist hart erarbeitet. Ein Netzfehler MUSS deshalb weiter
// als Fehler (Exception) ankommen und darf nie als Response getarnt werden.
//
// Geladen wird nach config.js und vendor/supabase.js, vor allen anderen
// Skripten, die fetch benutzen.
// ===================================================================

(function () {
    'use strict';

    const originalFetch = window.fetch.bind(window);
    const CFG = window.HT_CONFIG || {};

    // ---------------------------------------------------------------
    // Betriebsart festlegen
    // ---------------------------------------------------------------
    // ?backend=supabase merkt sich die Wahl im Browser - zum Ausprobieren
    // lokal, ohne den Code anzufassen. ?backend=server hebt sie auf.

    function leseLokal(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function schreibeLokal(key, wert) {
        try {
            if (wert === null) localStorage.removeItem(key); else localStorage.setItem(key, wert);
        } catch (e) { /* Privatmodus: dann gilt die Wahl nur fuer diese Seite */ }
    }

    let wunsch = null;
    try { wunsch = new URLSearchParams(location.search).get('backend'); } catch (e) { /* egal */ }
    if (wunsch === 'supabase') schreibeLokal('ht_backend', 'supabase');
    if (wunsch === 'server') schreibeLokal('ht_backend', null);

    const host = location.hostname;
    const MODUS = (
        /\.github\.io$/.test(host) ||
        host === 'tracker.langschwerts.de' ||
        (wunsch !== 'server' && leseLokal('ht_backend') === 'supabase')
    ) ? 'supabase' : 'server';

    // Gleiche Schreibweise wie usernameSlug in server.js: daraus entsteht
    // die Mailadresse, unter der der Benutzer in Supabase angelegt wurde.
    function slug(name) {
        return String(name || '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    }

    // ===============================================================
    // MODUS "server": der bisherige fetch-Wrapper, unveraendert
    // ===============================================================

    function installiereServerModus() {
        window.fetch = async function () {
            let [resource, config] = arguments;
            if (!config) config = {};
            if (!config.headers) config.headers = {};

            const token = localStorage.getItem('auth_token');
            if (token) {
                config.headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await originalFetch(resource, config);
            // 401 handling for main api (not whatsapp which uses its own admin token logic)
            if (response.status === 401 && resource.toString().startsWith('/api') && !resource.toString().includes('/api/whatsapp') && !resource.toString().includes('/api/login') && !resource.toString().includes('/api/register')) {
                if (window.logoutUser) window.logoutUser();
            }
            return response;
        };
    }

    async function jsonPost(url, daten) {
        const res = await originalFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(daten)
        });
        const body = await res.json().catch(function () { return {}; });
        return { res: res, body: body };
    }

    const serverApi = {
        hatAnmeldung: function () {
            return !!leseLokal('auth_token');
        },
        login: async function (username, password) {
            try {
                const r = await jsonPost('/api/login', { username: username, password: password });
                if (!r.res.ok) return { ok: false, error: r.body.error || 'Error' };
                localStorage.setItem('auth_token', r.body.token);
                localStorage.setItem('auth_username', r.body.username);
                return { ok: true, username: r.body.username };
            } catch (e) {
                return { ok: false, error: 'Network error' };
            }
        },
        register: async function (username, password, code) {
            const daten = { username: username, password: password };
            if (code) daten.code = code;
            try {
                const r = await jsonPost('/api/register', daten);
                if (!r.res.ok) return { ok: false, error: r.body.error || 'Error' };
                return { ok: true };
            } catch (e) {
                return { ok: false, error: 'Network error' };
            }
        },
        logout: async function () {
            localStorage.removeItem('auth_token');
        },

        // Der alte Server kennt keine Passwort-Aenderung.
        passwortAendern: async function () {
            return { ok: false, error: 'Nur in der neuen App möglich.' };
        }
    };

    // ===============================================================
    // MODUS "supabase"
    // ===============================================================

    const SB = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
    const projektRef = (SB.match(/^https?:\/\/([^.]+)\./) || [])[1] || '';
    // Unter diesem Schluessel legt supabase-js die Sitzung im localStorage ab.
    const SITZUNGS_KEY = 'sb-' + projektRef + '-auth-token';

    const MIME_ENDUNG = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif'
    };
    const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

    let client = null;

    // Wird geworfen, wenn die Anmeldung fehlt oder abgelaufen ist.
    // Der Verteiler macht daraus ein 401 - echte Netzfehler dagegen nicht.
    function AuthFehler() { this.istAuthFehler = true; }

    function netzFehler() {
        return new TypeError('Failed to fetch');
    }

    function abbruchFehler() {
        try { return new DOMException('The operation was aborted.', 'AbortError'); }
        catch (e) { const f = new Error('The operation was aborted.'); f.name = 'AbortError'; return f; }
    }

    // supabase-js kennt unser AbortSignal nicht. Ohne diese Huelle koennte
    // ein haengendes Token-Erneuern die Zeitgrenze aus sync.js aushebeln,
    // und die App wuerde in der Halle wieder ewig "Lade..." zeigen.
    function mitAbbruch(versprechen, signal) {
        if (!signal) return versprechen;
        return new Promise(function (ok, fehler) {
            if (signal.aborted) return fehler(abbruchFehler());
            const ab = function () { fehler(abbruchFehler()); };
            signal.addEventListener('abort', ab, { once: true });
            versprechen.then(function (v) {
                signal.removeEventListener('abort', ab);
                ok(v);
            }, function (e) {
                signal.removeEventListener('abort', ab);
                fehler(e);
            });
        });
    }

    function holeClient() {
        if (client) return client;
        if (!window.supabase || !window.supabase.createClient) {
            throw new Error('supabase-js nicht geladen');
        }
        client = window.supabase.createClient(SB, CFG.supabaseKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
            global: { fetch: originalFetch }
        });
        return client;
    }

    function istNetzproblem(fehler) {
        return !!fehler && (fehler.name === 'AuthRetryableFetchError' || fehler.status === 0);
    }

    // Aktuelle Sitzung. Offline und mit abgelaufenem Token kann sie nicht
    // erneuert werden - das ist ein Netzproblem und keine Abmeldung.
    async function holeSitzung(signal) {
        const r = await mitAbbruch(holeClient().auth.getSession(), signal);
        if (r.error && istNetzproblem(r.error)) throw netzFehler();
        return r.data && r.data.session ? r.data.session : null;
    }

    function antwort(status, body) {
        return new Response(JSON.stringify(body), {
            status: status,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Eine Anfrage an Supabase mit Anmeldung. Wirft AuthFehler bei 401,
    // laesst Netzfehler und Abbruch unveraendert durch.
    async function sb(url, opt) {
        opt = opt || {};
        let erneuert = false;

        for (;;) {
            const sitzung = await holeSitzung(opt.signal);
            if (!sitzung) throw new AuthFehler();

            const kopf = Object.assign({
                'apikey': CFG.supabaseKey,
                'Authorization': 'Bearer ' + sitzung.access_token
            }, opt.headers || {});
            if (opt.json !== false && !kopf['Content-Type']) kopf['Content-Type'] = 'application/json';

            const res = await originalFetch(url, {
                method: opt.method || 'GET',
                headers: kopf,
                body: opt.body,
                signal: opt.signal,
                keepalive: opt.keepalive
            });

            if (res.status === 401) {
                if (erneuert) throw new AuthFehler();
                erneuert = true;
                const r = await mitAbbruch(holeClient().auth.refreshSession(), opt.signal);
                if (r.error && istNetzproblem(r.error)) throw netzFehler();
                continue;
            }
            // "Nicht angemeldet" aus der Datenbank: Konto ohne Profil.
            if (res.status === 403) {
                const f = await res.clone().json().catch(function () { return null; });
                if (f && f.code === '42501') throw new AuthFehler();
            }
            return res;
        }
    }

    function rest(pfad) { return SB + '/rest/v1/' + pfad; }

    async function leseJson(res) {
        return res.json().catch(function () { return null; });
    }

    // ---------------------------------------------------------------
    // Routen
    // ---------------------------------------------------------------

    function labelAus(roh) {
        if (roh === null || roh === undefined) return null;
        return String(roh).trim().slice(0, 120) || null;
    }

    const ROUTEN = {
        'GET /api/me': async function (a) {
            // Kein Netzaufruf, aber ohne Netz muss er scheitern: app.js
            // zeigt daran den Offline-Hinweis.
            if (!navigator.onLine) throw netzFehler();
            const sitzung = await holeSitzung(a.signal);
            if (!sitzung) throw new AuthFehler();
            const meta = sitzung.user && sitzung.user.user_metadata;
            const name = (meta && meta.username) || leseLokal('auth_username');
            return antwort(200, { username: name });
        },

        'GET /api/state': async function (a) {
            const res = await sb(rest('rpc/get_state'), { method: 'POST', body: '{}', signal: a.signal });
            if (!res.ok) return antwort(500, { error: 'Failed to read state' });
            return antwort(200, await leseJson(res));
        },

        'POST /api/state': async function (a) {
            const res = await sb(rest('rpc/push_state'), {
                method: 'POST',
                body: JSON.stringify({ p_state: a.body }),
                signal: a.signal,
                keepalive: a.keepalive
            });
            const d = res.ok ? await leseJson(res) : null;
            if (d && d.ok === true) {
                // Ticker-Zaehler gibt es hier nicht - der Ticker ist noch nicht umgezogen.
                return antwort(200, { success: true, rev: d.rev, ticker: { aktiv: false, erzeugt: 0, ausgelassen: 0 } });
            }
            if (d && d.ok === false && d.error === 'stale') {
                return antwort(409, { error: 'stale', message: d.message, state: d.state });
            }
            return antwort(500, { error: 'Failed to write state' });
        },

        'GET /api/archives': async function (a) {
            const res = await sb(rest('archives_list?select=*&order=date.desc'), { signal: a.signal });
            if (!res.ok) return antwort(500, { error: 'Failed to list archives' });
            return antwort(200, await leseJson(res));
        },

        'POST /api/archive': async function (a) {
            const b = a.body || {};
            const filename = 'game-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
            const data = {
                spieler: b.spieler,
                aktionen: b.aktionen,
                teamHeim: b.teamHeim || null,
                teamGast: b.teamGast || null,
                archivedAt: new Date().toISOString()
            };
            const res = await sb(rest('archives'), {
                method: 'POST',
                headers: { 'Prefer': 'return=minimal' },
                body: JSON.stringify({ filename: filename, data: data }),
                signal: a.signal
            });
            if (!res.ok) return antwort(500, { error: 'Failed to archive game' });
            return antwort(200, { success: true, filename: filename });
        },

        'GET /api/archive/:x': async function (a) {
            if (!/\.json$/.test(a.param)) return antwort(400, { error: 'Invalid filename' });
            const res = await sb(rest('archives?select=data,label&filename=eq.' + encodeURIComponent(a.param)),
                { signal: a.signal });
            if (!res.ok) return antwort(500, { error: 'Failed to read archive' });
            const zeilen = await leseJson(res);
            if (!Array.isArray(zeilen) || zeilen.length === 0) return antwort(404, { error: 'Archive not found' });
            const daten = Object.assign({}, zeilen[0].data);
            if (zeilen[0].label !== null && zeilen[0].label !== undefined) daten.label = zeilen[0].label;
            return antwort(200, daten);
        },

        'DELETE /api/archive/:x': async function (a) {
            if (!/\.json$/.test(a.param)) return antwort(400, { error: 'Invalid filename' });
            const res = await sb(rest('archives?filename=eq.' + encodeURIComponent(a.param)), {
                method: 'DELETE',
                headers: { 'Prefer': 'return=representation' },
                signal: a.signal
            });
            if (!res.ok) return antwort(500, { error: 'Failed to delete archive' });
            const zeilen = await leseJson(res);
            if (!Array.isArray(zeilen) || zeilen.length === 0) return antwort(404, { error: 'Archive not found' });
            return antwort(200, { success: true });
        },

        'PATCH /api/archive/:x': async function (a) {
            if (!/\.json$/.test(a.param)) return antwort(400, { error: 'Invalid filename' });
            const label = labelAus(a.body && a.body.label);
            const res = await sb(rest('archives?filename=eq.' + encodeURIComponent(a.param)), {
                method: 'PATCH',
                headers: { 'Prefer': 'return=representation' },
                body: JSON.stringify({ label: label }),
                signal: a.signal
            });
            if (!res.ok) return antwort(500, { error: 'Failed to rename archive' });
            const zeilen = await leseJson(res);
            if (!Array.isArray(zeilen) || zeilen.length === 0) return antwort(404, { error: 'Archive not found' });
            return antwort(200, { success: true, label: label });
        },

        'GET /api/teams': async function (a) {
            const res = await sb(rest('teams?select=data&order=created_at.asc'), { signal: a.signal });
            if (!res.ok) return antwort(500, { error: 'Failed to read teams' });
            const zeilen = await leseJson(res);
            return antwort(200, (zeilen || []).map(function (z) { return z.data; }));
        },

        'POST /api/teams': async function (a) {
            const team = a.body || {};
            if (!team.id) team.id = 'team_' + Date.now();
            const res = await sb(rest('teams?on_conflict=user_id,id'), {
                method: 'POST',
                headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify({ user_id: a.sitzung.user.id, id: team.id, data: team }),
                signal: a.signal
            });
            if (!res.ok) return antwort(500, { error: 'Failed to save team' });
            return antwort(200, { success: true, team: team });
        },

        'DELETE /api/teams/:x': async function (a) {
            const res = await sb(rest('teams?id=eq.' + encodeURIComponent(a.param)), {
                method: 'DELETE',
                signal: a.signal
            });
            if (!res.ok) return antwort(500, { error: 'Failed to delete team' });
            return antwort(200, { success: true });
        },

        'POST /api/upload-avatar': async function (a) {
            const datei = a.formData && a.formData.get('avatar');
            if (!datei || typeof datei === 'string') return antwort(400, { error: 'No file uploaded' });

            // Endung nur aus dem MIME-Typ, nie aus dem Dateinamen des Clients.
            const endung = MIME_ENDUNG[datei.type];
            if (!endung) return antwort(400, { error: 'Nur Bilder erlaubt (JPEG, PNG, WebP, GIF)' });
            if (datei.size > AVATAR_MAX_BYTES) return antwort(400, { error: 'Bild ist zu gross (max. 2 MB)' });

            const zufall = new Uint8Array(16);
            crypto.getRandomValues(zufall);
            const name = Array.prototype.map.call(zufall, function (b) {
                return ('0' + b.toString(16)).slice(-2);
            }).join('') + endung;

            const pfad = a.sitzung.user.id + '/' + name;
            const res = await sb(SB + '/storage/v1/object/avatars/' + pfad, {
                method: 'POST',
                headers: { 'Content-Type': datei.type },
                body: datei,
                signal: a.signal,
                json: false
            });
            if (!res.ok) return antwort(500, { error: 'Upload fehlgeschlagen' });
            return antwort(200, { success: true, avatarUrl: SB + '/storage/v1/object/public/avatars/' + pfad });
        }
    };

    // Pfad und Methode einer Anfrage in Routenschluessel + Parameter zerlegen.
    function finde(methode, pfad) {
        let m = pfad.match(/^\/api\/(archive|teams)\/([^/]+)$/);
        if (m) {
            let param;
            try { param = decodeURIComponent(m[2]); } catch (e) { return null; }
            const r = ROUTEN[methode + ' /api/' + m[1] + '/:x'];
            return r ? { fn: r, param: param } : null;
        }
        const r = ROUTEN[methode + ' ' + pfad];
        return r ? { fn: r, param: null } : null;
    }

    async function behandle(resource, config) {
        // Ziel, Methode, Rumpf aus String / URL / Request ermitteln
        let urlText;
        let methode = 'GET';
        let signal;
        let keepalive;
        let rohBody;

        if (typeof resource === 'string') {
            urlText = resource;
        } else if (typeof Request !== 'undefined' && resource instanceof Request) {
            urlText = resource.url;
            methode = resource.method;
            signal = resource.signal;
        } else {
            urlText = String(resource);
        }
        if (config) {
            if (config.method) methode = String(config.method);
            if (config.signal) signal = config.signal;
            keepalive = config.keepalive;
            rohBody = config.body;
        }
        methode = methode.toUpperCase();

        let u;
        try { u = new URL(urlText, location.href); } catch (e) { return null; }
        if (u.origin !== location.origin || u.pathname.indexOf('/api/') !== 0) return null;
        const pfad = u.pathname;

        if (rohBody === undefined && typeof Request !== 'undefined' && resource instanceof Request
            && methode !== 'GET' && methode !== 'HEAD') {
            rohBody = await resource.clone().text();
        }

        const a = { signal: signal, keepalive: keepalive, body: null, formData: null, param: null, sitzung: null };

        try {
            // Ticker ist noch nicht umgezogen. Die Oberflaeche verkraftet das:
            // laden() liefert null, das Kopf-Badge bleibt aus.
            if (pfad.indexOf('/api/ticker/') === 0 || pfad === '/api/ticker') {
                return antwort(503, {
                    error: 'Der Ticker zieht gerade um und ist hier noch nicht verfügbar.',
                    chats: []
                });
            }

            const route = finde(methode, pfad);
            if (!route) return antwort(404, { error: 'Not found' });
            a.param = route.param;

            if (typeof FormData !== 'undefined' && rohBody instanceof FormData) {
                a.formData = rohBody;
            } else if (typeof rohBody === 'string' && rohBody !== '') {
                try { a.body = JSON.parse(rohBody); }
                catch (e) { return antwort(400, { error: 'Invalid JSON' }); }
            }

            if (route.fn === ROUTEN['POST /api/teams'] || route.fn === ROUTEN['POST /api/upload-avatar']) {
                // Diese Routen brauchen die Benutzer-ID fuer Zeile bzw. Pfad.
                a.sitzung = await holeSitzung(signal);
                if (!a.sitzung) throw new AuthFehler();
            }

            return await route.fn(a);
        } catch (e) {
            if (e && e.istAuthFehler) {
                // Nur ausloggen, wenn noch eine Anmeldung gespeichert ist -
                // sonst waere es eine Reload-Schleife auf dem Anmeldeformular.
                if (supabaseApi.hatAnmeldung() && window.logoutUser) window.logoutUser();
                return antwort(401, { error: 'Unauthorized' });
            }
            throw e;
        }
    }

    function installiereSupabaseModus() {
        window.fetch = async function (resource, config) {
            const r = await behandle(resource, config);
            if (r) return r;
            return originalFetch.apply(null, arguments);
        };
    }

    const supabaseApi = {
        hatAnmeldung: function () {
            // Synchron und ohne Netz: nur nachsehen, was auf dem Geraet liegt.
            if (!leseLokal('auth_username')) return false;
            try {
                const s = JSON.parse(leseLokal(SITZUNGS_KEY) || 'null');
                return !!(s && s.refresh_token);
            } catch (e) {
                return false;
            }
        },

        login: async function (username, password) {
            try {
                const r = await holeClient().auth.signInWithPassword({
                    email: slug(username) + '@' + CFG.mailDomain,
                    password: password
                });
                if (r.error) {
                    if (istNetzproblem(r.error)) return { ok: false, error: 'Keine Verbindung zum Server.' };
                    return { ok: false, error: 'Benutzername oder Passwort falsch.' };
                }
                const meta = r.data.user && r.data.user.user_metadata;
                const name = (meta && meta.username) || username;
                schreibeLokal('auth_username', name);
                return { ok: true, username: name };
            } catch (e) {
                return { ok: false, error: 'Keine Verbindung zum Server.' };
            }
        },

        register: async function (username, password, code) {
            try {
                const res = await originalFetch(SB + '/functions/v1/register', {
                    method: 'POST',
                    headers: { 'apikey': CFG.supabaseKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: username, password: password, code: code })
                });
                const d = await res.json().catch(function () { return {}; });
                if (res.ok) return { ok: true };
                return { ok: false, error: d.error || 'Registrierung fehlgeschlagen.' };
            } catch (e) {
                return { ok: false, error: 'Keine Verbindung zum Server.' };
            }
        },

        // Passwort aendern: erst das aktuelle durch erneutes Anmelden pruefen
        // (loggt bei Fehler nicht aus), dann das neue setzen. Sync und
        // Spielstand bleiben unberuehrt; die Sitzung bleibt gueltig.
        passwortAendern: async function (alt, neu) {
            try {
                const sitzung = await holeSitzung();
                const mail = sitzung && sitzung.user && sitzung.user.email;
                if (!mail) return { ok: false, error: 'Nicht angemeldet.' };
                const c = holeClient();
                const pruef = await c.auth.signInWithPassword({ email: mail, password: alt });
                if (pruef.error) {
                    if (istNetzproblem(pruef.error)) return { ok: false, error: 'Keine Verbindung zum Server.' };
                    return { ok: false, error: 'Aktuelles Passwort stimmt nicht.' };
                }
                const r = await c.auth.updateUser({ password: neu });
                if (r.error) {
                    if (istNetzproblem(r.error)) return { ok: false, error: 'Keine Verbindung zum Server.' };
                    return { ok: false, error: 'Nicht gespeichert: ' + (r.error.message || 'Unbekannter Fehler') };
                }
                return { ok: true };
            } catch (e) {
                return { ok: false, error: 'Keine Verbindung zum Server.' };
            }
        },

        logout: async function () {
            // Nur lokal abmelden: muss auch ohne Netz klappen. Bewusst bleibt
            // auth_username stehen, wie bisher beim Server-Modus.
            try { await holeClient().auth.signOut({ scope: 'local' }); } catch (e) { /* egal */ }
            // Falls signOut an einem Fehler hing: Sitzung trotzdem entfernen.
            try { localStorage.removeItem(SITZUNGS_KEY); } catch (e) { /* egal */ }
        }
    };

    // ---------------------------------------------------------------

    if (MODUS === 'supabase') installiereSupabaseModus(); else installiereServerModus();

    window.Api = Object.assign({ modus: MODUS }, MODUS === 'supabase' ? supabaseApi : serverApi);

    // Alte Adresse (Pi): Hinweis auf die neue App zeigen. Nur hier - auf
    // GitHub Pages waere er sinnlos. Die Skripte stehen am Ende der Seite,
    // die Hinweise gibt es also schon.
    if (MODUS === 'server') {
        document.querySelectorAll('.umzug-hinweis').forEach(function (el) { el.hidden = false; });
    }
})();
