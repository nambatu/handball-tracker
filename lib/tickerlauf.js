'use strict';

const fs = require('fs');
const path = require('path');
const { Outbox } = require('./outbox');
const TickerRegeln = require('./ticker');
const { nachrichtFuer, nachrichtFuerMarke, EREIGNISSE, STANDARDVORLAGEN } = TickerRegeln;
const KI = require('./ki');

// ===================================================================
// TICKER-LAUF: aus einem State-Push werden Outbox-Eintraege
// ===================================================================
// Haengt an POST /api/state. Der Push ist um 1,2 s entprellt, spaetestens
// alle 5 s - fuer einen WhatsApp-Ticker mehr als genug und deutlich
// innerhalb des Frischefensters.
//
// Die zentrale Betriebsannahme: DER TICKER LAEUFT NUR LIVE. Eine Aktion,
// die aelter als TICKER_MAX_ALTER ist, wird stumm als getickert markiert
// und taucht nie in der Outbox auf. Ein Ticker, der nach der Halbzeit-
// pause dreissig Nachrichten auf einmal in die Gruppe kippt, hilft
// niemandem - und genau das passiert sonst, wenn das Handy in der Halle
// eine Viertelstunde ohne Empfang war und dann alles nachschiebt.
// ===================================================================

const MAX_ALTER_MS = Number(process.env.TICKER_MAX_ALTER_MS) || 120000;
const GETICKERT_MAX = 500;   // so viele Aktions-IDs werden erinnert

function standardKonfiguration() {
    const ereignisse = {};
    EREIGNISSE.forEach(e => { ereignisse[e.schluessel] = e.standardAn; });
    return {
        aktiv: false,
        chatId: null,
        ereignisse: ereignisse,
        vorlagen: {},      // leer = STANDARDVORLAGEN
        regeln: [],
        pauseHinweis: true,
        kiAnalyse: true,     // greift nur, wenn GEMINI_API_KEY gesetzt ist
        kiHinweis: ''        // Freitext, der an den Prompt angehaengt wird
    };
}

function leseKonfiguration(datei) {
    const standard = standardKonfiguration();
    try {
        if (!fs.existsSync(datei)) return standard;
        const roh = JSON.parse(fs.readFileSync(datei, 'utf8'));
        return {
            aktiv: !!roh.aktiv,
            chatId: roh.chatId || null,
            ereignisse: Object.assign({}, standard.ereignisse, roh.ereignisse || {}),
            vorlagen: roh.vorlagen || {},
            regeln: Array.isArray(roh.regeln) ? roh.regeln : [],
            pauseHinweis: roh.pauseHinweis !== false,
            kiAnalyse: roh.kiAnalyse !== false,
            kiHinweis: typeof roh.kiHinweis === 'string' ? roh.kiHinweis : ''
        };
    } catch (e) {
        console.error('[Ticker] Konfiguration unlesbar, nutze Standard:', e.message);
        return standard;
    }
}

function schreibeKonfiguration(datei, konfiguration) {
    const tmp = datei + '.tmp';
    fs.mkdirSync(path.dirname(datei), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(konfiguration, null, 2));
    fs.renameSync(tmp, datei);
}

// ---------------------------------------------------------------
// Merkzettel: welche Aktionen sind durch?
// ---------------------------------------------------------------

function leseMerkzettel(datei) {
    try {
        if (!fs.existsSync(datei)) return [];
        const roh = JSON.parse(fs.readFileSync(datei, 'utf8'));
        return Array.isArray(roh.getickert) ? roh.getickert.map(String) : [];
    } catch (e) {
        return [];
    }
}

function schreibeMerkzettel(datei, ids) {
    try {
        const tmp = datei + '.tmp';
        fs.mkdirSync(path.dirname(datei), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify({ getickert: ids.slice(-GETICKERT_MAX) }));
        fs.renameSync(tmp, datei);
    } catch (e) {
        console.error('[Ticker] Merkzettel nicht speicherbar:', e.message);
    }
}

/**
 * Alles Vorhandene als erledigt vermerken, ohne etwas zu senden.
 * Gebraucht, solange der Ticker aus ist.
 */
