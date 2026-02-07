// ===================================================================
// 1. KONFIGURATION & DATENSTRUKTUREN
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

// ===================================================================
// 2. GLOBALE VARIABLES (STATE)
// ===================================================================

let SPIELER = [];
let selectedPlayerId = null;
let selectedPrimaryAction = null;
let selectedPrimaryActionCategory = null;
let currentSort = 'nummer';

// Timer-Zustand
let timerInterval = null;
let spielzeitSekunden = 0;
let currentHalf = 1;
let isTimerRunning = false;

// Zwischenspeicher für Assist-Logik
let tempActionData = null; 

// Cached DOM-Elemente
const playerListElement = document.getElementById('player-list');
const actionPanelElement = document.getElementById('action-panel');
const actionTitleElement = actionPanelElement ? actionPanelElement.querySelector('h3') : null;
const feedbackOverlay = document.getElementById('feedback-overlay');
const historyPanelElement = document.getElementById('history-panel'); 


// ===================================================================
// 3. INITIALISIERUNG & SPEICHER (LOAD/SAVE)
// ===================================================================

window.onload = () => {
    loadPlayers();
    loadGameState();
    updateActionCount();
    renderHistory();
    updateUI();
};

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
    sortPlayers();
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

function sortPlayers() {
    SPIELER.sort((a, b) => {
        if (currentSort === 'nummer') {
            return a.nummer - b.nummer;
        } else if (currentSort === 'position') {
            return a.position.localeCompare(b.position);
        }
        return 0;
    });
}

function toggleSort(criteria) {
    if (currentSort === criteria) {
        SPIELER.reverse();
    } else {
        currentSort = criteria;
        sortPlayers();
    }
    updateUI();
}

// Helper: Ist es ein Gegner?
function isGuestTeam(name) {
    if (!name) return false;
    const lowerName = name.toLowerCase().trim();
    return lowerName === 'gegner' || lowerName === 'enemy' || lowerName === 'gast';
}

// ===================================================================
// 4. AKTIONSLOGIK (SPEICHERN & UNDO)
// ===================================================================

/**
 * SCHRITT 1: Entscheidung - Speichern oder nach Assist fragen?
 */
function saveAction(player, finalActionType, finalActionLabel, category) {
    if (!isTimerRunning) {
        alert("▶️ Der Spiel-Timer ist gestoppt oder pausiert. Bitte zuerst starten!");
        return;
    }

    const isGoal = finalActionType.includes('WurfTor');
    const isEnemy = isGuestTeam(player.name); 

    if (isGoal && !isEnemy) {
        // Fall A: Tor (Eigenes Team) -> Overlay öffnen
        tempActionData = {
            player: player,
            typ: finalActionType,
            label: finalActionLabel,
            category: category
        };
        showAssistOverlay(); 
    } else {
        // Fall B: Kein Tor oder Gegner -> Sofort speichern
        executeSaveAction(player, finalActionType, finalActionLabel, category, null);
    }
}

/**
 * SCHRITT 2: Tatsächliches Speichern in die Datenbank
 */
function executeSaveAction(player, actionType, actionLabel, category, assistId) {
    const aktionen = loadActions();

    const newAction = {
        id: Date.now(),
        spielId: "current_match",
        spielerId: player.id,
        assistId: assistId,
        typ: actionType,
        label: actionLabel,
        category: category || "Unbekannt", // Fallback, falls immer noch was fehlt
        halbzeit: currentHalf,
        
        // FIX: Wir speichern die echten Sekunden (Integer), nicht den Text!
        // Der CSV Export formatiert das dann später wieder schön zu mm:ss
        spielzeit: spielzeitSekunden, 
        
        timestamp: Date.now()
    };

    aktionen.push(newAction);
    saveActions(aktionen);

    // UI Updates
    showVisualFeedback(player.id, actionLabel);
    updateActionCount();
    renderHistory();
    updateScoreboard();

    // Reset Selection
    selectedPlayerId = null;
    selectedPrimaryAction = null;
    selectedPrimaryActionCategory = null;
    updateUI();
}

