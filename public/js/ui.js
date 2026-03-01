// ===================================================================
// UI COMPONENTS & STATE
// ===================================================================

let selectedPlayerId = null;
let selectedPrimaryAction = null;
let selectedPrimaryActionCategory = null;
let currentSort = 'nummer';

let tempActionData = null;

const playerListElement = document.getElementById('player-list');
const actionPanelElement = document.getElementById('action-panel');
const actionTitleElement = actionPanelElement ? actionPanelElement.querySelector('h3') : null;
const feedbackOverlay = document.getElementById('feedback-overlay');
const historyPanelElement = document.getElementById('history-panel');

function updateUI() {
    renderPlayerList();
    renderActionButtons();
    if (window.Timer) window.Timer.updateTimerDisplay();
}

function toggleSort(criteria) {
    if (currentSort === criteria) {
        window.Store.getSPIELER().reverse();
    } else {
        currentSort = criteria;
        sortPlayers();
    }
    updateUI();
}

function sortPlayers() {
    const spieler = window.Store.getSPIELER();
    spieler.sort((a, b) => {
        if (currentSort === 'nummer') {
            return a.nummer - b.nummer;
        } else if (currentSort === 'position') {
            return a.position.localeCompare(b.position);
        }
        return 0;
    });
}

function renderPlayerList() {
    if (!playerListElement) return;

    playerListElement.innerHTML = `
        <div class="player-list-header">
            <h3>Spieler</h3>
            <div class="sort-options">
                <span class="sort-label">Sortieren:</span>
                <button onclick="window.UI.toggleSort('nummer')" class="sort-btn ${currentSort === 'nummer' ? 'active-sort' : ''}"># Nr.</button>
                <button onclick="window.UI.toggleSort('position')" class="sort-btn ${currentSort === 'position' ? 'active-sort' : ''}">Pos.</button>
            </div>
        </div>
    `;

    const summaryStats = window.Stats ? window.Stats.getPlayerSummaryStats() : {};
    const spieler = window.Store.getSPIELER();

    spieler.forEach(player => {
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
    const aktionen = window.Store.loadActions();
    const spieler = window.Store.getSPIELER();

    // Create copy for displaying history
    const historyActions = [...aktionen].reverse();

    const aktionenToShow = historyActions.slice(0, 25);

    aktionenToShow.forEach(entry => {
        const player = spieler.find(s => s.id === entry.spielerId);
        const playerNumber = player ? player.nummer : '?';
        const playerName = player ? player.name : 'Unbekannt';

        const assistPlayer = entry.assistId ? spieler.find(p => p.id === entry.assistId) : null;
        const assistText = assistPlayer ? `<br><small style="color:#666">🅰️ Assist: ${assistPlayer.name}</small>` : '';

        const entryElement = document.createElement('div');
        entryElement.className = 'history-entry';

        entryElement.innerHTML = `
            <span class="history-time">${window.Timer ? window.Timer.formatTime(entry.spielzeit) : entry.spielzeit}</span>
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

function updateScoreboard() {
    const aktionen = window.Store.loadActions();
    const spieler = window.Store.getSPIELER();
    let homeGoals = 0;
    let guestGoals = 0;

    aktionen.forEach(action => {
        if (action.typ && action.typ.includes('WurfTor')) {
            const player = spieler.find(p => p.id === action.spielerId);
            if (player) {
                if (window.Store.isGuestTeam(player.name)) {
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

function renderActionButtons() {
    if (!actionPanelElement || !actionTitleElement) return;

    actionPanelElement.innerHTML = '';
    actionPanelElement.appendChild(actionTitleElement);

    let buttonsToRender = [];
    let titleText = "Aktion (Nach Spieler-Wahl)";

    if (selectedPrimaryActionCategory && window.Store.UNTERAKTIONEN[selectedPrimaryActionCategory]) {
        buttonsToRender = window.Store.UNTERAKTIONEN[selectedPrimaryActionCategory];
        const primaryActionLabel = window.Store.HAUPTAKTIONEN.find(a => a.typ === selectedPrimaryAction).label;
        titleText = `Details für: ${primaryActionLabel}`;

        const backButton = document.createElement('button');
        backButton.className = 'action-button back-button';
        backButton.innerText = '← Zurück zu Aktionen';
        backButton.onclick = resetActionSelection;
        actionTitleElement.insertAdjacentElement('afterend', backButton);

    } else {
        buttonsToRender = window.Store.HAUPTAKTIONEN;
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
    const player = window.Store.getSPIELER().find(p => p.id === selectedPlayerId);

    if (category !== null && window.Store.UNTERAKTIONEN[category]) {
        selectedPrimaryAction = actionType;
        selectedPrimaryActionCategory = category;
        updateUI();

    } else {
        let finalActionType;
        let finalActionLabel;
        let finalCategory = category;

        if (selectedPrimaryAction && selectedPrimaryActionCategory) {
            finalActionType = `${selectedPrimaryAction}_${actionType}`;

            const primaryAction = window.Store.HAUPTAKTIONEN.find(a => a.typ === selectedPrimaryAction);
            const subAction = window.Store.UNTERAKTIONEN[selectedPrimaryActionCategory].find(a => a.typ === actionType);

            finalActionLabel = `${primaryAction.label} (${subAction.label})`;
            finalCategory = selectedPrimaryActionCategory;

        } else {
            const primaryAction = window.Store.HAUPTAKTIONEN.find(a => a.typ === actionType);
            finalActionType = actionType;
            finalActionLabel = primaryAction ? primaryAction.label : actionType;

            if (!finalCategory && primaryAction) {
                finalCategory = primaryAction.category;
            }
        }

        handleActionFlow(player, finalActionType, finalActionLabel, finalCategory);
    }
}

function resetActionSelection() {
    selectedPrimaryAction = null;
    selectedPrimaryActionCategory = null;
    updateUI();
}

function handleActionFlow(player, finalActionType, finalActionLabel, category) {
    const timerState = window.Timer ? window.Timer.getTimerState() : { isTimerRunning: false };

    if (!timerState.isTimerRunning) {
        alert("▶️ Der Spiel-Timer ist gestoppt oder pausiert. Bitte zuerst starten!");
        return;
    }

    const isGoal = finalActionType.includes('WurfTor');
    const isEnemy = window.Store.isGuestTeam(player.name);

    if (isGoal && !isEnemy) {
        tempActionData = {
            player: player,
            typ: finalActionType,
            label: finalActionLabel,
            category: category
        };
        showAssistOverlay();
    } else {
        executeSaveAction(player, finalActionType, finalActionLabel, category, null);
    }
}

function executeSaveAction(player, actionType, actionLabel, category, assistId) {
    const aktionen = window.Store.loadActions();
    const timerState = window.Timer ? window.Timer.getTimerState() : { spielzeitSekunden: 0, currentHalf: 1 };

    const newAction = {
        id: Date.now(),
        spielId: "current_match",
        spielerId: player.id,
        assistId: assistId,
        typ: actionType,
        label: actionLabel,
        category: category || "Unbekannt",
        halbzeit: timerState.currentHalf,
        spielzeit: timerState.spielzeitSekunden,
        timestamp: Date.now()
    };

    aktionen.push(newAction);
    window.Store.saveActions(aktionen);

    updateActionCount();
    renderHistory();
    updateScoreboard();

    // Hook to broadcast to WhatsApp
    if (window.WhatsAppMod && typeof window.WhatsAppMod.broadcastEvent === 'function') {
        const homeScore = document.getElementById('score-home').innerText;
        const guestScore = document.getElementById('score-guest').innerText;
        window.WhatsAppMod.broadcastEvent(newAction, player, assistId, `${homeScore}:${guestScore}`);
    }

    selectedPlayerId = null;
    selectedPrimaryAction = null;
    selectedPrimaryActionCategory = null;
    updateUI();
}

function undoLastAction() {
    if (!confirm("Letzte Aktion rückgängig machen?")) return;

    const aktionen = window.Store.loadActions();
    if (aktionen.length === 0) {
        alert("Keine Aktionen zum Löschen.");
        return;
    }

    const lastAction = aktionen.pop();
    window.Store.saveActions(aktionen);

    const player = window.Store.getSPIELER().find(s => s.id === lastAction.spielerId);
    const actionLabel = lastAction.label || lastAction.typ;

    updateActionCount();
    renderHistory();
    updateScoreboard();
    updateUI();

    alert(`RÜCKGÄNGIG: ${player ? player.nummer : '?'} (${actionLabel})`);
}

function updateActionCount() {
    const aktionen = window.Store.loadActions();
    const el = document.getElementById("action-count");
    if (el) el.innerText = aktionen.length;
}

function showAssistOverlay() {
    const overlay = document.getElementById('assist-overlay');
    const list = document.getElementById('assist-list');

    if (!overlay || !list) return;

    list.innerHTML = '';
    const spieler = window.Store.getSPIELER();

    spieler.forEach(p => {
        const isEnemy = window.Store.isGuestTeam(p.name);
        if (p.id !== selectedPlayerId && !isEnemy) {
            const btn = document.createElement('button');
            btn.innerHTML = `<strong>${p.nummer}</strong><br>${p.name}`;
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

// MANAGEMENT / ROSTER
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

    const spieler = window.Store.getSPIELER();
    spieler.forEach(p => {
        const li = document.createElement("li");
        li.innerHTML = `
            <span>#${p.nummer} ${p.name} (${p.position})</span>
            <button onclick="window.UI.removePlayer('${p.id}')">Löschen</button>
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

    window.Store.addPlayerToStore(name, number, posEl.value);

    nameEl.value = "";
    numEl.value = "";
    renderRosterList();
}

function removePlayer(playerId) {
    if (!confirm("Wirklich löschen?")) return;
    window.Store.removePlayerFromStore(playerId);
    if (selectedPlayerId && String(selectedPlayerId) === String(playerId)) {
        selectedPlayerId = null;
    }
    renderRosterList();
}

window.UI = {
    updateUI,
    renderHistory,
    updateScoreboard,
    undoLastAction,
    updateActionCount,
    toggleSort,
    selectPlayer,
    selectAction,
    resetActionSelection,
    confirmAssist,
    closeAssistOverlay,
    togglePlayerManagement,
    addPlayer,
    removePlayer
};
