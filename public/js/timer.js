// ===================================================================
// TIMER & GAME STATE LOGIC
// ===================================================================
// Die Spieluhr rechnet mit Zeitstempeln, nicht mit gezaehlten Ticks.
//
// Frueher: setInterval(... , 1000) und spielzeitSekunden++.
// Mobile Browser drosseln Intervalle im Hintergrund-Tab auf ca. 1x/Minute;
// nach ein paar Minuten Sperrbildschirm ging die Uhr deutlich nach.
//
// Jetzt: accumulatedMs + (jetzt - startedAt). Das Interval dient nur noch
// dem Neuzeichnen - egal wie oft es feuert, der angezeigte Wert stimmt.
// ===================================================================

const CLOCK_KEY = 'ht_clock_v2';
const LEGACY_CLOCK_KEY = 'gameState';

let clock = {
    accumulatedMs: 0,   // gesicherte Spielzeit aus abgeschlossenen Laufphasen
    startedAt: null,    // Date.now() beim Start, null wenn pausiert
    half: 1
};

let displayInterval = null;
let lastPlaytimeSeconds = 0;

// ---------------------------------------------------------------
// Kern: Zeitberechnung
// ---------------------------------------------------------------

function elapsedMs() {
    return clock.accumulatedMs + (clock.startedAt ? Date.now() - clock.startedAt : 0);
}

function elapsedSeconds() {
    return Math.floor(elapsedMs() / 1000);
}

function isRunning() {
    return clock.startedAt !== null;
}

function formatTime(totalSeconds) {
    const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ---------------------------------------------------------------
// Persistenz (rein lokal - die Uhr gehoert zum Geraet, nicht zum Server)
// ---------------------------------------------------------------

function saveGameState() {
    try {
        localStorage.setItem(CLOCK_KEY, JSON.stringify(clock));
    } catch (e) {
        console.error('[Timer] Konnte Uhr nicht speichern', e);
    }
}

function loadGameState() {
    let loaded = null;
    try {
        loaded = JSON.parse(localStorage.getItem(CLOCK_KEY));
    } catch (e) { /* ignorieren */ }

    if (loaded && typeof loaded.accumulatedMs === 'number') {
        clock = {
            accumulatedMs: loaded.accumulatedMs,
            startedAt: loaded.startedAt || null,
            half: loaded.half || 1
        };

        // Die Uhr lief beim letzten Mal noch. Das ist der ehrliche Zustand
        // (die Halbzeit lief ja weiter), kann aber auch heissen, dass der
        // Browser einfach zu war. Deshalb Hinweis + Korrekturmoeglichkeit.
        if (clock.startedAt) {
            const gapSeconds = Math.floor((Date.now() - clock.startedAt) / 1000);
            if (gapSeconds > 60 && window.Toast) {
                window.Toast(
                    `Spieluhr lief weiter (+${formatTime(gapSeconds)}). Stimmt das nicht, Zeit antippen.`,
                    { type: 'warn', duration: 9000 }
                );
            }
        }
    } else {
        // Einmalige Migration vom alten Format
        try {
            const legacy = JSON.parse(localStorage.getItem(LEGACY_CLOCK_KEY));
            if (legacy && typeof legacy.spielzeit === 'number') {
                clock = { accumulatedMs: legacy.spielzeit * 1000, startedAt: null, half: legacy.halbzeit || 1 };
                localStorage.removeItem(LEGACY_CLOCK_KEY);
                saveGameState();
            }
        } catch (e) { /* ignorieren */ }
    }

    lastPlaytimeSeconds = elapsedSeconds();
    if (isRunning()) startDisplayLoop();
    updateTimerDisplay();
}

// ---------------------------------------------------------------
// Anzeige
// ---------------------------------------------------------------

function updateTimerDisplay() {
    const timerEl = document.getElementById("game-timer");
    if (timerEl) timerEl.innerText = formatTime(elapsedSeconds());

    const btn = document.getElementById("timer-btn");
    if (btn) btn.innerText = isRunning() ? "⏸️ Pause" : "▶️ Start";

    const endBtn = document.getElementById("half-end-btn");
    if (endBtn) {
        if (clock.half === 2) {
            endBtn.innerText = "🏁 Spiel Beenden";
            endBtn.classList.add('end-game');
        } else {
            endBtn.innerText = "⏸️ Halbzeit";
            endBtn.classList.remove('end-game');
        }
    }
}

function startDisplayLoop() {
    if (displayInterval) return;
    // 500 ms: die Anzeige bleibt fluessig, und selbst wenn der Browser
    // drosselt, wird beim naechsten Tick der korrekte Wert gerechnet.
    displayInterval = setInterval(tick, 500);
}

function stopDisplayLoop() {
    clearInterval(displayInterval);
    displayInterval = null;
}

function tick() {
    updateTimerDisplay();

    const nowSeconds = elapsedSeconds();
    const delta = nowSeconds - lastPlaytimeSeconds;
    if (delta > 0 && window.Store && window.Store.tickPlaytime) {
        lastPlaytimeSeconds = nowSeconds;
        const needsRedraw = window.Store.tickPlaytime(delta, nowSeconds);
        if (needsRedraw && window.UI) window.UI.updateUI();
    } else if (delta < 0) {
        lastPlaytimeSeconds = nowSeconds;
    }
}

// Nach Sperrbildschirm / Tab-Wechsel sofort nachziehen, statt auf den
// naechsten (gedrosselten) Tick zu warten.
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && isRunning()) tick();
});