function undoLastAction() {
    if (!confirm("Letzte Aktion rückgängig machen?")) return;

    const aktionen = loadActions();
    if (aktionen.length === 0) {
        alert("Keine Aktionen zum Löschen.");
        return;
    }

    const lastAction = aktionen.pop();
    saveActions(aktionen);

    const player = SPIELER.find(s => s.id === lastAction.spielerId);
    const actionLabel = lastAction.label || lastAction.typ;

    updateActionCount();
    renderHistory();
    updateScoreboard(); // Wichtig: Spielstand korrigieren
    updateUI();

    alert(`RÜCKGÄNGIG: ${player ? player.nummer : '?'} (${actionLabel})`);
}

// ===================================================================
// 5. ASSIST OVERLAY LOGIK
// ===================================================================

function showAssistOverlay() {
    const overlay = document.getElementById('assist-overlay');
    const list = document.getElementById('assist-list');
    
    if (!overlay || !list) {
        console.error("Overlay Elemente fehlen in index.html");
        return;
    }

    list.innerHTML = ''; // Liste leeren
    
    SPIELER.forEach(p => {
        // Nicht man selbst und kein Gegner
        const isEnemy = isGuestTeam(p.name);
        if (p.id !== selectedPlayerId && !isEnemy) {
            const btn = document.createElement('button');
            btn.innerHTML = `<strong>${p.nummer}</strong><br>${p.name}`;
            // Optional: CSS Klasse hinzufügen falls gewünscht
            btn.style.margin = "5px"; 
            btn.style.padding = "10px";
            btn.onclick = () => confirmAssist(p.id);
            list.appendChild(btn);
        }
    });

    overlay.style.display = 'flex';
}

function closeAssistOverlay() {
    const overlay = document.getElementById('assist-overlay');
    if (overlay) overlay.style.display = 'none';
    tempActionData = null;
}

function confirmAssist(assistPlayerId) {
    if (!tempActionData) return;

    executeSaveAction(
        tempActionData.player,
        tempActionData.typ,
        tempActionData.label,
        tempActionData.category,
        assistPlayerId
    );

    closeAssistOverlay();
}

// ===================================================================
// 6. UI RENDERING (SPIELER, AKTIONEN, VERLAUF)
// ===================================================================

function updateUI() {
    renderPlayerList();
    renderActionButtons();
    updateTimerDisplay();
}

function renderPlayerList() {
    if (!playerListElement) return;

    playerListElement.innerHTML = `
        <div class="player-list-header">
            <h3>Spieler</h3>
            <div class="sort-options">
                <span class="sort-label">Sortieren:</span>
                <button onclick="toggleSort('nummer')" class="sort-btn ${currentSort === 'nummer' ? 'active-sort' : ''}"># Nr.</button>
                <button onclick="toggleSort('position')" class="sort-btn ${currentSort === 'position' ? 'active-sort' : ''}">Pos.</button>
            </div>
        </div>
    `;

    const summaryStats = getPlayerSummaryStats();

    SPIELER.forEach(player => {
        const stats = summaryStats[player.id] || { tore: 0, fehler: 0, paraden: 0 };
        const isSelected = selectedPlayerId === player.id;
        const playerButton = document.createElement('div');

        playerButton.className = `player-button ${isSelected ? 'selected-player' : ''}`;
        playerButton.onclick = () => selectPlayer(player.id);

        playerButton.innerHTML = `
            <div class="player-info">
                <span class="player-number">#${player.nummer}</span>
                <span class="player-name">${player.name} (${player.position})</span>
            </div>
            <div class="player-stats"> 
                <span class="stat-item green">🥅 ${stats.tore}</span> 
                <span class="stat-item red">❌ ${stats.fehler}</span> 
                <span class="stat-item yellow">🧤 ${stats.paraden}</span>
            </div>
        `;
        playerListElement.appendChild(playerButton);
    });
}

