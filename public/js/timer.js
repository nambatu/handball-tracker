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

const STANDARD_HALBZEIT_SEKUNDEN = 30 * 60;

// Spielphasen. Die Phase sagt, WO im Spiel wir sind; ob die Uhr gerade laeuft,
// steht weiter in `startedAt`. Beides getrennt zu halten ist Absicht: in
// `hz1` kann die Uhr stehen (Unterbrechung, Auszeit), ohne dass sich die
// Phase aendert.
//   vor    vor dem Anpfiff
//   hz1    1. Halbzeit
//   pause  Halbzeitpause
//   hz2    2. Halbzeit
//   ende   abgepfiffen, noch nicht archiviert
const PHASEN = ['vor', 'hz1', 'pause', 'hz2', 'ende'];

const AUSZEIT_SEKUNDEN = 60;

let clock = {
    accumulatedMs: 0,   // gesicherte Spielzeit aus abgeschlossenen Laufphasen
    startedAt: null,    // Date.now() beim Start, null wenn pausiert
    half: 1,            // 1 in vor/hz1, 2 ab pause - andere Module lesen das
    phase: 'vor',
    // Stand VOR dem letzten Phasenwechsel (Halbzeit, Abpfiff): damit laesst
    // sich ein versehentlicher Tipp zuruecknehmen, ohne dass Zeit verloren geht.
    vorher: null,       // { phase, accumulatedMs, half }
    // true, wenn die Uhr absichtlich angehalten wurde (Unterbrechen, Auszeit).
    // Nur dann heisst die Taste "Weiter" - auch jenseits der Halbzeitlaenge,
    // wo sie sonst "Halbzeit" hiesse.
    angehalten: false,
    // Laufende Auszeit: nur Anzeige, auf Wanduhrzeit gerechnet
    auszeit: null,      // { team, bisMs, markeId }
    // Laenge EINER Halbzeit. Liegt bewusst bei der Uhr und nicht im
    // synchronisierten Spielstand: die Uhr gehoert zum Geraet, und eine
    // D-Jugend spielt 2x20 waehrend die Erste daneben 2x30 spielt.
    halbzeitSekunden: STANDARD_HALBZEIT_SEKUNDEN
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
        clock = normalisiereUhr(loaded);

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
                clock = normalisiereUhr({ accumulatedMs: legacy.spielzeit * 1000, startedAt: null,
                          half: legacy.halbzeit || 1, halbzeitSekunden: STANDARD_HALBZEIT_SEKUNDEN });
                localStorage.removeItem(LEGACY_CLOCK_KEY);
                saveGameState();
            }
        } catch (e) { /* ignorieren */ }
    }

    lastPlaytimeSeconds = elapsedSeconds();
    if (isRunning() || clock.auszeit) startDisplayLoop();
    updateTimerDisplay();
}

/**
 * Macht aus einer gespeicherten Uhr eine vollstaendige. Aeltere Staende kennen
 * keine Phase: dann wird sie aus dem abgeleitet, was da ist.
 */
function normalisiereUhr(roh) {
    const c = {
        accumulatedMs: roh.accumulatedMs,
        startedAt: roh.startedAt || null,
        half: roh.half === 2 ? 2 : 1,
        phase: roh.phase,
        vorher: null,
        angehalten: !!roh.angehalten,
        auszeit: null,
        halbzeitSekunden: Number(roh.halbzeitSekunden) || STANDARD_HALBZEIT_SEKUNDEN
    };

    if (PHASEN.indexOf(c.phase) === -1) {
        if (!c.startedAt && !c.accumulatedMs) c.phase = 'vor';
        else c.phase = c.half === 2 ? 'hz2' : 'hz1';
    }
    // half muss zur Phase passen, sonst rechnen Aktionen und Ticker falsch
    c.half = (c.phase === 'vor' || c.phase === 'hz1') ? 1 : 2;

    // Eine Uhr, die in pause/ende laeuft, gibt es nicht
    if ((c.phase === 'pause' || c.phase === 'ende' || c.phase === 'vor') && c.startedAt) {
        c.accumulatedMs += Date.now() - c.startedAt;
        c.startedAt = null;
    }

    const v = roh.vorher;
    if (v && PHASEN.indexOf(v.phase) !== -1 && typeof v.accumulatedMs === 'number') {
        c.vorher = { phase: v.phase, accumulatedMs: v.accumulatedMs, half: v.half === 2 ? 2 : 1 };
    }
    const a = roh.auszeit;
    if (a && (a.team === 'heim' || a.team === 'gast') && typeof a.bisMs === 'number') {
        c.auszeit = { team: a.team, bisMs: a.bisMs, markeId: a.markeId || null };
    }
    return c;
}

