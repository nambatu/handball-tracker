'use strict';

// ===================================================================
// TICKER-REGELN
// ===================================================================
// Aus einer erfassten Aktion wird hier der Text, der in die Gruppe geht.
//
// Der Reiz an der Sache ist nicht eine schoenere Standardvorlage, sondern:
// wenn JU ein Tor schiesst, kommt JUS Spruch. Deshalb ist eine Regel ein
// Paar aus Bedingung und Text, und die spezifischste Bedingung gewinnt:
//
//   Spieler+Typ+Subtyp -> Spieler+Typ -> Typ+Subtyp -> Typ -> Standard
//
// Warum das serverseitig liegt und nicht mehr im Browser:
//   1. Doppler - ein Reload oder ein zweites Geraet schickt dieselben
//      Aktionen erneut. Der Server fuehrt die Liste der schon getickerten
//      Aktions-IDs; der Browser koennte das gar nicht wissen.
//   2. Undo - eine zurueckgenommene Aktion, die noch in der Outbox liegt,
//      geht gar nicht erst raus. Im Browser ist die Nachricht dann schon weg.
//   3. Das ADMIN_PASSWORD lag im sessionStorage jedes Trackenden. Ein
//      globales Passwort in jedem Browser, der tickert - das faellt weg.
// ===================================================================

// Ereignisarten, die der Ticker ueberhaupt kennt. Was hier nicht steht,
// wird nie getickert - Ballverluste und Fehlwuerfe wuerden die Gruppe
// zuspammen, und das war schon vorher als `return` im Frontend so
// entschieden. Jetzt steht die Entscheidung an einer Stelle und ist
// abschaltbar, statt im Code vergraben zu sein.
const EREIGNISSE = [
    { schluessel: 'tor', label: 'Tor', standardAn: true },
    { schluessel: 'torGast', label: 'Gegentor', standardAn: true },
    { schluessel: 'parade', label: 'Parade', standardAn: true },
    { schluessel: 'siebenmeterRaus', label: 'Siebenmeter herausgeholt', standardAn: true },
    { schluessel: 'zeitstrafe', label: '2 Minuten', standardAn: true },
    { schluessel: 'gelb', label: 'Gelbe Karte', standardAn: true },
    { schluessel: 'rot', label: 'Rote Karte', standardAn: true },
    { schluessel: 'blau', label: 'Blaue Karte', standardAn: true },
    { schluessel: 'rest10', label: 'Noch 10 Minuten', standardAn: true, zeitmarke: true },
    { schluessel: 'rest5', label: 'Noch 5 Minuten', standardAn: true, zeitmarke: true },
    { schluessel: 'rest1', label: 'Letzte Minute', standardAn: true, zeitmarke: true },
    { schluessel: 'ende', label: 'Spielende (Zusammenfassung)', standardAn: true, zeitmarke: true },
    { schluessel: 'fehlwurf', label: 'Fehlwurf', standardAn: false },
    { schluessel: 'ballverlust', label: 'Ballverlust', standardAn: false },
    { schluessel: 'ballgewinn', label: 'Ballgewinn', standardAn: false }
];

