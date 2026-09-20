// ===================================================================
// UI COMPONENTS & STATE
// ===================================================================

let selectedPlayerId = null;
let selectedPrimaryAction = null;
let selectedPrimaryActionCategory = null;
let currentSort = 'nummer';

let tempActionData = null;
let uhrHinweisGezeigt = false;

const historyPanelElement = document.getElementById('history-panel');

// Die Classic-Ansicht ist aus dem Umschalter entfernt (der Code bleibt aber
// liegen). Wer sie gespeichert hatte, landet automatisch auf Mobile.
const HIDDEN_MODES = ['classic'];
let storedMode = localStorage.getItem('UI_MODE') || 'thumb';
if (HIDDEN_MODES.indexOf(storedMode) !== -1) {
    storedMode = 'thumb';
    try { localStorage.setItem('UI_MODE', storedMode); } catch (e) { /* egal */ }
}
window.UI_MODE = storedMode;

function switchUIMode(mode) {
    window.UI_MODE = mode;
    localStorage.setItem('UI_MODE', mode);
    
    document.querySelectorAll('.view-toggle-container .control-btn').forEach(btn => btn.classList.remove('active-mode'));
    const btn = document.getElementById('btn-mode-' + mode);
    if(btn) btn.classList.add('active-mode');
    
    const container = document.getElementById('app-container');
    if(container) container.className = 'layout-' + mode;
    
    selectedPlayerId = null;
    selectedPrimaryAction = null;
    selectedPrimaryActionCategory = null;
    
    updateUI();
}

/**
 * Neuzeichnen, ohne die Scrollposition zu verlieren.
 *
 * Beim Neuaufbau ist der View-Container kurz leer. Die Seite wird dadurch
 * schlagartig kuerzer, der Browser kappt die Scrollposition auf 0 - und nach
 * jeder erfassten Aktion stand man wieder ganz oben und musste sich zum Feld
 * zurueckscrollen. Deshalb Position merken und direkt wieder setzen.
 */
function mitScrollposition(fn) {
    const app = document.getElementById('app-container');
    const y = window.scrollY || window.pageYOffset || 0;
    const appTop = app ? app.scrollTop : 0;

    fn();

    if (app && app.scrollTop !== appTop) app.scrollTop = appTop;
    if ((window.scrollY || window.pageYOffset || 0) !== y) window.scrollTo(0, y);
}

function updateUI() {
    mitScrollposition(function () {
        renderDynamicView();
        renderGoalkeeperBadge();
        renderTeamNames();
    });
    if (window.Timer) window.Timer.updateTimerDisplay();
}

// ===================================================================
// AKTIVER TORWART
// ===================================================================

/**
 * Die Anzeige in der Kopfzeile ist entfallen - der aktive Torwart ergibt
 * sich aus Position TW. Die Funktion bleibt, weil sie beschriftet, wer
 * gerade gewaehlt ist, sobald der Knopf irgendwo wieder auftaucht.
 */
function renderGoalkeeperBadge() {
    const el = document.getElementById('gk-indicator');
    if (!el) return;

    const gk = window.Store.getActiveGoalkeeper();
    if (!gk) {
        el.innerHTML = '<span class="gk-icon">🧤</span><span class="gk-name">Kein Torwart</span>';
        el.title = 'Kein Spieler auf Position TW. Gegentore lassen sich ohne Torwart nicht zuordnen.';
        el.classList.add('gk-missing');
    } else {
        el.innerHTML = '<span class="gk-icon">🧤</span><span class="gk-name">#' + gk.nummer + ' '
            + escapeHtml(String(gk.name).split(' ')[0]) + '</span><span class="gk-caret">▾</span>';
        el.title = 'Im Tor: ' + gk.name + ' — antippen zum Wechseln. Gegentore und Paraden werden diesem Torwart zugerechnet.';
        el.classList.remove('gk-missing');
    }
}

function openGoalkeeperPicker() {
    const box = document.getElementById('gk-picker');
    const list = document.getElementById('gk-picker-list');
    if (!box || !list) return;

    const keepers = window.Store.getGoalkeepers();
    const activeId = window.Store.getActiveGoalkeeperId();

    list.innerHTML = '';

    if (keepers.length === 0) {
        list.innerHTML = '<p class="gk-empty">Kein Spieler hat die Position TW. '
            + 'Bitte in der Spielerverwaltung einen Torwart anlegen.</p>';
    } else {
        keepers.forEach(function (p) {
            const btn = document.createElement('button');
            btn.className = 'gk-option' + (String(p.id) === String(activeId) ? ' gk-active' : '');
            btn.innerHTML = '<span class="gk-radio">' + (String(p.id) === String(activeId) ? '●' : '○') + '</span>'
                + '<strong>#' + p.nummer + '</strong> ' + escapeHtml(p.name)
                + (p.position !== 'TW' ? ' <em class="gk-hint">(steht auf ' + escapeHtml(p.position) + ')</em>' : '');
            btn.onclick = function () { selectGoalkeeper(p.id); };
            list.appendChild(btn);
        });
    }

    box.style.display = 'flex';
}

function closeGoalkeeperPicker() {
    const box = document.getElementById('gk-picker');
    if (box) box.style.display = 'none';
}

function selectGoalkeeper(playerId) {
    if (window.Store.setActiveGoalkeeper(playerId)) {
        const gk = window.Store.getActiveGoalkeeper();
        closeGoalkeeperPicker();
        renderGoalkeeperBadge();
        if (window.Toast && gk) {
            window.Toast('Im Tor: #' + gk.nummer + ' ' + gk.name, { type: 'success', duration: 2500 });
        }
    }
}

// ===================================================================
// ERFASSUNGS-FEEDBACK
// ===================================================================
// Das grosse Aufblitzen ueber dem halben Bildschirm hat im Spiel mehr
// gestoert als geholfen - es verdeckte genau den Bereich, auf den man
// als naechstes tippen will. Geblieben ist der kurze Vibrationsimpuls:
// der bestaetigt den Tipper, ohne etwas zu verdecken.
// (Auf iOS gibt es navigator.vibrate nicht - dort quittiert der
// Rueckgaengig-Toast die Aktion.)

function feedbackKindFor(actionType) {
    const t = String(actionType || '');
    if (t.includes('WurfTor')) return 'tor';
    if (t.includes('Parade')) return 'parade';
    if (t.includes('Ballverlust') || t.includes('WurfOhneTor')) return 'fehler';
    if (t.includes('Zeitstrafe') || t.includes('Karte')) return 'strafe';
    return 'neutral';
}

function pulseFeedback(kind) {
    try {
        if (navigator.vibrate) navigator.vibrate(kind === 'tor' ? [30, 40, 60] : 35);
    } catch (e) { /* nicht unterstuetzt - egal */ }
}

/** Spielernamen kommen aus Nutzereingaben und landen in innerHTML. */
function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Zieht die Zeitstrafen-Countdowns nach.
 *
 * Vorher lief die Anzeige nur weiter, wenn irgendetwas anderes ein
 * Neuzeichnen ausloeste - im Stillstand blieb sie einfach stehen. Ein
 * kompletter Rerender pro Sekunde kommt nicht in Frage: der wuerde das
 * Drag&Drop neu aufbauen und flackern. Deshalb werden hier nur die
 * betroffenen Kreise angefasst.
 *
 * @returns {boolean} true, wenn mindestens eine Strafe noch laeuft
 */
