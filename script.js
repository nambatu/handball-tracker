// ===================================================================
// Globale Zustandsvariablen (State) & Initialisierung
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

// Cached DOM-Elemente
const playerListElement = document.getElementById('player-list');
const actionPanelElement = document.getElementById('action-panel');
const actionTitleElement = actionPanelElement ? actionPanelElement.querySelector('h3') : null;
const feedbackOverlay = document.getElementById('feedback-overlay');


// ===================================================================
// Datenstruktur für Aktionen (Zwei-Ebenen-Modell)
// ===================================================================

const HAUPTAKTIONEN = [
    { typ: "WurfTor", label: "🥅 Wurf mit Tor", category: "Wurf", farbe: "green" },
    { typ: "WurfOhneTor", label: "❌ Wurf ohne Tor", category: "Wurf", farbe: "red" },
    { typ: "Ballverlust", label: "🥀 Ballverlust", category: "Verlust", farbe: "red" },
    { typ: "Parade", label: "🧤 Parade", category: "Parade", farbe: "yellow" },
];

const UNTERAKTIONEN = {
    "Wurf": [
        { typ: "Aussen", label: "Außen" },
        { typ: "Kreis", label: "Kreis" },
        { typ: "Rueckraum", label: "Rückraum" },
        { typ: "Gegenstoss", label: "Gegenstoß" },
        { typ: "ZweiteWelle", label: "2. Welle" },
    ],
    "Verlust": [
        { typ: "Fehlpass", label: "Fehlpass" },
        { typ: "Doppel", label: "Doppel" },
        { typ: "Fuss", label: "Fuß" },
        { typ: "Schrittfehler", label: "Schrittfehler" },
        { typ: "Stuermerfoul", label: "Stürmerfoul" },
        { typ: "Zeitspiel", label: "Zeitspiel"},
        { typ: "TechnischerFehler", label: "Technischer Fehler"}
    ],
    "Parade": [
        { typ: "MitBallgewinn", label: "Mit Ballgewinn" },
        { typ: "OhneBallgewinn", label: "Ohne Ballgewinn" },
    ],
};

// ===================================================================
// Initialisierung & Load/Save
// ===================================================================

window.onload = () => {
    loadPlayers(); 
    loadGameState(); 
    updateUI();
    updateActionCount();
};

function loadPlayers() {
    let savedPlayers = JSON.parse(localStorage.getItem("spieler"));
    if (savedPlayers && savedPlayers.length > 0) {
        SPIELER = savedPlayers;
    } else {
        // Initiale Liste
        SPIELER = [
            { id: 'p1', name: "GEGNER", nummer: 0, position: "Hurensohn" },
            { id: 'p2', name: "Tom Tester", nummer: 22, position: "LA" },
            { id: 'p3', name: "Kai Keeper", nummer: 1, position: "TW" },
        ];
        savePlayers(); 
    }
    // Wichtig: Beim Laden sofort sortieren
    sortPlayers();
}

function savePlayers() {
    localStorage.setItem("spieler", JSON.stringify(SPIELER));
}

/**
 * Sortiert die Spielerliste nach der aktuellen Sortiermethode.
 */
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
        // Bei gleichem Kriterium einfach umkehren (z.B. nach Nummer aufsteigend/absteigend)
        SPIELER.reverse();
    } else {
        currentSort = criteria;
        sortPlayers();
    }
    updateUI();
}

function loadActions() {
    return JSON.parse(localStorage.getItem("aktionen")) || [];
}

function saveActions(aktionen) {
    localStorage.setItem("aktionen", JSON.stringify(aktionen));
}

/**
 * Macht die letzte gespeicherte Aktion rückgängig.
 */
function undoLastAction() {
    if (!confirm("Sicher, dass die letzte Aktion rückgängig gemacht werden soll? Dies kann nicht rückgängig gemacht werden.")) {
        return;
    }

    const aktionen = loadActions();
    
    if (aktionen.length === 0) {
        alert("Es gibt keine Aktionen zum Löschen.");
        return;
    }

    const lastAction = aktionen.pop(); 
    saveActions(aktionen);
    
    // Spielerinformationen abrufen
    const player = SPIELER.find(s => s.id === lastAction.spielerId);
    
    // Die gespeicherte lesbare Bezeichnung verwenden (z.B. '🥅 Wurf mit Tor (Außen)')
    const actionLabel = lastAction.label || lastAction.typ; 

    // UI aktualisieren
    updateActionCount();
    updateUI(); 

    alert(`Aktion RÜCKGÄNGIG: ${player ? player.nummer + ' - ' + player.name : 'Unbekannter Spieler'} (${actionLabel})`);
}