function renderHistory() {
    if (!historyPanelElement) return;

    historyPanelElement.innerHTML = '<h3>Verlauf</h3>';
    const aktionen = loadActions();
    aktionen.reverse(); // Neueste oben

    const aktionenToShow = aktionen.slice(0, 25);

    aktionenToShow.forEach(entry => {
        const player = SPIELER.find(s => s.id === entry.spielerId);
        const playerNumber = player ? player.nummer : '?'; // Fix: Variable definiert
        const playerName = player ? player.name : 'Unbekannt';
        
        const assistPlayer = entry.assistId ? SPIELER.find(p => p.id === entry.assistId) : null;
        const assistText = assistPlayer ? `<br><small style="color:#666">🅰️ Assist: ${assistPlayer.name}</small>` : '';
        
        const entryElement = document.createElement('div');
        entryElement.className = 'history-entry';

        // Fix: entryElement statt div benutzt
        entryElement.innerHTML = `
            <span class="history-time">${entry.spielzeit}</span>
            <span class="history-player">
                <strong>${playerNumber} ${playerName}</strong>
                ${assistText}
            </span>
            <span class="history-action">${entry.label}</span>
        `;
        historyPanelElement.appendChild(entryElement);
    });

    updateScoreboard();
}

function renderActionButtons() {
    if (!actionPanelElement || !actionTitleElement) return;

    actionPanelElement.innerHTML = '';
    actionPanelElement.appendChild(actionTitleElement);

    let buttonsToRender = [];
    let titleText = "Aktion (Nach Spieler-Wahl)";

    // Untermenü
    if (selectedPrimaryActionCategory && UNTERAKTIONEN[selectedPrimaryActionCategory]) {
        buttonsToRender = UNTERAKTIONEN[selectedPrimaryActionCategory];
        const primaryActionLabel = HAUPTAKTIONEN.find(a => a.typ === selectedPrimaryAction).label;
        titleText = `Details für: ${primaryActionLabel}`;

        const backButton = document.createElement('button');
        backButton.className = 'action-button back-button';
        backButton.innerText = '← Zurück zu Aktionen';
        backButton.onclick = resetActionSelection;
        actionTitleElement.insertAdjacentElement('afterend', backButton);

    } else {
        // Hauptmenü
        buttonsToRender = HAUPTAKTIONEN;
    }

    actionTitleElement.innerText = titleText;

    buttonsToRender.forEach(action => {
        const button = document.createElement('button');
        const isSelected = action.typ === selectedPrimaryAction;

        let baseClass;
        if (selectedPrimaryActionCategory) {
            baseClass = 'sub-blue';
        } else {
            baseClass = action.farbe || 'neutral';
        }

        button.className = `action-button ${baseClass} ${isSelected ? 'selected-action' : ''}`;
        button.innerText = action.label;

        // WICHTIG: Kategorie immer mitgeben
        if (action.category !== undefined) {
            button.onclick = () => selectAction(action.typ, action.category);
        } else {
            button.onclick = () => selectAction(action.typ);
        }

        actionPanelElement.appendChild(button);
    });
}

function selectPlayer(playerId) {
    if (selectedPlayerId === playerId) {
        selectedPlayerId = null;
    } else {
        selectedPlayerId = playerId;
    }
    selectedPrimaryAction = null;
    selectedPrimaryActionCategory = null;
    updateUI();
}