function refreshSuspensions() {
    const st = window.Timer ? window.Timer.getTimerState() : { spielzeitSekunden: 0 };
    const jetzt = st.spielzeitSekunden;
    const spieler = window.Store.getSPIELER();
    let nochAktiv = false;

    document.querySelectorAll('.player-badge[data-pid]').forEach(function (badge) {
        const p = spieler.find(x => String(x.id) === badge.dataset.pid);
        if (!p) return;

        const bis = p.suspendedUntilGameTime;
        const laeuft = bis !== null && bis !== undefined && jetzt < bis;
        let overlay = badge.querySelector('.badge-suspension');

        if (laeuft) {
            nochAktiv = true;
            const rest = bis - jetzt;
            const m = Math.floor(rest / 60);
            const sek = rest % 60;
            const text = m + ':' + (sek < 10 ? '0' : '') + sek;

            if (!overlay) {
                overlay = document.createElement('span');
                overlay.className = 'badge-suspension';
                badge.appendChild(overlay);
            }
            if (overlay.textContent !== text) overlay.textContent = text;
            badge.classList.add('is-suspended');
        } else {
            if (overlay) overlay.remove();
            badge.classList.remove('is-suspended');
        }
    });

    return nochAktiv;
}

// ---------------------------------------------------------------
// Aktions-Sheet (Court-Ansicht)
// ---------------------------------------------------------------
// Das Menue haengt bewusst NICHT im #dynamic-view-container:
//   - als Flex-Kind hat es dem Spielfeld Hoehe weggenommen, dadurch sind
//     bei jeder Auswahl alle prozentual positionierten Spieler gesprungen;
//   - der Container hat overflow:hidden, auf dem Handy lag das Menue danach
//     komplett ausserhalb des sichtbaren Bereichs ("es geht kein Menue auf").
// Als fixes Bottom-Sheet am <body> kann beides nicht mehr passieren.

const ACTION_SHEET_ID = 'court-action-sheet';

function closeActionSheet() {
    const alt = document.getElementById(ACTION_SHEET_ID);
    if (alt) alt.remove();
    document.documentElement.style.setProperty('--cas-height', '0px');
}

/**
 * Breite/Position des Sheets nachziehen.
 * Auf dem Handy volle Breite (das macht schon das CSS). Auf dem Desktop
 * liegt neben dem Feld der Verlauf - dort wird das Sheet auf die Spalte
 * des Spielfelds gesetzt, sonst haengt es quer unter beiden Panels.
 * Ausserdem meldet es seine Hoehe an die Toasts, damit die nicht
 * ausgerechnet die Aktionsbuttons zudecken.
 */
function positionActionSheet() {
    const sheet = document.getElementById(ACTION_SHEET_ID);
    if (!sheet) { document.documentElement.style.setProperty('--cas-height', '0px'); return; }

    const container = document.getElementById('dynamic-view-container');
    const zweispaltig = window.innerWidth > 1024 && container;

    if (zweispaltig) {
        const r = container.getBoundingClientRect();
        sheet.style.left = Math.round(r.left) + 'px';
        sheet.style.right = 'auto';
        sheet.style.width = Math.round(r.width) + 'px';
        sheet.style.maxWidth = 'none';
        sheet.style.margin = '0';
    } else {
        sheet.style.left = '';
        sheet.style.right = '';
        sheet.style.width = '';
        sheet.style.maxWidth = '';
        sheet.style.margin = '';
    }

    document.documentElement.style.setProperty('--cas-height', sheet.offsetHeight + 'px');
}

window.addEventListener('resize', positionActionSheet);
window.addEventListener('orientationchange', positionActionSheet);

/**
 * Baut das Aktions-Sheet fuer den gewaehlten Spieler und haengt es an <body>.
 * @param {string} playerId
 * @param {string} [posClass] Position auf dem Feld (fuer Torwart-Aktionen)
 */
function openActionSheet(playerId, posClass) {
    closeActionSheet();

    const player = window.Store.getSPIELER().find(p => p.id === playerId);
    if (!player) return;

    const sheet = document.createElement('div');
    sheet.id = ACTION_SHEET_ID;
    sheet.className = 'court-action-sheet';

    // Kopfzeile: das Sheet sitzt am unteren Bildschirmrand, der markierte
    // Spieler weiter oben. Ohne Namen tippt man im Eifer auf den Falschen.
    const head = document.createElement('div');
    head.className = 'cas-head';
    const istGast = window.Store.istGast(player);
    const titel = istGast
        ? (window.Store.getTeamNames().gast && window.Store.getTeamNames().gast !== 'GAST'
            ? window.Store.getTeamNames().gast : 'Gegner')
        : `#${player.nummer} ${player.name}`;
    const label = document.createElement('span');
    label.className = 'cas-title';
    label.innerText = titel;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'cas-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Auswahl aufheben');
    closeBtn.innerText = '✕';
    closeBtn.onclick = (e) => { e.stopPropagation(); selectPlayer(playerId); };
    head.appendChild(label);
    head.appendChild(closeBtn);
    sheet.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'cas-grid';

    if (selectedPrimaryActionCategory && window.Store.UNTERAKTIONEN[selectedPrimaryActionCategory]) {
        const backBtn = document.createElement('button');
        backBtn.className = 'court-action-btn neutral';
        backBtn.innerText = '← Zurück';
        backBtn.onclick = (e) => { e.stopPropagation(); resetActionSelection(); };
        grid.appendChild(backBtn);

        window.Store.UNTERAKTIONEN[selectedPrimaryActionCategory].forEach(u => {
            const btn = document.createElement('button');
            btn.className = 'court-action-btn sub-blue';
            btn.innerText = u.label;
            btn.onclick = (e) => { e.stopPropagation(); selectAction(u.typ); };
            grid.appendChild(btn);
        });
    } else {
        getAvailableActionsForPlayer(playerId, posClass).forEach(a => {
            const btn = document.createElement('button');
            btn.className = `court-action-btn ${a.farbe || 'neutral'}`;
            btn.innerText = a.label;
            btn.onclick = (e) => { e.stopPropagation(); selectAction(a.typ, a.category); };
            grid.appendChild(btn);
        });
    }

    sheet.appendChild(grid);
    document.body.appendChild(sheet);
    positionActionSheet();
}

function renderDynamicView() {
    const container = document.getElementById('dynamic-view-container');
    if (!container) return;

    // Bei jedem Neuzeichnen zuerst weg - sonst bleibt beim Moduswechsel
    // oder nach dem Abwaehlen ein verwaistes Sheet am <body> haengen.
    closeActionSheet();

    if (window.UI_MODE === 'classic') {
        container.innerHTML = `
            <section id="player-list"></section>
            <section id="action-panel"></section>
        `;
        renderPlayerList();
        renderActionButtons();
    } else if (window.UI_MODE === 'thumb') {
        container.innerHTML = '';
        renderThumbView(container);
    } else if (window.UI_MODE === 'court') {
        container.innerHTML = '';
        renderCourtView(container);
    }

    // Nach dem Neuaufbau stimmen die Masse wieder - Sheet nachziehen.
    positionActionSheet();
}

