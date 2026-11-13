// ===================================================================
// STORE & DATA MANAGEMENT
// ===================================================================
// Der Store haelt keine eigene Kopie der Daten mehr, sondern arbeitet
// direkt auf dem State von window.Sync. Jede Aenderung wird ueber
// Sync.touch() sofort lokal gesichert; der Server-Push laeuft im
// Hintergrund (siehe sync.js).
// ===================================================================

// Wurfpositionen werden zweimal gebraucht: fuer eigene Wuerfe und - aus
// Sicht des Torwarts - fuer die Zone, aus der eine Parade kam. Dadurch
// laesst sich die Fangquote spaeter nach Wurfposition aufschluesseln.
const WURFPOSITIONEN = [
    { typ: "Aussen", label: "Außen" },
    { typ: "Kreis", label: "Kreis" },
    { typ: "Rueckraum6m", label: "Rückraum (6m)" },
    { typ: "Rueckraum9m", label: "Rückraum (9m)" },
    { typ: "Gegenstoss", label: "Gegenstoß" },
    { typ: "ZweiteWelle", label: "2. Welle" },
    { typ: "7Meter", label: "7 Meter" }
];

// `label` wird mit der Aktion gespeichert (Verlauf, Bericht) und vom Ticker
// verglichen (lib/ticker.js: Regeln mit "subtyp", Platzhalter {sub}). Es darf
// sich deshalb nicht aendern. Was auf den Knoepfen steht, ist `anzeige` - ohne
// Emoji, die Farbe der Taste sagt schon, worum es geht.
const HAUPTAKTIONEN = [
    { typ: "WurfTor", label: "🤾🏻‍♀️ Wurf mit Tor", anzeige: "Wurf mit Tor", category: "Wurf", farbe: "green" },
    { typ: "WurfOhneTor", label: "❌ Wurf ohne Tor", anzeige: "Wurf ohne Tor", category: "Wurf", farbe: "red" },
    { typ: "Ballverlust", label: "🥀 Ballverlust", anzeige: "Ballverlust", category: "Verlust", farbe: "red" },
    { typ: "Ballgewinn", label: "💪 Ballgewinn", anzeige: "Ballgewinn", category: "Gewinn", farbe: "green" },
    { typ: "Parade", label: "🧤 Parade", anzeige: "Parade", category: "ParadeZone", farbe: "yellow", nurTorwart: true },
    { typ: "SiebenMeterRaus", label: "🎯 7m herausgeholt", anzeige: "7m herausgeholt", category: "Herausgeholt", farbe: "green" },
    { typ: "Zeitstrafe", label: "⏱️ 2-Minuten", anzeige: "2-Minuten", category: "Strafe", farbe: "orange" },
    { typ: "Karte", label: "🟨 Karte", anzeige: "Karte", category: "Karte", farbe: "orange" },
];

const UNTERAKTIONEN = {
    "Wurf": WURFPOSITIONEN,
    // Aus welcher Zone kam der gehaltene Wurf?
    "ParadeZone": WURFPOSITIONEN,
    "Verlust": [
        { typ: "Fehlpass", label: "Fehlpass" },
        { typ: "Doppel", label: "Doppel" },
        { typ: "Fuss", label: "Fuß" },
        { typ: "Schrittfehler", label: "Schrittfehler" },
        { typ: "Stuermerfoul", label: "Stürmerfoul" },
        { typ: "Zeitspiel", label: "Zeitspiel" },
        { typ: "TechnischerFehler", label: "Technischer Fehler" }
    ],
    "Gewinn": [
        { typ: "Abgefangen", label: "Pass abgefangen" },
        { typ: "Abgenommen", label: "Ball abgenommen" },
        { typ: "Block", label: "Block" }
    ],
    "Karte": [
        // punkt: Farbe der Karte als kleines Quadrat statt Emoji
        { typ: "Gelb", label: "🟨 Gelbe Karte", anzeige: "Gelbe Karte", punkt: "#f2c744" },
        { typ: "Rot", label: "🟥 Rote Karte", anzeige: "Rote Karte", punkt: "#e5484d" },
        { typ: "Blau", label: "🟦 Blaue Karte", anzeige: "Blaue Karte", punkt: "#3b82f6" }
    ]
};

