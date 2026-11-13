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

// ---------------------------------------------------------------
// Phasen und die eine Haupttaste
// ---------------------------------------------------------------
// Die Haupttaste zeigt immer den NAECHSTEN Schritt. Was sie zeigt und was sie
// tut, kommt aus derselben Funktion (hauptAktion) - so kann die Beschriftung
// nie etwas anderes versprechen als der Tipp bewirkt.

/** Spielzeit (s), bei der die Halbzeit bzw. das Spiel nach Plan endet. */
function zielSekunden() {
    return (clock.phase === 'hz2' || clock.phase === 'ende' ? 2 : 1) * clock.halbzeitSekunden;
}

function inHalbzeit() {
    return clock.phase === 'hz1' || clock.phase === 'hz2';
}

/** Ist die Planzeit der laufenden Halbzeit erreicht? Nur Anzeige - die Uhr laeuft weiter. */
function planzeitErreicht() {
    return inHalbzeit() && elapsedSeconds() >= zielSekunden();
}

/**
 * @returns {{ art: string, text: string, primaer: boolean }}
 */
function hauptAktion() {
    switch (clock.phase) {
        case 'vor':
            return { art: 'anpfiff', text: 'Anpfiff', primaer: true };
        case 'hz1':
        case 'hz2': {
            const endeArt = clock.phase === 'hz1' ? 'halbzeit' : 'abpfiff';
            const endeText = clock.phase === 'hz1' ? 'Halbzeit' : 'Abpfiff';
            if (isRunning()) {
                return planzeitErreicht()
                    ? { art: endeArt, text: endeText, primaer: true }
                    : { art: 'unterbrechen', text: 'Unterbrechen', primaer: false };
            }
            // Steht die Uhr jenseits der Planzeit, ohne dass jemand sie angehalten
            // hat (etwa nach "Zurueck in die 1. Halbzeit"), ist der naechste
            // Schritt der Pfiff. Nur wer sie selbst angehalten hat (Unterbrechen,
            // Auszeit), bekommt "Weiter".
            if (planzeitErreicht() && !clock.angehalten) {
                return { art: endeArt, text: endeText, primaer: true };
            }
            return { art: 'weiter', text: 'Weiter', primaer: true };
        }
        case 'pause':
            return { art: 'anpfiff2', text: 'Anpfiff 2. Halbzeit', primaer: true };
        default:
            return { art: 'archivieren', text: 'Spiel archivieren', primaer: true };
    }
}

function hauptknopf() {
    switch (hauptAktion().art) {
        case 'anpfiff': anpfiff(); break;
        case 'unterbrechen': unterbrechen(); break;
        case 'weiter': weiter(); break;
        case 'halbzeit': halbzeit(); break;
        case 'anpfiff2': anpfiff2(); break;
        case 'abpfiff': abpfiff(); break;
        case 'archivieren':
            if (window.UI) window.UI.archivierenStarten();
            break;
    }
}

function uhrStarten() {
    if (isRunning()) return;
    clock.startedAt = Date.now();
    clock.angehalten = false;
    lastPlaytimeSeconds = elapsedSeconds();
    startDisplayLoop();
    // Solange das Spiel laeuft, darf sich das Handy nicht sperren
    if (window.WakeLock) window.WakeLock.enable(true);
}

function uhrStoppen() {
    if (!isRunning()) return;
    clock.accumulatedMs += Date.now() - clock.startedAt;
    clock.startedAt = null;
    if (window.WakeLock) window.WakeLock.release();
}

/** Nach jedem Schritt: sichern, Anzeige und Feld nachziehen. */
function schrittFertig(sichern) {
    saveGameState();
    if (!isRunning() && !clock.auszeit) stopDisplayLoop();
    tick();
    updateTimerDisplay();
    if (window.UI) window.UI.updateUI();
    if (sichern && window.Sync) window.Sync.flush();
}

function wechslePhase(phase) {
    clock.phase = phase;
    clock.half = (phase === 'vor' || phase === 'hz1') ? 1 : 2;
}

function merkeVorher() {
    clock.vorher = { phase: clock.phase, accumulatedMs: elapsedMs(), half: clock.half };
}

function anpfiff() {
    if (clock.phase !== 'vor') return;
    wechslePhase('hz1');
    uhrStarten();
    schrittFertig(false);
}

function unterbrechen() {
    if (!isRunning()) return;
    uhrStoppen();
    clock.angehalten = true;
    schrittFertig(true);
}

