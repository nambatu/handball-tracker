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

function loadPlayers() {
    let savedPlayers = JSON.parse(localStorage.getItem("spieler"));
    if (savedPlayers && savedPlayers.length > 0) {
        SPIELER = savedPlayers;
    } else {
        SPIELER = [
            { id: 'p1', name: "Gegner", nummer: 0, position: "N/A" },
            { id: 'p2', name: "Tom Tester", nummer: 22, position: "LA" },
            { id: 'p3', name: "Kai Keeper", nummer: 1, position: "TW" },
        ];
        savePlayers();
    }
}

function savePlayers() {
    localStorage.setItem("spieler", JSON.stringify(SPIELER));
}

function loadActions() {
    return JSON.parse(localStorage.getItem("aktionen")) || [];
}

function saveActions(aktionen) {
    localStorage.setItem("aktionen", JSON.stringify(aktionen));
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
    loadPlayers,
    savePlayers,
    loadActions,
    saveActions,
    isGuestTeam,
    addPlayerToStore,
    removePlayerFromStore
};