// ===================================================================
// === DATENLOGIK: AKTION SPEICHERN & ZÄHLEN ===
// ===================================================================

/**
 * Speichert die fertige Aktion und aktualisiert die UI.
 */
function saveAction(player, finalActionType, finalActionLabel) {
    if (!isTimerRunning) {
        alert("▶️ Der Spiel-Timer ist gestoppt oder pausiert. Bitte zuerst starten!");
        return;
    }
    
    const aktionen = loadActions();

    const newAction = {
        id: Date.now(), 
        spielId: "current_match",
        spielerId: player.id,
        typ: finalActionType, // z.B. WurfTor_Aussen
        label: finalActionLabel, // z.B. 🥅 Wurf mit Tor (Außen)
        halbzeit: currentHalf,
        spielzeit: spielzeitSekunden, 
        timestamp: new Date().toISOString()
    };
    
    aktionen.push(newAction);
    saveActions(aktionen);
    
    // Visuelles Feedback
    showVisualFeedback(player.id, finalActionLabel);
    
    // UI-Elemente aktualisieren
    updateActionCount();
    
    // Wichtig: Nach dem Speichern wird der Spieler deselektiert und die Ansicht zurückgesetzt
    selectedPlayerId = null; 
    selectedPrimaryAction = null;
    selectedPrimaryActionCategory = null;
    updateUI(); 
}


/**
 * Zählt alle Aktionen aus dem LocalStorage und erstellt eine Statistik-Zusammenfassung.
 */
function getPlayerSummaryStats() {
    const aktionen = loadActions();
    let summary = {};

    SPIELER.forEach(s => {
        summary[s.id] = { tore: 0, fehler: 0, paraden: 0, gesamtAktionen: 0 };
    });

    aktionen.forEach(action => {
        if (!summary[action.spielerId]) return;
        
        const type = action.typ;

        // Tore zählen (Wurf mit Tor)
        if (type.includes("WurfTor")) {
            summary[action.spielerId].tore++;
        }
        
        // Fehler zählen (enthält Ballverlust und Technischer Fehler)
        if (type.includes("Verlust") || type === "TechnischerFehler") {
            summary[action.spielerId].fehler++;
        }
        
        // Paraden zählen
        if (type.includes("Parade")) {
             summary[action.spielerId].paraden++;
        }
        
        summary[action.spielerId].gesamtAktionen++;
    });

    return summary;
}

/**
 * Exportiert die gesamten Rohdaten der Aktionen als CSV-Datei.
 */
/**
 * Exportiert die gesamten Rohdaten und die Statistik-Tabelle als CSV-Datei.
 */