function merkeAlle(datei, eintraege) {
    const bisher = leseMerkzettel(datei);
    const bekannt = new Set(bisher);
    const neu = [];
    eintraege.forEach(a => {
        const id = String(a && a.id);
        if (id && id !== 'undefined' && !bekannt.has(id)) { bekannt.add(id); neu.push(id); }
    });
    if (neu.length > 0) schreibeMerkzettel(datei, bisher.concat(neu));
}

// ---------------------------------------------------------------
// Ein Lauf
// ---------------------------------------------------------------

/**
 * Vergleicht den eingehenden Stand mit dem Merkzettel und legt fuer alles
 * Neue und Frische Outbox-Eintraege an.
 *
 * @returns {{ aktiv, erzeugt, ausgelassen, zurueckgenommen, grund? }}
 */
function lauf({ outbox, konfiguration, merkzettelDatei, state, jetzt = Date.now(), maxAlterMs = MAX_ALTER_MS }) {
    const aktionen = Array.isArray(state.aktionen) ? state.aktionen : [];
    const marken = Array.isArray(state.tickerMarken) ? state.tickerMarken : [];

    // Ticker aus? Dann trotzdem mitschreiben, was passiert ist.
    //
    // Sonst gilt beim Einschalten mitten im Spiel alles bisher Erfasste
    // als "noch nicht getickert", und die Gruppe bekommt rueckwirkend
    // einen Schwall - im schlimmsten Fall drei Tore auf einen Schlag,
    // Sekunden nachdem man den Schalter umgelegt hat. Einschalten heisst:
    // ab jetzt, nicht rueckwirkend.
    if (!konfiguration.aktiv || !konfiguration.chatId) {
        merkeAlle(merkzettelDatei, aktionen.concat(marken));
        return {
            aktiv: false, erzeugt: 0, ausgelassen: 0, zurueckgenommen: 0,
            grund: konfiguration.aktiv ? 'keine_gruppe' : 'aus'
        };
    }

    const spieler = Array.isArray(state.spieler) ? state.spieler : [];

    const getickert = leseMerkzettel(merkzettelDatei);
    const bekannt = new Set(getickert);

    // --- Undo: was aus dem Stand verschwunden ist, soll nicht raus ---
    // Der Hebel existiert nur hier. Im Browser war die Nachricht in dem
    // Moment schon weg, in dem das Undo geklickt wurde.
    const vorhandeneIds = new Set(aktionen.map(a => String(a.id)).concat(marken.map(m => String(m.id))));
    let zurueckgenommen = 0;
    getickert.forEach(id => {
        if (!vorhandeneIds.has(id)) {
            if (outbox.zuruecknehmen('aktion:' + id) || outbox.zuruecknehmen('marke:' + id)) zurueckgenommen++;
        }
    });

    let erzeugt = 0;
    let ausgelassen = 0;
    const neuGetickert = [];

    aktionen.forEach(aktion => {
        const id = String(aktion.id);
        if (bekannt.has(id)) return;

        // Ab hier gilt die Aktion in jedem Fall als erledigt - auch wenn
        // nichts rausgeht. Sonst wird sie bei jedem Push erneut geprueft
        // und irgendwann doch noch verspaetet getickert.
        neuGetickert.push(id);

        const alter = jetzt - (Number(aktion.timestamp) || 0);
        if (alter > maxAlterMs) { ausgelassen++; return; }

        const nachricht = nachrichtFuer(aktion, {
            aktionen: aktionen,
            spieler: spieler,
            konfiguration: konfiguration,
            teamGast: state.teamGast,
            halbzeitSekunden: Number(state.halbzeitSekunden) || 1800
        });
        if (!nachricht) return;

        const eintrag = outbox.einreihen({
            chatId: konfiguration.chatId,
            idempotencyKey: 'aktion:' + id,
            nachrichten: [{ text: nachricht.text }],
            // Bewusst der Zeitpunkt der AKTION, nicht des Pushes: das
            // Gateway rechnet daraus seinen Verfall. Eine Aktion, die es
            // knapp durchs Frischefenster geschafft hat, soll nicht noch
            // fuenf weitere Minuten Gnadenfrist bekommen.
            erstelltAm: Number(aktion.timestamp) || jetzt
        });
        if (eintrag) erzeugt++;
    });

    // Zeitmarken ("Noch 5 Minuten"). Die kommen aus der Spieluhr des
    // tickernden Geraets, nicht aus einer Aktion - der Server kennt die
    // laufende Uhr gar nicht, sie laeuft lokal.
    marken.forEach(marke => {
        const id = String(marke.id);
        if (bekannt.has(id)) return;
        neuGetickert.push(id);

        const alter = jetzt - (Number(marke.timestamp) || 0);
        if (alter > maxAlterMs) { ausgelassen++; return; }

        const nachricht = nachrichtFuerMarke(marke, {
            aktionen: aktionen,
            spieler: spieler,
            konfiguration: konfiguration,
            teamGast: state.teamGast
        });
        if (!nachricht) return;

        const eintrag = outbox.einreihen({
            chatId: konfiguration.chatId,
            idempotencyKey: 'marke:' + id,
            nachrichten: [{ text: nachricht.text }],
            erstelltAm: Number(marke.timestamp) || jetzt
        });
        if (eintrag) erzeugt++;

        // Die KI-Analyse laeuft NACHTRAEGLICH und in einer eigenen
        // Nachricht. Sie darf den State-Push nicht aufhalten: ein
        // ueberlastetes Modell wuerde sonst dafuer sorgen, dass am Ende
        // gar nichts in der Gruppe steht - auch nicht die Zahlen.
        if (eintrag && marke.art === 'ende' && konfiguration.kiAnalyse && KI.verfuegbar()) {
            starteKiAnalyse({ outbox, konfiguration, state, aktionen, spieler, id });
        }
    });

    if (neuGetickert.length > 0) {
        schreibeMerkzettel(merkzettelDatei, getickert.concat(neuGetickert));
    } else if (zurueckgenommen > 0) {
        schreibeMerkzettel(merkzettelDatei, getickert.filter(id => vorhandeneIds.has(id)));
    }

    return { aktiv: true, erzeugt, ausgelassen, zurueckgenommen };
}