function selectAction(actionType, category = null) {
    if (!selectedPlayerId) {
        alert("Bitte zuerst einen Spieler auswählen!");
        return;
    }
    const player = SPIELER.find(p => p.id === selectedPlayerId);

    // Ebene 1: Hauptaktion geklickt -> ins Untermenü
    if (category !== null && UNTERAKTIONEN[category]) {
        selectedPrimaryAction = actionType;
        selectedPrimaryActionCategory = category;
        updateUI();

    // Ebene 2: Fertige Aktion (oder Hauptaktion ohne Untermenü)
    } else {
        let finalActionType;
        let finalActionLabel;
        let finalCategory = category; // Startwert

        // Fall: Wir kommen aus einem Untermenü
        if (selectedPrimaryAction && selectedPrimaryActionCategory) {
            finalActionType = `${selectedPrimaryAction}_${actionType}`;
            
            const primaryAction = HAUPTAKTIONEN.find(a => a.typ === selectedPrimaryAction);
            const subAction = UNTERAKTIONEN[selectedPrimaryActionCategory].find(a => a.typ === actionType);
            
            finalActionLabel = `${primaryAction.label} (${subAction.label})`;
            finalCategory = selectedPrimaryActionCategory; // Kategorie sicherstellen

        // Fall: Einzelaktion ohne Untermenü (Direktklick)
        } else {
            const primaryAction = HAUPTAKTIONEN.find(a => a.typ === actionType);
            finalActionType = actionType;
            finalActionLabel = primaryAction ? primaryAction.label : actionType;
            
            // FIX: Wenn category null ist, holen wir sie aus der Config
            if (!finalCategory && primaryAction) {
                finalCategory = primaryAction.category;
            }
        }

        // Speichern aufrufen
        saveAction(player, finalActionType, finalActionLabel, finalCategory);
    }
}

function resetActionSelection() {
    selectedPrimaryAction = null;
    selectedPrimaryActionCategory = null;
    updateUI();
}

function updateActionCount() {
    const aktionen = loadActions();
    const el = document.getElementById("action-count");
    if(el) el.innerText = aktionen.length;
}

function showVisualFeedback(playerId, actionLabel) {
    if (!feedbackOverlay) return;
    const player = SPIELER.find(p => p.id === playerId);
    if (!player) return;

    feedbackOverlay.innerText = `${player.nummer} - ${player.name}:\n${actionLabel}`;
    feedbackOverlay.classList.add('show');
    setTimeout(() => {
        feedbackOverlay.classList.remove('show');
    }, 1500);
}

// ===================================================================
// 7. TIMER & SPIELZUSTAND LOGIK
// ===================================================================

function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateTimerDisplay() {
    // FIX: Element direkt abrufen
    const timerEl = document.getElementById("game-timer");
    if (timerEl) timerEl.innerText = formatTime(spielzeitSekunden);

    const btn = document.getElementById("timer-btn");
    if (btn) btn.innerText = isTimerRunning ? "⏸️ Pause" : "▶️ Start Spiel";

    const endBtn = document.getElementById("half-end-btn");
    if (endBtn) {
        if (currentHalf === 2) {
            endBtn.innerText = "🏁 Spiel Beenden";
            endBtn.classList.add('end-game');
        } else {
            endBtn.innerText = "⏸️ Halbzeit";
            endBtn.classList.remove('end-game');
        }
    }

    const infoHeader = document.getElementById("game-info");
    const teamNameEl = document.getElementById('team-name');
    if (infoHeader && teamNameEl) {
        // Wir suchen NICHT h2, da der Header jetzt anders aufgebaut ist (Scoreboard),
        // aber die Spielzeit ist separat. Das hier ist nur noch für den Debug oder Titel.
        // Falls du einen Titel aktualisieren willst:
        // infoHeader.querySelector('h2').innerText = ... (Vorsicht, h2 enthält jetzt spans)
    }
}

function toggleGameTimer() {
    if (isTimerRunning) {
        clearInterval(timerInterval);
        isTimerRunning = false;
    } else {
        timerInterval = setInterval(() => {
            spielzeitSekunden++;
            updateTimerDisplay();
            saveGameState();
        }, 1000);
        isTimerRunning = true;
    }
    updateTimerDisplay();
    saveGameState();
}

function saveGameState() {
    const gameState = {
        spielzeit: spielzeitSekunden,
        halbzeit: currentHalf,
        isRunning: isTimerRunning
    };
    localStorage.setItem("gameState", JSON.stringify(gameState));
}

function loadGameState() {
    const savedState = JSON.parse(localStorage.getItem("gameState"));
    if (savedState) {
        spielzeitSekunden = savedState.spielzeit || 0;
        currentHalf = savedState.halbzeit || 1;
        if (savedState.isRunning) {
            isTimerRunning = false;
            const btn = document.getElementById("timer-btn");
            if(btn) btn.innerText = "▶️ Weiter";
        }
        updateTimerDisplay();
    }
}