// Immer live aus dem Sync-State lesen, damit In-Place-Mutationen
// (z.B. Sortieren in ui.js) nicht auf einer veralteten Kopie landen.
function state() {
    return window.Sync.getState();
}

async function loadInitialState(username) {
    await window.Sync.init(username);

    if (state().spieler.length === 0) {
        state().spieler = [
            { id: 'p1', name: "Gegner", nummer: 0, position: "N/A", team: 'gast', playtimeSeconds: 0, suspendedUntilGameTime: null },
            { id: 'p2', name: "Tom Tester", nummer: 22, position: "LA", team: 'heim', playtimeSeconds: 0, suspendedUntilGameTime: null },
            { id: 'p3', name: "Kai Keeper", nummer: 1, position: "TW", team: 'heim', playtimeSeconds: 0, suspendedUntilGameTime: null },
        ];
        savePlayers();
    } else if (migriereTeamFeld(state().spieler)) {
        // Einmalig beim ersten Start nach der Umstellung.
        console.log('[Store] team-Feld nachgetragen.');
        savePlayers();
    }

    // Ohne Gegner-Eintrag laesst sich kein gegnerisches Tor erfassen.
    if (!state().spieler.some(istGast)) {
        state().spieler.unshift({
            id: 'gast_' + Date.now(), name: 'Gegner', nummer: 0, position: 'N/A',
            team: 'gast', playtimeSeconds: 0, suspendedUntilGameTime: null
        });
        savePlayers();
    }
}

function loadPlayers() {
    return state().spieler;
}

function savePlayers() {
    window.Sync.touch();
}

function loadActions() {
    return state().aktionen;
}

function saveActions(aktionen) {
    if (Array.isArray(aktionen)) {
        state().aktionen = aktionen;
    }
    window.Sync.touch();
}

// ---------------------------------------------------------------
// Marken (Zeitmarken, Auszeiten)
// ---------------------------------------------------------------
// Marken sind keine Spieleraktionen und duerfen deshalb nie in
// `aktionen` landen: sonst tauchten sie in Statistik, Bericht und
// Spielstand auf. Sie liegen in `tickerMarken` - das wird ohnehin
// synchronisiert, beim Zusammenfuehren nach id vereinigt und mit dem
// Spiel zurueckgesetzt.

function getMarken() {
    const s = state();
    if (!Array.isArray(s.tickerMarken)) s.tickerMarken = [];
    return s.tickerMarken;
}

function addMarke(marke) {
    const liste = getMarken();
    if (liste.some(function (m) { return String(m.id) === String(marke.id); })) return false;
    liste.push(marke);
    window.Sync.touch();
    return true;
}

function removeMarke(id) {
    const liste = getMarken();
    const idx = liste.findIndex(function (m) { return String(m.id) === String(id); });
    if (idx === -1) return null;
    const entfernt = liste.splice(idx, 1)[0];
    window.Sync.touch();
    return entfernt;
}

/** Auszeiten des laufenden Spiels je Team. */
function zaehleAuszeiten() {
    const n = { heim: 0, gast: 0 };
    getMarken().forEach(function (m) {
        if (m && m.art === 'auszeit' && (m.team === 'heim' || m.team === 'gast')) n[m.team]++;
    });
    return n;
}

/** Torstand aus den Aktionen (Gegner = Gast). */
function getStand() {
    const spieler = state().spieler;
    let heim = 0;
    let gast = 0;
    state().aktionen.forEach(function (a) {
        if (!a.typ || a.typ.indexOf('WurfTor') === -1) return;
        const p = spieler.find(function (x) { return x.id === a.spielerId; });
        if (!p) return;
        if (istGast(p)) gast++; else heim++;
    });
    return { heim: heim, gast: gast };
}

// ---------------------------------------------------------------
// Heim oder Gast
// ---------------------------------------------------------------
// Bis September 2026 wurde die Gegnerseite am NAMEN erkannt. Das war
// fragil bis gefaehrlich: wer den Eintrag "Gegner" in "HC Musterdorf"
// umbenannte, liess ab dem Moment alle gegnerischen Tore als eigene
// zaehlen - lautlos, mitten im Spiel.
//
// Jetzt entscheidet das Feld `team`. Der Namensvergleich bleibt nur noch
// als Rueckfall fuer Daten, die vor der Umstellung entstanden sind.