/**
 * Stoesst die KI-Analyse an und reiht sie ein, sobald sie da ist.
 * Bewusst ohne await - der Aufrufer ist mitten in einem HTTP-Request.
 */
function starteKiAnalyse({ outbox, konfiguration, state, aktionen, spieler, id }) {
    const nachId = {};
    spieler.forEach(function (p) { if (p && p.id !== undefined) nachId[p.id] = p; });

    const zahlen = TickerRegeln.spielZusammenfassung(aktionen, nachId);
    const verlauf = TickerRegeln.spielVerlauf(aktionen, nachId, state.halbzeitSekunden);
    const stand = TickerRegeln.standBis(aktionen, nachId, aktionen.length - 1);

    const daten = {
        heim: state.teamHeim || 'Wir',
        gast: state.teamGast || 'Gegner',
        endstand: stand.text,
        halbzeitstand: verlauf.halbzeitstand,
        verlauf: verlauf.verlauf,
        torschuetzen: zahlen.torschuetzen,
        wurfquote: zahlen.wurfquote,
        paraden: zahlen.paraden,
        zeitstrafen: zahlen.zeitstrafen,
        siebenmeter: zahlen.siebenmeter
    };

    KI.analyse(daten, { hinweis: konfiguration.kiHinweis }).then(function (text) {
        if (!text) return;
        outbox.einreihen({
            chatId: konfiguration.chatId,
            idempotencyKey: 'marke:' + id + ':ki',
            nachrichten: [{ text: text }],
            // JETZT, nicht der Zeitpunkt des Spielendes: sonst waere die
            // Analyse beim Gateway unter Umstaenden schon verfallen,
            // bevor sie ueberhaupt fertig war.
            erstelltAm: Date.now()
        });
    }).catch(function (e) {
        console.error('[KI] Analyse nicht eingereiht:', e && e.message);
    });
}

// ---------------------------------------------------------------
// Outbox je Benutzer (eine Instanz, nicht eine pro Request)
// ---------------------------------------------------------------

const outboxen = new Map();

function outboxFuer(schluessel, datei) {
    if (!outboxen.has(schluessel)) outboxen.set(schluessel, new Outbox({ datei }));
    return outboxen.get(schluessel);
}

function alleOutboxenSchliessen() {
    outboxen.forEach(o => o.schliessen());
}

module.exports = {
    lauf,
    leseKonfiguration,
    schreibeKonfiguration,
    standardKonfiguration,
    outboxFuer,
    alleOutboxenSchliessen,
    leseMerkzettel,
    schreibeMerkzettel,
    MAX_ALTER_MS,
    EREIGNISSE,
    STANDARDVORLAGEN
};
