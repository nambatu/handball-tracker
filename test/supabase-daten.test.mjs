// Vertragstest: Archive, Mannschaften, Avatare, Trennung der Konten und
// gesperrte Funktionen gegen das echte Supabase.
//
// Dieses File veraendert NIE den Spielstand von Konto A (den gehoert
// supabase-stand.test.mjs). Fuer Isolationspruefungen nutzt es den Stand von B.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
    SKIP, URL_BASIS, KEY, anmeldenA, anmeldenB, api, getState, pushState, standLeeren, leerung, LAUF
} from './helfer.mjs';

// 1x1 PNG (transparent)
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64');

describe('Archive und Mannschaften', { skip: SKIP, concurrency: false }, () => {
    let A;
    before(async () => {
        A = await anmeldenA();
        // Hinweis: loescht nur Teams/Archive; Spielstand von A bleibt unangetastet.
        await api(A, 'DELETE', '/rest/v1/teams?user_id=eq.' + A.userId);
        await api(A, 'DELETE', '/rest/v1/archives?user_id=eq.' + A.userId);
    });
    after(async () => {
        if (!A) return;
        await api(A, 'DELETE', '/rest/v1/teams?user_id=eq.' + A.userId);
        await api(A, 'DELETE', '/rest/v1/archives?user_id=eq.' + A.userId);
    });

    it('Mannschaften: anlegen (Upsert), auflisten, gleiche id ueberschreiben, loeschen', async () => {
        const id = 'team-' + LAUF;
        const up = (data) => api(A, 'POST', '/rest/v1/teams?on_conflict=user_id,id', { id: id, data: data },
            { Prefer: 'resolution=merge-duplicates,return=representation' });
        const r1 = await up({ id: id, name: 'Erste Fassung', spieler: [] });
        assert.ok(r1.status === 201 || r1.status === 200, r1.status + ' ' + r1.text);
        let liste = (await api(A, 'GET', '/rest/v1/teams?select=id,data')).json;
        assert.equal(liste.length, 1);
        assert.equal(liste[0].data.name, 'Erste Fassung');
        const r2 = await up({ id: id, name: 'Zweite Fassung', spieler: [] });
        assert.ok(r2.status < 300, r2.status + ' ' + r2.text);
        liste = (await api(A, 'GET', '/rest/v1/teams?select=id,data')).json;
        assert.equal(liste.length, 1, 'gleiche id darf keine zweite Zeile erzeugen');
        assert.equal(liste[0].data.name, 'Zweite Fassung');
        const del = await api(A, 'DELETE', '/rest/v1/teams?id=eq.' + id, undefined, { Prefer: 'return=representation' });
        assert.equal(del.json.length, 1);
        assert.deepEqual((await api(A, 'GET', '/rest/v1/teams?select=id')).json, []);
    });

    it('Archive: anlegen, in archives_list sichtbar, Beschriftung aendern, lesen, loeschen', async () => {
        const fn = 'game-2026-11-12T10-00-00-000Z.json';
        const daten = { teamHeim: 'Heim ' + LAUF, teamGast: 'Gast', aktionen: [{ id: 1 }, { id: 2 }, { id: 3 }], spieler: [] };
        const ins = await api(A, 'POST', '/rest/v1/archives', { filename: fn, data: daten }, { Prefer: 'return=representation' });
        assert.equal(ins.status, 201, ins.text);
        const l = (await api(A, 'GET', '/rest/v1/archives_list?filename=eq.' + fn)).json;
        assert.equal(l.length, 1);
        assert.equal(l[0].teamHeim, 'Heim ' + LAUF);
        assert.equal(l[0].teamGast, 'Gast');
        assert.equal(l[0].aktionen, 3);
        assert.ok(l[0].date && !isNaN(Date.parse(l[0].date)), 'date muss ein Zeitstempel sein');
        const pa = await api(A, 'PATCH', '/rest/v1/archives?filename=eq.' + fn, { label: 'Pokalspiel' }, { Prefer: 'return=representation' });
        assert.equal(pa.json.length, 1, pa.text);
        const rd = (await api(A, 'GET', '/rest/v1/archives?select=label,data&filename=eq.' + fn)).json;
        assert.equal(rd[0].label, 'Pokalspiel');
        assert.deepEqual(rd[0].data, daten);
        const del = await api(A, 'DELETE', '/rest/v1/archives?filename=eq.' + fn, undefined, { Prefer: 'return=representation' });
        assert.equal(del.json.length, 1);
        assert.deepEqual((await api(A, 'GET', '/rest/v1/archives_list?filename=eq.' + fn)).json, []);
    });

    it('Archive: Dateinamen mit "/" oder ".." und doppelte Namen werden abgelehnt', async () => {
        // Der Name wurde frueher als Dateiname auf dem Pi benutzt - Pfadtricks muessen draussen bleiben.
        for (const fn of ['../boese.json', 'a/b.json', 'a..b/c.json', 'ohne-endung', '']) {
            const r = await api(A, 'POST', '/rest/v1/archives', { filename: fn, data: {} });
            assert.ok(r.status >= 400, JSON.stringify(fn) + ' muesste abgelehnt werden, war ' + r.status);
        }
        const fn = 'doppelt-' + LAUF + '.json';
        const r1 = await api(A, 'POST', '/rest/v1/archives', { filename: fn, data: {} });
        assert.equal(r1.status, 201, r1.text);
        const r2 = await api(A, 'POST', '/rest/v1/archives', { filename: fn, data: {} });
        assert.equal(r2.status, 409, 'zweiter gleicher Name: ' + r2.status + ' ' + r2.text);
    });
});

