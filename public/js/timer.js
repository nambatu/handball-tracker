// ===================================================================
// TIMER & GAME STATE LOGIC
// ===================================================================

let timerInterval = null;
let spielzeitSekunden = 0;
let currentHalf = 1;
let isTimerRunning = false;

function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateTimerDisplay() {
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
            if (btn) btn.innerText = "▶️ Weiter";
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

    // Will need to notify UI module to update
    if (window.UI) window.UI.updateUI();
}

async function endGame() {
    if (!confirm("SPIEL BEENDEN? Das aktuelle Spiel wird ins Archiv verschoben und hier zurückgesetzt.")) return;

    try {
        const spieler = window.Store.getSPIELER();
        const aktionen = window.Store.loadActions();
        
        await fetch('/api/archive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ spieler, aktionen })
        });

        window.Store.saveActions([]); // Leeres Array speichern
        window.UI.renderHistory();

        const homeScoreEl = document.getElementById("score-home");
        const guestScoreEl = document.getElementById("score-guest");
        if (homeScoreEl) homeScoreEl.innerText = "0";
        if (guestScoreEl) guestScoreEl.innerText = "0";

        alert("Spiel erfolgreich ins Archiv verschoben und zurückgesetzt.");
        
        if (window.UI && typeof window.UI.renderHistory === "function") {
            window.UI.renderHistory();
        }
    } catch(e) {
        console.error("Failed to archive game", e);
        alert("Fehler beim Archivieren!");
    }
    
    spielzeitSekunden = 0;
    currentHalf = 1;
    isTimerRunning = false;
    clearInterval(timerInterval);

    localStorage.removeItem("gameState");
    localStorage.removeItem("aktionen");
    localStorage.removeItem("whatsapp_group"); 

    if (window.UI) {
        window.UI.renderHistory();
        window.UI.updateUI();
        window.UI.updateScoreboard();
    }
}

function getTimerState() {
    return {
        spielzeitSekunden,
        currentHalf,
        isTimerRunning
    };
}

window.Timer = {
    formatTime,
    updateTimerDisplay,
    toggleGameTimer,
    loadGameState,
    toggleEndHalfOrGame,
    getTimerState
};