// Vorbild ist ein echter, von Hand getippter Ticker aus der Gruppe:
//
//     18:22 Leo
//     18:23 Paul
//     19:23
//     Olaf 🥳
//     50.' min
//
// Daraus die Regeln, die hier gelten:
//   - Stand zuerst, Vorname hinterher. Mehr nicht.
//   - Eigene Tore mit Namen, Gegentore nur als Stand. (Im Vorbild fallen
//     drei Tore der Gegenseite hintereinander ohne einen einzigen Namen,
//     waehrend jedes eigene Tor benannt wird.)
//   - Kein Fettdruck, keine Ruckennummer, keine Wurfart, keine Uhrzeit an
//     jeder Zeile. Nach dem fuenften Tor nervt das.
//
// Wer es ausfuehrlicher mag, aendert das im Ticker-Fenster - die
// Platzhalter koennen weiterhin alles.
const STANDARDVORLAGEN = {
    tor: '{stand} {vorname}',
    torGast: '{stand}',
    parade: '🧤 {vorname}',
    siebenmeterRaus: '7m {vorname}',
    zeitstrafe: '2 Min {vorname}',
    gelb: '🟨 {vorname}',
    rot: '🟥 {vorname}',
    blau: '🟦 {vorname}',
    rest10: 'Noch 10 Minuten — {stand}',
    rest5: 'Noch 5 Minuten — {stand}',
    rest1: 'Letzte Minute — {stand}',
    // Die einzige lange Nachricht, und zwar bewusst: am Ende darf es eine
    // Zusammenfassung sein, waehrend des Spiels nicht.
    ende: '🏁 *Ende* — {heim} {stand} {gast}\n\n'
        + 'Tore: {torschuetzen}\n'
        + 'Wurfquote: {wurfquote}\n'
        + 'Paraden: {paraden}\n'
        + '2 Minuten: {zeitstrafen}',
    fehlwurf: 'Fehlwurf {vorname}',
    ballverlust: 'Ballverlust {vorname}',
    ballgewinn: 'Ball erobert {vorname}'
};

// Welche Ereignisse keine Aktion, sondern eine Zeitmarke sind.
const ZEITMARKEN = EREIGNISSE.filter(e => e.zeitmarke).map(e => e.schluessel);

// ---------------------------------------------------------------
// Heim/Gast - dieselbe Regel wie im Frontend
// ---------------------------------------------------------------
// Bewusst nachgebaut statt importiert: store.js ist ein Browser-Modul mit
// window-Zugriff. Wichtig ist nur, dass beide Seiten dasselbe entscheiden -
// das Feld `team` zuerst, der Name nur noch als Rueckfall fuer Altdaten.

function istGastName(name) {
    const n = String(name || '').trim().toLowerCase();
    return n === 'gegner' || n === 'enemy' || n === 'gast';
}

function istGast(spieler) {
    if (!spieler) return false;
    if (spieler.team === 'gast') return true;
    if (spieler.team === 'heim') return false;
    return istGastName(spieler.name);
}

// ---------------------------------------------------------------
// Ereignisart bestimmen
// ---------------------------------------------------------------

function ereignisFuer(aktion, spieler) {
    const typ = String(aktion && aktion.typ || '');
    if (typ.includes('WurfTor')) return istGast(spieler) ? 'torGast' : 'tor';
    if (typ.includes('Parade')) return 'parade';
    if (typ.includes('SiebenMeterRaus')) return 'siebenmeterRaus';
    if (typ.includes('Zeitstrafe')) return 'zeitstrafe';
    if (typ.includes('Karte_Gelb') || typ === 'Gelb') return 'gelb';
    if (typ.includes('Karte_Rot') || typ === 'Rot') return 'rot';
    if (typ.includes('Karte_Blau') || typ === 'Blau') return 'blau';
    // Achtung: der Typ heisst "WurfOhneTor", nicht "Fehlwurf". Und
    // "WurfOhneTor" enthaelt "WurfTor" NICHT als Teilkette, die Reihenfolge
    // der Pruefungen ist hier also unkritisch.
    if (typ.includes('WurfOhneTor')) return 'fehlwurf';
    if (typ.includes('Ballverlust')) return 'ballverlust';
    if (typ.includes('Ballgewinn') || typ.includes('Abgefangen') || typ.includes('Abgenommen') || typ.includes('Block')) return 'ballgewinn';
    return null;
}

// ---------------------------------------------------------------
// Spielstand bis einschliesslich einer Aktion
// ---------------------------------------------------------------

function standBis(aktionen, spielerNachId, bisIndex) {
    let heim = 0, gast = 0;
    for (let i = 0; i <= bisIndex; i++) {
        const a = aktionen[i];
        if (!a || !String(a.typ || '').includes('WurfTor')) continue;
        if (istGast(spielerNachId[a.spielerId])) gast++; else heim++;
    }
    return { heim, gast, text: heim + ':' + gast };
}