function getPlayerDisplayHtml(player, size = '40px') {
    const timerState = window.Timer ? window.Timer.getTimerState() : { spielzeitSekunden: 0 };

    let isSuspended = false;
    let suspensionOverlay = '';
    if (player.suspendedUntilGameTime !== null && player.suspendedUntilGameTime !== undefined
        && timerState.spielzeitSekunden < player.suspendedUntilGameTime) {
        isSuspended = true;
        const remaining = player.suspendedUntilGameTime - timerState.spielzeitSekunden;
        const m = Math.floor(remaining / 60);
        const sec = remaining % 60;
        suspensionOverlay = `<span class="badge-suspension">${m}:${sec < 10 ? '0' : ''}${sec}</span>`;
    }

    // Die Trikotnummer steht IM Kreis, der Name nur darunter. Vorher standen
    // Initialen im Kreis und der Vorname darunter - dieselbe Information zweimal.
    // Nummern sind ausserdem eindeutig, Initialen kollidieren.
    const inner = player.avatarUrl
        ? `<img class="badge-photo" src="${escapeHtml(player.avatarUrl)}" alt="">
           <span class="badge-number-chip">${escapeHtml(player.nummer)}</span>`
        : `<span class="badge-number">${escapeHtml(player.nummer)}</span>`;

    return `<span class="player-badge${isSuspended ? ' is-suspended' : ''}" data-pid="${escapeHtml(player.id)}" style="--badge-size:${size}">
        ${inner}${suspensionOverlay}
    </span>`;
}

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('app-container');
    if(container) container.className = 'layout-' + window.UI_MODE;
    const btn = document.getElementById('btn-mode-' + window.UI_MODE);
    if(btn) btn.classList.add('active-mode');

    // Enter legt den Spieler an. Auf dem Handy verdeckt die Tastatur den
    // Hinzufuegen-Button; ohne das hier musste man nach jedem Namen erst
    // die Tastatur schliessen und scrollen. Einen ganzen Kader einzugeben
    // war damit eine Qual - und ohne <form> tat "Fertig" gar nichts.
    ['input-name', 'input-number'].forEach(function (id) {
        const feld = document.getElementById(id);
        if (!feld) return;
        feld.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            addPlayer();
        });
    });
});

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
    const playerListElement = document.getElementById('player-list');
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
            <div style="display:flex; align-items:center; gap: 10px;">
                ${getPlayerDisplayHtml(player, '40px')}
                <div class="player-info">
                    <span class="player-number">#${player.nummer}</span>
                    <span class="player-name">${escapeHtml(player.name)} (${escapeHtml(player.position)})</span>
                </div>
            </div>
            <div class="player-stats"> 
                <span class="stat-item green">🥅 ${stats.tore}</span> 
                <span class="stat-item red">❌ ${stats.fehler}</span> 
                <span class="stat-item yellow">🧤 ${stats.paraden}</span>
            </div>
        `;
        document.getElementById('player-list').appendChild(playerButton);
    });
}

/**
 * Baut die Verlaufseintraege in einen beliebigen Container.
 * Wird zweimal gebraucht: fuer das Seitenpanel (breite Bildschirme) und
 * fuer das Verlauf-Overlay - auf dem Handy ist das Panel per CSS
 * ausgeblendet, und ohne das Overlay waere die Korrektur dort
 * ueberhaupt nicht erreichbar.
 */
function buildHistoryInto(container, limit) {
    if (!container) return;
    container.innerHTML = '';

    const aktionen = window.Store.loadActions();
    const spieler = window.Store.getSPIELER();

    if (aktionen.length === 0) {
        container.innerHTML = '<p class="history-empty">Noch keine Aktionen erfasst.</p>';
        return;
    }

    [...aktionen].reverse().slice(0, limit || 25).forEach(entry => {
        const player = spieler.find(s => s.id === entry.spielerId);
        const playerNumber = player ? player.nummer : '?';
        const playerName = player ? player.name : 'Unbekannt';

        const assistPlayer = entry.assistId ? spieler.find(p => p.id === entry.assistId) : null;
        const assistText = assistPlayer
            ? `<br><small class="history-assist">🅰️ Assist: ${escapeHtml(assistPlayer.name)}</small>` : '';

        const el = document.createElement('div');
        el.className = 'history-entry is-editable';
        el.title = 'Antippen zum Korrigieren';
        el.onclick = () => openActionEdit(entry.id);
        el.innerHTML = `
            <span class="history-time">${window.Timer ? window.Timer.formatTime(entry.spielzeit) : entry.spielzeit}</span>
            <span class="history-player">
                <strong>${escapeHtml(playerNumber)} ${escapeHtml(playerName)}</strong>
                ${assistText}
            </span>
            <span class="history-action">${escapeHtml(entry.label)}</span>
        `;
        container.appendChild(el);
    });
}

function renderHistory() {
    if (historyPanelElement) {
        historyPanelElement.innerHTML = '<h3>Verlauf</h3>';
        const box = document.createElement('div');
        historyPanelElement.appendChild(box);
        buildHistoryInto(box, 25);
    }

    // Overlay mitziehen, falls es gerade offen ist
    const overlay = document.getElementById('history-view');
    if (overlay && overlay.style.display === 'flex') {
        buildHistoryInto(document.getElementById('history-view-list'), 200);
    }

    updateScoreboard();
}

function openHistoryView() {
    const box = document.getElementById('history-view');
    if (!box) return;
    buildHistoryInto(document.getElementById('history-view-list'), 200);
    box.style.display = 'flex';
}

function closeHistoryView() {
    const box = document.getElementById('history-view');
    if (box) box.style.display = 'none';
}

// ===================================================================
// TEAMNAMEN
// ===================================================================

function renderTeamNames() {
    const names = window.Store.getTeamNames();
    const heimEl = document.getElementById('team-name');
    const gastEl = document.getElementById('guest-name');
    if (heimEl) heimEl.textContent = names.heim;
    if (gastEl) gastEl.textContent = names.gast;
}

function openTeamNameEdit() {
    const box = document.getElementById('team-name-edit');
    if (!box) return;
    const names = window.Store.getTeamNames();
    const heimInput = document.getElementById('input-team-heim');
    const gastInput = document.getElementById('input-team-gast');
    if (!heimInput || !gastInput) return;

    heimInput.value = names.heim === 'HEIM' ? '' : names.heim;
    gastInput.value = names.gast === 'GAST' ? '' : names.gast;

    box.style.display = 'flex';
    heimInput.focus();

    const onKey = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); applyTeamNameEdit(); }
        if (e.key === 'Escape') { e.preventDefault(); closeTeamNameEdit(); }
    };
    heimInput.onkeydown = onKey;
    gastInput.onkeydown = onKey;
}

function closeTeamNameEdit() {
    const box = document.getElementById('team-name-edit');
    if (box) box.style.display = 'none';
}

function applyTeamNameEdit() {
    const heim = document.getElementById('input-team-heim').value;
    const gast = document.getElementById('input-team-gast').value;
    window.Store.setTeamNames(heim, gast);
    renderTeamNames();
    closeTeamNameEdit();
    if (window.Toast) window.Toast('Teamnamen gespeichert.', { type: 'success', duration: 2500 });
}

function updateScoreboard() {
    renderTeamNames();
    const aktionen = window.Store.loadActions();
    const spieler = window.Store.getSPIELER();
    let homeGoals = 0;
    let guestGoals = 0;

    aktionen.forEach(action => {
        if (action.typ && action.typ.includes('WurfTor')) {
            const player = spieler.find(p => p.id === action.spielerId);
            if (player) {
                if (window.Store.istGast(player)) {
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

function getAvailableActionsForPlayer(playerId, posClassFallback) {
    const all = window.Store.HAUPTAKTIONEN;
    if (!playerId) return all.filter(a => !a.nurTorwart);

    const player = window.Store.getSPIELER().find(p => p.id === playerId);
    if (!player) return all.filter(a => !a.nurTorwart);

    const position = posClassFallback || player.position;

    // Der Torwart konnte frueher AUSSCHLIESSLICH Paraden machen - Fehlpaesse,
    // Zeitstrafen oder ein Tor ins leere Tor liessen sich gar nicht erfassen.
    // Jetzt bekommt er alles, Feldspieler alles ausser der Parade.
    if (position === 'TW') return all;
    return all.filter(a => !a.nurTorwart);
}

function renderActionButtons() {
    const actionPanelElement = document.getElementById('action-panel');
    if (!actionPanelElement) return;

    actionPanelElement.innerHTML = '<h3>Aktion</h3>';
    const actionTitleElement = actionPanelElement.querySelector('h3');

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
        buttonsToRender = getAvailableActionsForPlayer(selectedPlayerId);
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

        document.getElementById('action-panel').appendChild(button);
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
        if (window.Toast) window.Toast("Bitte zuerst einen Spieler auswählen.", { type: "warn" });
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
    const timerState = window.Timer ? window.Timer.getTimerState() : { isTimerRunning: false, spielzeitSekunden: 0 };

    // Frueher wurde hier per alert() komplett blockiert. Damit liess sich
    // vor dem Anwurf, in der Halbzeit oder nach Spielende nichts nachtragen.
    // Jetzt wird erfasst und nur darauf hingewiesen - danebengetippt ist
    // dank des Rueckgaengig-Toasts in zwei Sekunden behoben.
    //
    // Der Hinweis kommt EINMAL pro Pausenphase. Bei jeder Aktion waere er
    // Krach: wer in der Halbzeit fuenf Sachen nachtraegt, will ihn nicht
    // fuenfmal lesen.
    if (timerState.isTimerRunning) {
        uhrHinweisGezeigt = false;
    } else if (!uhrHinweisGezeigt && window.Toast) {
        uhrHinweisGezeigt = true;
        window.Toast('Uhr läuft nicht — Aktionen werden bei '
            + (window.Timer ? window.Timer.formatTime(timerState.spielzeitSekunden) : '00:00') + ' eingetragen.',
            { type: 'warn', duration: 4000 });
    }

    const isGoal = finalActionType.includes('WurfTor');
    const isEnemy = window.Store.istGast(player);

    // Bei Siebenmeter und Gegenstoss gibt es praktisch nie einen Assist.
    // Die Abfrage waere dort nur ein Klick mehr pro Tor.
    const ohneAssist = finalActionType.includes('7Meter') || finalActionType.includes('Gegenstoss');

    if (isGoal && !isEnemy && !ohneAssist && assistAbfrageAktiv()) {
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

    // Torwart mitschreiben: bei einer Aktion DES Torwarts er selbst,
    // sonst der gerade im Tor stehende Keeper. Nur so laesst sich spaeter
    // ein Gegentor dem richtigen Torhueter zuordnen (Fangquote bei
    // zwei Keepern getrennt berechenbar).
    const torwartId = window.Store.isGoalkeeper(player)
        ? player.id
        : window.Store.getActiveGoalkeeperId();

    const newAction = {
        id: Date.now(),
        spielId: "current_match",
        spielerId: player.id,
        assistId: assistId,
        torwartId: torwartId,
        typ: actionType,
        label: actionLabel,
        category: category || "Unbekannt",
        halbzeit: timerState.currentHalf,
        spielzeit: timerState.spielzeitSekunden,
        timestamp: Date.now()
    };

    aktionen.push(newAction);
    window.Store.saveActions(aktionen);
    
    if (actionType === 'Zeitstrafe') {
        window.Store.applySuspension(player.id, timerState.spielzeitSekunden);
    }

    updateActionCount();
    renderHistory();
    updateScoreboard();

    const kind = feedbackKindFor(actionType);
    pulseFeedback(kind);

    // Hier wird NICHT mehr getickert. Die Nachricht entsteht serverseitig
    // aus dem State-Push. Vom Browser aus zu feuern hiesse: jeder Reload
    // tickert erneut, ein Undo kaeme zu spaet, und das Admin-Passwort
    // muesste im sessionStorage jedes Trackenden liegen.

    selectedPlayerId = null;
    selectedPrimaryAction = null;
    selectedPrimaryActionCategory = null;
    updateUI();

    // Rueckgaengig direkt dort, wo man gerade hingeschaut hat - statt
    // unten den Undo-Knopf zu suchen und zwei Dialoge wegzuklicken.
    if (window.Toast) {
        window.Toast(`#${player.nummer} ${String(player.name).split(' ')[0]} · ${actionLabel}`, {
            type: kind === 'tor' ? 'success' : (kind === 'fehler' ? 'warn' : 'info'),
            duration: 6000,
            actionLabel: 'Rückgängig',
            onAction: () => removeActionById(newAction.id, true)
        });
    }
}