function toggleEndHalfOrGame() {
    if (isTimerRunning) toggleGameTimer();

    if (currentHalf === 1) {
        if (confirm("1. Halbzeit beenden?")) {
            currentHalf = 2;
        }
    } else {
        endGame();
    }
    saveGameState();
    updateUI();
}

function endGame() {
    if (!confirm("SPIEL BEENDEN? Alle Daten werden gelöscht!")) return;
    
    spielzeitSekunden = 0;
    currentHalf = 1;
    isTimerRunning = false;
    clearInterval(timerInterval);
    
    localStorage.removeItem("gameState");
    localStorage.removeItem("aktionen");
    
    alert("Spiel beendet. Reset.");
    renderHistory();
    updateUI();
    updateScoreboard(); // Reset Score
}

// ===================================================================
// 8. SPIELER-VERWALTUNG (MANAGEMENT)
// ===================================================================

function togglePlayerManagement() {
    const mainApp = document.getElementById("app-container");
    const managementView = document.getElementById("player-management-view");

    if (managementView.style.display === 'none' || managementView.style.display === '') {
        mainApp.style.display = 'none';
        managementView.style.display = 'block';
        renderRosterList();
    } else {
        managementView.style.display = 'none';
        mainApp.style.display = 'flex';
        updateUI();
    }
}

function renderRosterList() {
    const rosterList = document.getElementById("roster-list");
    if (!rosterList) return;
    rosterList.innerHTML = '';
    sortPlayers();

    SPIELER.forEach(p => {
        const li = document.createElement("li");
        li.innerHTML = `
            <span>#${p.nummer} ${p.name} (${p.position})</span>
            <button onclick="removePlayer('${p.id}')">Löschen</button>
        `;
        rosterList.appendChild(li);
    });
}

function addPlayer() {
    const nameEl = document.getElementById("input-name");
    const numEl = document.getElementById("input-number");
    const posEl = document.getElementById("input-position");
    
    const name = nameEl.value;
    const number = parseInt(numEl.value);

    if (!name || isNaN(number)) {
        alert("Bitte Name und Nummer angeben.");
        return;
    }

    SPIELER.push({
        id: 'p' + Date.now(),
        name: name,
        nummer: number,
        position: posEl.value || "N/A"
    });
    savePlayers();

    nameEl.value = "";
    numEl.value = "";
    renderRosterList();
}

function removePlayer(playerId) {
    if (!confirm("Wirklich löschen?")) return;
    SPIELER = SPIELER.filter(p => String(p.id) !== String(playerId));
    savePlayers();
    if (selectedPlayerId && String(selectedPlayerId) === String(playerId)) {
        selectedPlayerId = null;
    }
    renderRosterList();
}

// ===================================================================
// 9. STATISTIK & CSV EXPORT
// ===================================================================

function updateScoreboard() {
    const aktionen = loadActions();
    let homeGoals = 0;
    let guestGoals = 0;

    aktionen.forEach(action => {
        if (action.typ && action.typ.includes('WurfTor')) {
            const player = SPIELER.find(p => p.id === action.spielerId);
            if (player) {
                if (isGuestTeam(player.name)) {
                    guestGoals++;
                } else {
                    homeGoals++;
                }
            }
        }
    });

    const homeEl = document.getElementById('score-home');
    const guestEl = document.getElementById('score-guest');
    if (homeEl && guestEl) {
        homeEl.innerText = homeGoals;
        guestEl.innerText = guestGoals;
    }
}

function getPlayerSummaryStats() {
    const aktionen = loadActions();
    let summary = {};

    SPIELER.forEach(s => {
        summary[s.id] = { tore: 0, fehler: 0, paraden: 0, gesamtAktionen: 0 };
    });

    aktionen.forEach(action => {
        if (!summary[action.spielerId]) return;
        const type = action.typ;
        if (type.includes("WurfTor")) summary[action.spielerId].tore++;
        if (type.includes("Ballverlust")) summary[action.spielerId].fehler++;
        if (type.includes("Parade")) summary[action.spielerId].paraden++;
        summary[action.spielerId].gesamtAktionen++;
    });

    return summary;
}