function weiter() {
    if (isRunning() || !inHalbzeit()) return;
    // Mit "Weiter" ist die Auszeit vorbei, egal wie viel von der Minute uebrig war
    clock.auszeit = null;
    uhrStarten();
    schrittFertig(false);
}

/**
 * Halbzeit. Die Uhr haelt an und rastet auf die Halbzeitlaenge ein, wenn sie
 * dort oder dahinter steht (der Pfiff kam nach der Anzeige). Steht sie davor
 * (Halbzeit vorzeitig), behaelt sie ihren Wert; die zweite Halbzeit beginnt
 * dann trotzdem bei der vollen Halbzeitlaenge, denn Handballuhren laufen durch.
 */
function halbzeit() {
    if (clock.phase !== 'hz1') return;
    merkeVorher();
    uhrStoppen();
    const ziel = clock.halbzeitSekunden * 1000;
    if (clock.accumulatedMs >= ziel) clock.accumulatedMs = ziel;
    clock.auszeit = null;
    clock.angehalten = false;
    wechslePhase('pause');
    lastPlaytimeSeconds = elapsedSeconds();
    schrittFertig(true);
}

/** Zurueck aus der Pause in die 1. Halbzeit: gestoppt, mit dem Wert von vor dem Tipp. */
function zurueckInHalbzeit1() {
    if (clock.phase !== 'pause') return;
    const v = clock.vorher;
    wechslePhase('hz1');
    if (v && v.phase === 'hz1') clock.accumulatedMs = v.accumulatedMs;
    clock.vorher = null;
    clock.angehalten = false;
    lastPlaytimeSeconds = elapsedSeconds();
    schrittFertig(true);
}

function anpfiff2() {
    if (clock.phase !== 'pause') return;
    wechslePhase('hz2');
    // Nach einer vorzeitigen Halbzeit steht die Uhr noch davor: die zweite
    // Halbzeit zaehlt trotzdem ab der vollen Halbzeitlaenge.
    const ziel = clock.halbzeitSekunden * 1000;
    if (clock.accumulatedMs < ziel) clock.accumulatedMs = ziel;
    clock.vorher = null;
    uhrStarten();
    schrittFertig(false);
}

/**
 * Abpfiff: die Uhr haelt an, das Spiel ist aus, aber noch nicht archiviert.
 * Der Schlusspfiff-Eintrag fuer den Ticker entsteht bewusst erst beim
 * Archivieren (endGame) - dort stand er schon immer, und dort ist das Spiel
 * sicher gespeichert.
 */
function abpfiff() {
    if (clock.phase === 'ende') return;
    merkeVorher();
    uhrStoppen();
    const ziel = clock.halbzeitSekunden * 2000;
    if (clock.accumulatedMs >= ziel) clock.accumulatedMs = ziel;
    clock.auszeit = null;
    clock.angehalten = false;
    wechslePhase('ende');
    lastPlaytimeSeconds = elapsedSeconds();
    schrittFertig(true);
}

/** Weiterspielen nach einem Abpfiff: zurueck in die Phase davor, gestoppt, mit dem alten Wert. */
function weiterspielen() {
    if (clock.phase !== 'ende') return;
    const v = clock.vorher;
    if (v) {
        wechslePhase(v.phase);
        clock.accumulatedMs = v.accumulatedMs;
    } else {
        wechslePhase('hz2');
    }
    clock.vorher = null;
    clock.angehalten = false;
    lastPlaytimeSeconds = elapsedSeconds();
    schrittFertig(true);
}

/** Menue "Halbzeit vorzeitig" / "Abpfiff vorzeitig": dieselben Schritte wie die Haupttaste. */
function vorzeitig(art) {
    if (art === 'halbzeit') halbzeit();
    else if (art === 'abpfiff') abpfiff();
}

/**
 * Menue "Spiel beenden und archivieren": erst Abpfiff, dann die Rueckfrage.
 * Bricht man dort ab, bleibt es beim Abpfiff - "Weiterspielen" macht ihn rueckgaengig.
 */
async function spielBeendenUndArchivieren() {
    if (clock.phase !== 'ende') abpfiff();
    return endGame();
}

// ---------------------------------------------------------------
// Auszeit
// ---------------------------------------------------------------

/** Verbleibende Sekunden der laufenden Auszeit, null wenn keine laeuft. */
function auszeitRest() {
    if (!clock.auszeit) return null;
    return Math.max(0, Math.ceil((clock.auszeit.bisMs - Date.now()) / 1000));
}