function istGastName(name) {
    if (!name) return false;
    const lowerName = String(name).toLowerCase().trim();
    return lowerName === 'gegner' || lowerName === 'enemy' || lowerName === 'gast';
}

/**
 * Gehoert dieser Spieler zur Gegnerseite?
 * @param {object} p Spieler
 */
function istGast(p) {
    if (!p) return false;
    if (p.team === 'gast') return true;
    if (p.team === 'heim') return false;
    return istGastName(p.name);   // Altbestand ohne team-Feld
}

/**
 * Alter Name, damit nichts bricht: nimmt einen Spieler ODER einen Namen.
 * Neuer Code soll istGast(spieler) benutzen.
 */
function isGuestTeam(spielerOderName) {
    if (spielerOderName && typeof spielerOderName === 'object') return istGast(spielerOderName);
    return istGastName(spielerOderName);
}

/**
 * Setzt das team-Feld bei allen Spielern, die es noch nicht haben.
 * Laeuft ueber den laufenden Kader genauso wie ueber ein Archivspiel.
 * @returns {boolean} true, wenn etwas geaendert wurde
 */
function migriereTeamFeld(spieler) {
    let veraendert = false;
    (spieler || []).forEach(function (p) {
        if (p && p.team !== 'heim' && p.team !== 'gast') {
            p.team = istGastName(p.name) ? 'gast' : 'heim';
            veraendert = true;
        }
    });
    return veraendert;
}

function addPlayerToStore(name, number, position, avatarUrl = null) {
    state().spieler.push({
        id: 'p' + Date.now() + '_' + Math.floor(Math.random() * 10000),
        name: name,
        nummer: number,
        position: position || "N/A",
        team: 'heim',
        playtimeSeconds: 0,
        avatarUrl: avatarUrl,
        suspendedUntilGameTime: null
    });
    savePlayers();
}

function updatePlayerAvatar(playerId, avatarUrl) {
    const player = state().spieler.find(p => String(p.id) === String(playerId));
    if (player) {
        player.avatarUrl = avatarUrl;
        savePlayers();
    }
}

// ---------------------------------------------------------------
// Zeitstrafen und gesperrte Plaetze
// ---------------------------------------------------------------
// EINE Quelle fuer die Dauer: `suspendedUntilGameTime` am Spieler (Spielzeit in
// Sekunden, bis zu der er gesperrt ist). Die Restzeit wird immer aus der
// Spieluhr gerechnet - steht die Uhr, steht auch die Strafe.
//
// Dazu kommt `sperrePlatz` am selben Spieler: welcher Feldplatz wegen dieser
// Strafe gesperrt ist. Beides liegt im Spielerobjekt und damit im
// synchronisierten Stand: nach einem Neuladen (oder auf einem zweiten Geraet)
// stimmen Sperre und Restzeit weiter. Gesperrte Plaetze werden nicht
// gespeichert, sondern aus diesen beiden Feldern abgeleitet.
//
// Rote Karte: kein eigenes Feld. Wer in diesem Spiel eine Aktion "Karte_Rot"
// hat, ist fuer den Rest des Spiels gesperrt (Rueckgaengig hebt das von selbst
// auf), blockiert aber keinen Platz.

const SPERRE_SEKUNDEN = 120;
// Reihenfolge, in der ein Platz gesperrt wird, wenn der Bestrafte nicht auf
// dem Feld stand oder der Torwart ist: zuerst der Kreislaeufer. Das Tor
// wird nie gesperrt - eine Mannschaft hat immer einen Torwart.
const SPERR_PLAETZE = ['KM', 'RM', 'RL', 'RR', 'LA', 'RA'];

function spielzeitJetzt() {
    return window.Timer ? window.Timer.getTimerState().spielzeitSekunden : 0;
}

/** Verbleibende Sekunden der Zeitstrafe (0 = keine laufende). */
function sperreRest(p, jetzt) {
    const bis = p && p.suspendedUntilGameTime;
    if (bis === null || bis === undefined) return 0;
    return Math.max(0, bis - (jetzt === undefined ? spielzeitJetzt() : jetzt));
}