function showStats_GetDetailedData() {
    const aktionen = loadActions();
    let stats = {};
    let allActionTypes = [];

    // Alle möglichen Kombinationen sammeln
    HAUPTAKTIONEN.forEach(h => {
        if (h.category && UNTERAKTIONEN[h.category]) {
            UNTERAKTIONEN[h.category].forEach(u => {
                allActionTypes.push(`${h.typ}_${u.typ}`);
            });
        } else {
            allActionTypes.push(h.typ);
        }
    });
    // + gespeicherte
    const storedTypes = [...new Set(aktionen.map(a => a.typ))];
    allActionTypes = [...new Set([...allActionTypes, ...storedTypes])].sort();

    // Init
    SPIELER.forEach(s => {
        stats[s.id] = { name: s.name, nummer: s.nummer, aktionen: {} };
        allActionTypes.forEach(typ => stats[s.id].aktionen[typ] = 0);
    });

    // Count
    aktionen.forEach(action => {
        if (stats[action.spielerId] && stats[action.spielerId].aktionen.hasOwnProperty(action.typ)) {
            stats[action.spielerId].aktionen[action.typ]++;
        }
    });

    return { stats: stats, allActionTypes: allActionTypes };
}

function showStats() {
    const data = showStats_GetDetailedData();
    const stats = data.stats;
    const allActionTypes = data.allActionTypes;

    let html = "<h2>Statistikübersicht</h2>";
    html += "<table border='1' cellspacing='0' cellpadding='5' width='100%'>";
    html += "<thead style='background:#f2f2f2;'><tr><th style='text-align:left;'>Spieler</th>";
    
    allActionTypes.forEach(typ => {
        html += `<th style='font-size:0.8em;'>${typ.replace('_', ' ')}</th>`;
    });
    html += "</tr></thead><tbody>";

    Object.values(stats).forEach(p => {
        html += `<tr><td style='font-weight:bold;'>#${p.nummer} ${p.name}</td>`;
        allActionTypes.forEach(typ => {
            const count = p.aktionen[typ] || 0;
            const style = count > 0 ? "font-weight:bold;" : "color:#ccc;";
            html += `<td style='text-align:center;${style}'>${count}</td>`;
        });
        html += "</tr>";
    });
    html += "</tbody></table>";

    const win = window.open('', 'Statistik', 'width=1000,height=600');
    if (win) {
        win.document.write(`<html><head><title>Stats</title><style>body{font-family:sans-serif;padding:20px;}table{border-collapse:collapse;}td,th{border:1px solid #ddd;}</style></head><body>${html}<br><button onclick="window.opener.exportAsCSV()">CSV Export</button></body></html>`);
        win.document.close();
    }
}

/**
 * Berechnet eine vereinfachte Zusammenfassung für den Header der CSV.
 * Zählt Tore, Fehlwürfe, Assists, Techn. Fehler und Paraden.
 */
function getHighLevelStats() {
    const aktionen = loadActions();
    let stats = {};

    // 1. Grundstruktur für alle Spieler
    SPIELER.forEach(s => {
        stats[s.id] = { 
            name: s.name, 
            nummer: s.nummer, 
            tore: 0, 
            fehlwuerfe: 0, 
            assists: 0, 
            fehler: 0, 
            paraden: 0 
        };
    });

    // 2. Aktionen durchgehen
    aktionen.forEach(a => {
        // Falls Spieler gelöscht wurde, ignorieren
        if (!stats[a.spielerId]) return;

        const typ = a.typ;

        // Tore
        if (typ.includes("WurfTor")) {
            stats[a.spielerId].tore++;
        }
        // Fehlwürfe (Wurf ohne Tor)
        else if (typ.includes("WurfOhneTor")) {
            stats[a.spielerId].fehlwuerfe++;
        }
        // Technische Fehler / Ballverlust
        else if (typ.includes("Ballverlust")) {
            stats[a.spielerId].fehler++;
        }
        // Paraden
        else if (typ.includes("Parade")) {
            stats[a.spielerId].paraden++;
        }

        // Assists zählen (Achtung: Assist-ID steht im Datensatz, nicht als eigene Aktion)
        if (a.assistId && stats[a.assistId]) {
            stats[a.assistId].assists++;
        }
    });

    return stats;
}