/** Auszeit-Taste: Uhr sofort anhalten, dann fragt das Sheet, wer sie nimmt. */
function auszeitOeffnen() {
    if (!inHalbzeit()) return;
    if (isRunning()) {
        uhrStoppen();
        clock.angehalten = true;
        schrittFertig(true);
    } else {
        clock.angehalten = true;
        saveGameState();
        updateTimerDisplay();
    }
    if (window.UI) window.UI.zeigeAuszeitWahl();
}

/** Auszeit eintragen. @param {'heim'|'gast'} team */
function auszeitEintragen(team) {
    if (!inHalbzeit() || (team !== 'heim' && team !== 'gast')) return null;
    const s = window.Sync.getState();
    const jetzt = Date.now();
    // Die spielId gehoert in jede Marken-id: sonst gilt eine Auszeit im
    // naechsten Spiel als "schon bekannt" (Merkzettel des Servers).
    const marke = {
        id: 'auszeit-' + (s.spielId || 'spiel') + '-' + jetzt,
        art: 'auszeit',
        team: team,
        halbzeit: clock.half,
        spielzeit: elapsedSeconds(),
        timestamp: jetzt
    };
    window.Store.addMarke(marke);
    clock.auszeit = { team: team, bisMs: jetzt + AUSZEIT_SEKUNDEN * 1000, markeId: marke.id };
    clock.angehalten = true;
    saveGameState();
    startDisplayLoop();
    updateTimerDisplay();
    if (window.UI) window.UI.updateScoreboard();
    return marke;
}

/** Auszeit zurueckziehen (Rueckgaengig, Verlauf). Die Uhr bleibt stehen. */
function auszeitEntfernen(markeId) {
    const weg = window.Store.removeMarke(markeId);
    if (clock.auszeit && clock.auszeit.markeId === markeId) {
        clock.auszeit = null;
        saveGameState();
        if (!isRunning()) stopDisplayLoop();
    }
    updateTimerDisplay();
    if (window.UI) window.UI.updateScoreboard();
    return weg;
}

/** Wiederherstellen nach "Rueckgaengig" im Verlauf (die Uhr wird dabei nicht angefasst). */
function auszeitWiederherstellen(marke) {
    return window.Store.addMarke(marke);
}

// ---------------------------------------------------------------
// Anzeige von Status, Taste und Balken
// ---------------------------------------------------------------

function statusText() {
    switch (clock.phase) {
        case 'vor': return { zusatz: '', text: 'Vor dem Spiel' };
        case 'pause': return { zusatz: '', text: 'Halbzeitpause' };
        case 'ende': {
            const st = window.Store && window.Store.getStand ? window.Store.getStand() : null;
            return { zusatz: '', text: 'Spiel beendet' + (st ? ' · ' + st.heim + ':' + st.gast : '') };
        }
        default:
            return {
                zusatz: isRunning() ? '' : 'Unterbrochen · ',
                text: clock.half + '. Halbzeit'
            };
    }
}

/**
 * Was der schmale Hinweisbalken auf dem Feld zeigen soll (null = nichts).
 * Vorrang: laufende Auszeit, dann "Planzeit erreicht", dann der Rueckweg
 * (Pause, Ende).
 */
function getBalken() {
    if (inHalbzeit() && clock.auszeit) {
        const n = window.Store.getTeamNames();
        const rest = auszeitRest();
        return {
            art: 'auszeit',
            name: 'Auszeit ' + (clock.auszeit.team === 'heim' ? n.heim : n.gast),
            vorbei: rest === 0,
            zeit: formatRest(rest)
        };
    }
    if (planzeitErreicht()) {
        return {
            art: 'hinweis',
            text: clock.phase === 'hz1'
                ? formatTime(zielSekunden()) + ' erreicht – Halbzeit, sobald abgepfiffen ist.'
                : 'Spielzeit erreicht – Abpfiff, sobald abgepfiffen ist.'
        };
    }
    if (clock.phase === 'pause') {
        return { art: 'link', text: 'Zurück in die 1. Halbzeit', aktion: 'zurueck' };
    }
    if (clock.phase === 'ende') {
        return { art: 'link', text: 'Weiterspielen', aktion: 'weiterspielen' };
    }
    return null;
}