function istDisqualifiziert(p) {
    if (!p || istGast(p)) return false;
    return state().aktionen.some(function (a) {
        return String(a.spielerId) === String(p.id) && a.typ && a.typ.indexOf('Karte_Rot') !== -1;
    });
}

/** Zeitstrafe oder Rote Karte: kann nicht spielen, nicht gewaehlt, nicht gezogen werden. */
function istGesperrt(p, jetzt) {
    if (!p || istGast(p)) return false;
    return sperreRest(p, jetzt) > 0 || istDisqualifiziert(p);
}

/** Satz fuer den Hinweis beim Antippen eines gesperrten Spielers. */
function sperreText(p, jetzt) {
    const name = p.name;
    if (istDisqualifiziert(p)) return name + ' hat Rot und ist für den Rest des Spiels gesperrt';
    const rest = sperreRest(p, jetzt);
    return name + ' ist noch ' + Math.floor(rest / 60) + ':' + String(rest % 60).padStart(2, '0') + ' gesperrt';
}

/**
 * Wer steht wo? Rein abgeleitet aus Positionen, Strafen und Karten.
 *   belegt     Platz -> Spieler auf dem Feld
 *   blockiert  Platz -> gesperrter Spieler, dessen Strafe den Platz sperrt
 *   bank       alle uebrigen eigenen Spieler (auch Gesperrte)
 * Regel wie bisher: pro Platz zaehlt der erste passende Spieler.
 */
function berechneFeld(jetzt) {
    const t = jetzt === undefined ? spielzeitJetzt() : jetzt;
    const belegt = {};
    const blockiert = {};
    const bank = [];
    const eigene = state().spieler.filter(p => !istGast(p));
    eigene.forEach(p => {
        const platz = p.sperrePlatz;
        if (platz && COURT_POSITIONEN.indexOf(platz) !== -1 && platz !== 'TW' && sperreRest(p, t) > 0) {
            blockiert[platz] = p;
        }
    });
    eigene.forEach(p => {
        const pos = normalisiertePosition(p);
        if (!istGesperrt(p, t) && COURT_POSITIONEN.indexOf(pos) !== -1 && !blockiert[pos] && !belegt[pos]) {
            belegt[pos] = p;
        } else {
            bank.push(p);
        }
    });
    return { belegt: belegt, blockiert: blockiert, bank: bank };
}

function platzVon(feld, p) {
    return Object.keys(feld.belegt).find(function (k) { return feld.belegt[k].id === p.id; }) || null;
}

/**
 * Nimmt einen Spieler vom Feld auf die Bank. War er der Torwart, rutscht kein
 * anderer Torwart nach: doppelte Torwart-Eintraege auf der Bank werden auf
 * "Bank" gesetzt (und als frueherer Torwart gemerkt), sonst fuellte die
 * Feldansicht das leere Tor von selbst. Der Platz bleibt leer, bis jemand
 * bewusst dort hingestellt wird.
 */
function vomFeldNehmen(p, feld) {
    const platz = platzVon(feld, p);
    if (!platz) return null;
    p.position = 'Bank';
    if (platz === 'TW') {
        p.warTorwart = true;
        const s = state();
        if (String(s.aktiverTorwartId) === String(p.id)) s.aktiverTorwartId = null;
        feld.bank.forEach(function (q) {
            if (q.id !== p.id && normalisiertePosition(q) === 'TW') {
                q.position = 'Bank';
                q.warTorwart = true;
            }
        });
    }
    return platz;
}

/**
 * Zeitstrafe (2 Minuten) eintragen. Beim eigenen Team: der Spieler geht auf die
 * Bank und ein Platz wird fuer die Dauer gesperrt (siehe SPERR_PLAETZE).
 * Beim Gegner nur die Zeit - dort gibt es keine Plaetze.
 */
