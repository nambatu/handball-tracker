// Konfiguration: Spieler & Aktionstypen
// Wichtig: 'let' für dynamische Zuweisung in loadPlayers()
let SPIELER = []; 

const AKTIONSTYPEN = [
    // Positive Aktionen (Reihe 1)
    { typ: "Tor", label: "⚽ Tor", farbe: "green" }, 
    { typ: "Gegenstoß", label: "🏃 Gegenstoß", farbe: "green" }, 
    
    // Negative Aktionen (Reihe 2)
    { typ: "Fehlpass", label: "❌ Fehlpass", farbe: "red" },
    { typ: "Technischer Fehler", label: "⚠️ Tech. Fehler", farbe: "red" },
    
    // Defensive Aktionen (Reihe 3)
    { typ: "Block", label: "🛡️ Block", farbe: "blue" },
    { typ: "Ballgewinn", label: "🖐️ Ballgewinn", farbe: "blue" },
    
    // Torwart-Aktionen (Reihe 4)
    { typ: "ParadeMit", label: "🧤 Parade m. Ballgewinn", farbe: "yellow" },
    { typ: "ParadeOhne", label: "🥅 Parade o. Ballgewinn", farbe: "yellow" },
];

let selectedPlayerId = null;
let selectedActionType = null;
let currentHalf = 1;

// Zustand des Timers
let timerInterval = null;
let spielzeitSekunden = 0; // Gesamtspielzeit in Sekunden
let isTimerRunning = false; 

// Initialisierung beim Laden der Seite
window.onload = () => {
    loadPlayers(); 
    renderPlayerButtons();
    renderActionButtons();
    updateActionCount();
    loadGameState();
};

// ======================================================================
// === STATISTIK-AGGREGATION FÜR LIVE-ANZEIGE ===
// ======================================================================

function getPlayerSummaryStats() {
    const aktionen = JSON.parse(localStorage.getItem("aktionen")) || [];
    let summary = {};

    SPIELER.forEach(s => {
        summary[s.id] = { tore: 0, fehler: 0 };
    });

    aktionen.forEach(action => {
        if (!summary[action.spielerId]) return;

        if (action.typ === "Tor" || action.typ === "Gegenstoß") {
            summary[action.spielerId].tore++;
        }
        if (action.typ === "Fehlpass" || action.typ === "Technischer Fehler") {
            summary[action.spielerId].fehler++;
        }
    });

    return summary;
}

// ======================================================================
// === RÜCKGÄNGIG ===
// ======================================================================

function undoLastAction() {
    if (!confirm("Sicher, dass die letzte Aktion rückgängig gemacht werden soll? Dies kann nicht rückgängig gemacht werden.")) {
        return;
    }

    const aktionen = JSON.parse(localStorage.getItem("aktionen")) || [];
    
    if (aktionen.length === 0) {
        alert("Es gibt keine Aktionen zum Löschen.");
        return;
    }

    const lastAction = aktionen.pop(); 
    
    localStorage.setItem("aktionen", JSON.stringify(aktionen));
    updateActionCount();
    
    renderPlayerButtons(); 

    const player = SPIELER.find(s => s.id === lastAction.spielerId);
    alert(`Aktion RÜCKGÄNGIG: ${player ? player.nummer + ' - ' + player.name : 'Unbekannter Spieler'} (${lastAction.typ})`);
}

// ======================================================================
// === KERN-FUNKTIONEN ===
// ======================================================================

function renderPlayerButtons() {
    const container = document.getElementById("player-list");
    container.innerHTML = '<h3>Spieler (Tippen zum Auswählen)</h3>';
    
    const summaryStats = getPlayerSummaryStats();

    SPIELER.forEach(s => {
        const stats = summaryStats[s.id] || { tore: 0, fehler: 0 };
        
        const btn = document.createElement("button");
        btn.className = "player-button";
        
        btn.innerHTML = `
            <span>${s.nummer} - ${s.name} (${s.position})</span>
            <span class="player-stats">
                ⚽ ${stats.tore} | ❌ ${stats.fehler}
            </span>
        `;
        
        btn.onclick = (e) => selectPlayer(s.id, e.target); 
        container.appendChild(btn);
    });
}