describe('Trennung der Konten (Isolation)', { skip: SKIP, concurrency: false }, () => {
    let A, B;
    const fnA = 'iso-' + LAUF + '.json';
    const teamA = 'iso-team-' + LAUF;

    before(async () => {
        A = await anmeldenA();
        B = await anmeldenB();
        await leerung(B); // B-Spielstand gehoert diesem File
        await api(A, 'DELETE', '/rest/v1/archives?filename=eq.' + fnA);
        await api(A, 'DELETE', '/rest/v1/teams?id=eq.' + teamA);
        await api(A, 'POST', '/rest/v1/archives', { filename: fnA, data: { teamHeim: 'Geheim-' + LAUF, aktionen: [] } });
        await api(A, 'POST', '/rest/v1/teams', { id: teamA, data: { name: 'Geheim-' + LAUF } });
    });
    after(async () => {
        if (A) {
            await api(A, 'DELETE', '/rest/v1/archives?filename=eq.' + fnA);
            await api(A, 'DELETE', '/rest/v1/teams?id=eq.' + teamA);
        }
        if (B) await leerung(B);
    });

    it('B sieht den Spielstand von A nie (eigene Zeile in states, get_state ohne A-Daten)', async () => {
        await pushState(B, { rev: 1, spieler: [{ id: 'b1', name: 'Nur-B-' + LAUF }] });
        const rows = (await api(B, 'GET', '/rest/v1/states?select=user_id')).json;
        assert.ok(rows.every(z => z.user_id === B.userId), 'nur eigene Zeile erlaubt');
        const fremd = (await api(B, 'GET', '/rest/v1/states?select=user_id&user_id=eq.' + A.userId)).json;
        assert.deepEqual(fremd, []);
        const g = (await getState(B)).json;
        assert.deepEqual(g.spieler.map(p => p.id), ['b1']);
        // Schreiben in A's Zeile ist nicht moeglich:
        const w = await api(B, 'PATCH', '/rest/v1/states?user_id=eq.' + A.userId, { rev: 1 }, { Prefer: 'return=representation' });
        assert.ok(w.status >= 400 || (Array.isArray(w.json) && w.json.length === 0), w.status + ' ' + w.text);
    });

    it('B sieht und aendert Archive und Mannschaften von A nicht', async () => {
        for (const t of ['archives', 'teams']) {
            const s = await api(B, 'GET', '/rest/v1/' + t + '?user_id=eq.' + A.userId);
            assert.deepEqual(s.json, [], t + ': B darf nichts von A sehen');
            const all = (await api(B, 'GET', '/rest/v1/' + t)).json;
            assert.ok(all.every(z => z.user_id === B.userId));
        }
        const lst = (await api(B, 'GET', '/rest/v1/archives_list?filename=eq.' + fnA)).json;
        assert.deepEqual(lst, []);
        const u1 = await api(B, 'PATCH', '/rest/v1/archives?filename=eq.' + fnA, { label: 'gehackt' }, { Prefer: 'return=representation' });
        const d1 = await api(B, 'DELETE', '/rest/v1/archives?filename=eq.' + fnA, undefined, { Prefer: 'return=representation' });
        const u2 = await api(B, 'PATCH', '/rest/v1/teams?id=eq.' + teamA, { data: { name: 'gehackt' } }, { Prefer: 'return=representation' });
        const d2 = await api(B, 'DELETE', '/rest/v1/teams?id=eq.' + teamA, undefined, { Prefer: 'return=representation' });
        for (const r of [u1, d1, u2, d2]) {
            assert.ok(r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0), r.status + ' ' + r.text);
        }
        // Unveraendert bei A:
        const a = (await api(A, 'GET', '/rest/v1/archives?select=label&filename=eq.' + fnA)).json;
        assert.equal(a.length, 1);
        assert.equal(a[0].label, null);
        const t = (await api(A, 'GET', '/rest/v1/teams?select=data&id=eq.' + teamA)).json;
        assert.equal(t[0].data.name, 'Geheim-' + LAUF);
    });

    it('B kann keine Zeilen mit der user_id von A anlegen', async () => {
        const r1 = await api(B, 'POST', '/rest/v1/archives', { user_id: A.userId, filename: 'fremd-' + LAUF + '.json', data: {} });
        const r2 = await api(B, 'POST', '/rest/v1/teams', { user_id: A.userId, id: 'fremd-' + LAUF, data: {} });
        assert.ok(r1.status >= 400, 'archives: ' + r1.status + ' ' + r1.text);
        assert.ok(r2.status >= 400, 'teams: ' + r2.status + ' ' + r2.text);
        const check = (await api(A, 'GET', '/rest/v1/archives?filename=eq.fremd-' + LAUF + '.json')).json;
        assert.deepEqual(check, []);
    });
});