function sperreSetzen(playerId, spielzeit) {
    const p = state().spieler.find(x => String(x.id) === String(playerId));
    if (!p) return;
    const schonGesperrt = sperreRest(p, spielzeit) > 0 && p.sperrePlatz;
    const feld = berechneFeld(spielzeit);
    p.suspendedUntilGameTime = spielzeit + SPERRE_SEKUNDEN;

    if (!istGast(p)) {
        const eigenerPlatz = platzVon(feld, p);
        if (eigenerPlatz) vomFeldNehmen(p, feld);
        if (!schonGesperrt) {
            let platz;
            if (eigenerPlatz && eigenerPlatz !== 'TW') platz = eigenerPlatz;
            else platz = SPERR_PLAETZE.find(function (k) { return !feld.blockiert[k]; }) || null;
            if (platz && feld.belegt[platz] && feld.belegt[platz].id !== p.id) feld.belegt[platz].position = 'Bank';
            p.sperrePlatz = platz;
        }
    }
    savePlayers();
}

/** Rote Karte: runter vom Feld, aber kein Platz wird gesperrt. */
function disqualifiziere(playerId) {
    const p = state().spieler.find(x => String(x.id) === String(playerId));
    if (!p || istGast(p)) return;
    vomFeldNehmen(p, berechneFeld());
    savePlayers();
}

/** Kompatibel zu frueher; die Dauer kommt weiter aus derselben Quelle. */
function applySuspension(playerId, currentGameTimeSeconds) {
    sperreSetzen(playerId, currentGameTimeSeconds);
}

function clearSuspension(playerId) {
    const player = state().spieler.find(p => String(p.id) === String(playerId));
    if (player && (player.suspendedUntilGameTime !== null || player.sperrePlatz)) {
        player.suspendedUntilGameTime = null;
        player.sperrePlatz = null;
        savePlayers();
    }
}

/**
 * Hebt abgelaufene Strafen auf: Platz frei, Spieler wieder waehlbar (er bleibt
 * auf der Bank - niemand wird von selbst aufs Feld gestellt).
 * @returns {Array} die freigegebenen Spieler
 */
function beendeAbgelaufeneSperren(jetzt) {
    const t = jetzt === undefined ? spielzeitJetzt() : jetzt;
    const frei = [];
    state().spieler.forEach(function (p) {
        const bis = p.suspendedUntilGameTime;
        if (bis === null || bis === undefined || t < bis) return;
        p.suspendedUntilGameTime = null;
        p.sperrePlatz = null;
        if (!istGast(p)) frei.push(p);
    });
    if (frei.length) {
        window.Sync.touch();
        frei.forEach(function (p) { if (window.UI && window.UI.sperreBeendet) window.UI.sperreBeendet(p); });
    } else if (state().spieler.some(function (p) { return p.suspendedUntilGameTime === null && p.sperrePlatz; })) {
        // Platz ohne Strafe (etwa nach einer Umbuchung): aufraeumen
        state().spieler.forEach(function (p) { if (p.suspendedUntilGameTime === null) p.sperrePlatz = null; });
        window.Sync.touch();
    }
    return frei;
}

/**
 * Spieler auf einen Feldplatz stellen (Ziehen). Ein gesperrter Platz nimmt
 * niemanden auf - AUSSER einen Spieler vom Feld: der tauscht, sein bisheriger
 * Platz wird dann der gesperrte (so entscheidet der Trainer, WER fehlt).
 * @returns {{ ok: boolean, grund?: string }}
 */
function platziereSpieler(playerId, platz, jetzt) {
    const p = state().spieler.find(x => String(x.id) === String(playerId));
    if (!p) return { ok: false, grund: 'Spieler nicht gefunden.' };
    const feld = berechneFeld(jetzt);
    if (istGesperrt(p, jetzt)) return { ok: false, grund: sperreText(p, jetzt) + '.' };

    const blocker = feld.blockiert[platz];
    if (blocker) {
        const alt = platzVon(feld, p);
        if (!alt) return { ok: false, grund: 'Dieser Platz ist gesperrt. Nur ein Spieler vom Feld kann tauschen.' };
        if (alt === 'TW') return { ok: false, grund: 'Der Torwart-Platz kann nicht gesperrt werden.' };
        blocker.sperrePlatz = alt;
        p.position = platz;
        savePlayers();
        return { ok: true };
    }

    const insasse = feld.belegt[platz];
    if (insasse && insasse.id !== p.id) insasse.position = 'Bank';
    p.position = platz;
    savePlayers();
    return { ok: true };
}

function removePlayerFromStore(playerId) {
    const s = state();
    s.spieler = s.spieler.filter(p => String(p.id) !== String(playerId));
    savePlayers();
}