function renderActionButtons() {
    const container = document.getElementById("action-panel");
    container.innerHTML = '<h3>Aktion (Nach Spieler-Wahl)</h3>';

    AKTIONSTYPEN.forEach(a => {
        const btn = document.createElement("button");
        btn.className = `action-button ${a.farbe}`;
        btn.innerText = a.label;
        btn.onclick = (e) => selectAction(a.typ, e.target);
        container.appendChild(btn);
    });
}

function selectPlayer(id, element) {
    const buttonElement = element.closest('.player-button');
    if (!buttonElement) return;

    document.querySelectorAll('.player-button').forEach(btn => btn.classList.remove('selected'));

    if (selectedActionType) {
        selectedPlayerId = id; 
        addAction(selectedActionType);

        document.querySelectorAll('.action-button').forEach(btn => btn.classList.remove('selected-action'));
        selectedPlayerId = null; 
        selectedActionType = null;
        
    } else {
        selectedPlayerId = id;
        buttonElement.classList.add('selected');
    }
}

function selectAction(type, element) {
    document.querySelectorAll('.action-button').forEach(btn => btn.classList.remove('selected-action'));

    if (selectedPlayerId) {
        addAction(type);
        document.querySelector('.player-button.selected')?.classList.remove('selected');
        selectedPlayerId = null; 
        selectedActionType = null;
        
    } else {
        selectedActionType = type;
        element.classList.add('selected-action');
    }
}

// ======================================================================
// === SPIELSTAND & TIMER LOGIK ===
// ======================================================================

