// Vertragstest: Spielstand (push_state / get_state) gegen das echte Supabase.
// Ersetzt POST/GET /api/state aus server.js. Eine verlorene Aktion ist nach
// dem Spiel nicht mehr zu retten - deshalb wird dieser Vertrag hart geprueft.
//
// Dieses File benutzt den Spielstand von Konto A (und nur dieses File darf
// ihn veraendern). Die Tests laufen nacheinander, weil sie sich einen Stand teilen.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
    SKIP, anmeldenA, api, getState, pushState, standLeeren, zusammenfuehren, LAUF
} from './helfer.mjs';

const SCHLUESSEL = ['rev', 'updatedAt', 'spielId', 'spieler', 'aktionen', 'tickerMarken',
    'aktiverTorwartId', 'teamHeim', 'teamGast', 'halbzeitSekunden'].sort();

const spieler = function (id, name) { return { id: id, name: name, nummer: 7 }; };
const aktion = function (id, ts) { return { id: id, typ: 'tor', timestamp: ts }; };

// Setzt den Server auf genau diesen rev (erst leeren = rev 0, dann pushen).
async function serverAuf(s, rev, extra) {
    await standLeeren(s);
    const r = await pushState(s, Object.assign({ rev: rev, spieler: [], aktionen: [] }, extra || {}));
    assert.equal(r.json.ok, true, 'Vorbereitung: Push mit rev ' + rev + ' muss klappen: ' + r.text);
}