function exportAsCSV() {
    const aktionen = loadActions();
    
    if (aktionen.length === 0) {
        alert("Keine Aktionen zum Exportieren vorhanden.");
        return;
    }

    let csvContent = "";

    // --- TEIL 1: STATISTIK-ZUSAMMENFASSUNG (TABELLE) ---
    csvContent += "=== STATISTIK-ZUSAMMENFASSUNG (PRO SPIELER UND AKTIONSTYP) ===\n";
    const stats = getPlayerSummaryStats(); // Verwenden der bereits implementierten Logik
    
    // Hier nutzen wir die detaillierte Zählung aus der showStats Logik
    const fullStats = {};
    const detailedSummary = showStats_GetDetailedData(); // NEU: Hilfsfunktion
    
    let allActionTypes = detailedSummary.allActionTypes;

    // Header-Zeile
    let header = "Spieler_Nummer,Spieler_Name";
    allActionTypes.forEach(typ => { header += `,${typ}`; });
    csvContent += header + "\n";
    
    // Datenzeilen
    Object.values(detailedSummary.stats).forEach(playerStats => {
        let row = `${playerStats.nummer},"${playerStats.name}"`;
        allActionTypes.forEach(typ => {
            row += `,${playerStats.aktionen[typ] || 0}`;
        });
        csvContent += row + "\n";
    });

    // --- TEIL 2: ROHDATEN-EXPORT ---
    csvContent += "\n\n=== ROHDATEN (ALLE AKTIONEN CHRONOLOGISCH) ===\n";
    csvContent += "Spieler_Nummer,Spieler_Name,Aktionstyp_Technisch,Aktionstyp_Lesbar,Halbzeit,Spielzeit_Sekunden,Zeitstempel\n";

    aktionen.forEach(action => {
        const player = SPIELER.find(s => s.id === action.spielerId);
        const playerName = player ? player.name : 'Unbekannt';
        const playerNumber = player ? player.nummer : 'N/A';
        
        csvContent += `${playerNumber},"${playerName}",${action.typ},"${action.label}",${action.halbzeit},${action.spielzeit},${action.timestamp}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    link.href = URL.createObjectURL(blob);
    link.download = `handball_statistik_export_${new Date().toLocaleDateString()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    alert("CSV-Export erfolgreich gestartet.");
}

/**
 * Hilfsfunktion: Sammelt alle Daten für Statistik und Export zentral.
 * Verhindert doppelten Code.
 */
function showStats_GetDetailedData() {
    const aktionen = loadActions();
    let stats = {};
    
    // 1. Alle möglichen Aktionen sammeln (aus Definitionen + tatsächlich gespeicherten)
    let allActionTypes = [];
    
    // Füge alle Hauptaktionen hinzu
    HAUPTAKTIONEN.forEach(h => {
        if (h.category === null) {
            allActionTypes.push(h.typ);
        } else if (UNTERAKTIONEN[h.category]) {
            // Füge alle Kombinationen hinzu (Haupt_Unter)
            UNTERAKTIONEN[h.category].forEach(u => {
                allActionTypes.push(`${h.typ}_${u.typ}`);
            });
        }
    });

    // Sicherheitshalber auch Typen aus den gespeicherten Aktionen nehmen (falls Konfig geändert wurde)
    const storedTypes = [...new Set(aktionen.map(a => a.typ))];
    allActionTypes = [...new Set([...allActionTypes, ...storedTypes])].sort();

    // 2. Initialisiere Zähler
    SPIELER.forEach(s => {
        stats[s.id] = {
            name: s.name,
            nummer: s.nummer,
            aktionen: {}
        };
        allActionTypes.forEach(typ => {
            stats[s.id].aktionen[typ] = 0;
        });
    });

    // 3. Aktionen zählen
    aktionen.forEach(action => {
        if (stats[action.spielerId]) {
            stats[action.spielerId].aktionen[action.typ]++;
        }
    });

    return { stats: stats, allActionTypes: allActionTypes };
}

/**
 * Öffnet das Statistik-Fenster (Pop-up).
 */
function showStats() {
    // Daten holen
    const data = showStats_GetDetailedData();
    const stats = data.stats;
    const allActionTypes = data.allActionTypes;

    // HTML Bericht bauen
    let reportHtml = "<h2>Statistikübersicht</h2>";
    reportHtml += "<table border='1' cellspacing='0' cellpadding='5' width='100%'>";
    
    // Header
    reportHtml += "<thead style='background-color: #f2f2f2;'><tr><th style='text-align:left;'>Spieler</th>";
    allActionTypes.forEach(typ => {
        // Versuchen, den Typ lesbar zu machen (optional)
        // Einfache Variante: Unterstrich durch Leerzeichen ersetzen
        let readable = typ.replace('_', ' ');
        reportHtml += `<th style='font-size: 0.8em;'>${readable}</th>`; 
    });
    reportHtml += "</tr></thead><tbody>";

    // Body
    Object.values(stats).forEach(playerStats => {
        reportHtml += `<tr><td style='font-weight:bold;'>#${playerStats.nummer} ${playerStats.name}</td>`;
        allActionTypes.forEach(typ => {
            const count = playerStats.aktionen[typ] || 0;
            // Nullen grau darstellen, Zahlen fett
            const style = count > 0 ? "font-weight:bold; color:black;" : "color:#ccc;";
            reportHtml += `<td style='text-align:center; ${style}'>${count}</td>`;
        });
        reportHtml += "</tr>";
    });

    reportHtml += "</tbody></table>";

    // Fenster öffnen
    const statsWindow = window.open('', 'Statistik', 'width=1000,height=600');
    if (statsWindow) {
        statsWindow.document.write('<html><head><title>Statistik</title>');
        statsWindow.document.write('<style>body{font-family: sans-serif; padding: 20px;} table { border-collapse: collapse; } td, th { border: 1px solid #ddd; }</style>');
        statsWindow.document.write('</head><body>');
        statsWindow.document.write(reportHtml);
        statsWindow.document.write('<br><div style="margin-top: 20px;">');
        statsWindow.document.write('<button onclick="window.opener.exportAsCSV()" style="padding: 10px; background-color: #4CAF50; color: white; border: none; cursor: pointer; margin-right: 10px;">Excel/CSV Export</button>');
        statsWindow.document.write('<button onclick="window.close()" style="padding: 10px; background-color: #f44336; color: white; border: none; cursor: pointer;">Schließen</button>');
        statsWindow.document.write('</div></body></html>');
        statsWindow.document.close();
    } else {
        alert("Pop-up konnte nicht geöffnet werden. Bitte Pop-up-Blocker prüfen!");
    }
}

// ===================================================================
// === AKTIONSLOGIK: SELECT & RENDER ===
// ===================================================================

function selectPlayer(playerId) {
    if (selectedPlayerId === playerId) {
        selectedPlayerId = null; // Deselektieren
    } else {
        selectedPlayerId = playerId;
    }
    // Zustand der Aktionen zurücksetzen, wenn der Spieler wechselt/deselektiert wird
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

    // --- Ebene 1: Hauptaktion wurde geklickt ---
    if (category !== null && UNTERAKTIONEN[category]) {
        // Hauptaktion merken und zur Unteraktions-Auswahl wechseln
        selectedPrimaryAction = actionType;
        selectedPrimaryActionCategory = category;
        updateUI();
        
    // --- Ebene 2: Unteraktion oder Einzelaktion ohne Untermenü wurde geklickt ---
    } else {
        let finalActionType;
        let finalActionLabel;

        // Fall 1: Unteraktion wurde geklickt (Wir haben eine vorgemerkte Hauptaktion)
        if (selectedPrimaryAction && selectedPrimaryActionCategory) {
            // Die endgültige Aktion zusammenfügen (z.B. 'WurfTor_Aussen')
            finalActionType = `${selectedPrimaryAction}_${actionType}`;
            
            const primaryAction = HAUPTAKTIONEN.find(a => a.typ === selectedPrimaryAction);
            const subAction = UNTERAKTIONEN[selectedPrimaryActionCategory].find(a => a.typ === actionType);
            
            finalActionLabel = `${primaryAction.label} (${subAction.label})`;

        // Fall 2: Einzelaktion ohne Untermenü wurde geklickt (z.B. 'TechnischerFehler')
        } else {
            finalActionType = actionType;
            finalActionLabel = HAUPTAKTIONEN.find(a => a.typ === actionType).label;
        }
        
        // AKTION SPEICHERN (inkl. Reset des selectedPlayerId)
        saveAction(player, finalActionType, finalActionLabel);
    }
}

function resetActionSelection() {
    selectedPrimaryAction = null;
    selectedPrimaryActionCategory = null;
    updateUI();
}

function updateUI() {
    renderPlayerList();
    renderActionButtons();
    updateTimerDisplay(); 
}

// ===================================================================
// === RENDERING UI ===
// ===================================================================

/**
 * Rendert entweder die Spielerliste oder die Verwaltungsansicht.
 */
function renderPlayerList() {
    if (!playerListElement) return;
    
    // NEU: Header-Struktur aufgeräumt
    // - "Spieler verwalten" entfernt (ist ja im Header)
    // - Flexbox-Layout vorbereitet: Titel links, Sortierung rechts
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
            <div class="stats">
                <span class="stat-item green">⚽ ${stats.tore}</span> | 
                <span class="stat-item red">❌ ${stats.fehler}</span> |
                <span class="stat-item yellow">🧤 ${stats.paraden}</span>
            </div>
        `;
        playerListElement.appendChild(playerButton);
    });
}

/**
 * Rendert das Panel zur Spieler-Verwaltung direkt in #player-list.
 */
function renderManagementPanel() {
    if (!playerListElement) return;
    
    // HTML für Formulare und Liste einfügen
    let html = '<h2>Spielerverwaltung</h2>';
    
    // --- Formular zum Hinzufügen ---
    html += `
        <div class="management-form" style="padding: 10px; border: 1px solid #ccc; margin-bottom: 20px;">
            <h4>Spieler hinzufügen</h4>
            <input type="text" id="playerName" placeholder="Name" required style="width: 90%; margin-bottom: 5px;">
            <input type="number" id="playerNumber" placeholder="Rückennummer" required style="width: 90%; margin-bottom: 5px;">
            <input type="text" id="playerPosition" placeholder="Position (z.B. LA, TW)" required style="width: 90%; margin-bottom: 10px;">
            <button onclick="addPlayer()" style="background-color: #4CAF50; color: white; padding: 10px; border: none; width: 95%;">Spieler hinzufügen</button>
        </div>
    `;
    
    // --- Liste der aktuellen Spieler ---
    html += '<h4>Aktuelle Spieler löschen</h4>';
    SPIELER.forEach(p => {
        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding: 5px 0;">
                <span>#${p.nummer} ${p.name} (${p.position})</span>
                <button onclick="removePlayer('${p.id}')" style="background-color: #f44336; color: white; padding: 5px; border: none; font-size: 0.8em;">Löschen</button>
            </div>
        `;
    });
    
    html += `<hr><button onclick="showPlayerManagement(false)" style="padding: 10px; width: 100%; margin-top: 10px;">← Zurück zur Spielerliste</button>`;
    
    playerListElement.innerHTML = html;
}

function renderActionButtons() {
    if (!actionPanelElement || !actionTitleElement) return;
    actionPanelElement.innerHTML = ''; 

    let buttonsToRender = [];
    let titleText = "Aktion (Nach Spieler-Wahl)";

    // Fall 1: Unteraktions-Menü anzeigen
    if (selectedPrimaryActionCategory && UNTERAKTIONEN[selectedPrimaryActionCategory]) {
        buttonsToRender = UNTERAKTIONEN[selectedPrimaryActionCategory];
        
        // Titel anpassen
        const primaryActionLabel = HAUPTAKTIONEN.find(a => a.typ === selectedPrimaryAction).label;
        titleText = `Unteraktion: ${primaryActionLabel}`;

        // "Zurück"-Button hinzufügen
        const backButton = document.createElement('button');
        backButton.className = 'action-button back-button';
        backButton.innerText = '← Zurück zu Aktionen';
        backButton.onclick = resetActionSelection;
        actionPanelElement.appendChild(backButton);
        
        // Hier den Titel neu einfügen
        actionPanelElement.appendChild(actionTitleElement);


    // Fall 2: Hauptaktions-Menü anzeigen
    } else {
        buttonsToRender = HAUPTAKTIONEN;
        actionPanelElement.appendChild(actionTitleElement);
    }

    // Titel aktualisieren
    actionTitleElement.innerText = titleText;
    

    // Buttons rendern
    buttonsToRender.forEach(action => {
        const button = document.createElement('button');
        
        const isSelected = action.typ === selectedPrimaryAction;
        
        let baseClass = action.category ? action.farbe : 'neutral'; 
        if (selectedPrimaryActionCategory) {
            // Bei Unteraktionen nur eine neutrale Klasse verwenden (Sub-Buttons sind im CSS gefärbt)
            baseClass = 'sub-action'; 
        }
        
        button.className = `action-button ${baseClass} ${isSelected ? 'selected-action' : ''}`;
        button.innerText = action.label;
        
        if (action.category !== undefined) { 
             button.onclick = () => selectAction(action.typ, action.category);
        } else {
             button.onclick = () => selectAction(action.typ);
        }

        actionPanelElement.appendChild(button);
    });
}

// ===================================================================
// === VISUELLES FEEDBACK & ZÄHLER ===
// ===================================================================

function showVisualFeedback(playerId, actionLabel) {
    if (!feedbackOverlay) return;
    const player = SPIELER.find(p => p.id === playerId);

    if (!player) return;

    feedbackOverlay.innerText = `${player.nummer} - ${player.name}:\n${actionLabel}`;
    feedbackOverlay.classList.add('show');
    
    // Das visuelle Feedback (grünes Fenster) verschwindet nach 1,5 Sekunden
    setTimeout(() => {
        feedbackOverlay.classList.remove('show');
    }, 1500);
}

function updateActionCount() {
    const aktionen = loadActions();
    document.getElementById("action-count").innerText = aktionen.length;
}

// ===================================================================
// === TIMER & SPIELZUSTAND LOGIK ===
// ===================================================================

function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateTimerDisplay() {
    document.getElementById("game-timer").innerText = formatTime(spielzeitSekunden);
    document.getElementById("timer-btn").innerText = isTimerRunning ? "⏸️ Pause" : "▶️ Start Spiel";
    
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
    document.getElementById("game-info").querySelector('h2').innerText = 
        `Aktuelles Spiel: ... (${currentHalf}. Halbzeit)`;
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
             document.getElementById("timer-btn").innerText = "▶️ Start Spiel (Weiter)";
        }
        updateTimerDisplay();
    }
}