function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateTimerDisplay() {
    document.getElementById("game-timer").innerText = formatTime(spielzeitSekunden);
    document.getElementById("timer-btn").innerText = isTimerRunning ? "⏸️ Pause" : "▶️ Start Spiel";
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

/**
 * Steuert den Wechsel von Halbzeit zu Halbzeit und von Halbzeit zum Spielende.
 */
function toggleEndHalfOrGame() {
    if (isTimerRunning) {
        toggleGameTimer(); // Timer stoppen
    }
    
    if (currentHalf === 1) {
        // Erste Halbzeit beenden -> Wechsel zu 2. Halbzeit
        alert("Erste Halbzeit beendet. Jetzt Pause und dann 'Start Spiel' für die 2. Halbzeit.");
        currentHalf = 2;
        
        // Button-Text und Stil aktualisieren
        const endBtn = document.getElementById("half-end-btn");
        if (endBtn) {
            endBtn.innerText = "🏁 Spiel Beenden";
            endBtn.classList.add('end-game');
        }

        document.getElementById("game-info").querySelector('h2').innerText = `Aktuelles Spiel: ... (2. Halbzeit)`;
    } else {
        // Spiel beenden (nach der 2. Halbzeit)
        endGame();
    }
    saveGameState();
}

/**
 * Fragt den Benutzer, ob das Spiel beendet werden soll, und setzt dann die Daten zurück.
 */
function endGame() {
    if (isTimerRunning) {
        toggleGameTimer(); // Timer stoppen
    }
    
    if (!confirm("Spiel beendet? Alle erfassten Aktionen und der Spielstand werden gelöscht. (Statistik vorher exportieren!)")) {
        return; 
    }
    
    resetGameData();
    alert("Spiel beendet und Daten zurückgesetzt. Du kannst sofort ein neues Spiel beginnen.");
}

/**
 * Setzt alle Spielstände und Aktionen im LocalStorage und den globalen Variablen zurück.
 */
function resetGameData() {
    // Globale Variablen zurücksetzen
    spielzeitSekunden = 0;
    currentHalf = 1;
    isTimerRunning = false;
    
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    // LocalStorage bereinigen (Spielstand und Aktionen)
    localStorage.removeItem("gameState");
    localStorage.removeItem("aktionen");

    // UI-Elemente zurücksetzen
    document.getElementById("game-info").querySelector('h2').innerText = `Aktuelles Spiel: ... (1. Halbzeit)`;
    updateTimerDisplay(); 
    updateActionCount();
    
    // Halbzeit-Button zurücksetzen
    const endBtn = document.getElementById("half-end-btn");
    if (endBtn) {
        endBtn.innerText = "⏸️ Halbzeit";
        endBtn.classList.remove('end-game');
    }
    
    // Spieler-Live-Stats aktualisieren (die jetzt 0 sind)
    renderPlayerButtons(); 
    
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
    
    // Standardwerte für den Fall, dass nichts gespeichert ist
    const endBtn = document.getElementById("half-end-btn");
    if (endBtn) {
        endBtn.innerText = "⏸️ Halbzeit";
        endBtn.classList.remove('end-game');
    }
    
    if (savedState) {
        spielzeitSekunden = savedState.spielzeit || 0;
        currentHalf = savedState.halbzeit || 1;
        
        if (savedState.isRunning) {
             document.getElementById("timer-btn").innerText = "▶️ Start Spiel (Weiter)";
        }
        
        document.getElementById("game-info").querySelector('h2').innerText = 
            `Aktuelles Spiel: ... (${currentHalf}. Halbzeit)`;
        
        // Button-Text beim Laden der 2. Halbzeit aktualisieren
        if (endBtn && currentHalf === 2) {
            endBtn.innerText = "🏁 Spiel Beenden";
            endBtn.classList.add('end-game');
        }
        
        updateTimerDisplay();
    }
}

function addAction(type) {
    const player = SPIELER.find(s => s.id === selectedPlayerId); 
    
    if (!player) {
        alert("Interner Fehler: Spieler-ID fehlt.");
        return;
    }
    
    if (!isTimerRunning) {
        alert("▶️ Der Spiel-Timer ist gestoppt oder pausiert. Bitte zuerst starten!");
        return;
    }

    const aktionen = JSON.parse(localStorage.getItem("aktionen")) || [];

    const newAction = {
        id: Date.now(), 
        spielId: "current_match",
        spielerId: selectedPlayerId,
        typ: type,
        halbzeit: currentHalf,
        spielzeit: spielzeitSekunden, 
        timestamp: new Date().toISOString()
    };
    
    aktionen.push(newAction);

    localStorage.setItem("aktionen", JSON.stringify(aktionen));
    
    console.log(`Aktion erfasst: ${player.name} - ${type} bei ${formatTime(spielzeitSekunden)}`);
    
    document.querySelector('.player-button.selected')?.classList.remove('selected');
    selectedPlayerId = null; 

    showVisualFeedback(player.id, type);
    
    updateActionCount();
    renderPlayerButtons(); 
}

function updateActionCount() {
    const aktionen = JSON.parse(localStorage.getItem("aktionen")) || [];
    document.getElementById("action-count").innerText = aktionen.length;
}

// ======================================================================
// === STATISTIK & EXPORT ===
// ======================================================================

function showStats() {
    const aktionen = JSON.parse(localStorage.getItem("aktionen")) || [];
    let stats = {};
    
    SPIELER.forEach(s => {
        stats[s.id] = {
            name: s.name,
            nummer: s.nummer,
            aktionen: {}
        };
        AKTIONSTYPEN.forEach(a => {
            stats[s.id].aktionen[a.typ] = 0;
        });
    });

    aktionen.forEach(action => {
        if (stats[action.spielerId]) {
            stats[action.spielerId].aktionen[action.typ]++;
        }
    });

    let reportHtml = "<h2>Statistikübersicht</h2>";
    reportHtml += "<table border='1' width='100%'><thead><tr><th>Spieler</th>";
    
    AKTIONSTYPEN.forEach(a => {
        reportHtml += `<th>${a.label}</th>`;
    });
    reportHtml += "</tr></thead><tbody>";

    Object.values(stats).forEach(playerStats => {
        reportHtml += `<tr><td>${playerStats.nummer} ${playerStats.name}</td>`;
        AKTIONSTYPEN.forEach(a => {
            reportHtml += `<td>${playerStats.aktionen[a.typ]}</td>`;
        });
        reportHtml += "</tr>";
    });

    reportHtml += "</tbody></table>";

    const statsWindow = window.open('', 'Statistik', 'width=800,height=600');
    statsWindow.document.write(reportHtml);
    statsWindow.document.write('<br><button onclick="window.opener.exportAsCSV()">Export CSV</button>');
    statsWindow.document.write('<button onclick="window.close()">Fenster schließen</button>');
}

function exportAsCSV() {
    const aktionen = JSON.parse(localStorage.getItem("aktionen")) || [];
    
    if (aktionen.length === 0) {
        alert("Keine Aktionen zum Exportieren vorhanden.");
        return;
    }

    let csvContent = "Spieler_Nummer,Spieler_Name,Aktionstyp,Halbzeit,Spielzeit_Sekunden,Zeitstempel\n";

    aktionen.forEach(action => {
        const player = SPIELER.find(s => s.id === action.spielerId);
        const playerName = player ? player.name : 'Unbekannt';
        const playerNumber = player ? player.nummer : 'N/A';
        
        csvContent += `${playerNumber},"${playerName}",${action.typ},${action.halbzeit},${action.spielzeit},${action.timestamp}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    link.href = URL.createObjectURL(blob);
    link.download = `handball_statistik_${new Date().toLocaleDateString()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    alert("CSV-Export erfolgreich gestartet.");
}

function showVisualFeedback(playerId, actionType) {
    const overlay = document.getElementById("feedback-overlay");
    const player = SPIELER.find(s => s.id === playerId);
    const action = AKTIONSTYPEN.find(a => a.typ === actionType);

    if (!overlay || !player || !action) return;

    overlay.innerText = `${player.nummer} - ${player.name}\n${action.label}`;

    overlay.style.display = 'block';
    setTimeout(() => {
        overlay.style.opacity = 1;
    }, 10); 

    setTimeout(() => {
        overlay.style.opacity = 0;
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 300);
    }, 800);
}

// ======================================================================
// === SPIELER VERWALTUNG ===
// ======================================================================

function loadPlayers() {
    const savedPlayers = JSON.parse(localStorage.getItem("spieler"));
    if (savedPlayers && savedPlayers.length > 0) {
        SPIELER = savedPlayers;
    } else {
        // Initiale Liste
        SPIELER = [
            { id: Date.now() + 1, name: "Max Mustermann", nummer: 10, position: "RM" },
            { id: Date.now() + 2, name: "Tom Tester", nummer: 22, position: "LA" },
            { id: Date.now() + 3, name: "Kai Keeper", nummer: 1, position: "TW" },
        ];
        savePlayers(); 
    }
}

function savePlayers() {
    localStorage.setItem("spieler", JSON.stringify(SPIELER));
}

function togglePlayerManagement() {
    const mainApp = document.getElementById("app-container");
    const managementView = document.getElementById("player-management-view");

    if (managementView.style.display === 'none' || managementView.style.display === '') {
        // Zeige Management View und verstecke Hauptansicht
        mainApp.style.display = 'none';
        managementView.style.display = 'block';
        renderPlayerManagement();
    } else {
        // Verstecke Management View und zeige Hauptansicht
        managementView.style.display = 'none';
        mainApp.style.display = 'flex';
        renderPlayerButtons();
    }
}

function renderPlayerManagement() {
    const rosterList = document.getElementById("roster-list");
    rosterList.innerHTML = '';

    const sortedPlayers = [...SPIELER].sort((a, b) => a.nummer - b.nummer);

    sortedPlayers.forEach(s => {
        const li = document.createElement("li");
        li.innerHTML = `
            <span>#${s.nummer} - ${s.name} (${s.position})</span>
            <button onclick="deletePlayer(${s.id})">Löschen</button>
        `;
        rosterList.appendChild(li);
    });
}

function addPlayer() {
    const name = document.getElementById("input-name").value.trim();
    const numberStr = document.getElementById("input-number").value.trim();
    const position = document.getElementById("input-position").value;
    const number = parseInt(numberStr);
    
    if (!name || isNaN(number) || number <= 0 || numberStr === '') {
        alert("Bitte Name und eine gültige Trikot-Nummer eingeben.");
        return;
    }

    if (SPIELER.some(p => p.nummer === number)) {
        alert(`Die Trikot-Nummer ${number} ist bereits vergeben.`);
        return;
    }

    const newPlayer = {
        id: Date.now(),
        name: name,
        nummer: number,
        position: position
    };

    SPIELER.push(newPlayer);
    
    document.getElementById("input-name").value = '';
    document.getElementById("input-number").value = '';
    
    savePlayers();
    renderPlayerManagement();
}

function deletePlayer(id) {
    const playerToDelete = SPIELER.find(p => p.id === id);
    if (!playerToDelete) return;

    if (!confirm(`Sicher, dass Spieler ${playerToDelete.name} (#${playerToDelete.nummer}) gelöscht werden soll?`)) return;
    
    SPIELER = SPIELER.filter(p => p.id !== id);
    
    savePlayers();
    renderPlayerManagement();
    alert(`Spieler ${playerToDelete.name} gelöscht.`);
}