// ---------------------------------------------------------------
// Anzeige
// ---------------------------------------------------------------

/** Spielzeit, bei der die laufende Halbzeit endet. */
function halbzeitEndeSekunden() {
    return clock.halbzeitSekunden * clock.half;
}

// ---------------------------------------------------------------
// Zeitmarken fuer den Ticker
// ---------------------------------------------------------------
// "Noch 10 Minuten", "Noch 5 Minuten", "Letzte Minute" - nur am
// Spielende, also in der zweiten Halbzeit.
//
// Warum hier und nicht auf dem Server: die Spieluhr laeuft lokal auf dem
// tickernden Geraet. Der Server kennt sie gar nicht - er sieht nur die
// Spielzeit, die an einer Aktion klebt, und faellt zwischen zwei Toren
// in ein Loch. Also erzeugt die Uhr die Marke und schickt sie mit dem
// naechsten Push; der Server macht daraus wie ueblich die Nachricht und
// sorgt fuer Doppler-Sperre, Undo und Frischefenster.

const ZEITMARKEN = [
    { art: 'rest10', restSekunden: 600 },
    { art: 'rest5', restSekunden: 300 },
    { art: 'rest1', restSekunden: 60 }
];

function pruefeZeitmarken() {
    if (!isRunning() || clock.half < 2) return;
    if (!window.Sync || !window.Sync.getState) return;

    const rest = halbzeitEndeSekunden() - elapsedSeconds();
    // Nach dem Abpfiff-Zeitpunkt laeuft die Uhr weiter; dann ist nichts
    // mehr "noch x Minuten" und es soll auch nichts mehr kommen.
    if (rest <= 0) return;

    const s = window.Sync.getState();
    if (!Array.isArray(s.tickerMarken)) s.tickerMarken = [];

    let neu = false;
    ZEITMARKEN.forEach(function (m) {
        if (rest > m.restSekunden) return;
        // Feste id statt Zeitstempel: so kann dieselbe Marke auch nach
        // einem Reload oder auf einem zweiten Geraet nicht doppelt
        // entstehen - der Merkzettel auf dem Server erkennt sie wieder.
        const id = 'marke:' + (s.spielId || 'spiel') + ':' + m.art + ':hz' + clock.half;
        if (s.tickerMarken.some(function (x) { return x.id === id; })) return;
        s.tickerMarken.push({
            id: id,
            art: m.art,
            halbzeit: clock.half,
            spielzeit: elapsedSeconds(),
            timestamp: Date.now()
        });
        neu = true;
    });

    if (neu) window.Sync.touch();
}

