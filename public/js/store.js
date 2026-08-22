// ===================================================================
// STORE & DATA MANAGEMENT (localStorage)
// ===================================================================

const HAUPTAKTIONEN = [
    { typ: "WurfTor", label: "🤾🏻‍♀️ Wurf mit Tor", category: "Wurf", farbe: "green" },
    { typ: "WurfOhneTor", label: "❌ Wurf ohne Tor", category: "Wurf", farbe: "red" },
    { typ: "Ballverlust", label: "🥀 Ballverlust", category: "Verlust", farbe: "red" },
    { typ: "Parade", label: "🧤 Parade", category: "Wurf", farbe: "yellow" },
    { typ: "Zeitstrafe", label: "⏱️ 2-Minuten", farbe: "orange" },
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

function addPlayerToStore(name, number, position, avatarUrl = null) {
    SPIELER.push({
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
    const player = SPIELER.find(p => String(p.id) === String(playerId));
    if (player) {
        player.avatarUrl = avatarUrl;
        savePlayers();
    }
}

function applySuspension(playerId, currentGameTimeSeconds) {
    const player = SPIELER.find(p => String(p.id) === String(playerId));
    if (player) {
        // 2 minutes = 120 seconds
        player.suspendedUntilGameTime = currentGameTimeSeconds + 120;
        savePlayers();
    }
}

function removePlayerFromStore(playerId) {
    SPIELER = SPIELER.filter(p => String(p.id) !== String(playerId));
    savePlayers();
}

function updatePlayerPosition(playerId, newPosition) {
    const player = SPIELER.find(p => String(p.id) === String(playerId));
    if (player) {
        player.position = newPosition;
        savePlayers();
    }
}

function tickPlaytime() {
    let updated = false;
    // We need current game time to clear suspensions
    const timerState = window.Timer ? window.Timer.getTimerState() : { spielzeitSekunden: 0 };
    
    SPIELER.forEach(p => {
        // Clear suspension if time has passed
        if (p.suspendedUntilGameTime !== null && timerState.spielzeitSekunden >= p.suspendedUntilGameTime) {
            p.suspendedUntilGameTime = null;
            updated = true;
            if (window.UI) window.UI.updateUI(); // refresh UI so they aren't grayed out
        }
        
        // Initialize if undefined
        if (typeof p.playtimeSeconds !== 'number') {
            p.playtimeSeconds = 0;
        }
        // Exclude guest team and players on the bench or N/A
        if (!isGuestTeam(p.name) && p.position !== 'Bank' && p.position !== 'N/A' && p.position !== 'Gast') {
            p.playtimeSeconds++;
            updated = true;
        }
    });
    // We don't call savePlayers() here to avoid spamming the backend every second.
    // The state will be saved when the game timer is paused, or positions change.
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
    updatePlayerPosition,
    updatePlayerAvatar,
    applySuspension,
    tickPlaytime,
    
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