// ---------------------------------------------------------------
// Maskierung
// ---------------------------------------------------------------
// Ein Spieler, der sich "Jan *Bomber* Weber" nennt, zerlegt sonst die
// WhatsApp-Auszeichnung der ganzen Nachricht - dasselbe Thema wie beim
// CSV-Export. Maskiert wird nur der EINGESETZTE WERT, nie die Vorlage:
// das *fett* in der Vorlage ist ja gewollt.

function maskiere(wert) {
    return String(wert === undefined || wert === null ? '' : wert)
        .replace(/([*_~`])/g, '​$1');
}

// ---------------------------------------------------------------
// Platzhalter
// ---------------------------------------------------------------

function zeitText(sekunden) {
    const s = Math.max(0, Math.floor(Number(sekunden) || 0));
    const m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function baueWerte(ctx) {
    const { aktion, spieler, assist, torwart, stand, anzahl, teamGast } = ctx;
    const name = (spieler && spieler.name) || '';
    const vorname = name.split(' ')[0] || '';
    const nachname = name.split(' ').slice(1).join(' ');

    return {
        nr: (spieler && spieler.nummer) !== undefined ? spieler.nummer : '',
        name: name,
        vorname: vorname,
        // Kurzname: "Jan W." - in einer Mannschaftsgruppe reicht das meist,
        // und es passt besser in eine Ticker-Zeile.
        kurzname: nachname ? vorname + ' ' + nachname.charAt(0).toUpperCase() + '.' : vorname,
        assist: (assist && assist.name) || '',
        assistZusatz: assist ? ' (Assist: ' + maskiere(assist.name) + ')' : '',
        torwart: (torwart && torwart.name) || '',
        stand: stand.text,
        zeit: zeitText(aktion.spielzeit),
        halbzeit: aktion.halbzeit || 1,
        sub: aktion.label || '',
        gegner: teamGast || 'die Gäste',
        anzahl: anzahl
    };
}

// `assistZusatz` ist bereits maskiert - sonst wuerde die Klammer beim
// Einsetzen ein zweites Mal durch die Maskierung laufen.
const SCHON_MASKIERT = { assistZusatz: true };

function setzeEin(vorlage, werte) {
    return String(vorlage).replace(/\{(\w+)\}/g, function (ganz, schluessel) {
        if (!Object.prototype.hasOwnProperty.call(werte, schluessel)) {
            // Unbekannter Platzhalter bleibt stehen. "undefined" mitten in
            // der Gruppennachricht waere schlimmer als {quatsch}.
            return ganz;
        }
        const wert = werte[schluessel];
        return SCHON_MASKIERT[schluessel] ? String(wert) : maskiere(wert);
    });
}

// ---------------------------------------------------------------
// Regelauswahl
// ---------------------------------------------------------------

function standLage(stand, spielerIstGast) {
    // Immer aus Sicht der eigenen Mannschaft.
    if (stand.heim === stand.gast) return 'ausgleich';
    return stand.heim > stand.gast ? 'fuehrung' : 'rueckstand';
}

function phaseVon(aktion, halbzeitSekunden) {
    const rest = (Number(halbzeitSekunden) || 1800) - (Number(aktion.spielzeit) || 0);
    if ((aktion.halbzeit || 1) >= 2 && rest <= 300) return 'letzte5';
    return 'normal';
}

/**
 * Passt eine Regel? `wenn` ist bewusst eine UND-Verknuepfung aller
 * gesetzten Felder - eine Regel ohne Felder passt auf alles und waere
 * eine Falle, deshalb wird sie verworfen.
 */
function regelPasst(regel, ctx) {
    const w = (regel && regel.wenn) || {};
    const gesetzt = Object.keys(w).filter(k => w[k] !== undefined && w[k] !== null && w[k] !== '');
    if (gesetzt.length === 0) return false;

    if (w.spielerId && w.spielerId !== ctx.aktion.spielerId) return false;
    if (w.ereignis && w.ereignis !== ctx.ereignis) return false;
    if (w.typ && !String(ctx.aktion.typ || '').includes(w.typ)) return false;
    if (w.subtyp && String(ctx.aktion.label || '') !== String(w.subtyp)) return false;
    if (w.anzahl !== undefined && w.anzahl !== null && w.anzahl !== '' && Number(w.anzahl) !== ctx.anzahl) return false;
    if (w.stand && w.stand !== ctx.standLage) return false;
    if (w.phase && w.phase !== ctx.phase) return false;
    return true;
}

// Je spezifischer, desto hoeher. Die Reihenfolge aus dem Konzept:
// Spieler+Typ+Subtyp > Spieler+Typ > Typ+Subtyp > Typ.
// Die Zusatzbedingungen (anzahl/stand/phase) zaehlen extra - eine
// Hattrick-Regel soll die schlichte Tor-Regel desselben Spielers schlagen.
function spezifitaet(regel) {
    const w = (regel && regel.wenn) || {};
    let punkte = 0;
    if (w.spielerId) punkte += 8;
    if (w.subtyp) punkte += 4;
    if (w.typ || w.ereignis) punkte += 2;
    if (w.anzahl !== undefined && w.anzahl !== null && w.anzahl !== '') punkte += 1;
    if (w.stand) punkte += 1;
    if (w.phase) punkte += 1;
    return punkte;
}

function waehleRegel(regeln, ctx) {
    let beste = null, besteP = -1, besteIdx = -1;
    (regeln || []).forEach(function (regel, idx) {
        if (!regel || !Array.isArray(regel.dann) || regel.dann.length === 0) return;
        if (!regelPasst(regel, ctx)) return;
        const p = spezifitaet(regel);
        // Bei Gleichstand gewinnt die zuerst angelegte Regel. Willkuerlich,
        // aber vorhersagbar - und vorhersagbar ist hier das Wichtige.
        if (p > besteP) { beste = regel; besteP = p; besteIdx = idx; }
    });
    return beste;
}

// ---------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------

/**
 * Baut die Nachricht zu GENAU EINER Aktion.
 *
 * @returns {{ text: string, ereignis: string }|null}
 *          null heisst: zu dieser Aktion wird nichts getickert.
 */
function nachrichtFuer(aktion, kontext) {
    const {
        aktionen = [],
        spieler = [],
        konfiguration = {},
        teamGast = null,
        halbzeitSekunden = 1800
    } = kontext || {};

    const nachId = {};
    spieler.forEach(function (p) { if (p && p.id !== undefined) nachId[p.id] = p; });

    const index = aktionen.indexOf(aktion);
    if (index < 0) return null;

    const akteur = nachId[aktion.spielerId] || null;
    const ereignis = ereignisFuer(aktion, akteur);
    if (!ereignis) return null;

    const schalter = konfiguration.ereignisse || {};
    const eintrag = EREIGNISSE.find(e => e.schluessel === ereignis);
    const an = Object.prototype.hasOwnProperty.call(schalter, ereignis)
        ? !!schalter[ereignis]
        : !!(eintrag && eintrag.standardAn);
    if (!an) return null;

    const stand = standBis(aktionen, nachId, index);

    // {anzahl}: das wievielte Ereignis DIESER Art fuer diesen Spieler in
    // diesem Spiel. Damit wird "3. Tor" und eine Hattrick-Regel moeglich.
    let anzahl = 0;
    for (let i = 0; i <= index; i++) {
        const a = aktionen[i];
        if (!a || a.spielerId !== aktion.spielerId) continue;
        if (ereignisFuer(a, nachId[a.spielerId]) === ereignis) anzahl++;
    }

    const ctx = {
        aktion: aktion,
        ereignis: ereignis,
        anzahl: anzahl,
        standLage: standLage(stand, istGast(akteur)),
        phase: phaseVon(aktion, halbzeitSekunden)
    };

    const regel = waehleRegel(konfiguration.regeln, ctx);
    const vorlagen = konfiguration.vorlagen || {};
    const vorlage = regel
        ? (regel.dann[0] && regel.dann[0].text) || ''
        : (vorlagen[ereignis] || STANDARDVORLAGEN[ereignis] || '');
    if (!String(vorlage).trim()) return null;

    const werte = baueWerte({
        aktion: aktion,
        spieler: akteur,
        assist: aktion.assistId ? nachId[aktion.assistId] : null,
        torwart: aktion.torwartId ? nachId[aktion.torwartId] : null,
        stand: stand,
        anzahl: anzahl,
        teamGast: teamGast
    });

    const text = setzeEin(vorlage, werte).trim();
    if (!text) return null;
    return { text: text, ereignis: ereignis };
}

// ---------------------------------------------------------------
// Auswertung fuer die Schlusszusammenfassung
// ---------------------------------------------------------------
// Bewusst nur das, was eine Mannschaftsgruppe wirklich interessiert:
// wer getroffen hat, wie gut geworfen wurde, was der Torwart gehalten
// hat, wie viele Zeitstrafen. Alles Weitere steht im Spielbericht.

function prozent(zaehler, nenner) {
    if (!nenner) return null;
    return Math.round((zaehler / nenner) * 100) + ' %';
}

function spielZusammenfassung(aktionen, nachId) {
    const tore = {};          // spielerId -> Anzahl
    const paraden = {};       // torwartId -> Anzahl
    let eigeneTore = 0, eigeneWuerfe = 0, gegentore = 0, zeitstrafen = 0, siebenRaus = 0;

    aktionen.forEach(function (a) {
        const spieler = nachId[a.spielerId];
        const gast = istGast(spieler);
        const typ = String(a.typ || '');

        if (typ.includes('WurfTor')) {
            if (gast) { gegentore++; return; }
            eigeneTore++; eigeneWuerfe++;
            tore[a.spielerId] = (tore[a.spielerId] || 0) + 1;
            return;
        }
        if (typ.includes('WurfOhneTor')) {
            if (!gast) eigeneWuerfe++;
            return;
        }
        if (typ.includes('Parade')) {
            if (!gast) paraden[a.spielerId] = (paraden[a.spielerId] || 0) + 1;
            return;
        }
        if (typ.includes('Zeitstrafe')) { if (!gast) zeitstrafen++; return; }
        if (typ.includes('SiebenMeterRaus')) { if (!gast) siebenRaus++; }
    });

    function liste(zaehlung, suffix) {
        const eintraege = Object.keys(zaehlung)
            .map(function (id) {
                const p = nachId[id];
                const name = p ? (String(p.name || '').split(' ')[0] || p.name) : '?';
                return { name: name, n: zaehlung[id] };
            })
            .sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
        if (eintraege.length === 0) return '—';
        return eintraege.map(function (e) {
            return maskiere(e.name) + ' ' + e.n + (suffix || '');
        }).join(', ');
    }

    const paradenGesamt = Object.keys(paraden).reduce(function (s, k) { return s + paraden[k]; }, 0);
    const quote = prozent(eigeneTore, eigeneWuerfe);
    // Fangquote: gehaltene Baelle im Verhaeltnis zu allen gegnerischen
    // Abschluessen, die aufs Tor kamen (Paraden + Gegentore).
    const fangquote = prozent(paradenGesamt, paradenGesamt + gegentore);

    return {
        torschuetzen: liste(tore),
        wurfquote: quote ? quote + ' (' + eigeneTore + '/' + eigeneWuerfe + ')' : '—',
        paraden: paradenGesamt > 0
            ? liste(paraden) + (fangquote ? ' (' + fangquote + ')' : '')
            : '—',
        zeitstrafen: String(zeitstrafen),
        siebenmeter: String(siebenRaus),
        beste: (function () {
            const ids = Object.keys(tore).sort(function (a, b) { return tore[b] - tore[a]; });
            if (ids.length === 0) return '—';
            const p = nachId[ids[0]];
            const name = p ? (String(p.name || '').split(' ')[0] || p.name) : '?';
            return maskiere(name) + ' (' + tore[ids[0]] + ')';
        })()
    };
}

/**
 * Halbzeitstand und grober Spielverlauf - nur fuer die KI-Analyse.
 * Die Gruppe bekommt das nicht als Zahlenkolonne zu sehen; es ist
 * Futter fuer einen Text, der sonst nur den Endstand kennt und deshalb
 * nichts ueber den Spielverlauf sagen koennte.
 */
function spielVerlauf(aktionen, nachId, halbzeitSekunden) {
    let halbzeitHeim = 0, halbzeitGast = 0;
    aktionen.forEach(function (a) {
        if (!String(a.typ || '').includes('WurfTor')) return;
        if ((a.halbzeit || 1) !== 1) return;
        if (istGast(nachId[a.spielerId])) halbzeitGast++; else halbzeitHeim++;
    });

    // Stand alle zehn Minuten. Mehr Stuetzstellen braucht es nicht -
    // der Text soll einen Spielverlauf erkennen, keine Kurve zeichnen.
    const laenge = (Number(halbzeitSekunden) || 1800) * 2;
    const punkte = ['Start 0:0'];
    for (let sek = 600; sek <= laenge; sek += 600) {
        let heim = 0, gast = 0;
        aktionen.forEach(function (a) {
            if (!String(a.typ || '').includes('WurfTor')) return;
            if ((Number(a.spielzeit) || 0) > sek) return;
            if (istGast(nachId[a.spielerId])) gast++; else heim++;
        });
        punkte.push(Math.round(sek / 60) + '. Min ' + heim + ':' + gast);
    }

    return {
        halbzeitstand: halbzeitHeim + ':' + halbzeitGast,
        verlauf: punkte.join(', ')
    };
}

/**
 * Baut die Nachricht zu einer Zeitmarke ("Noch 5 Minuten").
 *
 * Eine Zeitmarke haengt an keiner Aktion und an keinem Spieler - sie
 * kommt aus der Spieluhr. Deshalb ein eigener Weg statt eines
 * Pseudo-Spielers: sonst muesste jede Regel und jeder Platzhalter damit
 * rechnen, dass es den Schuetzen gar nicht gibt.
 *
 * @returns {{ text: string, ereignis: string }|null}
 */
function nachrichtFuerMarke(marke, kontext) {
    const {
        aktionen = [],
        spieler = [],
        konfiguration = {},
        teamGast = null
    } = kontext || {};

    if (ZEITMARKEN.indexOf(marke.art) < 0) return null;

    const schalter = konfiguration.ereignisse || {};
    const eintrag = EREIGNISSE.find(e => e.schluessel === marke.art);
    const an = Object.prototype.hasOwnProperty.call(schalter, marke.art)
        ? !!schalter[marke.art]
        : !!(eintrag && eintrag.standardAn);
    if (!an) return null;

    const nachId = {};
    spieler.forEach(function (p) { if (p && p.id !== undefined) nachId[p.id] = p; });

    const stand = standBis(aktionen, nachId, aktionen.length - 1);
    const vorlagen = konfiguration.vorlagen || {};
    const vorlage = vorlagen[marke.art] !== undefined && vorlagen[marke.art] !== null
        ? vorlagen[marke.art]
        : (STANDARDVORLAGEN[marke.art] || '');
    if (!String(vorlage).trim()) return null;

    // Bewusst nur die Platzhalter, die hier ueberhaupt einen Sinn haben.
    // {name} bei einer Zeitmarke waere leer - dann lieber stehen lassen,
    // damit man beim Bearbeiten sieht, dass es hier nichts zu holen gibt.
    const werte = {
        stand: stand.text,
        zeit: zeitText(marke.spielzeit),
        halbzeit: marke.halbzeit || 2,
        gegner: teamGast || 'die Gäste',
        heim: (kontext || {}).teamHeim || 'Wir',
        gast: teamGast || 'Gegner'
    };

    // Die Auswertung kostet einen Durchlauf durch alle Aktionen - das
    // lohnt nur beim Schlusspfiff, nicht bei jeder Zeitmarke.
    if (marke.art === 'ende') Object.assign(werte, spielZusammenfassung(aktionen, nachId));

    const text = setzeEin(vorlage, werte).trim();
    if (!text) return null;
    return { text: text, ereignis: marke.art };
}

module.exports = {
    nachrichtFuer,
    nachrichtFuerMarke,
    spielZusammenfassung,
    spielVerlauf,
    ZEITMARKEN,
    ereignisFuer,
    istGast,
    maskiere,
    setzeEin,
    zeitText,
    standBis,
    EREIGNISSE,
    STANDARDVORLAGEN
};