/**
 * Entfernt eine Aktion anhand ihrer ID - nicht "die letzte".
 * Wichtig, weil der Toast auch dann noch stehen kann, wenn inzwischen
 * eine weitere Aktion erfasst wurde.
 */
function removeActionById(actionId, mitWiederherstellen) {
    const aktionen = window.Store.loadActions();
    const idx = aktionen.findIndex(a => String(a.id) === String(actionId));
    if (idx === -1) {
        if (window.Toast) window.Toast('Aktion nicht mehr vorhanden.', { type: 'warn' });
        return false;
    }

    const entfernt = aktionen.splice(idx, 1)[0];
    window.Store.saveActions(aktionen);

    if (entfernt.typ === 'Zeitstrafe' && window.Store.clearSuspension) {
        window.Store.clearSuspension(entfernt.spielerId);
    }

    updateActionCount();
    renderHistory();
    updateScoreboard();
    updateUI();

    if (mitWiederherstellen && window.Toast) {
        const p = window.Store.getSPIELER().find(x => x.id === entfernt.spielerId);
        window.Toast(`Zurückgenommen: ${p ? '#' + p.nummer + ' ' : ''}${entfernt.label}`, {
            type: 'info',
            duration: 6000,
            actionLabel: 'Doch behalten',
            onAction: () => restoreAction(entfernt, idx)
        });
    }
    return true;
}

/** Macht ein Rueckgaengig wieder rueckgaengig. */
function restoreAction(action, idx) {
    const aktionen = window.Store.loadActions();
    aktionen.splice(Math.min(idx, aktionen.length), 0, action);
    window.Store.saveActions(aktionen);

    if (action.typ === 'Zeitstrafe' && window.Store.applySuspension) {
        window.Store.applySuspension(action.spielerId, action.spielzeit);
    }

    updateActionCount();
    renderHistory();
    updateScoreboard();
    updateUI();
    if (window.Toast) window.Toast('Wiederhergestellt.', { type: 'success', duration: 2500 });
}

function undoLastAction() {
    const aktionen = window.Store.loadActions();
    if (aktionen.length === 0) {
        if (window.Toast) window.Toast('Keine Aktionen zum Zurücknehmen.', { type: 'warn' });
        return;
    }
    // Kein confirm() mehr: das Zuruecknehmen ist selbst zuruecknehmbar,
    // eine Sicherheitsabfrage davor waere nur ein Klick mehr im Spiel.
    removeActionById(aktionen[aktionen.length - 1].id, true);
}

// ===================================================================
// AKTION NACHTRAEGLICH KORRIGIEREN
// ===================================================================
// Bisher liess sich nur die LETZTE Aktion zuruecknehmen. Faellt einem
// drei Aktionen spaeter auf, dass der falsche Spieler dranstand, musste
// man alles dazwischen mit wegwerfen.

let editingActionId = null;

function openActionEdit(actionId) {
    const aktionen = window.Store.loadActions();
    const action = aktionen.find(a => String(a.id) === String(actionId));
    if (!action) return;

    editingActionId = actionId;
    const box = document.getElementById('action-edit');
    const info = document.getElementById('action-edit-info');
    const list = document.getElementById('action-edit-players');
    const assistWrap = document.getElementById('action-edit-assist-wrap');
    const assistList = document.getElementById('action-edit-assist');
    if (!box || !info || !list) return;

    const spieler = window.Store.getSPIELER();
    const p = spieler.find(x => x.id === action.spielerId);

    info.innerHTML = '<span class="ae-time">'
        + (window.Timer ? window.Timer.formatTime(action.spielzeit) : '') + '</span>'
        + '<strong>' + escapeHtml(action.label) + '</strong>'
        + '<span class="ae-cur">aktuell: '
        + (p ? '#' + escapeHtml(p.nummer) + ' ' + escapeHtml(p.name) : 'Unbekannt') + '</span>';

    list.innerHTML = '';
    spieler.forEach(function (x) {
        const btn = document.createElement('button');
        btn.className = 'ae-player' + (x.id === action.spielerId ? ' ae-active' : '');
        btn.innerHTML = '<strong>#' + escapeHtml(x.nummer) + '</strong> ' + escapeHtml(x.name);
        btn.onclick = function () { reassignAction(actionId, x.id); };
        list.appendChild(btn);
    });

    // Assist nur dort anbieten, wo er ueberhaupt Sinn ergibt
    const istEigenesTor = action.typ && action.typ.indexOf('WurfTor') !== -1
        && p && !window.Store.istGast(p);

    if (assistWrap) assistWrap.style.display = istEigenesTor ? 'block' : 'none';
    if (istEigenesTor && assistList) {
        assistList.innerHTML = '';
        const keiner = document.createElement('button');
        keiner.className = 'ae-player' + (!action.assistId ? ' ae-active' : '');
        keiner.textContent = 'Kein Assist';
        keiner.onclick = function () { reassignAssist(actionId, null); };
        assistList.appendChild(keiner);

        spieler.forEach(function (x) {
            if (x.id === action.spielerId || window.Store.istGast(x)) return;
            const btn = document.createElement('button');
            btn.className = 'ae-player' + (x.id === action.assistId ? ' ae-active' : '');
            btn.innerHTML = '<strong>#' + escapeHtml(x.nummer) + '</strong> '
                + escapeHtml(String(x.name).split(' ')[0]);
            btn.onclick = function () { reassignAssist(actionId, x.id); };
            assistList.appendChild(btn);
        });
    }

    box.style.display = 'flex';
}

