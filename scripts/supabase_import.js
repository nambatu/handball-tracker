#!/usr/bin/env node
'use strict';
/*
 * Einmaliger Umzug: Spieldaten vom Pi (JSON-Dateien unter DATA_DIR) nach Supabase.
 *
 *   node scripts/supabase_import.js --probe     nur anschauen, schreibt nichts (Standard)
 *   node scripts/supabase_import.js --los       wirklich uebertragen
 *   Optional: --data <ordner>   anderes Datenverzeichnis (sonst DATA_DIR aus .env, sonst ./data)
 *
 * Der Schluessel (service_role) kommt NUR aus der Umgebungsvariable
 * SUPABASE_SERVICE_ROLE_KEY. Er wird nie gedruckt, nie geloggt, nie aus einer Datei gelesen.
 *
 * Grundsaetze:
 *   - Die Pi-Daten werden nur gelesen, nie veraendert.
 *   - Beliebig oft wiederholbar: was schon in Supabase ist, wird erkannt und nicht angefasst.
 *   - Kein stilles Halbzeug: Schlaegt bei einem Konto etwas fehl (z. B. ein Avatar), werden fuer
 *     dieses Konto Spielstand/Teams/Archive NICHT geschrieben (sonst zeigten sie auf fehlende
 *     Bilder). Das steht dann im Ergebnis, und ein zweiter Lauf holt es nach.
 */

const fs = require('fs');
const path = require('path');

const STANDARD_URL = 'https://pbkasfptpfzmkhhsyzgr.supabase.co';
const MAX_ARCHIV_BYTES = 5 * 1024 * 1024;   // wie die Pruefung in der Datenbank
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;   // wie das Limit des Buckets
const ARCHIV_NAME = /^[A-Za-z0-9._-]{1,120}\.json$/;
const AVATAR_NAME = /^[A-Za-z0-9._-]{1,120}$/;
const AVATAR_TYPEN = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
// Dieselbe Feldliste wie push_state() in supabase/migrations (0001-0003).
const STATE_FELDER = ['rev', 'updatedAt', 'spielId', 'spielName', 'spieler', 'aktionen', 'tickerMarken',
    'aktiverTorwartId', 'teamHeim', 'teamGast', 'halbzeitSekunden'];

// ---------------------------------------------------------------- reine Funktionen