/**
 * Der neue, benutzerfreundliche CSV Export
 */
function exportAsCSV() {
    const aktionen = loadActions();

    if (aktionen.length === 0) {
        alert("Keine Daten zum Exportieren.");
        return;
    }

    // CSV BOM für Excel (damit Umlaute richtig angezeigt werden)
    let csv = "\uFEFF"; 

    // ==========================================
    // TEIL 1: MANNSCHAFTS-ÜBERSICHT (SUMMARY)
    // ==========================================
    csv += "=== SPIELER STATISTIK ===\n";
    csv += "Nr.,Name,Tore,Assists,Fehlwürfe,Tech. Fehler,Paraden\n";

    const summary = getHighLevelStats();

    // Sortieren nach Toren (absteigend) für bessere Übersicht
    const sortedPlayerIds = Object.keys(summary).sort((a, b) => {
        return summary[b].tore - summary[a].tore; 
    });

    sortedPlayerIds.forEach(id => {
        const s = summary[id];
        // CSV-Zeile bauen
        csv += `${s.nummer},"${s.name}",${s.tore},${s.assists},${s.fehlwuerfe},${s.fehler},${s.paraden}\n`;
    });

    csv += "\n"; // Leerzeile zur Trennung

    // ==========================================
    // TEIL 2: SPIELVERLAUF (LOG)
    // ==========================================
    csv += "=== SPIELVERLAUF ===\n";
    csv += "Halbzeit,Spielzeit,Spielstand,Nr.,Name,Aktion,Detail,Assist\n";

    // Chronologisch sortieren (Alt -> Neu)
    const sortedActions = [...aktionen].sort((a, b) => a.timestamp - b.timestamp);

    let homeGoals = 0;
    let guestGoals = 0;

    sortedActions.forEach(a => {
        // 1. Spielstand berechnen (Laufender Score)
        const player = SPIELER.find(p => p.id === a.spielerId);
        const pName = player ? player.name : "Unbekannt";
        const pNum = player ? player.nummer : "?";
        
        let isGoal = false;

        if (a.typ && a.typ.includes("WurfTor")) {
            isGoal = true;
            if (isGuestTeam(pName)) {
                guestGoals++;
            } else {
                homeGoals++;
            }
        }

        // 2. Zeit formatieren (mm:ss)
        // Wir nutzen deine bestehende formatTime Funktion, falls verfügbar, sonst Berechnung
        let timeString = "00:00";
        if (typeof formatTime === "function") {
            // Wir müssen sicherstellen, dass a.spielzeit eine Zahl ist
            timeString = formatTime(parseInt(a.spielzeit));
        }

        // 3. Assist Name holen
        const assistPlayer = a.assistId ? SPIELER.find(p => p.id === a.assistId) : null;
        const assistName = assistPlayer ? assistPlayer.name : "";

        // 4. Label bereinigen (Emoji entfernen für Excel?) 
        // Optional: Wir lassen die Emojis drin, Excel kann das meistens. 
        // Falls du sie weg haben willst: a.label.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '').trim();
        const cleanLabel = a.label; 

        // 5. Kategorie extrahieren (z.B. "Tor" statt "WurfTor_Aussen")
        // Wir nehmen einfach den Label-Text, der ist meist am besten lesbar.
        
        // Zeile schreiben
        // Format: HZ, Zeit, Score, Nr, Name, Aktion, Detail, Assist
        csv += `${a.halbzeit},${timeString},"${homeGoals}:${guestGoals}",${pNum},"${pName}","${a.category}","${cleanLabel}","${assistName}"\n`;
    });

    // ==========================================
    // DOWNLOAD STARTEN
    // ==========================================
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `handball_match_report_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}