function closeActionEdit() {
    const box = document.getElementById('action-edit');
    if (box) box.style.display = 'none';
    editingActionId = null;
}

function reassignAction(actionId, newPlayerId) {
    const aktionen = window.Store.loadActions();
    const action = aktionen.find(a => String(a.id) === String(actionId));
    if (!action) return;

    const alterSpieler = action.spielerId;
    action.spielerId = newPlayerId;

    // Torwart-Zuordnung mitziehen, sonst stimmt die Fangquote nicht mehr
    const neu = window.Store.getSPIELER().find(x => x.id === newPlayerId);
    if (window.Store.isGoalkeeper(neu)) action.torwartId = newPlayerId;

    // Eine umgebuchte Zeitstrafe muss auch die Sperre mitnehmen
    if (action.typ === 'Zeitstrafe') {
        window.Store.clearSuspension(alterSpieler);
        window.Store.applySuspension(newPlayerId, action.spielzeit);
    }

    window.Store.saveActions(aktionen);
    updateActionCount();
    renderHistory();
    updateScoreboard();
    updateUI();
    closeActionEdit();
    if (window.Toast && neu) {
        window.Toast('Umgebucht auf #' + neu.nummer + ' ' + neu.name + '.', { type: 'success', duration: 3000 });
    }
}

function reassignAssist(actionId, assistId) {
    const aktionen = window.Store.loadActions();
    const action = aktionen.find(a => String(a.id) === String(actionId));
    if (!action) return;
    action.assistId = assistId;
    window.Store.saveActions(aktionen);
    renderHistory();
    closeActionEdit();
    if (window.Toast) {
        window.Toast(assistId ? 'Assist geändert.' : 'Assist entfernt.', { type: 'success', duration: 2500 });
    }
}

function deleteEditedAction() {
    if (!editingActionId) return;
    const id = editingActionId;
    closeActionEdit();
    removeActionById(id, true);
}

// ===================================================================
// ZEITKORREKTUR
// ===================================================================

function openTimeEdit() {
    const box = document.getElementById('time-edit');
    const input = document.getElementById('time-edit-input');
    if (!box || !input) return;

    const st = window.Timer ? window.Timer.getTimerState() : { spielzeitSekunden: 0 };
    input.value = window.Timer ? window.Timer.formatTime(st.spielzeitSekunden) : '00:00';
    const hz = document.getElementById('time-edit-halbzeit');
    if (hz && window.Timer) hz.value = String(window.Timer.getHalbzeitMinuten());

    box.style.display = 'flex';
    input.focus();
    input.select();

    input.onkeydown = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); applyTimeEdit(); }
        if (e.key === 'Escape') { e.preventDefault(); closeTimeEdit(); }
    };
}

function closeTimeEdit() {
    const box = document.getElementById('time-edit');
    if (box) box.style.display = 'none';
}

function parseTimeInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    // "12:34" oder "1234" oder "12" (= Minuten)
    let m = raw.match(/^(\d{1,3}):([0-5]?\d)$/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);

    m = raw.match(/^(\d{1,3})$/);
    if (m) return parseInt(m[1], 10) * 60;

    return null;
}

function applyTimeEdit() {
    const input = document.getElementById('time-edit-input');
    if (!input) return;

    const seconds = parseTimeInput(input.value);
    if (seconds === null) {
        if (window.Toast) window.Toast('Bitte im Format mm:ss eingeben, z.B. 23:40.', { type: 'error' });
        return;
    }

    window.Timer.setGameTime(seconds);
    closeTimeEdit();
    if (window.Toast) {
        window.Toast('Spielzeit auf ' + window.Timer.formatTime(seconds) + ' gesetzt.', { type: 'success' });
    }
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

    // Nur wer gerade auf dem Feld steht, kann aufgelegt haben. Vorher stand
    // hier der komplette Kader - man konnte einen Bankspieler als
    // Vorlagengeber eintragen.
    const aufDemFeld = window.Store.getPlayersOnCourt();

    aufDemFeld.forEach(p => {
        if (p.id === selectedPlayerId) return;
        const btn = document.createElement('button');
        btn.innerHTML = `<strong>${escapeHtml(p.nummer)}</strong><br>${escapeHtml(p.name)}`;
        btn.style.margin = "5px";
        btn.style.padding = "10px";
        btn.onclick = () => confirmAssist(p.id);
        list.appendChild(btn);
    });

    if (!list.children.length) {
        list.innerHTML = '<p style="color: var(--text-muted);">Kein weiterer Spieler auf dem Feld.</p>';
    }

    overlay.style.display = 'flex';
}

// ---------------------------------------------------------------
// Assist-Abfrage abschaltbar
// ---------------------------------------------------------------
// Beim Mitschreiben fuer den Ticker ist die Frage nach dem Vorlagengeber
// ein Klick zu viel. Wer die Assists nicht auswertet, schaltet sie ab.

const ASSIST_KEY = 'ht_assist_fragen';

function assistAbfrageAktiv() {
    try { return localStorage.getItem(ASSIST_KEY) !== 'aus'; } catch (e) { return true; }
}

function setAssistAbfrage(aktiv) {
    try { localStorage.setItem(ASSIST_KEY, aktiv ? 'an' : 'aus'); } catch (e) { /* egal */ }
    const box = document.getElementById('setting-assist');
    if (box) box.checked = aktiv;
    if (window.Toast) {
        window.Toast(aktiv ? 'Assist wird wieder abgefragt.' : 'Assist wird nicht mehr abgefragt.',
            { type: 'success', duration: 3000 });
    }
}

/**
 * Spielzeit umstellen. Liegt hier statt direkt am Timer, damit die
 * Rueckmeldung an einer Stelle passiert und die Anzeige mitzieht.
 */
function setHalbzeitLaenge(minuten) {
    if (!window.Timer) return;
    const m = window.Timer.setHalbzeitLaenge(minuten);
    // Die Einstellung steht an zwei Stellen (Uhr und Verwaltung) - beide
    // muessen denselben Wert zeigen, sonst glaubt man je nach Weg etwas anderes.
    ['setting-halbzeit', 'time-edit-halbzeit'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.value = String(m);
    });
    if (window.Toast) window.Toast(`Spielzeit auf 2 × ${m} Minuten gestellt.`, { type: 'success', duration: 3000 });
}