function formatRest(sekunden) {
    const s = Math.max(0, Math.floor(sekunden || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function linkAktion(aktion) {
    if (aktion === 'zurueck') zurueckInHalbzeit1();
    else if (aktion === 'weiterspielen') weiterspielen();
}

function updateTimerDisplay() {
    const timerEl = document.getElementById("game-timer");
    if (timerEl) timerEl.innerText = formatTime(elapsedSeconds());

    // Das Ziel steht daneben, nicht in der Uhr: "24:10 / 30:00" laesst sich
    // im Vorbeigehen ablesen, ohne nachzurechnen wie lange noch zu spielen ist.
    const zielEl = document.getElementById("timer-target");
    if (zielEl) {
        zielEl.innerText = '/ ' + formatTime(zielSekunden());
        zielEl.classList.toggle('is-over', planzeitErreicht());
    }

    // Die Haupttaste zeigt den naechsten Schritt (siehe hauptAktion)
    const btn = document.getElementById("timer-btn");
    if (btn) {
        const h = hauptAktion();
        if (btn.textContent !== h.text) btn.textContent = h.text;
        btn.classList.toggle('primaer', h.primaer);
        btn.dataset.art = h.art;
    }

    // Auszeit gibt es nur in den Halbzeiten
    const az = document.getElementById("az-btn");
    if (az) az.hidden = !inHalbzeit();

    const zusatzEl = document.getElementById("hz-zusatz");
    const hzEl = document.getElementById("half-indicator");
    if (hzEl) {
        const st = statusText();
        if (zusatzEl) zusatzEl.textContent = st.zusatz;
        const textEl = document.getElementById("hz-text");
        if (textEl) textEl.textContent = st.text;
    }

    if (window.UI && window.UI.refreshBalken) window.UI.refreshBalken();
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

    // Steht die Uhr und laeuft auch keine Auszeit mehr, braucht es kein Neuzeichnen
    if (!isRunning() && (!clock.auszeit || auszeitRest() === 0)) stopDisplayLoop();

    // Die Planzeit meldet nur Hinweisbalken und Taste (updateTimerDisplay).
    // Die Uhr laeuft bewusst WEITER - wann abgepfiffen wird, entscheidet der
    // Schiedsrichter, nicht die App.

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
    if (document.visibilityState === 'visible' && (isRunning() || clock.auszeit)) tick();
});

// ---------------------------------------------------------------
// Steuerung
// ---------------------------------------------------------------

/**
 * Spielzeit manuell setzen (Schiedsrichteruhr weicht ab, App lief im
 * Hintergrund weiter, Fehlbedienung). Aendert nie die Phase.
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

// Rueckgabe: true, wenn das Spiel archiviert UND zurueckgesetzt ist. Die
// Startseite braucht das, um erst danach das Formular fuer ein neues Spiel
// zu oeffnen - bei Abbruch oder Fehler bleibt das laufende Spiel stehen.
//
// opt.bestaetigt: die Rueckfrage ist schon beantwortet (nur dann ueberspringen).
async function endGame(opt) {
    const bestaetigt = !!(opt && opt.bestaetigt);
    if (!bestaetigt) {
        const ok = window.UI && window.UI.frageArchivieren ? await window.UI.frageArchivieren() : false;
        if (!ok) return false;
    }

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
        suspendedUntilGameTime: null,
        sperrePlatz: null
    }));
    // Neue Spielkennung: daran haengen die Ticker-Zeitmarken, damit sie im
    // naechsten Spiel nicht als "schon getickert" gelten. Marken (Zeitmarken,
    // Auszeiten) bleiben absichtlich weg - sie gehoeren zum alten Spiel.
    await window.Sync.reset({ spieler: resetSpieler, aktionen: [], spielId: 'g' + Date.now() });

    clock = normalisiereUhr({
        accumulatedMs: 0, startedAt: null, half: 1, phase: 'vor',
        halbzeitSekunden: clock.halbzeitSekunden
    });
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
    updateTimerDisplay();

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
        phase: clock.phase,
        isTimerRunning: isRunning(),
        halbzeitSekunden: clock.halbzeitSekunden,
        halbzeitEndeSekunden: halbzeitEndeSekunden()
    };
}

window.Timer = {
    formatTime,
    updateTimerDisplay,
    hauptknopf,
    hauptAktion,
    anpfiff,
    loadGameState,
    vorzeitig,
    spielBeendenUndArchivieren,
    endGame,
    getTimerState,
    getBalken,
    linkAktion,
    auszeitOeffnen,
    auszeitEintragen,
    auszeitEntfernen,
    auszeitWiederherstellen,
    auszeitRest,
    formatRest,
    setGameTime,
    elapsedSeconds,
    setHalbzeitLaenge,
    getHalbzeitMinuten
};