function updatePlayerPosition(playerId, newPosition) {
    const player = state().spieler.find(p => String(p.id) === String(playerId));
    if (player) {
        player.position = newPosition;
        savePlayers();
    }
}

// Jede Aktion bekommt beim Speichern die ID des Torwarts mit, der in
// diesem Moment im Tor steht. Erst dadurch lassen sich Gegentore einem
// Keeper zuordnen und die Fangquote bei zwei Torhuetern getrennt
// berechnen - ohne dass man im Spiel einen Klick mehr machen muss.

function getTeamNames() {
    const st = state();
    return {
        heim: st.teamHeim || 'HEIM',
        gast: st.teamGast || 'GAST'
    };
}

function setTeamNames(heim, gast) {
    const st = state();
    if (typeof heim === 'string') st.teamHeim = heim.trim().slice(0, 40) || null;
    if (typeof gast === 'string') st.teamGast = gast.trim().slice(0, 40) || null;
    savePlayers();
}

/** Freier Spielname aus der Startseite (oder null). */
function getSpielName() {
    return state().spielName || null;
}

function setSpielName(name) {
    state().spielName = (typeof name === 'string' ? name.trim().slice(0, 80) : '') || null;
    savePlayers();
}

/**
 * Laedt eine gespeicherte Mannschaft in den Kader. EINE Umsetzung fuer die
 * Startseite ("Eigene Mannschaft") und "Team laden" in der Spielerverwaltung.
 *
 * Fuer beide gilt, mit Absicht:
 *  - Der Gegner-Eintrag bleibt immer stehen und wird nie aus dem gespeicherten
 *    Team uebernommen. Sonst entsteht ein "Gegner" mit team 'heim' - oder er
 *    verschwindet - und ein gegnerisches Tor liesse sich nicht mehr erfassen.
 *  - Ersetzen geht nur, solange das Spiel noch keine Aktionen hat: Aktionen
 *    haengen an der Spieler-id, ein Austausch mitten im Spiel wuerde sie
 *    verwaisen (die Statistik kennt die Spieler dann nicht mehr).
 *    Hinzufuegen geht jederzeit.
 *
 * @param {Array} spielerListe Spieler des gespeicherten Teams
 * @param {string} [modus] 'ersetzen' (Standard) oder 'hinzufuegen'
 * @returns {{ok: boolean, grund?: string, hinzugefuegt: number}}
 */
function ladeMannschaft(spielerListe, modus) {
    const ersetzen = modus !== 'hinzufuegen';
    if (ersetzen && state().aktionen.length > 0) {
        return { ok: false, grund: 'aktionen', hinzugefuegt: 0 };
    }

    if (ersetzen) {
        state().spieler.filter(function (p) { return !istGast(p); })
            .forEach(function (p) { removePlayerFromStore(p.id); });
        state().aktiverTorwartId = null;
    }

    let hinzugefuegt = 0;
    (spielerListe || []).filter(function (p) { return p && !istGast(p) && !istGastName(p.name); })
        .forEach(function (p) {
            // Beim Hinzufuegen keine Doppelten: dieselbe Person mit derselben Nummer
            if (!ersetzen && state().spieler.some(function (x) {
                return !istGast(x) && x.name === p.name && String(x.nummer) === String(p.nummer);
            })) return;
            addPlayerToStore(p.name, p.nummer, p.position);
            hinzugefuegt++;
        });
    savePlayers();
    return { ok: true, hinzugefuegt: hinzugefuegt };
}

/**
 * Beginnt ein neues Spiel aus der Startseite: Name, Mannschaftsnamen,
 * Halbzeitlaenge und eine frische Spielkennung - alles mit EINEM
 * Sync.touch(), damit der Stand nicht halb geschrieben beim Server landet.
 *
 * Die Spielkennung entstand bisher nur beim Beenden eines Spiels
 * (timer.js endGame). Fuer das allererste Spiel eines Kontos gab es keine -
 * die Ticker-Zeitmarken liefen dann unter dem Notnamen 'spiel'.
 */