function assistAbfrageAus() {
    setAssistAbfrage(false);
    confirmAssist(null);   // die laufende Aktion ohne Assist buchen
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
async function togglePlayerManagement() {
    const mainApp = document.getElementById("app-container");
    const managementView = document.getElementById("player-management-view");

    if (managementView.style.display === 'none' || managementView.style.display === '') {
        mainApp.style.display = 'none';
        managementView.style.display = 'block';
        bearbeiteterSpieler = null;
        const assistBox = document.getElementById('setting-assist');
        if (assistBox) assistBox.checked = assistAbfrageAktiv();
        const hzBox = document.getElementById('setting-halbzeit');
        if (hzBox && window.Timer) hzBox.value = String(window.Timer.getHalbzeitMinuten());
        const gkBtn = document.getElementById('setting-gk');
        if (gkBtn) {
            const gk = window.Store.getActiveGoalkeeper();
            gkBtn.innerText = gk ? `🧤 #${gk.nummer} ${String(gk.name).split(' ')[0]}` : 'Kein Torwart — wählen';
        }
        renderRosterList();
        await populateTeamsDropdown();
    } else {
        managementView.style.display = 'none';
        mainApp.style.display = 'flex';
        updateUI();
    }
}

// Welcher Spieler wird gerade bearbeitet (null = keiner)
let bearbeiteterSpieler = null;

const POSITIONS_AUSWAHL = [
    ['TW', 'Torwart (TW)'], ['LA', 'Linksaußen (LA)'], ['RL', 'Rückraum Links (RL)'],
    ['M', 'Mitte (RM)'], ['RR', 'Rückraum Rechts (RR)'], ['RA', 'Rechtsaußen (RA)'],
    ['K', 'Kreis (K)'], ['N/A', 'Bank / keine Position']
];

function startEditPlayer(playerId) {
    bearbeiteterSpieler = String(playerId);
    renderRosterList();
    const feld = document.getElementById('edit-name');
    if (feld) { feld.focus(); feld.select(); }
}

function cancelEditPlayer() {
    bearbeiteterSpieler = null;
    renderRosterList();
}

function saveEditedPlayer(playerId) {
    const name = document.getElementById('edit-name');
    const nummer = document.getElementById('edit-nummer');
    const position = document.getElementById('edit-position');
    if (!name || !nummer || !position) return;

    if (!String(name.value).trim() || String(nummer.value).trim() === '') {
        if (window.Toast) window.Toast('Name und Nummer dürfen nicht leer sein.', { type: 'warn' });
        return;
    }

    window.Store.updatePlayerData(playerId, {
        name: name.value,
        nummer: nummer.value,
        position: position.value
    });

    bearbeiteterSpieler = null;
    renderRosterList();
    if (window.UI) updateUI();
    if (window.Toast) window.Toast('Spieler geändert.', { type: 'success', duration: 2500 });
}

function renderRosterList() {
    const rosterList = document.getElementById("roster-list");
    if (!rosterList) return;
    rosterList.innerHTML = '';
    sortPlayers();

    const spieler = window.Store.getSPIELER();
    spieler.forEach(p => {
        const li = document.createElement("li");
        const istGast = window.Store.istGast(p);

        if (String(p.id) === bearbeiteterSpieler) {
            // Bearbeiten statt loeschen und neu anlegen: die Aktionen haengen
            // an der Spieler-id und waeren beim Neuanlegen alle weg.
            const optionen = POSITIONS_AUSWAHL.map(([wert, text]) =>
                `<option value="${wert}"${p.position === wert ? ' selected' : ''}>${escapeHtml(text)}</option>`).join('');
            li.className = 'roster-edit';
            li.innerHTML = `
                <input type="number" id="edit-nummer" value="${escapeHtml(p.nummer)}" min="0" inputmode="numeric" aria-label="Nummer">
                <input type="text" id="edit-name" value="${escapeHtml(p.name)}" aria-label="Name">
                <select id="edit-position" aria-label="Position">${optionen}</select>
                <button class="add-btn js-save">Speichern</button>
                <button class="cancel-btn js-cancel">Abbrechen</button>
            `;
            li.querySelector('.js-save').onclick = () => saveEditedPlayer(p.id);
            li.querySelector('.js-cancel').onclick = cancelEditPlayer;
            li.querySelectorAll('input').forEach(el => {
                el.addEventListener('keydown', e => {
                    if (e.key === 'Enter') { e.preventDefault(); saveEditedPlayer(p.id); }
                    if (e.key === 'Escape') { e.preventDefault(); cancelEditPlayer(); }
                });
            });
        } else {
            // Der Gegner-Eintrag ist sichtbar als solcher markiert: er zaehlt
            // die gegnerischen Tore und laesst sich deshalb nicht loeschen.
            // Umbenennen ist seit der Umstellung auf das team-Feld gefahrlos.
            // Ticker-Sprueche stehen bewusst hier und nicht in einem
            // eigenen Regel-Editor: man stellt sie dort ein, wo man den
            // Spieler ohnehin anfasst.
            const hatSprueche = window.TickerUI && window.TickerUI.hatRegeln(p.id);
            li.innerHTML = `
                <span>#${escapeHtml(p.nummer)} ${escapeHtml(p.name)} (${escapeHtml(p.position)})${
                    istGast ? ' <span class="gast-marke">Gegnerseite</span>' : ''}</span>
                <span class="roster-btns">
                    <button class="js-ticker" title="Eigener Ticker-Spruch">📡${hatSprueche ? ' ✓' : ''}</button>
                    <button class="js-edit">Bearbeiten</button>
                    ${istGast ? '' : '<button class="js-del">Löschen</button>'}
                </span>
                <div class="roster-ticker"></div>
            `;
            li.querySelector('.js-ticker').onclick = () => {
                if (window.TickerUI) window.TickerUI.toggleSpielerRegeln(p.id, li.querySelector('.roster-ticker'));
            };
            li.querySelector('.js-edit').onclick = () => startEditPlayer(p.id);
            const del = li.querySelector('.js-del');
            if (del) del.onclick = () => removePlayer(p.id);
        }
        rosterList.appendChild(li);
    });
}

async function addPlayer() {
    const nameEl = document.getElementById("input-name");
    const numEl = document.getElementById("input-number");
    const posEl = document.getElementById("input-position");
    const avatarEl = document.getElementById("input-avatar");

    const name = nameEl.value;
    const number = parseInt(numEl.value);

    if (!name || isNaN(number)) {
        if (window.Toast) window.Toast("Bitte Name und Nummer angeben.", { type: "warn" });
        return;
    }
    
    let avatarUrl = null;
    if (avatarEl && avatarEl.files.length > 0) {
        const formData = new FormData();
        formData.append('avatar', avatarEl.files[0]);
        try {
            const res = await fetch('/api/upload-avatar', {
                method: 'POST',
                // Don't set Content-Type header manually for FormData, let browser do it
                body: formData
            });
            const data = await res.json();
            if (res.ok && data.avatarUrl) {
                avatarUrl = data.avatarUrl;
            } else {
                if (window.Toast) window.Toast(data.error || "Avatar-Upload fehlgeschlagen.", { type: "error" });
            }
        } catch(e) {
            console.error("Upload failed", e);
        }
    }

    window.Store.addPlayerToStore(name, number, posEl.value, avatarUrl);

    nameEl.value = "";
    numEl.value = "";
    if (avatarEl) avatarEl.value = "";
    renderRosterList();

    // Kurze Rueckmeldung und Fokus zurueck ins Namensfeld: so laesst sich
    // ein ganzer Kader am Stueck eintippen, ohne die Tastatur zu schliessen.
    if (window.Toast) window.Toast(`#${number} ${name} hinzugefügt.`, { type: "success", duration: 2000 });
    try { nameEl.focus({ preventScroll: true }); } catch (e) { nameEl.focus(); }
}

function removePlayer(playerId) {
    const p = window.Store.getSPIELER().find(x => String(x.id) === String(playerId));
    // "Gegner" ist kein Spieler, sondern der Platzhalter, ueber den alle
    // gegnerischen Tore laufen. Ohne ihn passiert auf der Gegnerseite nichts
    // mehr - und der Spielstand bleibt einseitig stehen.
    if (p && window.Store.istGast(p)) {
        if (window.Toast) window.Toast('„Gegner" wird zum Zählen der gegnerischen Tore gebraucht und kann nicht gelöscht werden.',
            { type: 'warn', duration: 6000 });
        return;
    }
    if (!confirm("Wirklich löschen?")) return;
    window.Store.removePlayerFromStore(playerId);
    if (selectedPlayerId && String(selectedPlayerId) === String(playerId)) {
        selectedPlayerId = null;
    }
    renderRosterList();
}

async function populateTeamsDropdown() {
    const select = document.getElementById('team-select');
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Team auswählen --</option>';
    const teams = await window.Store.getTeams();
    
    teams.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name;
        select.appendChild(opt);
    });
}