function toggleEndHalfOrGame() {
    // Hier die Logik für Halbzeit / Spielende einfügen
    if (isTimerRunning) toggleGameTimer();
    
    if (currentHalf === 1) {
        alert("Erste Halbzeit beendet. Jetzt Pause und dann 'Start Spiel' für die 2. Halbzeit.");
        currentHalf = 2;
    } else {
        endGame();
    }
    saveGameState();
    updateUI();
}

function endGame() {
    if (isTimerRunning) toggleGameTimer();
    
    if (!confirm("Spiel beendet? Alle erfassten Aktionen und der Spielstand werden gelöscht. (Statistik vorher exportieren!)")) return;
    
    // Globale Variablen zurücksetzen
    spielzeitSekunden = 0;
    currentHalf = 1;
    isTimerRunning = false;
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    localStorage.removeItem("gameState");
    localStorage.removeItem("aktionen");
    
    alert("Spiel beendet und Daten zurückgesetzt.");
    updateUI();
}

// Diese Funktion steuert das Ein- und Ausblenden des Overlays
function togglePlayerManagement() {
    const mainApp = document.getElementById("app-container");
    const managementView = document.getElementById("player-management-view");

    // Prüfen, ob das Overlay gerade unsichtbar ist
    if (managementView.style.display === 'none' || managementView.style.display === '') {
        // -> ÖFFNEN (Verwaltung zeigen)
        mainApp.style.display = 'none';       
        managementView.style.display = 'block'; 
        
        // WICHTIG: Liste laden, damit man auch wen löschen kann
        renderRosterList(); 
    } else {
        // -> SCHLIESSEN (Zurück zum Spiel)
        managementView.style.display = 'none'; 
        mainApp.style.display = 'flex';       
        
        // WICHTIG: Hauptansicht aktualisieren (falls Namen geändert wurden)
        updateUI(); 
    }
}