function updateTimerDisplay() {
    const timerEl = document.getElementById("game-timer");
    if (timerEl) timerEl.innerText = formatTime(elapsedSeconds());

    // Das Ziel steht daneben, nicht in der Uhr: "24:10 / 30:00" laesst sich
    // im Vorbeigehen ablesen, ohne nachzurechnen wie lange noch zu spielen ist.
    const zielEl = document.getElementById("timer-target");
    if (zielEl) {
        zielEl.innerText = '/ ' + formatTime(halbzeitEndeSekunden());
        zielEl.classList.toggle('is-over', elapsedSeconds() >= halbzeitEndeSekunden());
    }

    // Eine Uhrtaste fuer beides: "Uhr starten" solange sie steht (dann ist sie
    // die Hauptaktion in Blau), "Pause" waehrend sie laeuft.
    const btn = document.getElementById("timer-btn");
    if (btn) {
        btn.textContent = isRunning() ? "Pause" : "Uhr starten";
        btn.classList.toggle('primaer', !isRunning());
    }

    const hzEl = document.getElementById("half-indicator");
    if (hzEl) hzEl.textContent = clock.half + ". Hz";
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
    pruefeZeitmarken();

    // Einmal pro Halbzeit Bescheid geben. Die Uhr laeuft bewusst WEITER -
    // wann abgepfiffen wird, entscheidet der Schiedsrichter, nicht die App.
    if (isRunning() && halbzeitHinweisFuer !== clock.half
        && elapsedSeconds() >= halbzeitEndeSekunden()) {
        halbzeitHinweisFuer = clock.half;
        if (window.Toast) {
            window.Toast(
                (clock.half === 1 ? 'Halbzeit' : 'Spielzeit') + ' erreicht ('
                + formatTime(halbzeitEndeSekunden()) + '). Die Uhr läuft weiter.',
                { type: 'warn', duration: 8000 }
            );
        }
    }

    // Zeitstrafen sekundengenau mitlaufen lassen. Gezielt, nicht ueber
    // einen kompletten Rerender - der wuerde jede Sekunde das Drag&Drop
    // neu aufbauen und sichtbar flackern.
    if (window.UI && window.UI.refreshSuspensions) window.UI.refreshSuspensions();

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

/**
 * Erste Halbzeit beenden. Die Uhr haelt an, die zweite Halbzeit beginnt mit
 * dem naechsten Druck auf "Uhr starten". Das Spiel selbst beendet nur
 * endGame() - ueber das Menue, bewusst nicht mehr als Knopf in der Kopfzeile,
 * wo er mit der Uhr verwechselt werden konnte.
 */
function halbzeitBeenden() {
    if (clock.half !== 1) return;
    if (isRunning()) toggleGameTimer();

    if (confirm("1. Halbzeit beenden?")) {
        clock.half = 2;
        halbzeitHinweisFuer = 0;
    }
    saveGameState();

    updateTimerDisplay();
    if (window.UI) window.UI.updateUI();
}

// Rueckgabe: true, wenn das Spiel archiviert UND zurueckgesetzt ist. Die
// Startseite braucht das, um erst danach das Formular fuer ein neues Spiel
// zu oeffnen - bei Abbruch oder Fehler bleibt das laufende Spiel stehen.
async function endGame() {
    if (!confirm("SPIEL BEENDEN? Das aktuelle Spiel wird ins Archiv verschoben und hier zurückgesetzt.")) return false;

    const spieler = window.Store.getSPIELER();
    const aktionen = window.Store.loadActions();
    // Vor dem Zuruecksetzen merken: reset() leert den Namen mit dem Rest.
    const spielName = window.Store.getSpielName ? window.Store.getSpielName() : null;

    // Erst sicherstellen, dass der Server den finalen Stand hat,
    // dann archivieren. Sonst landet ein unvollstaendiges Spiel im Archiv.
    try {
        await window.Sync.flush();
    } catch (e) { /* der Archiv-Request traegt die Daten ohnehin selbst */ }

    let archived = false;
    let archivDatei = null;
    try {
        const res = await fetch('/api/archive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ spieler, aktionen }, window.Store.getTeamNames
                ? { teamHeim: window.Store.getTeamNames().heim, teamGast: window.Store.getTeamNames().gast }
                : {}))
        });
        archived = res.ok;
        if (res.ok) {
            const antwort = await res.json().catch(function () { return null; });
            archivDatei = antwort && antwort.filename;
        }
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
        return false;
    }

    // Der Spielname aus der Startseite wird zur Beschriftung des Archivs.
    // Scheitert das, ist das Spiel trotzdem sicher archiviert - der Name
    // laesst sich im Archiv nachtragen. Deshalb wird der Fehler bewusst
    // verschluckt.
    if (spielName && archivDatei) {
        try {
            await fetch('/api/archive/' + encodeURIComponent(archivDatei), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: spielName })
            });
        } catch (e) { /* siehe oben */ }
    }

    // Schlusspfiff in den Ticker. Die Reihenfolge ist entscheidend: erst
    // JETZT, nach dem gesicherten Archivieren, aber noch VOR dem
    // Zuruecksetzen - der Server baut die Zusammenfassung aus genau dem
    // Spielstand, der gleich geloescht wird.
    try {
        const s = window.Sync.getState();
        if (!Array.isArray(s.tickerMarken)) s.tickerMarken = [];
        const id = 'marke:' + (s.spielId || 'spiel') + ':ende';
        if (!s.tickerMarken.some(function (m) { return m.id === id; })) {
            s.tickerMarken.push({
                id: id, art: 'ende', halbzeit: clock.half,
                spielzeit: elapsedSeconds(), timestamp: Date.now()
            });
            window.Sync.touch();
            await window.Sync.flush();
        }
    } catch (e) {
        // Ohne Ticker endet das Spiel trotzdem. Das Archiv liegt bereits.
        console.warn('[Ticker] Schlussnachricht nicht abgesetzt:', e && e.message);
    }

    const resetSpieler = spieler.map(p => Object.assign({}, p, {
        playtimeSeconds: 0,
        suspendedUntilGameTime: null
    }));
    // Neue Spielkennung: daran haengen die Ticker-Zeitmarken, damit sie im
    // naechsten Spiel nicht als "schon getickert" gelten.
    await window.Sync.reset({ spieler: resetSpieler, aktionen: [], spielId: 'g' + Date.now() });

    clock = { accumulatedMs: 0, startedAt: null, half: 1, halbzeitSekunden: clock.halbzeitSekunden };
    halbzeitHinweisFuer = 0;
    lastPlaytimeSeconds = 0;
    stopDisplayLoop();
    saveGameState();

    if (window.UI) {
        window.UI.vergissUhrWahl();
        window.UI.updateActionCount();
        window.UI.renderHistory();
        window.UI.updateUI();
        window.UI.updateScoreboard();
    }

    if (window.Toast) {
        window.Toast('Spiel archiviert und zurückgesetzt.', { type: 'success' });
    }
    return true;
}