function beginneSpiel(opt) {
    const st = state();
    st.spielName = (typeof opt.spielName === 'string' ? opt.spielName.trim().slice(0, 80) : '') || null;
    st.teamHeim = (typeof opt.teamHeim === 'string' ? opt.teamHeim.trim().slice(0, 40) : '') || null;
    st.teamGast = (typeof opt.teamGast === 'string' ? opt.teamGast.trim().slice(0, 40) : '') || null;
    st.spielId = 'g' + Date.now();
    if (opt.halbzeitMinuten) {
        // Erst den Stand setzen, dann die Uhr: Timer.setHalbzeitLaenge ruft nur
        // dann selbst touch(), wenn sich st.halbzeitSekunden noch aendert.
        st.halbzeitSekunden = Math.round(opt.halbzeitMinuten) * 60;
        if (window.Timer) window.Timer.setHalbzeitLaenge(opt.halbzeitMinuten);
    }
    savePlayers();
}

// ===================================================================
// AKTIVER TORWART
// ===================================================================

function isGoalkeeper(p) {
    return !!p && p.position === 'TW';
}

/** Alle Torhueter des eigenen Teams (auch die auf der Bank). */
function getGoalkeepers() {
    return state().spieler.filter(p => !istGast(p) && !istGesperrt(p) && (isGoalkeeper(p) || p.warTorwart));
}

/**
 * Der aktuell im Tor stehende Torwart.
 * Vorrang hat die manuelle Auswahl; sonst der Spieler auf Position TW.
 */
function getActiveGoalkeeper() {
    const s = state();
    if (s.aktiverTorwartId) {
        const chosen = s.spieler.find(p => String(p.id) === String(s.aktiverTorwartId));
        if (chosen && !istGesperrt(chosen)) return chosen;
    }
    return s.spieler.find(p => !istGast(p) && !istGesperrt(p) && isGoalkeeper(p)) || null;
}

function getActiveGoalkeeperId() {
    const gk = getActiveGoalkeeper();
    return gk ? gk.id : null;
}

function setActiveGoalkeeper(playerId) {
    const s = state();
    const player = s.spieler.find(p => String(p.id) === String(playerId));
    if (!player || istGesperrt(player)) return false;

    s.aktiverTorwartId = player.id;
    // Merken, dass dieser Spieler schon einmal im Tor stand - sonst
    // verschwindet er aus der Torwart-Auswahl, sobald er auf eine
    // Feldposition wechselt.
    player.warTorwart = true;
    savePlayers();
    return true;
}

function isOnCourt(p) {
    return !istGast(p)
        && p.position !== 'Bank'
        && p.position !== 'N/A'
        && p.position !== 'Gast';
}

// Die sieben Plaetze auf dem Feld, in der Reihenfolge der Court-Ansicht.
const COURT_POSITIONEN = ['TW', 'LA', 'RL', 'RM', 'RR', 'RA', 'KM'];

function normalisiertePosition(p) {
    let pos = p && p.position;
    if (pos === 'M') pos = 'RM';
    if (pos === 'K') pos = 'KM';
    return pos;
}

/**
 * Die Spieler, die gerade tatsaechlich auf dem Feld stehen.
 *
 * Regel wie in der Court-Ansicht: pro Position der erste passende Spieler,
 * alle weiteren sitzen auf der Bank. isOnCourt() allein reicht dafuer NICHT -
 * danach waere auch der zweite Rueckraum-Linke "auf dem Feld".
 *
 * Bewusst hier und nicht in der UI, damit Feldansicht und Assist-Auswahl
 * nicht auseinanderlaufen koennen.
 */
function getPlayersOnCourt() {
    const feld = berechneFeld();
    const ids = new Set(Object.keys(feld.belegt).map(k => String(feld.belegt[k].id)));
    return state().spieler.filter(p => ids.has(String(p.id)));
}

/**
 * Stammdaten eines Spielers aendern (Nummer, Name, Position).
 * Vorher blieb nur loeschen und neu anlegen - dabei gingen alle bereits
 * erfassten Aktionen des Spielers verloren, weil sie an der id haengen.
 */
function updatePlayerData(playerId, felder) {
    const player = state().spieler.find(p => String(p.id) === String(playerId));
    if (!player) return false;
    if (felder.name !== undefined && String(felder.name).trim()) player.name = String(felder.name).trim();
    if (felder.nummer !== undefined && String(felder.nummer).trim() !== '') player.nummer = felder.nummer;
    if (felder.position !== undefined && felder.position) player.position = felder.position;
    savePlayers();
    return true;
}