// ---------------------------------------------------------------
// Steuerung
// ---------------------------------------------------------------

function toggleGameTimer() {
    if (isRunning()) {
        clock.accumulatedMs += Date.now() - clock.startedAt;
        clock.startedAt = null;
        stopDisplayLoop();
        tick();
        if (window.WakeLock) window.WakeLock.release();
        if (window.Sync) window.Sync.flush();
    } else {
        clock.startedAt = Date.now();
        lastPlaytimeSeconds = elapsedSeconds();
        startDisplayLoop();
        // Solange das Spiel laeuft, darf sich das Handy nicht sperren
        if (window.WakeLock) window.WakeLock.enable(true);
    }
    saveGameState();
    updateTimerDisplay();
}

/**
 * Spielzeit manuell setzen (Schiedsrichteruhr weicht ab, App lief im
 * Hintergrund weiter, Fehlbedienung).
 * @param {number} seconds
 */
function setGameTime(seconds) {
    const target = Math.max(0, Math.floor(Number(seconds) || 0));
    clock.accumulatedMs = target * 1000;
    if (isRunning()) clock.startedAt = Date.now();
    lastPlaytimeSeconds = target;
    saveGameState();
    updateTimerDisplay();
    if (window.UI) window.UI.updateUI();
}

function toggleEndHalfOrGame() {
    if (isRunning()) toggleGameTimer();

    if (clock.half === 1) {
        if (confirm("1. Halbzeit beenden?")) {
            clock.half = 2;
        }
    } else {
        endGame();
    }
    saveGameState();

    if (window.UI) window.UI.updateUI();
}

async function endGame() {
    if (!confirm("SPIEL BEENDEN? Das aktuelle Spiel wird ins Archiv verschoben und hier zurückgesetzt.")) return;

    const spieler = window.Store.getSPIELER();
    const aktionen = window.Store.loadActions();

    // Erst sicherstellen, dass der Server den finalen Stand hat,
    // dann archivieren. Sonst landet ein unvollstaendiges Spiel im Archiv.
    try {
        await window.Sync.flush();
    } catch (e) { /* der Archiv-Request traegt die Daten ohnehin selbst */ }

    let archived = false;
    try {
        const res = await fetch('/api/archive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ spieler, aktionen }, window.Store.getTeamNames
                ? { teamHeim: window.Store.getTeamNames().heim, teamGast: window.Store.getTeamNames().gast }
                : {}))
        });
        archived = res.ok;
    } catch (e) {
        archived = false;
    }

    if (!archived) {
        // NICHTS loeschen, solange das Spiel nicht sicher im Archiv liegt.
        if (window.Toast) {
            window.Toast('Archivieren fehlgeschlagen - das Spiel bleibt erhalten. Bitte bei Verbindung erneut beenden.',
                { type: 'error', duration: 10000 });
        } else {
            alert('Archivieren fehlgeschlagen - das Spiel bleibt erhalten.');
        }
        return;
    }

    const resetSpieler = spieler.map(p => Object.assign({}, p, {
        playtimeSeconds: 0,
        suspendedUntilGameTime: null
    }));
    await window.Sync.reset({ spieler: resetSpieler, aktionen: [] });

    clock = { accumulatedMs: 0, startedAt: null, half: 1 };
    lastPlaytimeSeconds = 0;
    stopDisplayLoop();
    saveGameState();

    if (window.UI) {
        window.UI.updateActionCount();
        window.UI.renderHistory();
        window.UI.updateUI();
        window.UI.updateScoreboard();
    }

    if (window.Toast) {
        window.Toast('Spiel archiviert und zurueckgesetzt.', { type: 'success' });
    }
}

function getTimerState() {
    return {
        spielzeitSekunden: elapsedSeconds(),
        currentHalf: clock.half,
        isTimerRunning: isRunning()
    };
}

window.Timer = {
    formatTime,
    updateTimerDisplay,
    toggleGameTimer,
    loadGameState,
    toggleEndHalfOrGame,
    getTimerState,
    setGameTime,
    elapsedSeconds
};
