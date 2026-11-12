// Gemeinsame Hilfen fuer die Vertragstests gegen das echte Supabase-Backend.
//
// Zugangsdaten kommen NUR aus Umgebungsvariablen (das Repo ist oeffentlich):
//   HT_SUPABASE_URL, HT_SUPABASE_KEY (publishable key),
//   HT_TEST_USER_A, HT_TEST_PASS_A, HT_TEST_USER_B, HT_TEST_PASS_B
// Aufruf z.B.: node --env-file=<datei> --test --test-concurrency=1 test/

const E = process.env;
export const URL_BASIS = (E.HT_SUPABASE_URL || '').replace(/\/+$/, '');
export const KEY = E.HT_SUPABASE_KEY || '';

const fehlend = ['HT_SUPABASE_URL', 'HT_SUPABASE_KEY', 'HT_TEST_USER_A', 'HT_TEST_PASS_A',
    'HT_TEST_USER_B', 'HT_TEST_PASS_B'].filter(function (n) { return !E[n]; });

// Wenn etwas fehlt, ueberspringen die Tests mit dieser Meldung (statt zu scheitern).
export const SKIP = fehlend.length
    ? 'Uebersprungen: Umgebungsvariablen fehlen (' + fehlend.join(', ') +
      '). Siehe test/helfer.mjs fuer die Liste.'
    : false;

export const DOMAIN = '@tracker.langschwerts.de';

// Fetch mit Zeitlimit, damit ein haengendes Backend den Lauf nicht blockiert.
async function holen(url, opts) {
    return fetch(url, Object.assign({ signal: AbortSignal.timeout(60000) }, opts));
}

export async function anmelden(user, pass) {
    const r = await holen(URL_BASIS + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { apikey: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user + DOMAIN, password: pass })
    });
    const j = await r.json();
    if (!r.ok || !j.access_token) {
        throw new Error('Anmeldung fehlgeschlagen (' + r.status + '): ' + (j.msg || j.error_description || JSON.stringify(j)));
    }
    return { token: j.access_token, userId: j.user.id, user: user };
}

export const anmeldenA = function () { return anmelden(E.HT_TEST_USER_A, E.HT_TEST_PASS_A); };
export const anmeldenB = function () { return anmelden(E.HT_TEST_USER_B, E.HT_TEST_PASS_B); };

// Allgemeiner Aufruf. sitzung = null -> nur apikey (anonym).
// body: Objekt (wird als JSON gesendet) ODER {roh: Buffer/String} fuer Dateien.
// Rueckgabe: { status, json, text, headers }
export async function api(sitzung, method, pfad, body, extraHeaders) {
    const h = { apikey: KEY };
    if (sitzung) h.Authorization = 'Bearer ' + sitzung.token;
    let payload;
    if (body && body.roh !== undefined) {
        payload = body.roh;
    } else if (body !== undefined) {
        h['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }
    Object.assign(h, extraHeaders || {});
    const r = await holen(URL_BASIS + pfad, { method: method, headers: h, body: payload });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* kein JSON */ }
    return { status: r.status, json: json, text: text, headers: r.headers };
}

export const getState = function (s) { return api(s, 'POST', '/rest/v1/rpc/get_state', {}); };
export const pushState = function (s, st) { return api(s, 'POST', '/rest/v1/rpc/push_state', { p_state: st }); };

// Den Spielstand ueber die API leeren. Eine Zeile in "states" laesst sich ueber
// die API nicht loeschen (bewusst: nur push_state darf schreiben). Wir setzen
// deshalb einen leeren Stand mit rev 0. rev 0 wird immer angenommen (wie im
// alten server.js), danach koennen Tests wieder bei kleinen revs anfangen.
export async function standLeeren(s) {
    const r = await pushState(s, { rev: 0, spieler: [], aktionen: [] });
    if (r.status !== 200 || !r.json || r.json.ok !== true) {
        throw new Error('Spielstand zuruecksetzen fehlgeschlagen: ' + r.status + ' ' + r.text);
    }
}

// Konto zuruecksetzen: Stand leeren, alle Mannschaften und Archive loeschen.
// (Avatare lassen sich per API nicht loeschen: es gibt keine Loesch-Policy.)
export async function leerung(s) {
    await standLeeren(s);
    const t = await api(s, 'DELETE', '/rest/v1/teams?user_id=eq.' + s.userId);
    if (t.status >= 300) throw new Error('Teams loeschen: ' + t.status + ' ' + t.text);
    const a = await api(s, 'DELETE', '/rest/v1/archives?user_id=eq.' + s.userId);
    if (a.status >= 300) throw new Error('Archive loeschen: ' + a.status + ' ' + a.text);
}

// Eindeutiges Suffix je Lauf.
export const LAUF = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------------------------------------------------------------
// Zusammenfuehrung wie im Browser.
// Kopie des Ablaufs von merge() in public/js/sync.js (Spieler und Aktionen
// ueber die id vereinigen, rev = Maximum + 1). Vereinfacht auf die Teile, die
// der Vertragstest braucht: Aktionen werden hier ueber "id" erkannt.
// Wenn sich merge() dort aendert, muss diese Kopie nicht mitziehen - sie
// soll nur zeigen, dass ein echter Zwei-Geraete-Ablauf durchgeht.
// ---------------------------------------------------------------
export function zusammenfuehren(lokal, fern) {
    const juenger = (fern.updatedAt || 0) >= (lokal.updatedAt || 0) ? fern : lokal;
    const aelter = juenger === fern ? lokal : fern;

    const spieler = [];
    const stelle = new Map();
    [aelter, juenger].forEach(function (q) {
        (q.spieler || []).forEach(function (p) {
            const k = String(p.id);
            if (stelle.has(k)) spieler[stelle.get(k)] = p;
            else { stelle.set(k, spieler.length); spieler.push(p); }
        });
    });

    const aktionen = (fern.aktionen || []).slice();
    const gesehen = new Set(aktionen.map(function (a) { return String(a.id); }));
    (lokal.aktionen || []).forEach(function (a) {
        if (!gesehen.has(String(a.id))) { gesehen.add(String(a.id)); aktionen.push(a); }
    });
    aktionen.sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });

    return Object.assign({}, juenger, {
        spieler: spieler,
        aktionen: aktionen,
        rev: Math.max(lokal.rev || 0, fern.rev || 0) + 1,
        updatedAt: Date.now()
    });
}