/**
 * Halbzeitlaenge in Minuten setzen (2x25, 2x30 ...).
 * @param {number} minuten
 */
function setHalbzeitLaenge(minuten) {
    const m = Math.max(1, Math.min(60, Math.round(Number(minuten) || 0)));
    clock.halbzeitSekunden = m * 60;
    halbzeitHinweisFuer = 0;
    saveGameState();
    updateTimerDisplay();

    // Auch in den Sync-Stand schreiben: der Server braucht die Laenge fuer
    // die Ticker-Regel "letzte 5 Minuten". Die Spieluhr selbst bleibt
    // bewusst lokal - sie laeuft auf dem Geraet, das tickt.
    try {
        if (window.Sync && window.Sync.getState) {
            const s = window.Sync.getState();
            if (s.halbzeitSekunden !== clock.halbzeitSekunden) {
                s.halbzeitSekunden = clock.halbzeitSekunden;
                window.Sync.touch();
            }
        }
    } catch (e) { /* ohne Sync laeuft die Uhr trotzdem */ }

    return m;
}

function getHalbzeitMinuten() {
    return Math.round(clock.halbzeitSekunden / 60);
}

function getTimerState() {
    return {
        spielzeitSekunden: elapsedSeconds(),
        currentHalf: clock.half,
        isTimerRunning: isRunning(),
        halbzeitSekunden: clock.halbzeitSekunden,
        halbzeitEndeSekunden: halbzeitEndeSekunden()
    };
}

window.Timer = {
    formatTime,
    updateTimerDisplay,
    toggleGameTimer,
    loadGameState,
    halbzeitBeenden,
    endGame,
    getTimerState,
    setGameTime,
    elapsedSeconds,
    setHalbzeitLaenge,
    getHalbzeitMinuten
};