// Diese Funktion füllt die Liste im "Spieler verwalten"-Overlay
function renderRosterList() {
    const rosterList = document.getElementById("roster-list");
    if (!rosterList) return;

    rosterList.innerHTML = ''; // Liste leeren
    sortPlayers(); // Sortieren, damit es ordentlich aussieht

    SPIELER.forEach(p => {
        const li = document.createElement("li");
        // Styling direkt hier für schnelle Ergebnisse
        li.style.display = "flex";
        li.style.justifyContent = "space-between";
        li.style.padding = "10px";
        li.style.borderBottom = "1px solid #eee";
        
        li.innerHTML = `
            <span>#${p.nummer} ${p.name} (${p.position})</span>
            <button onclick="removePlayer('${p.id}')" style="background-color: #f44336; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Löschen</button>
        `;
        rosterList.appendChild(li);
    });
}

// Angepasste Add-Funktion für das Overlay
function addPlayer() {
    const name = document.getElementById("input-name").value;
    const number = parseInt(document.getElementById("input-number").value);
    const position = document.getElementById("input-position").value; // ID im HTML prüfen!

    if (!name || isNaN(number)) {
        alert("Bitte Name und Nummer angeben.");
        return;
    }

    const newPlayer = {
        id: 'p' + Date.now(),
        name: name,
        nummer: number,
        position: position || "N/A"
    };

    SPIELER.push(newPlayer);
    savePlayers();
    
    // Inputs leeren
    document.getElementById("input-name").value = "";
    document.getElementById("input-number").value = "";
    
    // Wichtig: Liste im Overlay sofort aktualisieren
    renderRosterList();
}

// Angepasste Remove-Funktion für das Overlay
function removePlayer(playerId) {
    if (!confirm("Spieler wirklich löschen?")) return;
    
    // Robuster Vergleich (String vs String)
    SPIELER = SPIELER.filter(p => String(p.id) !== String(playerId));
    savePlayers();
    
    // Wenn der gelöschte Spieler gerade im Spiel ausgewählt war, Auswahl aufheben
    if (selectedPlayerId && String(selectedPlayerId) === String(playerId)) {
        selectedPlayerId = null;
    }
    
    // Wichtig: Liste im Overlay sofort aktualisieren
    renderRosterList();
}