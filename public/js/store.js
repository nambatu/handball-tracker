// ===================================================================
// STORE & DATA MANAGEMENT (localStorage)
// ===================================================================

const HAUPTAKTIONEN = [
    { typ: "WurfTor", label: "🤾🏻‍♀️ Wurf mit Tor", category: "Wurf", farbe: "green" },
    { typ: "WurfOhneTor", label: "❌ Wurf ohne Tor", category: "Wurf", farbe: "red" },
    { typ: "Ballverlust", label: "🥀 Ballverlust", category: "Verlust", farbe: "red" },
    { typ: "Parade", label: "🧤 Parade", category: "Wurf", farbe: "yellow" },
];

const UNTERAKTIONEN = {
    "Wurf": [
        { typ: "Aussen", label: "Außen" },
        { typ: "Kreis", label: "Kreis" },
        { typ: "Rueckraum6m", label: "Rückraum (6m)" },
        { typ: "Rueckraum9m", label: "Rückraum (9m)" },
        { typ: "Gegenstoss", label: "Gegenstoß" },
        { typ: "ZweiteWelle", label: "2. Welle" },
        { typ: "7Meter", label: "7 Meter"}
    ],
    "Verlust": [
        { typ: "Fehlpass", label: "Fehlpass" },
        { typ: "Doppel", label: "Doppel" },
        { typ: "Fuss", label: "Fuß" },
        { typ: "Schrittfehler", label: "Schrittfehler" },
        { typ: "Stuermerfoul", label: "Stürmerfoul" },
        { typ: "Zeitspiel", label: "Zeitspiel" },
        { typ: "TechnischerFehler", label: "Technischer Fehler" }
    ],
    "Parade": [
        { typ: "MitBallgewinn", label: "Mit Ballgewinn" },
        { typ: "OhneBallgewinn", label: "Ohne Ballgewinn" },
    ],
};

let SPIELER = [];
let AKTIONEN = [];

async function loadInitialState() {
    try {
        const res = await fetch('/api/state');
        if (res.ok) {
            const state = await res.json();
            SPIELER = state.spieler || [];
            AKTIONEN = state.aktionen || [];

            if (SPIELER.length === 0) {
                SPIELER = [
                    { id: 'p1', name: "Gegner", nummer: 0, position: "N/A" },
                    { id: 'p2', name: "Tom Tester", nummer: 22, position: "LA" },
                    { id: 'p3', name: "Kai Keeper", nummer: 1, position: "TW" },
                ];
                savePlayers();
            }
        }
    } catch (e) {
        console.error("Failed to load initial state from server", e);
    }
}

function loadPlayers() {
    return SPIELER;
}

function savePlayers() {
    fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spieler: SPIELER, aktionen: AKTIONEN })
    }).catch(e => console.error(e));
}

function loadActions() {
    return AKTIONEN;
}

function saveActions(aktionen) {
    AKTIONEN = aktionen;
    fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spieler: SPIELER, aktionen: AKTIONEN })
    }).catch(e => console.error(e));
}

// Helper: Ist es ein Gegner?
function isGuestTeam(name) {
    if (!name) return false;
    const lowerName = name.toLowerCase().trim();
    return lowerName === 'gegner' || lowerName === 'enemy' || lowerName === 'gast';
}

function addPlayerToStore(name, number, position) {
    SPIELER.push({
        id: 'p' + Date.now(),
        name: name,
        nummer: number,
        position: position || "N/A"
    });
    savePlayers();
}

function removePlayerFromStore(playerId) {
    SPIELER = SPIELER.filter(p => String(p.id) !== String(playerId));
    savePlayers();
}

// Export for other modules if utilizing ES modules later, or attach to window
window.Store = {
    HAUPTAKTIONEN,
    UNTERAKTIONEN,
    getSPIELER: () => SPIELER,
    loadInitialState,
    loadPlayers,
    savePlayers,
    loadActions,
    saveActions,
    isGuestTeam,
    addPlayerToStore,
    removePlayerFromStore,
    
    // Team API Wrappers
    getTeams: async function() {
        try {
            const res = await fetch('/api/teams');
            return await res.json();
        } catch(e) {
            console.error(e);
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
            return await res.json();
        } catch(e) {
            console.error(e);
            return null;
        }
    },
    deleteTeam: async function(teamId) {
        try {
            const res = await fetch('/api/teams/' + teamId, { method: 'DELETE' });
            return await res.json();
        } catch(e) {
            console.error(e);
            return null;
        }
    }
};