describe('Avatare (Storage)', { skip: SKIP, concurrency: false }, () => {
    let A, B;
    before(async () => { A = await anmeldenA(); B = await anmeldenB(); });

    const hoch = (s, pfad, bytes, typ) =>
        api(s, 'POST', '/storage/v1/object/avatars/' + pfad, { roh: bytes }, { 'Content-Type': typ });

    it('Hochladen in den eigenen Ordner klappt und das Bild ist oeffentlich lesbar', async () => {
        // Hinweis: Es gibt keine Loesch-Policy, die Testdatei bleibt liegen (1x1 Pixel, ca. 70 Byte).
        const name = 'vertragstest-' + LAUF + '.png';
        const r = await hoch(A, A.userId + '/' + name, PNG, 'image/png');
        assert.equal(r.status, 200, r.text);
        const g = await fetch(URL_BASIS + '/storage/v1/object/public/avatars/' + A.userId + '/' + name);
        assert.equal(g.status, 200);
        assert.equal(g.headers.get('content-type'), 'image/png');
    });

    it('Hochladen in den Ordner eines anderen Kontos wird verweigert', async () => {
        const r = await hoch(A, B.userId + '/fremd-' + LAUF + '.png', PNG, 'image/png');
        assert.ok(r.status >= 400, r.status + ' ' + r.text);
    });

    it('falscher Dateityp (text/plain) wird verweigert', async () => {
        const r = await hoch(A, A.userId + '/text-' + LAUF + '.png', Buffer.from('hallo'), 'text/plain');
        assert.ok(r.status >= 400, r.status + ' ' + r.text);
    });

    it('Datei ueber 2 MB wird verweigert', async () => {
        const gross = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 10)]);
        const r = await hoch(A, A.userId + '/gross-' + LAUF + '.png', gross, 'image/png');
        assert.ok(r.status >= 400, r.status + ' ' + r.text.slice(0, 200));
    });

    it('der Ordner laesst sich nicht auflisten', async () => {
        for (const s of [A, null]) {
            const r = await api(s, 'POST', '/storage/v1/object/list/avatars', { prefix: '' });
            assert.ok(r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0),
                'Auflisten muss leer/verboten sein, war ' + r.status + ' ' + r.text.slice(0, 200));
        }
    });
});

describe('Gesperrte Funktionen und Registrierung', { skip: SKIP, concurrency: false }, () => {
    it('register_erlaubt und registrierung_abschliessen sind fuer Benutzer und Anonyme gesperrt', async () => {
        const A = await anmeldenA();
        for (const s of [A, null]) {
            const r1 = await api(s, 'POST', '/rest/v1/rpc/register_erlaubt', { p_ip: 'x' });
            const r2 = await api(s, 'POST', '/rest/v1/rpc/registrierung_abschliessen',
                { p_user: A.userId, p_username: 'x', p_slug: 'x' });
            for (const r of [r1, r2]) {
                assert.ok([401, 403, 404].includes(r.status), 'erwartet 401/403/404, war ' + r.status + ' ' + r.text);
            }
        }
    });

    it('Registrierung mit falschem Code liefert nie 200 (503 = noch nicht eingerichtet, 403 = falscher Code)', async () => {
        // Hoechstens EINE Anfrage hierher je Lauf: die Funktion erlaubt nur 5 je Stunde und Adresse.
        const r = await fetch(URL_BASIS + '/functions/v1/register', {
            method: 'POST',
            headers: { apikey: KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'vertragstest' + LAUF, password: 'Falsch-' + LAUF + '-1!', code: 'falscher-code-' + LAUF })
        });
        assert.notEqual(r.status, 200);
        assert.ok([503, 403].includes(r.status), 'erwartet 503 oder 403, war ' + r.status + ' ' + (await r.text()));
    });
});