/**
 * Schreibt Einsatzzeit fort.
 *
 * Frueher wurde hier pro Interval-Tick +1 Sekunde gezaehlt - im
 * Hintergrund-Tab drosseln mobile Browser das Interval aber massiv, und
 * gespeichert wurde erst beim Pause-Klick. Jetzt kommt das Delta aus der
 * Spieluhr (echte Zeit) und wird bei jeder Aenderung lokal gesichert.
 *
 * @param {number} deltaSeconds - seit dem letzten Aufruf verstrichene Spielzeit
 * @param {number} gameTimeSeconds - aktueller Stand der Spieluhr
 * @returns {boolean} true, wenn die UI neu gezeichnet werden sollte
 */
function tickPlaytime(deltaSeconds, gameTimeSeconds) {
    if (!deltaSeconds || deltaSeconds <= 0) return false;

    let needsRedraw = false;
    let changed = false;

    // Abgelaufene Zeitstrafen aufheben (Platz frei, Hinweis "darf wieder spielen")
    if (beendeAbgelaufeneSperren(gameTimeSeconds).length) needsRedraw = true;

    state().spieler.forEach(p => {
        if (typeof p.playtimeSeconds !== 'number') {
            p.playtimeSeconds = 0;
        }

        if (isOnCourt(p)) {
            p.playtimeSeconds += deltaSeconds;
            changed = true;
        }
    });

    if (changed) {
        // Sichert lokal sofort, Server-Push ist gebuendelt -> kein Spam.
        window.Sync.touch();
    }

    return needsRedraw;
}

window.Store = {
    HAUPTAKTIONEN,
    UNTERAKTIONEN,
    WURFPOSITIONEN,
    getSPIELER: () => state().spieler,
    getTeamNames,
    setTeamNames,
    getSpielName,
    setSpielName,
    ladeMannschaft,
    beginneSpiel,
    isGoalkeeper,
    getGoalkeepers,
    getActiveGoalkeeper,
    getActiveGoalkeeperId,
    setActiveGoalkeeper,
    loadInitialState,
    loadPlayers,
    savePlayers,
    loadActions,
    saveActions,
    getMarken,
    addMarke,
    removeMarke,
    zaehleAuszeiten,
    getStand,
    isGuestTeam,
    istGast,
    istGastName,
    migriereTeamFeld,
    isOnCourt,
    getPlayersOnCourt,
    normalisiertePosition,
    COURT_POSITIONEN,
    updatePlayerData,
    addPlayerToStore,
    removePlayerFromStore,
    updatePlayerPosition,
    updatePlayerAvatar,
    applySuspension,
    clearSuspension,
    sperreSetzen,
    disqualifiziere,
    beendeAbgelaufeneSperren,
    platziereSpieler,
    berechneFeld,
    istGesperrt,
    istDisqualifiziert,
    sperreRest,
    sperreText,
    tickPlaytime,

    // Team API Wrappers
    // leise: true = kein Toast bei Fehlern (die Startseite fragt im
    // Hintergrund und meldet selbst, wenn die Liste fehlt)
    getTeams: async function(optionen) {
        try {
            const res = await fetch('/api/teams');
            if (!res.ok) return [];
            return await res.json();
        } catch(e) {
            console.error(e);
            if (window.Toast && !(optionen && optionen.leise)) window.Toast('Teams konnten nicht geladen werden (offline?)', { type: 'warn' });
            return [];
        }
    },
    saveTeam: async function(teamData) {
        try {
            const res = await fetch('/api/teams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(teamData)
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.json();
        } catch(e) {
            console.error(e);
            if (window.Toast) window.Toast('Team konnte nicht gespeichert werden - keine Verbindung.', { type: 'error' });
            return null;
        }
    },
    deleteTeam: async function(teamId) {
        try {
            const res = await fetch('/api/teams/' + teamId, { method: 'DELETE' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.json();
        } catch(e) {
            console.error(e);
            if (window.Toast) window.Toast('Team konnte nicht geloescht werden - keine Verbindung.', { type: 'error' });
            return null;
        }
    }
};