async function saveCurrentRosterAsTeam() {
    const nameInput = document.getElementById('new-team-name');
    const name = nameInput.value.trim();
    if (!name) {
        if (window.Toast) window.Toast("Bitte einen Teamnamen eingeben.", { type: "warn" });
        return;
    }
    const players = window.Store.getSPIELER();
    if (players.length === 0) {
        if (window.Toast) window.Toast("Der Kader ist leer.", { type: "warn" });
        return;
    }
    
    await window.Store.saveTeam({ name, players });
    if (window.Toast) window.Toast(`Team „${name}" gespeichert.`, { type: "success" });
    nameInput.value = "";
    await populateTeamsDropdown();
}

async function updateSelectedTeam() {
    const select = document.getElementById('team-select');
    const teamId = select.value;
    if (!teamId) {
        if (window.Toast) window.Toast("Bitte zuerst ein Team auswählen.", { type: "warn" });
        return;
    }
    
    const teams = await window.Store.getTeams();
    const team = teams.find(t => t.id === teamId);
    if (!team) return;

    const players = window.Store.getSPIELER();
    if (players.length === 0) {
        if (window.Toast) window.Toast("Der aktuelle Kader ist leer.", { type: "warn" });
        return;
    }

    if (!confirm(`Möchtest du das gespeicherte Team "${team.name}" wirklich mit dem aktuellen Kader überschreiben?`)) {
        return;
    }

    await window.Store.saveTeam({ id: team.id, name: team.name, players });
    if (window.Toast) window.Toast(`Team „${team.name}" aktualisiert.`, { type: "success" });
}

async function loadTeam() {
    const select = document.getElementById('team-select');
    const teamId = select.value;
    if (!teamId) {
        if (window.Toast) window.Toast("Bitte zuerst ein Team auswählen.", { type: "warn" });
        return;
    }
    
    const teams = await window.Store.getTeams();
    const team = teams.find(t => t.id === teamId);
    if (!team || !team.players) return;
    
    const currentPlayers = window.Store.getSPIELER();
    let replace = false;
    
    if (currentPlayers.length > 0) {
        const choice = confirm("Soll das Team den aktuellen Kader ERSETZEN (OK) oder HINZUGEFÜGT werden (Abbrechen)?");
        if (choice) {
            replace = true;
        }
    }
    
    if (replace) {
        // Clear all players first
        const allIds = currentPlayers.map(p => p.id);
        allIds.forEach(id => window.Store.removePlayerFromStore(id));
    }
    
    // Add players from team
    team.players.forEach(p => {
        window.Store.addPlayerToStore(p.name, p.nummer, p.position);
    });
    
    if (window.Toast) window.Toast(`Team „${team.name}" geladen.`, { type: "success" });
    renderRosterList();
}

async function deleteSelectedTeam() {
    const select = document.getElementById('team-select');
    const teamId = select.value;
    if (!teamId) {
        if (window.Toast) window.Toast("Bitte ein Team zum Löschen auswählen.", { type: "warn" });
        return;
    }
    
    if (!confirm("Team wirklich löschen?")) return;
    
    await window.Store.deleteTeam(teamId);
    await populateTeamsDropdown();
}

function clearAllPlayers() {
    const currentPlayers = window.Store.getSPIELER();
    if (currentPlayers.length === 0) return;
    
    if (!confirm("Wirklich ALLE Spieler aus dem aktuellen Kader löschen?")) return;
    
    const allIds = currentPlayers.map(p => p.id);
    allIds.forEach(id => window.Store.removePlayerFromStore(id));
    selectedPlayerId = null;
    renderRosterList();
}

function renderThumbView(container) {
    let topArea = document.createElement('div');
    topArea.className = 'thumb-top-area';
    let gridArea = document.createElement('div');
    gridArea.className = 'thumb-grid-area';
    
    const spieler = window.Store.getSPIELER();
    
    if (!selectedPlayerId) {
        topArea.innerHTML = '<h3 style="text-align:center; color: var(--accent-color); margin-top:20px;">Wähle einen Spieler...</h3>';
    } else {
        const p = spieler.find(s => s.id === selectedPlayerId);
        topArea.innerHTML = `
            <div style="text-align:center;">
                <h2 style="margin:0; color:var(--text-color);">#${escapeHtml(p.nummer)} ${escapeHtml(p.name)}</h2>
                <div style="color:var(--text-muted);">${escapeHtml(p.position)}</div>
                <button onclick="window.UI.selectPlayer('${p.id}')" style="margin-top:10px; background:transparent; border:1px solid var(--border-color); color:white; padding:5px 10px; border-radius:4px; cursor:pointer;">Abbrechen</button>
            </div>
        `;
    }
    
    if (!selectedPlayerId) {
        spieler.forEach(p => {
            const btn = document.createElement('div');
            btn.className = 'thumb-btn';
            btn.innerHTML = getPlayerDisplayHtml(p, '40px') + `<span class="name">${escapeHtml(p.name.split(' ')[0])}</span>`;
            btn.onclick = () => selectPlayer(p.id);
            gridArea.appendChild(btn);
        });
    } else {
        if (selectedPrimaryActionCategory && window.Store.UNTERAKTIONEN[selectedPrimaryActionCategory]) {
            const subEvents = window.Store.UNTERAKTIONEN[selectedPrimaryActionCategory];
            const backBtn = document.createElement('div');
            backBtn.className = 'thumb-btn thumb-action-btn neutral';
            backBtn.innerText = '← Zurück';
            backBtn.onclick = resetActionSelection;
            gridArea.appendChild(backBtn);
            subEvents.forEach(u => {
                const btn = document.createElement('div');
                btn.className = 'thumb-btn thumb-action-btn sub-blue';
                btn.innerText = u.label;
                btn.onclick = () => selectAction(u.typ);
                gridArea.appendChild(btn);
            });
        } else {
            const actions = getAvailableActionsForPlayer(selectedPlayerId);
            actions.forEach(a => {
                const btn = document.createElement('div');
                btn.className = `thumb-btn thumb-action-btn ${a.farbe || 'neutral'}`;
                btn.innerText = a.label;
                btn.onclick = () => selectAction(a.typ, a.category);
                gridArea.appendChild(btn);
            });
        }
    }
    
    container.appendChild(topArea);
    container.appendChild(gridArea);
}

function handleDragStart(e, playerId) {
    e.dataTransfer.setData('text/plain', playerId);
    setTimeout(() => {
        e.target.classList.add('dragging');
        document.body.classList.add('is-dragging-player');
    }, 0);
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    document.body.classList.remove('is-dragging-player');
    
    // Safety cleanup for any stuck drag-over classes
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function handleDrop(e, newPosition) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const draggedPlayerId = e.dataTransfer.getData('text/plain');
    if (!draggedPlayerId) return;

    if (newPosition !== 'Bank' && newPosition !== 'Gast' && newPosition !== 'N/A') {
        const currentOccupant = window.Store.getSPIELER().find(p => p.position === newPosition || (newPosition === 'RM' && p.position === 'M') || (newPosition === 'KM' && p.position === 'K'));
        if (currentOccupant && currentOccupant.id !== draggedPlayerId) {
            window.Store.updatePlayerPosition(currentOccupant.id, 'Bank');
        }
    }
    
    window.Store.updatePlayerPosition(draggedPlayerId, newPosition);
    updateUI();
}

