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

const HAUPTAKTIONEN = [
    { typ: "WurfTor", label: "🤾🏻‍♀️ Wurf mit Tor", category: "Wurf", farbe: "green" },
    { typ: "WurfOhneTor", label: "❌ Wurf ohne Tor", category: "Wurf", farbe: "red" },
    { typ: "Ballverlust", label: "🥀 Ballverlust", category: "Verlust", farbe: "red" },
    { typ: "Ballgewinn", label: "💪 Ballgewinn", category: "Gewinn", farbe: "green" },
    { typ: "Parade", label: "🧤 Parade", category: "ParadeZone", farbe: "yellow", nurTorwart: true },
    { typ: "SiebenMeterRaus", label: "🎯 7m herausgeholt", category: "Herausgeholt", farbe: "green" },
    { typ: "Zeitstrafe", label: "⏱️ 2-Minuten", category: "Strafe", farbe: "orange" },
    { typ: "Karte", label: "🟨 Karte", category: "Karte", farbe: "orange" },
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
        { typ: "Gelb", label: "🟨 Gelbe Karte" },
        { typ: "Rot", label: "🟥 Rote Karte" },
        { typ: "Blau", label: "🟦 Blaue Karte" }
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
            { id: 'p1', name: "Gegner", nummer: 0, position: "N/A", playtimeSeconds: 0, suspendedUntilGameTime: null },
            { id: 'p2', name: "Tom Tester", nummer: 22, position: "LA", playtimeSeconds: 0, suspendedUntilGameTime: null },
            { id: 'p3', name: "Kai Keeper", nummer: 1, position: "TW", playtimeSeconds: 0, suspendedUntilGameTime: null },
        ];
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

// Helper: Ist es ein Gegner?
function isGuestTeam(name) {
    if (!name) return false;
    const lowerName = name.toLowerCase().trim();
    return lowerName === 'gegner' || lowerName === 'enemy' || lowerName === 'gast';
}

function addPlayerToStore(name, number, position, avatarUrl = null) {
    state().spieler.push({
        id: 'p' + Date.now() + '_' + Math.floor(Math.random() * 10000),
        name: name,
        nummer: number,
        position: position || "N/A",
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

function applySuspension(playerId, currentGameTimeSeconds) {
    const player = state().spieler.find(p => String(p.id) === String(playerId));
    if (player) {
        // 2 minutes = 120 seconds
        player.suspendedUntilGameTime = currentGameTimeSeconds + 120;
        savePlayers();
    }
}

function clearSuspension(playerId) {
    const player = state().spieler.find(p => String(p.id) === String(playerId));
    if (player && player.suspendedUntilGameTime !== null) {
        player.suspendedUntilGameTime = null;
        savePlayers();
    }
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

<<<<<<< HEAD
=======
// ===================================================================
// AKTIVER TORWART
// ===================================================================
>>>>>>> 0b29f46e0ef45b664cf4cf7e8385847e009c625e
// Jede Aktion bekommt beim Speichern die ID des Torwarts mit, der in
// diesem Moment im Tor steht. Erst dadurch lassen sich Gegentore einem
// Keeper zuordnen und die Fangquote bei zwei Torhuetern getrennt
// berechnen - ohne dass man im Spiel einen Klick mehr machen muss.

<<<<<<< HEAD
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

// ===================================================================
// AKTIVER TORWART
// ===================================================================

=======
>>>>>>> 0b29f46e0ef45b664cf4cf7e8385847e009c625e
function isGoalkeeper(p) {
    return !!p && p.position === 'TW';
}

/** Alle Torhueter des eigenen Teams (auch die auf der Bank). */
function getGoalkeepers() {
    return state().spieler.filter(p => !isGuestTeam(p.name) && (isGoalkeeper(p) || p.warTorwart));
}

/**
 * Der aktuell im Tor stehende Torwart.
 * Vorrang hat die manuelle Auswahl; sonst der Spieler auf Position TW.
 */
function getActiveGoalkeeper() {
    const s = state();
    if (s.aktiverTorwartId) {
        const chosen = s.spieler.find(p => String(p.id) === String(s.aktiverTorwartId));
        if (chosen) return chosen;
    }
    return s.spieler.find(p => !isGuestTeam(p.name) && isGoalkeeper(p)) || null;
}

function getActiveGoalkeeperId() {
    const gk = getActiveGoalkeeper();
    return gk ? gk.id : null;
}

function setActiveGoalkeeper(playerId) {
    const s = state();
    const player = s.spieler.find(p => String(p.id) === String(playerId));
    if (!player) return false;

    s.aktiverTorwartId = player.id;
    // Merken, dass dieser Spieler schon einmal im Tor stand - sonst
    // verschwindet er aus der Torwart-Auswahl, sobald er auf eine
    // Feldposition wechselt.
    player.warTorwart = true;
    savePlayers();
    return true;
}

function isOnCourt(p) {
    return !isGuestTeam(p.name)
        && p.position !== 'Bank'
        && p.position !== 'N/A'
        && p.position !== 'Gast';
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

    state().spieler.forEach(p => {
        // Abgelaufene Zeitstrafe aufheben
        if (p.suspendedUntilGameTime !== null && p.suspendedUntilGameTime !== undefined
            && gameTimeSeconds >= p.suspendedUntilGameTime) {
            p.suspendedUntilGameTime = null;
            changed = true;
            needsRedraw = true;
        }

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
<<<<<<< HEAD
    getTeamNames,
    setTeamNames,
=======
>>>>>>> 0b29f46e0ef45b664cf4cf7e8385847e009c625e
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
    isGuestTeam,
    isOnCourt,
    addPlayerToStore,
    removePlayerFromStore,
    updatePlayerPosition,
    updatePlayerAvatar,
    applySuspension,
    clearSuspension,
    tickPlaytime,

    // Team API Wrappers
    getTeams: async function() {
        try {
            const res = await fetch('/api/teams');
            if (!res.ok) return [];
            return await res.json();
        } catch(e) {
            console.error(e);
            if (window.Toast) window.Toast('Teams konnten nicht geladen werden (offline?)', { type: 'warn' });
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