// Gleiche Regel wie usernameSlug in server.js.
function usernameSlug(username) {
    return String(username || '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

function contentTypeVon(dateiname) {
    return AVATAR_TYPEN[path.extname(dateiname).toLowerCase()] || null;
}

function dateinameGueltig(name) {
    return typeof name === 'string' && ARCHIV_NAME.test(name);
}

function leseJson(datei) {
    return JSON.parse(fs.readFileSync(datei, 'utf8'));
}

// Liest einen Benutzerordner. Wirft nie wegen kaputter Einzeldateien: Probleme landen als
// Eintraege mit "problem" bzw. "fehler", damit der Bericht sie nennen kann.
function leseNutzerOrdner(dir) {
    const r = { state: null, stateFehler: null, teams: [], teamsFehler: null, archive: [], avatare: [] };

    const stateDatei = path.join(dir, 'state.json');
    if (fs.existsSync(stateDatei)) {
        try { r.state = leseJson(stateDatei); } catch (e) { r.stateFehler = `state.json nicht lesbar (${e.message})`; }
    }

    const teamsDatei = path.join(dir, 'teams.json');
    if (fs.existsSync(teamsDatei)) {
        try {
            const t = leseJson(teamsDatei);
            if (!Array.isArray(t)) throw new Error('keine Liste');
            // Ersatz-ID muss bei jedem Lauf gleich sein (sonst gaebe es beim 2. Lauf Dubletten):
            // Zeitstempel der Datei + laufende Nummer.
            const stempel = Math.round(fs.statSync(teamsDatei).mtimeMs);
            r.teams = t.map((x, i) => {
                if (!x || typeof x !== 'object' || Array.isArray(x)) return { problem: `Mannschaft Nr. ${i + 1} ist keine gueltige Angabe` };
                const id = (typeof x.id === 'string' && x.id) || (typeof x.id === 'number' ? String(x.id) : `team_${stempel}_${i + 1}`);
                return { id, data: { ...x, id } };
            });
        } catch (e) { r.teamsFehler = `teams.json nicht lesbar (${e.message})`; }
    }

    const archDir = path.join(dir, 'archives');
    if (fs.existsSync(archDir)) {
        for (const name of fs.readdirSync(archDir).sort()) {
            if (!name.endsWith('.json')) continue;          // .bak, .tmp usw. ignorieren
            const voll = path.join(archDir, name);
            const eintrag = { name };
            try {
                const st = fs.statSync(voll);
                if (!st.isFile()) continue;
                eintrag.bytes = st.size;
                eintrag.mtime = st.mtime.toISOString();
                if (!dateinameGueltig(name)) eintrag.problem = 'Dateiname nicht erlaubt';
                else if (st.size > MAX_ARCHIV_BYTES) eintrag.problem = 'ueber 5 MB';
                else {
                    try { eintrag.json = leseJson(voll); } catch (e) { eintrag.fehler = `nicht lesbar (${e.message})`; }
                }
            } catch (e) { eintrag.fehler = e.message; }
            r.archive.push(eintrag);
        }
    }

    const avDir = path.join(dir, 'avatars');
    if (fs.existsSync(avDir)) {
        for (const name of fs.readdirSync(avDir).sort()) {
            const voll = path.join(avDir, name);
            let st;
            try { st = fs.statSync(voll); } catch (_) { continue; }
            if (!st.isFile()) continue;
            const e = { name, pfad: voll, bytes: st.size, type: contentTypeVon(name) };
            if (!e.type) e.problem = 'kein jpg/png/webp/gif';
            else if (!AVATAR_NAME.test(name)) e.problem = 'Dateiname nicht erlaubt';
            else if (st.size > MAX_AVATAR_BYTES) e.problem = 'ueber 2 MB';
            r.avatare.push(e);
        }
    }
    return r;
}

// Alle Unterordner von DATA_DIR (Dateien wie users.json, .jwt_secret, ticker*.json fallen weg).
function listeOrdner(dataDir) {
    return fs.readdirSync(dataDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => d.name).sort();
}

function oderNull(x) { return x || null; }
function liste(x) { return Array.isArray(x) ? x : []; }

// Der Spielstand genau in der Form, die push_state() speichern wuerde.
function reduziereState(s) {
    const q = (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
    return {
        rev: Math.trunc(Number(q.rev)) || 0,
        updatedAt: Number(q.updatedAt) || Date.now(),
        spielId: oderNull(q.spielId),
        spielName: oderNull(q.spielName),
        spieler: liste(q.spieler),
        aktionen: liste(q.aktionen),
        tickerMarken: liste(q.tickerMarken),
        aktiverTorwartId: oderNull(q.aktiverTorwartId),
        teamHeim: oderNull(q.teamHeim),
        teamGast: oderNull(q.teamGast),
        halbzeitSekunden: Number(q.halbzeitSekunden) || null
    };
}

function regexEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Ersetzt /api/avatars/<slug>/<datei> durch die neue URL (nur genau dieser Ordner, nur Dateien aus
// der Map). Ein davorstehender Rechnername (https://tracker...) wird mit ersetzt.
// Rueckgabe: { wert, ersetzt, ohneDatei: [Dateinamen ohne Datei auf dem Pi] }
function ersetzeUrls(wert, slug, urlMap) {
    const re = new RegExp(`(?:https?://[^"\\\\\\s/]+)?/api/avatars/${regexEscape(slug)}/([A-Za-z0-9._-]+)`, 'g');
    let ersetzt = 0;
    const ohneDatei = new Set();
    const text = JSON.stringify(wert).replace(re, (m, datei) => {
        if (urlMap.has(datei)) { ersetzt++; return urlMap.get(datei); }
        ohneDatei.add(datei);
        return m;
    });
    return { wert: JSON.parse(text), ersetzt, ohneDatei: [...ohneDatei] };
}

// Schluessel sortiert, damit zwei gleiche Dokumente gleich aussehen (Postgres sortiert jsonb anders).
function kanonisch(x) {
    if (Array.isArray(x)) return '[' + x.map(kanonisch).join(',') + ']';
    if (x && typeof x === 'object') {
        return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + kanonisch(x[k])).join(',') + '}';
    }
    return JSON.stringify(x === undefined ? null : x);
}

// Vergleich ohne updatedAt: fehlt es auf dem Pi, wird es bei jedem Lauf neu gesetzt.
function gleicherStand(a, b) {
    const ohne = o => { const c = { ...(o || {}) }; delete c.updatedAt; return c; };
    return kanonisch(ohne(a)) === kanonisch(ohne(b));
}

// Entscheidung zum Spielstand. neu = reduzierter Pi-Stand, remote = Zeile aus Supabase oder null.
function entscheideState(neu, remote) {
    if (liste(neu.spieler).length === 0 && liste(neu.aktionen).length === 0) return 'leer';
    if (!remote) return 'schreiben';
    const rs = remote.state || {};
    if (gleicherStand(rs, neu)) return 'schon_da';
    if (liste(rs.aktionen).length > 0) return 'uebersprungen';
    return 'schreiben';
}

// ---------------------------------------------------------------- Netzwerk (austauschbar)

function erzeugeApi({ url, key, fetchFn }) {
    const f = fetchFn || fetch;
    const basis = url.replace(/\/+$/, '');
    const kopf = { apikey: key, Authorization: `Bearer ${key}` };

    async function anfrage(methode, pfad, { body, headers, roh } = {}) {
        let letzter;
        for (let versuch = 1; versuch <= 3; versuch++) {
            try {
                const res = await f(basis + pfad, {
                    method: methode,
                    headers: { ...kopf, ...(headers || {}) },
                    body: body === undefined ? undefined : (roh ? body : JSON.stringify(body)),
                    signal: AbortSignal.timeout(60000)
                });
                if (res.status >= 500 && versuch < 3) { letzter = new Error(`HTTP ${res.status}`); continue; }
                return res;
            } catch (e) {
                letzter = new Error(`Verbindung fehlgeschlagen (${(e.cause && e.cause.code) || e.message})`);
                if (versuch === 3) throw letzter;
            }
        }
        throw letzter;
    }
    async function pruefe(res, was) {
        if (res.ok) return res;
        const text = (await res.text().catch(() => '')).slice(0, 300);
        const err = new Error(`${was}: HTTP ${res.status} ${text}`);
        err.status = res.status;
        throw err;
    }
    const json = async (res, was) => (await pruefe(res, was)).json();
    const jh = { 'Content-Type': 'application/json' };
    const q = encodeURIComponent;

    return {
        publicUrl: (uid, name) => `${basis}/storage/v1/object/public/avatars/${uid}/${name}`,
        async profile() {
            return json(await anfrage('GET', '/rest/v1/profiles?select=user_id,slug'), 'Konten lesen');
        },
        async avatarVorhanden(uid, name) {
            const res = await anfrage('HEAD', `/storage/v1/object/public/avatars/${uid}/${q(name)}`);
            return res.status === 200;
        },
        async avatarHochladen(uid, name, buf, type) {
            await pruefe(await anfrage('POST', `/storage/v1/object/avatars/${uid}/${q(name)}`,
                { body: buf, roh: true, headers: { 'Content-Type': type, 'x-upsert': 'true' } }), `Avatar ${name} hochladen`);
        },
        async stateHolen(uid) {
            const z = await json(await anfrage('GET', `/rest/v1/states?select=rev,state&user_id=eq.${uid}`), 'Spielstand lesen');
            return z[0] || null;
        },
        async stateSchreiben(uid, rev, state) {
            await pruefe(await anfrage('POST', '/rest/v1/states?on_conflict=user_id', {
                body: { user_id: uid, rev, state, updated_at: new Date().toISOString() },
                headers: { ...jh, Prefer: 'resolution=merge-duplicates,return=minimal' }
            }), 'Spielstand schreiben');
        },
        async teamsHolen(uid) {
            return json(await anfrage('GET', `/rest/v1/teams?select=id,data&user_id=eq.${uid}`), 'Mannschaften lesen');
        },
        async teamsSchreiben(uid, zeilen) {
            await pruefe(await anfrage('POST', '/rest/v1/teams?on_conflict=user_id,id', {
                body: zeilen.map(z => ({ user_id: uid, id: z.id, data: z.data })),
                headers: { ...jh, Prefer: 'resolution=merge-duplicates,return=minimal' }
            }), 'Mannschaften schreiben');
        },
        async archiveHolen(uid) {
            return json(await anfrage('GET', `/rest/v1/archives?select=filename&user_id=eq.${uid}&limit=10000`), 'Archive lesen');
        },
        async archivSchreiben(uid, z) {
            await pruefe(await anfrage('POST', '/rest/v1/archives?on_conflict=user_id,filename', {
                body: [{ user_id: uid, filename: z.filename, label: z.label, data: z.data, created_at: z.created_at }],
                headers: { ...jh, Prefer: 'resolution=ignore-duplicates,return=minimal' }
            }), `Archiv ${z.filename} schreiben`);
        }
    };
}

// ---------------------------------------------------------------- Ablauf je Konto

// Ein Konto abarbeiten. Gibt { zeilen, zaehler, fehler, warn } zurueck.
async function importiereNutzer({ slug, uid, daten, api, los }) {
    const z = { avatare: '-', state: '-', teams: '-', archive: '-' };
    const zeilen = [];
    const fehler = [];
    const warn = [];
    const log = t => zeilen.push('  ' + t);
    const wort = los ? ['hochgeladen', 'geschrieben', 'angelegt'] : ['wuerde hochladen', 'wuerde schreiben', 'wuerde anlegen'];

    // 1) Avatare zuerst, damit die neuen Adressen feststehen.
    const urlMap = new Map();
    let neu = 0, schon = 0, avProb = 0, avFehl = 0;
    for (const a of daten.avatare) {
        if (a.problem) { avProb++; warn.push(`Avatar ${a.name} uebersprungen: ${a.problem}`); continue; }
        try {
            if (await api.avatarVorhanden(uid, a.name)) { schon++; urlMap.set(a.name, api.publicUrl(uid, a.name)); continue; }
            if (los) await api.avatarHochladen(uid, a.name, fs.readFileSync(a.pfad), a.type);
            neu++;
            urlMap.set(a.name, api.publicUrl(uid, a.name));
        } catch (e) { avFehl++; fehler.push(`Avatar ${a.name}: ${e.message}`); }
    }
    if (daten.avatare.length) {
        log(`Avatare: ${neu} ${wort[0]}, ${schon} schon da` + (avProb ? `, ${avProb} uebersprungen` : '') + (avFehl ? `, ${avFehl} FEHLGESCHLAGEN` : ''));
    } else log('Avatare: keine');
    z.avatare = `${neu}+${schon}`;
    const mapUrl = (wert) => {
        const r = ersetzeUrls(wert, slug, urlMap);
        for (const d of r.ohneDatei) warn.push(`Bild-Verweis ohne Datei auf dem Pi: ${d} (bleibt unveraendert)`);
        return r.wert;
    };

    if (avFehl) {
        fehler.push('Spielstand, Mannschaften und Archive dieses Kontos wurden NICHT geschrieben (Avatar-Fehler). Bitte den Lauf wiederholen.');
        z.state = z.teams = z.archive = 'nicht';
        return { zeilen, zaehler: z, fehler, warn };
    }

    // 2) Spielstand
    try {
        if (daten.stateFehler) { fehler.push(daten.stateFehler); z.state = 'FEHLER'; }
        else if (!daten.state) { log('Spielstand: auf dem Pi keiner vorhanden'); z.state = 'keiner'; }
        else {
            const neuerStand = reduziereState(mapUrl(reduziereState(daten.state)));
            const remote = await api.stateHolen(uid);
            const entscheidung = entscheideState(neuerStand, remote);
            const info = `${neuerStand.spieler.length} Spieler, ${neuerStand.aktionen.length} Aktionen, rev ${neuerStand.rev}`;
            if (entscheidung === 'leer') { log('Spielstand: leer (keine Spieler, keine Aktionen) - nichts zu uebernehmen'); z.state = 'leer'; }
            else if (entscheidung === 'schon_da') { log(`Spielstand: schon uebernommen (${info})`); z.state = 'schon da'; }
            else if (entscheidung === 'uebersprungen') {
                log('Spielstand uebersprungen: in der neuen App wurde schon gespielt'); z.state = 'uebersprungen';
            } else {
                if (los) await api.stateSchreiben(uid, neuerStand.rev, neuerStand);
                log(`Spielstand: ${wort[1]} (${info})`); z.state = 'neu';
            }
        }
    } catch (e) { fehler.push(e.message); z.state = 'FEHLER'; }

    // 3) Mannschaften: vorhandene Eintraege (gleiche ID) bleiben, damit nichts ueberschrieben wird,
    //    was in der neuen App inzwischen geaendert wurde.
    try {
        if (daten.teamsFehler) { fehler.push(daten.teamsFehler); z.teams = 'FEHLER'; }
        else if (!daten.teams.length) { log('Mannschaften: keine'); z.teams = '0'; }
        else {
            const gut = daten.teams.filter(t => !t.problem);
            for (const t of daten.teams.filter(t => t.problem)) warn.push(`Mannschaft uebersprungen: ${t.problem}`);
            const vorhanden = new Map((await api.teamsHolen(uid)).map(t => [t.id, t.data]));
            const neue = [];
            let schonDa = 0, abweichend = 0;
            for (const t of gut) {
                const data = mapUrl(t.data);
                if (!vorhanden.has(t.id)) neue.push({ id: t.id, data });
                else { schonDa++; if (kanonisch(vorhanden.get(t.id)) !== kanonisch(data)) abweichend++; }
            }
            if (neue.length && los) await api.teamsSchreiben(uid, neue);
            log(`Mannschaften: ${neue.length} ${wort[2]}, ${schonDa} schon da` +
                (abweichend ? ` (${abweichend} davon in der neuen App geaendert - bleiben so)` : ''));
            z.teams = `${neue.length}+${schonDa}`;
        }
    } catch (e) { fehler.push(e.message); z.teams = 'FEHLER'; }

    // 4) Archive
    try {
        if (!daten.archive.length) { log('Archive: keine'); z.archive = '0'; }
        else {
            const da = new Set((await api.archiveHolen(uid)).map(a => a.filename));
            let neuA = 0, schonA = 0, uebersp = 0, fehlA = 0;
            for (const a of daten.archive) {
                if (a.problem) { uebersp++; warn.push(`Archiv ${a.name} uebersprungen: ${a.problem}`); continue; }
                if (a.fehler) { fehlA++; fehler.push(`Archiv ${a.name}: ${a.fehler}`); continue; }
                if (da.has(a.name)) { schonA++; continue; }
                try {
                    const data = mapUrl(a.json);
                    const label = (a.json && typeof a.json.label === 'string' && a.json.label.slice(0, 120)) || null;
                    if (los) await api.archivSchreiben(uid, { filename: a.name, label, data, created_at: a.mtime });
                    neuA++;
                } catch (e) { fehlA++; fehler.push(e.message); }
            }
            log(`Archive: ${neuA} ${wort[2]}, ${schonA} schon da` + (uebersp ? `, ${uebersp} uebersprungen` : '') + (fehlA ? `, ${fehlA} FEHLGESCHLAGEN` : ''));
            z.archive = `${neuA}+${schonA}`;
        }
    } catch (e) { fehler.push(e.message); z.archive = 'FEHLER'; }

    return { zeilen, zaehler: z, fehler, warn };
}

// Alles zusammen. Gibt { ausgabe: [Zeilen], exitCode } zurueck; druckt selbst nichts (testbar).
async function importiere({ dataDir, api, los, ordner }) {
    const out = [];
    const ausgabe = t => out.push(t);
    const profile = await api.profile();
    const nachSlug = new Map(profile.map(p => [p.slug, p.user_id]));
    const ergebnisse = [];
    const ohneKonto = [];
    let fehlerGesamt = 0;

    for (const slug of (ordner || listeOrdner(dataDir))) {
        const uid = nachSlug.get(slug);
        if (!uid) { ohneKonto.push(slug); continue; }
        ausgabe(`--- ${slug} ---`);
        const daten = leseNutzerOrdner(path.join(dataDir, slug));
        const r = await importiereNutzer({ slug, uid, daten, api, los });
        r.zeilen.forEach(ausgabe);
        r.warn.forEach(w => ausgabe('  Hinweis: ' + w));
        r.fehler.forEach(f => ausgabe('  FEHLER: ' + f));
        fehlerGesamt += r.fehler.length;
        ergebnisse.push({ slug, ...r.zaehler, ok: r.fehler.length === 0 });
        ausgabe('');
    }

    ausgabe('=== Zusammenfassung (Zahlen: neu+schon da) ===');
    const sp = ['Konto', 'Avatare', 'Spielstand', 'Teams', 'Archive', 'Ergebnis'];
    const tab = [sp, ...ergebnisse.map(e => [e.slug, e.avatare, e.state, e.teams, e.archive, e.ok ? 'ok' : 'FEHLER'])];
    const breit = sp.map((_, i) => Math.max(...tab.map(r => String(r[i]).length)));
    tab.forEach(r => ausgabe(r.map((c, i) => String(c).padEnd(breit[i])).join('  ').trimEnd()));
    if (ohneKonto.length) {
        ausgabe('');
        ausgabe('nicht uebernommen (kein Konto):');
        ohneKonto.forEach(s => ausgabe('  ' + s));
    }
    ausgabe('');
    const etwasNeu = ergebnisse.some(e => [e.avatare, e.teams, e.archive].some(v => /^[1-9]/.test(String(v))) || e.state === 'neu');
    if (fehlerGesamt) {
        ausgabe(`ACHTUNG: ${fehlerGesamt} Fehler. Nichts ist kaputt - bitte denselben Befehl nochmal ausfuehren, er macht dort weiter.`);
    } else if (!los) {
        ausgabe('Das war nur die Vorschau, es wurde nichts geschrieben. Zum Uebertragen: node scripts/supabase_import.js --los');
    } else if (!etwasNeu) {
        ausgabe('Es war nichts Neues zu uebertragen - alles ist schon in Supabase.');
    } else {
        ausgabe('Fertig. Bitte jeden Nutzer die neue App einmal oeffnen und pruefen lassen, ob Spielstand, Mannschaften und Archive da sind.');
    }
    return { ausgabe: out, exitCode: fehlerGesamt ? 1 : 0 };
}

// ---------------------------------------------------------------- Start

async function main(argv) {
    const args = argv.slice(2);
    const los = args.includes('--los');
    const probe = args.includes('--probe');
    const di = args.indexOf('--data');
    if (los && probe) { console.error('Bitte nur --probe ODER --los angeben, nicht beides.'); return 1; }
    if (di >= 0 && !args[di + 1]) { console.error('Nach --data fehlt der Ordner.'); return 1; }

    // Schluessel nur aus der Umgebung, nie aus der .env (dotenv wuerde ihn sonst mitladen).
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
    if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = key;

    const dataDir = di >= 0 ? path.resolve(args[di + 1])
        : process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
    const url = process.env.HT_SUPABASE_URL || STANDARD_URL;

    console.log(los ? 'Modus: ECHTER LAUF (es wird nach Supabase geschrieben)' : 'Modus: VORSCHAU (es wird nichts geschrieben)');
    console.log(`Datenverzeichnis: ${dataDir}`);
    if (url !== STANDARD_URL) console.log(`Ziel: ${url} (Testziel, nicht das echte Supabase)`);
    console.log('');

    if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
        console.error(`Das Datenverzeichnis gibt es nicht: ${dataDir}\nTipp: mit --data <ordner> angeben (siehe DATA_DIR in der .env).`);
        return 1;
    }
    const ordner = listeOrdner(dataDir);

    if (!key) {
        if (los) {
            console.error('Der Schluessel fehlt (SUPABASE_SERVICE_ROLE_KEY). Ohne ihn kann nichts uebertragen werden. Siehe scripts/supabase_import.md.');
            return 1;
        }
        console.log(`Gefundene Nutzerordner (${ordner.length}): ${ordner.join(', ') || '-'}`);
        for (const s of ordner) {
            const d = leseNutzerOrdner(path.join(dataDir, s));
            console.log(`  ${s}: Spielstand ${d.state ? 'ja' : 'nein'}, ${d.teams.length} Mannschaften, ${d.archive.length} Archive, ${d.avatare.length} Avatare`);
        }
        console.log('\nDer Schluessel (SUPABASE_SERVICE_ROLE_KEY) ist nicht gesetzt - darum kann ich nicht nachsehen, welche Konten es in Supabase gibt.');
        console.log('Es wurde nichts geschrieben. Anleitung zum Schluessel: scripts/supabase_import.md');
        return 0;
    }

    const api = erzeugeApi({ url, key });
    try {
        const r = await importiere({ dataDir, api, los, ordner });
        console.log(r.ausgabe.join('\n'));
        return r.exitCode;
    } catch (e) {
        const msg = /HTTP 401|HTTP 403/.test(e.message)
            ? 'Supabase hat den Schluessel abgelehnt. Ist es der "service_role"/"secret"-Schluessel (nicht der "anon"/"publishable")?'
            : e.message;
        console.error(`ABBRUCH: ${msg}\nEs ist nichts halb passiert, was man nicht wiederholen koennte - einfach nochmal starten.`);
        return 1;
    }
}

module.exports = {
    usernameSlug, contentTypeVon, dateinameGueltig, leseNutzerOrdner, listeOrdner, reduziereState,
    ersetzeUrls, kanonisch, entscheideState, erzeugeApi, importiereNutzer, importiere, STATE_FELDER
};

if (require.main === module) {
    main(process.argv).then(c => { process.exitCode = c; }, e => { console.error('ABBRUCH:', e.message); process.exitCode = 1; });
}