/**
 * Tipp-Erkennung ueber Pointer-Events.
 *
 * Die Spielerkreise sind draggable, und der Drag&Drop-Polyfill fuer Touch
 * haengt sich in die Touch-Events. Dadurch kam auf dem Handy mal ein Klick
 * an und mal nicht - gefuehlt musste man neben den Kreis tippen. Pointer-
 * Events laufen daran vorbei: kurz und ohne Bewegung = Tipp.
 */

// Die Sperre gegen den nachgeschobenen Klick MUSS global sein. Der Tipp
// loest ein Neuzeichnen aus; der Browser schickt den Klick danach an den
// frisch erzeugten Knoten, dessen eigene Sperre noch unberuehrt waere -
// und der haette die Auswahl sofort wieder aufgehoben.
let tapEchoBis = 0;

function istTapEcho() {
    return Date.now() < tapEchoBis;
}

function onTap(el, handler) {
    let sx = 0, sy = 0, t0 = 0, bewegt = false;

    el.addEventListener('pointerdown', function (e) {
        sx = e.clientX; sy = e.clientY; t0 = Date.now(); bewegt = false;
    });

    el.addEventListener('pointermove', function (e) {
        if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) bewegt = true;
    });

    el.addEventListener('pointerup', function (e) {
        if (bewegt || !t0 || Date.now() - t0 > 700) return;
        tapEchoBis = Date.now() + 500;
        e.stopPropagation();
        handler(e);
    });

    // Fallback fuer Maus ohne Pointer-Events und fuer synthetische Klicks
    el.addEventListener('click', function (e) {
        e.stopPropagation();
        if (istTapEcho()) return;
        handler(e);
    });
}

function renderCourtView(container) {
    container.innerHTML = '';
    const spieler = window.Store.getSPIELER();
    
    // 1. Opponent Area
    const opponentArea = document.createElement('div');
    opponentArea.className = 'court-opponent-area';
    const guestPlayer = spieler.find(p => window.Store.istGast(p));
    if (guestPlayer) {
        const oppBtn = document.createElement('button');
        oppBtn.className = 'court-opponent-btn';
        // "Gast / Gegner (0)" war unbeholfen - die Trikotnummer des
        // Pseudo-Spielers sagt niemandem etwas. Jetzt steht dort der
        // eingestellte Gastname, sonst schlicht "Gegner".
        const gastName = window.Store.getTeamNames().gast;
        oppBtn.innerText = (gastName && gastName !== 'GAST') ? gastName : 'Gegner';
        onTap(oppBtn, function () { selectPlayer(guestPlayer.id); });
        if(selectedPlayerId === guestPlayer.id) oppBtn.style.borderColor = 'white';
        opponentArea.appendChild(oppBtn);

        // Gleiches Sheet wie bei den eigenen Spielern. Frueher wuchs hier ein
        // zweispaltiges Menue IN die Gegner-Zeile und schob das Feld nach unten.
        if (selectedPlayerId === guestPlayer.id) openActionSheet(guestPlayer.id);
    }
    container.appendChild(opponentArea);

    // 2. Active Court Area
    const courtArea = document.createElement('div');
    courtArea.className = 'court-active-area';
    courtArea.onclick = () => {
        if (istTapEcho()) return;
        if (selectedPlayerId) selectPlayer(selectedPlayerId);
    };
    
    // Create Drop Zones for Court
    const positions = ['TW', 'LA', 'RL', 'RM', 'RR', 'RA', 'KM'];
    positions.forEach(pos => {
        const dropZone = document.createElement('div');
        dropZone.className = `court-drop-zone pos-${pos}`;
        dropZone.dataset.pos = pos;
        // Beschriftung macht aus dem raetselhaften gestrichelten Kreis
        // einen erkennbar leeren Platz
        dropZone.innerHTML = `<span class="dz-label">${escapeHtml(pos)}</span>`;
        dropZone.addEventListener('dragover', handleDragOver);
        dropZone.addEventListener('dragleave', handleDragLeave);
        dropZone.addEventListener('drop', (e) => handleDrop(e, pos));
        courtArea.appendChild(dropZone);
    });

    // 3. Bench Area
    const benchArea = document.createElement('div');
    benchArea.className = 'court-bench-area';
    benchArea.addEventListener('dragover', handleDragOver);
    benchArea.addEventListener('dragleave', handleDragLeave);
    benchArea.addEventListener('drop', (e) => handleDrop(e, 'Bank'));

    // Render Players
    const occupied = new Set();
    const courtPlayers = [];
    const benchPlayers = [];

    spieler.forEach(p => {
        if (window.Store.istGast(p)) return; 
        
        let posClass = p.position;
        if(posClass === 'M') posClass = 'RM';
        if(posClass === 'K') posClass = 'KM';
        
        if (posClass !== 'Bank' && posClass !== 'N/A' && !occupied.has(posClass)) {
            occupied.add(posClass);
            courtPlayers.push({ player: p, posClass: posClass });
        } else {
            benchPlayers.push({ player: p, posClass: posClass });
        }
    });

    // Wo jemand steht, braucht es keinen leeren Platzhalter mehr
    courtPlayers.forEach(cp => {
        const dz = courtArea.querySelector('.court-drop-zone.pos-' + cp.posClass);
        if (dz) dz.classList.add('is-occupied');
    });

    const allRenderedPlayers = [...courtPlayers.map(cp => ({...cp, area: courtArea})), ...benchPlayers.map(bp => ({...bp, area: benchArea}))];

    allRenderedPlayers.forEach(({player, posClass, area}) => {
        const node = document.createElement('div');
        node.className = `court-player-node ${area === courtArea ? 'pos-' + posClass : ''}`;
        if(selectedPlayerId === player.id) node.classList.add('selected');
        
        node.innerHTML = getPlayerDisplayHtml(player, '50px') + `<span class="name">${escapeHtml(player.name.split(' ')[0])}</span>`;
        node.draggable = true;
        node.addEventListener('dragstart', (e) => handleDragStart(e, player.id));
        node.addEventListener('dragend', handleDragEnd);
        
        if (area === courtArea) {
            node.addEventListener('dragover', handleDragOver);
            node.addEventListener('dragleave', handleDragLeave);
            node.addEventListener('drop', (e) => handleDrop(e, posClass));
        }
        
        onTap(node, function () { selectPlayer(player.id); });
        
        area.appendChild(node);
        
        if (selectedPlayerId === player.id) openActionSheet(player.id, posClass);
    });

    container.appendChild(courtArea);
    container.appendChild(benchArea);
}

window.UI = {
    updateUI,
    switchUIMode,
    renderHistory,
    openHistoryView,
    closeHistoryView,
    updateScoreboard,
    undoLastAction,
    updateActionCount,
    removeActionById,
    restoreAction,
    openActionEdit,
    closeActionEdit,
    reassignAction,
    reassignAssist,
    deleteEditedAction,
    pulseFeedback,
    refreshSuspensions,
    toggleSort,
    selectPlayer,
    selectAction,
    resetActionSelection,
    confirmAssist,
    closeAssistOverlay,
    assistAbfrageAus,
    setAssistAbfrage,
    setHalbzeitLaenge,
    assistAbfrageAktiv,
    saveEditedPlayer,
    startEditPlayer,
    cancelEditPlayer,
    togglePlayerManagement,
    renderRosterList,
    addPlayer,
    removePlayer,
    populateTeamsDropdown,
    saveCurrentRosterAsTeam,
    updateSelectedTeam,
    loadTeam,
    deleteSelectedTeam,
    clearAllPlayers,
    openTimeEdit,
    closeTimeEdit,
    applyTimeEdit,
    parseTimeInput,
    renderGoalkeeperBadge,
    renderTeamNames,
    openTeamNameEdit,
    closeTeamNameEdit,
    applyTeamNameEdit,
    openGoalkeeperPicker,
    closeGoalkeeperPicker,
    selectGoalkeeper,
    escapeHtml
};