describe('Spielstand-Vertrag (push_state / get_state)', { skip: SKIP, concurrency: false }, () => {
    let A, A2;

    before(async () => {
        A = await anmeldenA();
        A2 = await anmeldenA(); // zweites Geraet desselben Kontos
        await standLeeren(A);
    });
    after(async () => { if (A) await standLeeren(A); });

    it('frisches Konto: get_state liefert leere Listen', async () => {
        // Eine Zeile in "states" kann ueber die API nicht entfernt werden (nur
        // push_state schreibt). Wir garantieren daher nur die Form: nach dem
        // Leeren sind spieler und aktionen leer. Das Ur-Verhalten ohne Zeile
        // ({"spieler":[],"aktionen":[]}) deckt dieselben Schluessel ab.
        await standLeeren(A);
        const r = await getState(A);
        assert.equal(r.status, 200);
        assert.deepEqual(r.json.spieler, []);
        assert.deepEqual(r.json.aktionen, []);
    });

    it('normaler Push mit rev 1 wird angenommen, unbekannte Felder fallen weg, Schluessel exakt', async () => {
        await standLeeren(A);
        const r = await pushState(A, {
            rev: 1, updatedAt: 1700000000000, spielId: 'spiel-' + LAUF,
            spieler: [spieler('p1', 'Anna')], aktionen: [aktion('a1', 1000)],
            tickerMarken: [], aktiverTorwartId: 'p1', teamHeim: 'Heim', teamGast: 'Gast',
            halbzeitSekunden: 1800,
            hackerFeld: 'weg', __proto__x: { boese: true }
        });
        assert.deepEqual(r.json, { ok: true, rev: 1 });
        const g = (await getState(A)).json;
        assert.deepEqual(Object.keys(g).sort(), SCHLUESSEL);
        assert.equal(g.rev, 1);
        assert.deepEqual(g.spieler, [spieler('p1', 'Anna')]);
        assert.deepEqual(g.aktionen, [aktion('a1', 1000)]);
        assert.equal(g.hackerFeld, undefined, 'unbekannte Felder muessen verworfen werden');
    });

    it('JS-kompatible Normalisierung (leer -> [] bzw. null, Text -> Zahl, updatedAt gefuellt)', async () => {
        await standLeeren(A);
        const vorher = Date.now();
        const r = await pushState(A, {
            rev: 2, spielId: '', teamHeim: '', aktiverTorwartId: 0, halbzeitSekunden: '1500'
        });
        assert.equal(r.json.ok, true, r.text);
        const g = (await getState(A)).json;
        assert.deepEqual(g.spieler, []);
        assert.deepEqual(g.aktionen, []);
        assert.deepEqual(g.tickerMarken, []);
        assert.equal(g.spielId, null);
        assert.equal(g.teamHeim, null);
        assert.equal(g.teamGast, null);
        assert.equal(g.aktiverTorwartId, null);
        assert.strictEqual(g.halbzeitSekunden, 1500);
        assert.equal(typeof g.updatedAt, 'number');
        // Toleranz fuer Uhrenabweichung zwischen Test-Rechner und Datenbank.
        assert.ok(Math.abs(g.updatedAt - vorher) < 5 * 60 * 1000,
            'updatedAt sollte ein aktueller Millisekunden-Zeitstempel sein, war ' + g.updatedAt);
    });

    it('veraltet: Server rev 5, Push mit rev 3 -> stale, Serverstand unveraendert', async () => {
        await serverAuf(A, 5, { spieler: [spieler('p1', 'Anna')] });
        const vorher = (await getState(A)).json;
        const r = await pushState(A, { rev: 3, spieler: [spieler('pX', 'Fremd')], aktionen: [aktion('aX', 1)] });
        assert.equal(r.json.ok, false);
        assert.equal(r.json.error, 'stale');
        assert.equal(r.json.state.rev, 5);
        assert.match(r.json.message, /rev 5/);
        assert.deepEqual((await getState(A)).json, vorher, 'abgelehnter Push darf nichts veraendern');
    });

    it('gleiche rev wird angenommen (nur existingRev > incomingRev wird abgewiesen)', async () => {
        await serverAuf(A, 5, { spieler: [spieler('p1', 'Alt')] });
        const r = await pushState(A, { rev: 5, spieler: [spieler('p1', 'Neu')] });
        assert.deepEqual(r.json, { ok: true, rev: 5 });
        assert.equal((await getState(A)).json.spieler[0].name, 'Neu');
    });

    it('hoehere rev wird angenommen', async () => {
        await serverAuf(A, 5);
        const r = await pushState(A, { rev: 6, spieler: [spieler('p9', 'Neu')] });
        assert.deepEqual(r.json, { ok: true, rev: 6 });
        assert.equal((await getState(A)).json.rev, 6);
    });

    it('rev 0 bzw. fehlende rev wird auch bei neuerem Server angenommen (wie server.js: "incomingRev && ...")', async () => {
        // Das spiegelt bewusst den alten Server: ohne rev gilt der Schreibvorgang
        // als "ich weiss es nicht besser" und wird nicht abgewiesen. Das ist ein
        // Schlupfloch, aber altes Verhalten - der Test haelt es fest.
        await serverAuf(A, 5);
        const r0 = await pushState(A, { rev: 0, spieler: [spieler('p0', 'Null')] });
        assert.deepEqual(r0.json, { ok: true, rev: 0 });
        await serverAuf(A, 5);
        const rx = await pushState(A, { spieler: [spieler('pk', 'Ohne')] });
        assert.deepEqual(rx.json, { ok: true, rev: 0 });
    });

    it('Konflikt-Rundlauf mit zwei Geraeten: stale, zusammenfuehren, erneut pushen -> nichts geht verloren', async () => {
        await standLeeren(A);
        const p1 = spieler('p1', 'Anna'), p2 = spieler('p2', 'Bea');
        const x = aktion('x', 1000), y = aktion('y', 2000);
        // Geraet A hat rev 4 mit P1/X gepusht.
        const ra = await pushState(A, { rev: 4, updatedAt: 5000, spieler: [p1], aktionen: [x] });
        assert.equal(ra.json.ok, true);
        // Geraet B kennt nur rev 3 mit P2/Y.
        const lokalB = { rev: 3, updatedAt: 4000, spieler: [p2], aktionen: [y], tickerMarken: [] };
        const rb = await pushState(A2, lokalB);
        assert.equal(rb.json.ok, false);
        assert.equal(rb.json.error, 'stale');
        // B fuehrt zusammen wie merge() im Browser und pusht erneut.
        const fern = rb.json.state;
        fern.tickerMarken = fern.tickerMarken || [];
        const gemerged = zusammenfuehren(lokalB, fern);
        assert.equal(gemerged.rev, 5);
        const rb2 = await pushState(A2, gemerged);
        assert.deepEqual(rb2.json, { ok: true, rev: 5 });
        const g = (await getState(A)).json;
        assert.equal(g.rev, 5);
        assert.deepEqual(g.spieler.map(p => p.id).sort(), ['p1', 'p2']);
        assert.deepEqual(g.aktionen.map(a => a.id).sort(), ['x', 'y']);
    });

    it('gleichzeitige Pushes (rev N und N+1): am Ende steht immer die hoehere rev (5 Laeufe)', async () => {
        // Die Funktion sperrt je Benutzer; egal in welcher Reihenfolge die Anfragen
        // ankommen, darf die aeltere nie die neuere ueberschreiben.
        await standLeeren(A);
        for (let i = 0; i < 5; i++) {
            const alt = 10 + i * 10, neu = alt + 1;
            const [r1, r2] = await Promise.all([
                pushState(A, { rev: alt, spieler: [spieler('s' + alt, 'alt')] }),
                pushState(A2, { rev: neu, spieler: [spieler('s' + neu, 'neu')] })
            ]);
            assert.equal(r2.json.ok, true, 'Lauf ' + i + ': der neuere Push muss durchgehen');
            // Der aeltere ist entweder zuerst durchgegangen oder stale - beides korrekt.
            assert.ok(r1.json.ok === true || r1.json.error === 'stale', 'Lauf ' + i + ': ' + r1.text);
            const g = (await getState(A)).json;
            assert.equal(g.rev, neu, 'Lauf ' + i + ': Server muss rev ' + neu + ' halten');
            assert.equal(g.spieler[0].id, 's' + neu);
        }
    });

    it('ohne Anmeldung (nur apikey) sind push_state und get_state verweigert', async () => {
        const g = await getState(null);
        const p = await pushState(null, { rev: 99, spieler: [spieler('hack', 'Hack')] });
        for (const r of [g, p]) {
            assert.ok([401, 403, 404].includes(r.status), 'erwartet 401/403/404, war ' + r.status + ' ' + r.text);
        }
        assert.notEqual(p.json && p.json.ok, true);
    });

    it('direkte Schreibzugriffe auf die Tabelle states aendern nichts', async () => {
        await serverAuf(A, 7, { spieler: [spieler('p1', 'Anna')] });
        const vorher = (await getState(A)).json;
        const ins = await api(A, 'POST', '/rest/v1/states', { user_id: A.userId, rev: 999, state: { rev: 999 } },
            { Prefer: 'return=representation' });
        const upd = await api(A, 'PATCH', '/rest/v1/states?user_id=eq.' + A.userId, { rev: 999, state: { rev: 999 } },
            { Prefer: 'return=representation' });
        const del = await api(A, 'DELETE', '/rest/v1/states?user_id=eq.' + A.userId, undefined,
            { Prefer: 'return=representation' });
        assert.ok(ins.status >= 400, 'INSERT muss scheitern, war ' + ins.status + ' ' + ins.text);
        // PATCH/DELETE ohne passende Policy: Fehler oder 0 betroffene Zeilen.
        for (const r of [upd, del]) {
            assert.ok(r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0),
                'erwartet Fehler oder 0 Zeilen, war ' + r.status + ' ' + r.text);
        }
        assert.deepEqual((await getState(A)).json, vorher, 'Spielstand muss unveraendert sein');
    });

    it('state_backups ist fuer Benutzer nicht lesbar', async () => {
        await serverAuf(A, 1);
        await pushState(A, { rev: 2 }); // erzeugt eine Sicherung
        const r = await api(A, 'GET', '/rest/v1/state_backups?select=*');
        assert.ok(r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0),
            'erwartet Fehler oder leere Liste, war ' + r.status + ' ' + r.text);
    });

    it('Dokument ueber 5 MB wird abgelehnt und veraendert nichts', async () => {
        await serverAuf(A, 3, { spieler: [spieler('p1', 'Anna')] });
        const vorher = (await getState(A)).json;
        const gross = { rev: 4, spieler: [{ id: 'dick', blob: 'x'.repeat(5 * 1024 * 1024 + 1024) }] };
        const r = await pushState(A, gross);
        assert.ok(r.status >= 400, 'erwartet Fehlerstatus, war ' + r.status + ' ' + r.text.slice(0, 200));
        assert.notEqual(r.json && r.json.ok, true);
        assert.deepEqual((await getState(A)).json, vorher);
    });
});
