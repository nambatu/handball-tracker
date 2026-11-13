// ===================================================================
// UI COMPONENTS & STATE
// ===================================================================

let selectedPlayerId = null;
let selectedPrimaryAction = null;
let selectedPrimaryActionCategory = null;

let tempActionData = null;

// Frueher gab es zwei Ansichten (Liste und Feld), gemerkt in UI_MODE. Es gibt nur
// noch das Feld; ein alter Wert im Browser wird beim Start einmal aufgeraeumt.
try { localStorage.removeItem('UI_MODE'); } catch (e) { /* egal */ }

/**
 * Neuzeichnen, ohne die Scrollposition zu verlieren.
 *
 * Beim Neuaufbau ist der View-Container kurz leer. Die Seite wird dadurch
 * schlagartig kuerzer, der Browser kappt die Scrollposition auf 0. Seit die
 * Spielansicht nicht mehr scrollt, ist das fast nur noch Vorsicht - die
 * Bank (waagrecht scrollbar) soll ihre Position aber behalten, sonst springt
 * sie nach jeder Aktion zurueck an den Anfang.
 */
function mitScrollposition(fn) {
    const bankAlt = document.querySelector('.court-bench-area');
    const bankX = bankAlt ? bankAlt.scrollLeft : 0;
    const bankY = bankAlt ? bankAlt.scrollTop : 0;

    fn();

    const bank = document.querySelector('.court-bench-area');
    if (bank && (bankX || bankY)) { bank.scrollLeft = bankX; bank.scrollTop = bankY; }
}

function updateUI() {
    mitScrollposition(function () {
        renderDynamicView();
        renderTeamNames();
        zeichneAuszeitZaehler();
    });
    if (window.Timer) window.Timer.updateTimerDisplay();
}

// ===================================================================
// AKTIVER TORWART
// ===================================================================

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
        renderRosterList();   // die Kader-Ansicht zeigt den Torwart
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

    // Abgelaufene Strafen: Platz wird frei, Spieler waehlbar. Das aendert das Feld
    // (gesperrter Platz verschwindet), also einmal komplett neu zeichnen.
    if (window.Store.beendeAbgelaufeneSperren(jetzt).length) {
        updateUI();
        return false;
    }

    const spieler = window.Store.getSPIELER();
    let nochAktiv = false;

    document.querySelectorAll('.player-badge[data-pid]').forEach(function (badge) {
        const p = spieler.find(x => String(x.id) === badge.dataset.pid);
        if (!p) return;

        const rot = window.Store.istDisqualifiziert(p);
        const rest = window.Store.sperreRest(p, jetzt);
        const laeuft = rest > 0;
        let overlay = badge.querySelector('.badge-suspension');

        if (laeuft || rot) {
            nochAktiv = nochAktiv || laeuft;
            const text = rot && !laeuft ? 'Rot' : formatRestZeit(rest);

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

    // Restzeit in den gesperrten Plaetzen
    document.querySelectorAll('.dz-rest[data-pid]').forEach(function (el) {
        const p = spieler.find(x => String(x.id) === el.dataset.pid);
        const text = p ? formatRestZeit(window.Store.sperreRest(p, jetzt)) : '';
        if (el.textContent !== text) el.textContent = text;
    });

    return nochAktiv;
}

function formatRestZeit(sekunden) {
    const m = Math.floor(sekunden / 60);
    const sek = sekunden % 60;
    return m + ':' + (sek < 10 ? '0' : '') + sek;
}

/** Eine Zeitstrafe ist abgelaufen: kurzer Hinweis, der Spieler bleibt auf der Bank. */
function sperreBeendet(p) {
    if (window.Toast) window.Toast(p.name + ' darf wieder spielen', { type: 'info', duration: 4000 });
}

// ---------------------------------------------------------------
// Aktions-Sheet (Spielfeld)
// ---------------------------------------------------------------
// Das Menue haengt bewusst NICHT im #dynamic-view-container:
//   - als Teil des Spielfelds hat es diesem Hoehe weggenommen, dadurch sind
//     bei jeder Auswahl alle prozentual positionierten Spieler gesprungen;
//   - der Container schneidet ab (overflow:hidden), auf dem Handy lag das
//     Menue danach ausserhalb des sichtbaren Bereichs.
// Als fixes Sheet am <body> kann beides nicht passieren: hochkant unten ueber
// dem Feld, quer als Seitenleiste rechts (die Geometrie steht im CSS).

const ACTION_SHEET_ID = 'court-action-sheet';

function closeActionSheet() {
    const alt = document.getElementById(ACTION_SHEET_ID);
    if (alt) alt.remove();
    document.documentElement.style.setProperty('--cas-height', '0px');
    document.documentElement.style.setProperty('--cas-width', '0px');
}

/**
 * Meldet dem CSS, wie viel Platz das Sheet belegt, damit die Toasts nicht
 * ausgerechnet die Aktionsbuttons zudecken: unten als Hoehe, als Seitenleiste
 * als Breite.
 */
function positionActionSheet() {
    const sheet = document.getElementById(ACTION_SHEET_ID);
    if (!sheet) {
        document.documentElement.style.setProperty('--cas-height', '0px');
        document.documentElement.style.setProperty('--cas-width', '0px');
        return;
    }
    const r = sheet.getBoundingClientRect();
    const seitlich = r.width < window.innerWidth * 0.8;
    document.documentElement.style.setProperty('--cas-height', seitlich ? '0px' : Math.round(r.height) + 'px');
    document.documentElement.style.setProperty('--cas-width', seitlich ? Math.round(r.width) + 'px' : '0px');
}

window.addEventListener('resize', positionActionSheet);
window.addEventListener('orientationchange', positionActionSheet);

// Beschriftung der zweiten Stufe: WOHER der Wurf kam, WELCHE Karte, ...
const UNTERAKTION_FRAGE = {
    Wurf: 'Wurfposition', ParadeZone: 'Wurfposition', Verlust: 'Art des Ballverlusts',
    Gewinn: 'Art des Ballgewinns', Karte: 'Kartenfarbe'
};

/** Anzeigename einer Aktion. Gespeichert wird weiter `label` (mit Emoji): Ticker-Regeln vergleichen damit. */
function anzeigeName(a) {
    return a.anzeige || a.label;
}

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
    sheet.setAttribute('role', 'group');
    // Geisterklick: Der Tipp auf einen Spieler loest das Zeichnen aus, das Sheet
    // erscheint UNTER dem Finger, und der nachgereichte Klick des Browsers traf
    // dann die Taste darunter (meist "Wurf mit Tor"). Klicks in den ersten
    // 350 ms nach einem Spielertipp gelten daher nicht als Bedienung.
    sheet.addEventListener('click', function (e) {
        if (Date.now() - letzterTapAm < 350) { e.stopPropagation(); e.preventDefault(); }
    }, true);

    // Kopfzeile: das Sheet sitzt ueber dem Feld, der markierte Spieler ist
    // womoeglich verdeckt. Ohne Namen tippt man im Eifer auf den Falschen.
    const head = document.createElement('div');
    head.className = 'cas-head';
    const istGast = window.Store.istGast(player);
    const titel = istGast
        ? (window.Store.getTeamNames().gast && window.Store.getTeamNames().gast !== 'GAST'
            ? window.Store.getTeamNames().gast : 'Gegner')
        : `#${player.nummer} ${player.name}`;

    const textBox = document.createElement('div');
    textBox.className = 'cas-text';
    const label = document.createElement('span');
    label.className = 'cas-title';
    label.textContent = titel;
    label.title = titel;
    textBox.appendChild(label);

    // Steht die Uhr, sind nur Strafen erlaubt: eine halb gewaehlte andere Aktion verfaellt
    const nurStrafen = !!(window.Timer && window.Timer.darfErfassen(null).nurStrafen);
    if (nurStrafen && selectedPrimaryAction && !window.Timer.darfErfassen(selectedPrimaryAction).ok) {
        selectedPrimaryAction = null;
        selectedPrimaryActionCategory = null;
    }
    const inUnterstufe = !!(selectedPrimaryActionCategory && window.Store.UNTERAKTIONEN[selectedPrimaryActionCategory]);
    const sub = document.createElement('span');
    sub.className = 'cas-sub';
    if (inUnterstufe) {
        const haupt = window.Store.HAUPTAKTIONEN.find(a => a.typ === selectedPrimaryAction);
        sub.textContent = (haupt ? anzeigeName(haupt) : '') + ' · ' + (UNTERAKTION_FRAGE[selectedPrimaryActionCategory] || 'Auswahl');
    } else {
        sub.textContent = 'Aktion wählen';
    }
    textBox.appendChild(sub);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'cas-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Auswahl aufheben');
    closeBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    closeBtn.onclick = (e) => { e.stopPropagation(); selectPlayer(playerId); };
    head.appendChild(textBox);
    head.appendChild(closeBtn);
    sheet.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'cas-grid';

    if (inUnterstufe) {
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'court-action-btn neutral';
        backBtn.textContent = '← Zurück';
        backBtn.onclick = (e) => { e.stopPropagation(); resetActionSelection(); };
        grid.appendChild(backBtn);

        window.Store.UNTERAKTIONEN[selectedPrimaryActionCategory].forEach(u => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'court-action-btn sub-blue';
            if (u.punkt) {
                const punkt = document.createElement('span');
                punkt.className = 'cas-punkt';
                punkt.style.background = u.punkt;
                punkt.setAttribute('aria-hidden', 'true');
                btn.appendChild(punkt);
            }
            btn.appendChild(document.createTextNode(anzeigeName(u)));
            btn.onclick = (e) => { e.stopPropagation(); selectAction(u.typ); };
            grid.appendChild(btn);
        });
    } else {
        getAvailableActionsForPlayer(playerId, posClass).filter(a => !window.Timer || window.Timer.darfErfassen(a.typ).ok).forEach(a => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `court-action-btn ${a.farbe || 'neutral'}`;
            btn.textContent = anzeigeName(a);
            btn.onclick = (e) => { e.stopPropagation(); selectAction(a.typ, a.category); };
            grid.appendChild(btn);
        });
    }

    sheet.appendChild(grid);
    if (nurStrafen) {
        const hinweis = document.createElement('div');
        hinweis.className = 'cas-hinweis';
        hinweis.textContent = 'Uhr steht – nur Strafen. „Weiter“ tippen für alles andere.';
        sheet.appendChild(hinweis);
    }
    document.body.appendChild(sheet);
    positionActionSheet();
}

function renderDynamicView() {
    const container = document.getElementById('dynamic-view-container');
    if (!container) return;

    // Strafen, die inzwischen abgelaufen sind (Uhr vorgestellt, App neu geoeffnet),
    // vor dem Zeichnen aufheben - sonst stuende der Platz noch gesperrt da.
    window.Store.beendeAbgelaufeneSperren(window.Timer ? window.Timer.getTimerState().spielzeitSekunden : 0);

    // Bei jedem Neuzeichnen zuerst weg - sonst bleibt nach dem Abwaehlen
    // ein verwaistes Sheet am <body> haengen.
    closeActionSheet();

    container.innerHTML = '';
    renderCourtView(container);

    // Nach dem Neuaufbau stimmen die Masse wieder - Sheet nachziehen.
    positionActionSheet();
    refreshBalken();
}

// ---------------------------------------------------------------
// Hinweisbalken auf dem Feld
// ---------------------------------------------------------------
// Der Balken sitzt am oberen Rand des Feldes (in .court-active-area), nicht im
// Seitenfluss: wuerde er zwischen Kopfzeile und Feld Platz beanspruchen, rutschte
// beim Erscheinen alles ein Stueck nach unten - mitten im Spiel unter dem Finger
// weg - und auf 320x568 bliebe vom Feld zu wenig. Der obere Feldrand ist leer
// (der oberste Spieler steht deutlich tiefer). Der Inhalt kommt aus
// Timer.getBalken(); jede Sekunde wird nur der Zaehler getauscht.

function refreshBalken() {
    const feld = document.querySelector('.court-active-area');
    if (!feld || !window.Timer) return;
    const info = window.Timer.getBalken();
    let el = feld.querySelector('#spiel-balken');
    if (!info) { if (el) el.remove(); return; }

    const schluessel = [info.art, info.text || info.name || '', info.vorbei ? 'v' : ''].join('|');
    if (el && el.dataset.s === schluessel) {
        const z = el.querySelector('.balken-zeit');
        if (z && z.textContent !== ' · ' + info.zeit) z.textContent = ' · ' + info.zeit;
        return;
    }
    if (el) el.remove();

    el = document.createElement('div');
    el.id = 'spiel-balken';
    el.dataset.s = schluessel;
    el.className = 'spiel-balken balken-' + info.art;
    el.setAttribute('role', 'status');

    if (info.art === 'auszeit' && !info.vorbei) {
        const name = document.createElement('span');
        name.className = 'balken-name';
        name.textContent = info.name;
        name.title = info.name;
        const zeit = document.createElement('span');
        zeit.className = 'balken-zeit';
        zeit.textContent = ' · ' + info.zeit;
        el.appendChild(name);
        el.appendChild(zeit);
    } else if (info.art === 'auszeit') {
        const t = document.createElement('span');
        t.className = 'balken-text';
        t.textContent = 'Auszeit vorbei';
        el.appendChild(t);
    } else if (info.art === 'hinweis') {
        const t = document.createElement('span');
        t.className = 'balken-text';
        t.textContent = info.text;
        el.appendChild(t);
    } else {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'balken-knopf';
        b.textContent = info.text;
        b.onclick = function (e) {
            e.stopPropagation();
            window.Timer.linkAktion(info.aktion);
        };
        el.appendChild(b);
    }
    feld.insertBefore(el, feld.firstChild);
}

/** Auszeiten je Team neben den Namen im Spielstand ("AZ 1"). */
function zeichneAuszeitZaehler() {
    if (!window.Store || !window.Store.zaehleAuszeiten) return;
    const n = window.Store.zaehleAuszeiten();
    ['heim', 'gast'].forEach(function (team) {
        const el = document.getElementById('az-' + team);
        if (!el) return;
        const text = n[team] > 0 ? 'AZ ' + n[team] : '';
        if (el.textContent !== text) el.textContent = text;
        el.title = n[team] > 0 ? n[team] + (n[team] === 1 ? ' Auszeit' : ' Auszeiten') : '';
    });
}

function getPlayerDisplayHtml(player, size = '40px') {
    const timerState = window.Timer ? window.Timer.getTimerState() : { spielzeitSekunden: 0 };

    // Zeitstrafe (mit Restzeit) oder Rote Karte ("Rot"): grau, mit Kennzeichen im Kreis
    let isSuspended = false;
    let suspensionOverlay = '';
    const rest = window.Store.sperreRest(player, timerState.spielzeitSekunden);
    if (rest > 0) {
        isSuspended = true;
        suspensionOverlay = `<span class="badge-suspension">${formatRestZeit(rest)}</span>`;
    } else if (window.Store.istDisqualifiziert(player)) {
        isSuspended = true;
        suspensionOverlay = '<span class="badge-suspension">Rot</span>';
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

// ===================================================================
// BAUKASTEN: Vollbild-Ansicht und Bestaetigungsblatt
// Alle Nebenansichten (Verlauf, Kader, Archiv ...) sollen darauf aufbauen:
// Kopfzeile mit Zurueck, Titel und hoechstens einer Aktion, darunter der
// scrollende Inhalt. Kein confirm/prompt/alert mehr.
// ===================================================================

const Vollbild = (function () {
    const PFEIL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M15 5l-7 7 7 7"/></svg>';

    function istOffen(id) {
        const box = document.getElementById(id);
        return !!box && box.style.display === 'flex';
    }

    /**
     * Oeffnet die Vollbild-Ansicht `id` (wird beim ersten Mal gebaut) und gibt
     * den Inhaltsbereich zurueck. Optionen:
     *   titel   - Text der Kopfzeile
     *   hinweis - kurzer Erklaertext ueber dem Inhalt (optional)
     *   aktion  - { text, onClick } - hoechstens ein Knopf rechts oben (optional)
     *   onZu    - wird nach dem Schliessen gerufen (optional)
     */
    function oeffne(opt) {
        let box = document.getElementById(opt.id);
        if (!box) {
            box = document.createElement('div');
            box.id = opt.id;
            box.className = 'vollbild';
            box.style.display = 'none';
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');
            box.setAttribute('aria-labelledby', opt.id + '-titel');

            const kopf = document.createElement('header');
            kopf.className = 'vollbild-kopf';
            const zurueck = document.createElement('button');
            zurueck.type = 'button';
            zurueck.className = 'vollbild-zurueck';
            zurueck.innerHTML = PFEIL + '<span>Zurück</span>';
            zurueck.addEventListener('click', function () { schliesse(opt.id); });
            const titel = document.createElement('h2');
            titel.id = opt.id + '-titel';
            titel.className = 'vollbild-titel';
            const platz = document.createElement('div');
            platz.className = 'vollbild-aktion';
            kopf.appendChild(zurueck);
            kopf.appendChild(titel);
            kopf.appendChild(platz);

            const inhalt = document.createElement('div');
            inhalt.className = 'vollbild-inhalt';
            const hinweis = document.createElement('p');
            hinweis.className = 'vollbild-hinweis';
            inhalt.appendChild(hinweis);

            box.appendChild(kopf);
            box.appendChild(inhalt);
            document.body.appendChild(box);
        }
        box._onZu = opt.onZu || null;
        box.querySelector('.vollbild-titel').textContent = opt.titel || '';
        const hinweis = box.querySelector('.vollbild-hinweis');
        hinweis.textContent = opt.hinweis || '';
        hinweis.hidden = !opt.hinweis;

        const platz = box.querySelector('.vollbild-aktion');
        platz.innerHTML = '';
        if (opt.aktion) {
            const knopf = document.createElement('button');
            knopf.type = 'button';
            knopf.className = 'btn vollbild-aktion-knopf';
            knopf.textContent = opt.aktion.text;
            knopf.addEventListener('click', opt.aktion.onClick);
            platz.appendChild(knopf);
        }

        box.style.display = 'flex';
        const inhalt = box.querySelector('.vollbild-inhalt');
        inhalt.scrollTop = 0;
        return inhalt;
    }

    function schliesse(id) {
        const box = document.getElementById(id);
        if (!box || box.style.display === 'none') return;
        box.style.display = 'none';
        if (box._onZu) box._onZu();
    }

    return { oeffne, schliesse, istOffen };
})();

/**
 * Bestaetigungsblatt statt confirm(). Gibt ein Versprechen zurueck: true bei
 * "Ja", false bei "Abbrechen" oder Tipp daneben.
 *   titel, text, okText (Standard "OK"), gefahr (roter Knopf, bei Loeschen)
 */
function bestaetigen(opt) {
    return new Promise(function (resolve) {
        const sheet = document.createElement('div');
        sheet.className = 'sheet';
        sheet.setAttribute('role', 'alertdialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-labelledby', 'bestaetigen-titel');
        const panel = document.createElement('div');
        panel.className = 'sheet-panel';
        const titel = document.createElement('h2');
        titel.id = 'bestaetigen-titel';
        titel.className = 'sheet-titel';
        titel.textContent = opt.titel || 'Sicher?';
        panel.appendChild(titel);
        if (opt.text) {
            const text = document.createElement('p');
            text.className = 'sheet-text';
            text.textContent = opt.text;
            panel.appendChild(text);
        }
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'btn btn-block ' + (opt.gefahr ? 'btn-danger' : 'btn-primary');
        ok.textContent = opt.okText || 'OK';
        const nein = document.createElement('button');
        nein.type = 'button';
        nein.className = 'btn btn-block';
        nein.textContent = 'Abbrechen';
        panel.appendChild(ok);
        panel.appendChild(nein);
        sheet.appendChild(panel);

        function fertig(antwort) {
            sheet.remove();
            resolve(antwort);
        }
        ok.addEventListener('click', function () { fertig(true); });
        nein.addEventListener('click', function () { fertig(false); });
        sheet.addEventListener('click', function (e) { if (e.target === sheet) fertig(false); });
        document.body.appendChild(sheet);
        nein.focus();
    });
}

function sortPlayers() {
    // Der Kader steht immer nach Trikotnummer. Die frueheren Sortierknoepfe
    // gab es nur in der Listenansicht.
    window.Store.getSPIELER().sort((a, b) => a.nummer - b.nummer);
}

/**
 * Baut die Verlaufseintraege in einen Container (das Verlauf-Overlay).
 * Das frueher daneben stehende Seitenpanel ist mit der Listenansicht entfallen.
 */
function buildHistoryInto(container, limit) {
    if (!container) return;
    container.innerHTML = '';

    const aktionen = window.Store.loadActions();
    const spieler = window.Store.getSPIELER();
    // Auszeiten sind keine Spieleraktionen, gehoeren aber an ihre Stelle im
    // Verlauf - sonst sucht man sie dort vergeblich.
    const auszeiten = window.Store.getMarken().filter(function (m) { return m && m.art === 'auszeit'; });

    if (aktionen.length === 0 && auszeiten.length === 0) {
        container.innerHTML = '<p class="history-empty">Noch keine Aktionen erfasst.</p>';
        return;
    }

    const eintraege = aktionen.map(function (a) { return { t: a.timestamp || 0, aktion: a }; })
        .concat(auszeiten.map(function (m) { return { t: m.timestamp || 0, marke: m }; }));
    // Array.sort ist stabil: gleichzeitige Eintraege behalten ihre Reihenfolge
    eintraege.sort(function (a, b) { return a.t - b.t; });

    eintraege.reverse().slice(0, limit || 25).forEach(item => {
        if (item.marke) {
            container.appendChild(baueAuszeitZeile(item.marke));
            return;
        }
        const entry = item.aktion;
        const player = spieler.find(s => s.id === entry.spielerId);
        const playerNumber = player ? player.nummer : '?';
        const playerName = player ? player.name : 'Unbekannt';

        const assistPlayer = entry.assistId ? spieler.find(p => p.id === entry.assistId) : null;
        const assistText = assistPlayer
            ? `<br><small class="history-assist">Assist: ${escapeHtml(assistPlayer.name)}</small>` : '';

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
            <span class="history-action">${escapeHtml(ohneEmoji(entry.label))}</span>
        `;
        container.appendChild(el);
    });
}

/** Gespeicherte Bezeichnungen tragen ein Emoji (der Ticker braucht es); die Ansicht zeigt nur den Text. */
function ohneEmoji(text) {
    return String(text || '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]/gu, '').trim();
}

function auszeitTeamName(team) {
    const n = window.Store.getTeamNames();
    return team === 'heim' ? n.heim : n.gast;
}

function baueAuszeitZeile(marke) {
    const el = document.createElement('div');
    el.className = 'history-entry history-marke';

    const text = document.createElement('div');
    text.className = 'history-marke-text';
    const zeit = document.createElement('span');
    zeit.className = 'history-time';
    zeit.textContent = window.Timer.formatTime(marke.spielzeit);
    const was = document.createElement('span');
    was.className = 'history-action';
    was.textContent = 'Auszeit ' + auszeitTeamName(marke.team);
    text.appendChild(zeit);
    text.appendChild(was);

    const weg = document.createElement('button');
    weg.type = 'button';
    weg.className = 'history-weg';
    weg.setAttribute('aria-label', 'Auszeit löschen');
    weg.title = 'Auszeit löschen';
    weg.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3"/></svg>';
    weg.onclick = function (e) {
        e.stopPropagation();
        const entfernt = window.Timer.auszeitEntfernen(marke.id);
        renderHistory();
        if (entfernt && window.Toast) {
            window.Toast('Auszeit gelöscht.', {
                type: 'info', duration: 6000, actionLabel: 'Rückgängig',
                onAction: function () { window.Timer.auszeitWiederherstellen(entfernt); renderHistory(); updateScoreboard(); }
            });
        }
    };

    el.appendChild(text);
    el.appendChild(weg);
    return el;
}

function renderHistory() {
    // Ansicht mitziehen, falls sie gerade offen ist
    if (Vollbild.istOffen('history-view')) {
        buildHistoryInto(document.getElementById('history-view-liste'), 200);
    }

    updateScoreboard();
}

function openHistoryView() {
    const inhalt = Vollbild.oeffne({
        id: 'history-view',
        titel: 'Verlauf',
        hinweis: 'Eintrag antippen, um ihn zu korrigieren oder zu löschen.'
    });
    let liste = document.getElementById('history-view-liste');
    if (!liste) {
        liste = document.createElement('div');
        liste.id = 'history-view-liste';
        liste.className = 'karten-liste';
        inhalt.appendChild(liste);
    }
    buildHistoryInto(liste, 200);
}

function closeHistoryView() {
    Vollbild.schliesse('history-view');
}

// ===================================================================
// TEAMNAMEN
// ===================================================================

function renderTeamNames() {
    const names = window.Store.getTeamNames();
    const heimEl = document.getElementById('team-name');
    const gastEl = document.getElementById('guest-name');
    // title: im Stand werden lange Namen gekuerzt; voll zu sehen sind sie per Tipp
    // auf den Stand (Spiel-Info) und hier als Tooltip.
    if (heimEl) { heimEl.textContent = names.heim; heimEl.title = names.heim; }
    if (gastEl) { gastEl.textContent = names.gast; gastEl.title = names.gast; }
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
    zeichneAuszeitZaehler();
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

/**
 * Zeigt den Grund einer Ablehnung (Phase der Uhr) als kurzen Hinweis.
 * Die Entscheidung selbst faellt in Timer.darfErfassen - nur dort.
 */
function zeigeErfassenAbgelehnt(grund) {
    if (window.Toast && grund) window.Toast(grund, { type: 'warn', duration: 3500 });
}

function selectPlayer(playerId) {
    // Gesperrte Spieler (Zeitstrafe, Rot) koennen nichts tun: kurzer Hinweis, kein Sheet
    const gewaehlt = window.Store.getSPIELER().find(p => p.id === playerId);
    if (gewaehlt && window.Store.istGesperrt(gewaehlt)) {
        if (window.Toast) window.Toast(window.Store.sperreText(gewaehlt), { type: 'warn', duration: 3000 });
        return;
    }
    // Abwaehlen geht immer. Neu waehlen nur, wenn die Uhr irgendeine Aktion zulaesst.
    if (selectedPlayerId !== playerId && window.Timer) {
        const erlaubt = window.Timer.darfErfassen(null);
        if (!erlaubt.ok) {
            zeigeErfassenAbgelehnt(erlaubt.grund);
            return;
        }
    }
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

    // Hat sich die Uhr seit dem Oeffnen des Sheets geaendert (angehalten, Pause),
    // gilt das schon hier - nicht erst beim Speichern.
    const gewuenscht = selectedPrimaryAction ? selectedPrimaryAction + '_' + actionType : actionType;
    const erlaubt = window.Timer ? window.Timer.darfErfassen(gewuenscht) : { ok: true };
    if (!erlaubt.ok) {
        erfassenAbgelehnt(erlaubt.grund);
        return;
    }

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
    // Vorab pruefen, damit nach einer Ablehnung nicht erst der Assist abgefragt wird.
    // Endgueltig entscheidet Store.erfasseAktion beim Speichern.
    const erlaubt = window.Timer ? window.Timer.darfErfassen(finalActionType) : { ok: true };
    if (!erlaubt.ok) {
        erfassenAbgelehnt(erlaubt.grund);
        return;
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

/**
 * Aktion wurde abgelehnt (Uhr steht oder Spiel nicht in einer Halbzeit):
 * Sheet und Assist-Abfrage schliessen, Auswahl aufheben, Grund zeigen.
 */
function erfassenAbgelehnt(grund) {
    tempActionData = null;
    const overlay = document.getElementById('assist-overlay');
    if (overlay) overlay.style.display = 'none';
    selectedPlayerId = null;
    selectedPrimaryAction = null;
    selectedPrimaryActionCategory = null;
    updateUI();
    zeigeErfassenAbgelehnt(grund);
}

/** Neues Spiel oder Spiel verlassen: keine Auswahl uebernehmen. (Name bleibt, start.js und timer.js rufen ihn.) */
function vergissUhrWahl() {
    selectedPlayerId = null;
    selectedPrimaryAction = null;
    selectedPrimaryActionCategory = null;
    tempActionData = null;
}

// ===================================================================
// SHEETS (Menue, Spiel-Info, Zeitkorrektur)
// ===================================================================
// Ein Sheet ist ein abgedunkelter Bereich mit Tafel: hochkant von unten,
// quer als Dialog in der Mitte (CSS). Antippen des dunklen Bereichs und
// Escape schliessen. Sie liegen als <div hidden> fest im HTML.

const SHEET_IDS = ['menue', 'spiel-info', 'time-edit', 'auszeit-wahl', 'archiv-frage'];

function zeigeSheet(id) {
    const box = document.getElementById(id);
    if (!box) return;
    box.hidden = false;
    // Fokus nur im Zeitfeld (dort will man gleich tippen). Sonst klappt auf dem
    // Handy die Tastatur auf oder ein Knopf wirkt vorgewaehlt.
    if (id === 'time-edit') {
        const f = document.getElementById('time-edit-input');
        if (f) { f.focus(); f.select(); }
    }
}

function schliesseSheet(id) {
    const box = document.getElementById(id);
    if (box) box.hidden = true;
    // Wer das Sheet wegtippt, beantwortet damit die Frage mit "nein"
    if (id === 'archiv-frage' && archivFrageAntwort) {
        const r = archivFrageAntwort;
        archivFrageAntwort = null;
        r(false);
    }
}

// ---------------------------------------------------------------
// Archivieren (Rueckfrage) und Auszeit (Wahl)
// ---------------------------------------------------------------

let archivFrageAntwort = null;

/** Zeigt die Rueckfrage. @returns {Promise<boolean>} true = archivieren */
function frageArchivieren() {
    return new Promise(function (fertig) {
        if (archivFrageAntwort) archivFrageAntwort(false);
        archivFrageAntwort = fertig;
        zeigeSheet('archiv-frage');
    });
}

function archivFrageWahl(ja) {
    const r = archivFrageAntwort;
    archivFrageAntwort = null;
    schliesseSheet('archiv-frage');
    if (r) r(!!ja);
}

/** "Spiel archivieren": Rueckfrage, archivieren, zurueck zur Startseite. */
async function archivierenStarten() {
    const geschafft = window.Timer ? await window.Timer.endGame() : false;
    if (geschafft && window.Start) window.Start.zeige();
    return geschafft;
}

function zeigeAuszeitWahl() {
    const heim = document.getElementById('auszeit-heim');
    const gast = document.getElementById('auszeit-gast');
    if (heim) heim.textContent = auszeitTeamName('heim');
    if (gast) gast.textContent = auszeitTeamName('gast');
    zeigeSheet('auszeit-wahl');
}

function auszeitWahl(team) {
    schliesseSheet('auszeit-wahl');
    const marke = window.Timer.auszeitEintragen(team);
    if (!marke) return;
    renderHistory();
    if (window.Toast) {
        window.Toast('Auszeit ' + auszeitTeamName(team) + ' eingetragen', {
            type: 'info', duration: 6000, actionLabel: 'Rückgängig',
            onAction: function () { window.Timer.auszeitEntfernen(marke.id); renderHistory(); }
        });
    }
}

/** Abbrechen: die Uhr bleibt stehen, mit "Weiter" geht es weiter. */
function auszeitAbbrechen() {
    schliesseSheet('auszeit-wahl');
}

function schliesseAlleSheets() {
    SHEET_IDS.forEach(schliesseSheet);
}

SHEET_IDS.forEach(function (id) {
    document.addEventListener('DOMContentLoaded', function () {
        const box = document.getElementById(id);
        if (!box) return;
        // Nur ein Tipp AUF den dunklen Bereich schliesst, nicht ein Tipp in der Tafel
        box.addEventListener('click', function (e) {
            if (e.target !== box) return;
            // Geisterklick: das Sheet kann UNTER dem Finger erscheinen (Tipp auf
            // einen Spieler), und der nachgereichte Klick traefe sonst den
            // dunklen Bereich und schlosse es sofort wieder.
            if (Date.now() - letzterTapAm < 450) return;
            schliesseSheet(id);
        });
    });
});

document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    for (let i = SHEET_IDS.length - 1; i >= 0; i--) {
        const box = document.getElementById(SHEET_IDS[i]);
        if (box && !box.hidden) { schliesseSheet(SHEET_IDS[i]); return; }
    }
});

/** Spielansicht verlassen (zurueck zur Startseite): nichts darf offen oder gewaehlt bleiben. */
function verlasseSpiel() {
    selectedPlayerId = null;
    selectedPrimaryAction = null;
    selectedPrimaryActionCategory = null;
    closeActionSheet();
    schliesseAlleSheets();
}

function openMenue() {
    const st = window.Timer ? window.Timer.getTimerState() : { phase: 'vor', spielzeitSekunden: 0, halbzeitSekunden: 1800 };
    // Nur die Schritte, die in der jetzigen Phase ausser der Reihe Sinn ergeben.
    // Den regulaeren naechsten Schritt zeigt die Haupttaste.
    const hz = st.halbzeitSekunden;
    const frueheHalbzeit = st.phase === 'hz1' && st.spielzeitSekunden < hz;
    const fruehesEnde = st.phase === 'hz2' && st.spielzeitSekunden < 2 * hz;
    const setze = function (id, an) { const el = document.getElementById(id); if (el) el.hidden = !an; };
    setze('menue-halbzeit', frueheHalbzeit);
    setze('menue-abpfiff', fruehesEnde);
    setze('menue-ablauf', frueheHalbzeit || fruehesEnde);
    const beenden = document.getElementById('menue-beenden');
    if (beenden) beenden.textContent = st.phase === 'ende' ? 'Spiel archivieren' : 'Spiel beenden und archivieren';
    zeigeSheet('menue');
}

function closeMenue() {
    schliesseSheet('menue');
}

/** Ein Eintrag im Menue: erst zu, dann auf - sonst liegt das Menue ueber dem Overlay. */
async function menueWahl(name) {
    closeMenue();
    switch (name) {
        case 'halbzeit': window.Timer.vorzeitig('halbzeit'); break;
        case 'abpfiff': window.Timer.vorzeitig('abpfiff'); break;
        case 'statistik': window.Stats.showStats(); break;
        case 'bericht': window.Report.showCurrentReport(); break;
        case 'verlauf': openHistoryView(); break;
        case 'kader': togglePlayerManagement(); break;
        case 'ticker': window.TickerUI.oeffne(); break;
        case 'archiv': window.openArchiveModal(); break;
        case 'beenden': {
            // Erst Abpfiff, dann die Rueckfrage; "erst archivieren, dann loeschen"
            // steckt in endGame. Danach gibt es nichts mehr zu tracken: Startseite.
            const geschafft = window.Timer ? await window.Timer.spielBeendenUndArchivieren() : false;
            if (geschafft && window.Start) window.Start.zeige();
            break;
        }
    }
}

function openSpielInfo() {
    const n = window.Store.getTeamNames();
    const set = function (id, text) { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('info-spielname', window.Store.getSpielName() || 'Ohne Namen');
    set('info-heim', n.heim);
    set('info-gast', n.gast);
    zeigeSheet('spiel-info');
}

function closeSpielInfo() {
    schliesseSheet('spiel-info');
}

function spielInfoNamenAendern() {
    closeSpielInfo();
    openTeamNameEdit();
}

function executeSaveAction(player, actionType, actionLabel, category, assistId) {
    // Der Speicherweg ist Store.erfasseAktion. Dort entscheidet die Uhr (Phase),
    // ob erfasst werden darf - hier nur die Folgen fuer die Anzeige.
    const ergebnis = window.Store.erfasseAktion(player, actionType, actionLabel, category, assistId);
    if (!ergebnis.ok) {
        erfassenAbgelehnt(ergebnis.grund);
        return;
    }
    const newAction = ergebnis.aktion;
    const timerState = { spielzeitSekunden: newAction.spielzeit };

    if (actionType === 'Zeitstrafe') {
        // Spieler auf die Bank, Platz sperren (Gegner: nur die Zeit)
        window.Store.sperreSetzen(player.id, timerState.spielzeitSekunden);
    } else if (actionType.indexOf('Karte_Rot') !== -1) {
        window.Store.disqualifiziere(player.id);
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

    zeigeSheet('time-edit');

    input.onkeydown = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); applyTimeEdit(); }
    };
}

function closeTimeEdit() {
    schliesseSheet('time-edit');
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

// ===================================================================
// KADER (Vollbild): Spieler, Mannschaften, Spiel-Einstellungen
// Aufgebaut auf dem Baukasten (Vollbild, bestaetigen). Spieler anlegen und
// bearbeiten, Mannschaften laden und speichern laufen ueber Blaetter statt
// ueber Inline-Formulare und confirm().
// ===================================================================

const POSITIONS_AUSWAHL = [
    ['TW', 'Torwart (TW)'], ['LA', 'Linksaußen (LA)'], ['RL', 'Rückraum Links (RL)'],
    ['M', 'Mitte (RM)'], ['RR', 'Rückraum Rechts (RR)'], ['RA', 'Rechtsaußen (RA)'],
    ['K', 'Kreis (K)'], ['N/A', 'Bank / keine Position']
];

const KADER_ID = 'player-management-view';
let kaderTeams = [];
let kaderTeamsStatus = 'lade';   // 'lade' | 'ok' | 'fehler'

/**
 * Blatt von unten (wie das Bestaetigungsblatt) mit Titel und Schliessen-Kreuz.
 * baue(panel, zu) fuellt es; zu() schliesst. beiZu (optional) laeuft bei jedem
 * Schliessen, auch bei Tipp daneben. Gibt zu zurueck.
 */
function blatt(titel, baue, beiZu) {
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    const panel = document.createElement('div');
    panel.className = 'sheet-panel';
    const kopf = document.createElement('div');
    kopf.className = 'sheet-kopf';
    const h = document.createElement('h2');
    h.className = 'sheet-titel';
    h.textContent = titel;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'sheet-zu';
    x.setAttribute('aria-label', 'Schließen');
    x.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    kopf.appendChild(h);
    kopf.appendChild(x);
    panel.appendChild(kopf);
    sheet.appendChild(panel);
    function zu() {
        if (!sheet.isConnected) return;
        sheet.remove();
        if (beiZu) beiZu();
    }
    x.addEventListener('click', zu);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) zu(); });
    document.body.appendChild(sheet);
    baue(panel, zu);
    return zu;
}

/** Kleines Hilfsstueck: Element mit Klasse und Text. */
function bauEl(tag, klasse, text) {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text !== undefined) e.textContent = text;
    return e;
}

function bauKnopf(text, klasse, onClick) {
    const b = bauEl('button', 'btn ' + klasse, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}

async function togglePlayerManagement() {
    if (Vollbild.istOffen(KADER_ID)) {
        Vollbild.schliesse(KADER_ID);
        return;
    }
    const inhalt = Vollbild.oeffne({
        id: KADER_ID,
        titel: 'Kader',
        aktion: { text: 'Spieler +', onClick: function () { spielerBlatt(null); } },
        onZu: function () { updateUI(); }
    });
    let wurzel = document.getElementById('kader-inhalt');
    if (!wurzel) {
        wurzel = bauEl('div', 'kader-inhalt');
        wurzel.id = 'kader-inhalt';
        inhalt.appendChild(wurzel);
    }
    zeichneKader();
    kaderTeamsStatus = 'lade';
    zeichneKader();
    kaderTeams = await window.Store.getTeams();
    kaderTeamsStatus = 'ok';
    zeichneKader();
}

/** Kleines Rundbild: Foto oder Trikotnummer. */
function kaderBild(p) {
    if (p.avatarUrl) {
        const img = bauEl('img', 'kader-bild');
        img.src = p.avatarUrl;
        img.alt = '';
        return img;
    }
    return bauEl('span', 'kader-bild kader-nummer', String(p.nummer));
}

function zeichneKader() {
    const wurzel = document.getElementById('kader-inhalt');
    if (!wurzel) return;
    wurzel.innerHTML = '';
    sortPlayers();
    const spieler = window.Store.getSPIELER();

    // ---- Spieler ----
    const kSpieler = bauEl('section', 'karte');
    kSpieler.appendChild(bauEl('h3', 'karte-titel', 'Spieler (' + spieler.length + ')'));
    const liste = bauEl('div', 'kader-liste');
    spieler.forEach(function (p) {
        const zeile = bauEl('button', 'kader-zeile');
        zeile.type = 'button';
        zeile.appendChild(kaderBild(p));
        const mitte = bauEl('span', 'kader-text');
        mitte.appendChild(bauEl('span', 'kader-name', p.name));
        const posText = (POSITIONS_AUSWAHL.find(function (x) { return x[0] === p.position; }) || [0, p.position])[1];
        const istGast = window.Store.istGast(p);
        const posAnzeige = istGast ? 'Gegnerseite' : posText;
        // Die Nummer steht schon im Rundbild; nur bei einem Foto fehlt sie dort.
        mitte.appendChild(bauEl('span', 'kader-zusatz', p.avatarUrl ? '#' + p.nummer + ' · ' + posAnzeige : posAnzeige));
        zeile.appendChild(mitte);
        zeile.addEventListener('click', function () { spielerBlatt(p.id); });
        liste.appendChild(zeile);
    });
    if (!spieler.length) liste.appendChild(bauEl('p', 'history-empty', 'Noch keine Spieler. Oben „Spieler +“ antippen.'));
    kSpieler.appendChild(liste);
    wurzel.appendChild(kSpieler);

    // ---- Mannschaften ----
    const kTeam = bauEl('section', 'karte');
    kTeam.appendChild(bauEl('h3', 'karte-titel', 'Gespeicherte Mannschaften'));
    const tListe = bauEl('div', 'kader-liste');
    if (kaderTeamsStatus === 'lade') {
        tListe.appendChild(bauEl('p', 'feld-hinweis', 'Lade …'));
    } else if (!kaderTeams.length) {
        tListe.appendChild(bauEl('p', 'feld-hinweis', 'Noch keine Mannschaft gespeichert.'));
    }
    kaderTeams.forEach(function (t) {
        const zeile = bauEl('button', 'kader-zeile');
        zeile.type = 'button';
        const mitte = bauEl('span', 'kader-text');
        mitte.appendChild(bauEl('span', 'kader-name', t.name));
        const n = (t.players || []).filter(function (p) { return !window.Store.istGast(p); }).length;
        mitte.appendChild(bauEl('span', 'kader-zusatz', n + ' Spieler'));
        zeile.appendChild(mitte);
        zeile.addEventListener('click', function () { teamBlatt(t); });
        tListe.appendChild(zeile);
    });
    kTeam.appendChild(tListe);
    kTeam.appendChild(bauKnopf('Aktuellen Kader als Mannschaft speichern', 'btn-block', teamSpeichernBlatt));
    wurzel.appendChild(kTeam);

    // ---- Spiel-Einstellungen (Ids bleiben: setAssistAbfrage/setHalbzeitLaenge ziehen sie nach) ----
    const kSpiel = bauEl('section', 'karte');
    kSpiel.appendChild(bauEl('h3', 'karte-titel', 'Spiel'));
    const assist = bauEl('label', 'kader-schalter');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = 'setting-assist';
    box.checked = assistAbfrageAktiv();
    box.addEventListener('change', function () { setAssistAbfrage(box.checked); });
    assist.appendChild(box);
    assist.appendChild(bauEl('span', '', 'Nach jedem Tor nach dem Vorlagengeber fragen'));
    kSpiel.appendChild(assist);

    kSpiel.appendChild(bauEl('label', 'feld-label', 'Spielzeit')).htmlFor = 'setting-halbzeit';
    const sel = bauEl('select', 'feld');
    sel.id = 'setting-halbzeit';
    [[30, '2 × 30 Minuten (Erwachsene)'], [25, '2 × 25 Minuten (A-/B-Jugend)'], [20, '2 × 20 Minuten (C-/D-Jugend)'],
     [15, '2 × 15 Minuten (E-/F-Jugend)'], [10, '2 × 10 Minuten (Turnier)']].forEach(function (o) {
        const opt = document.createElement('option');
        opt.value = String(o[0]);
        opt.textContent = o[1];
        sel.appendChild(opt);
    });
    if (window.Timer) sel.value = String(window.Timer.getHalbzeitMinuten());
    sel.addEventListener('change', function () { setHalbzeitLaenge(sel.value); });
    kSpiel.appendChild(sel);

    kSpiel.appendChild(bauEl('span', 'feld-label', 'Torwart im Tor'));
    const gk = window.Store.getActiveGoalkeeper();
    const gkKnopf = bauKnopf(gk ? '#' + gk.nummer + ' ' + String(gk.name).split(' ')[0] : 'Kein Torwart – wählen',
        'btn-block', openGoalkeeperPicker);
    gkKnopf.id = 'setting-gk';
    kSpiel.appendChild(gkKnopf);
    wurzel.appendChild(kSpiel);

    // ---- Gefahrenzone ----
    if (spieler.some(function (p) { return !window.Store.istGast(p); })) {
        wurzel.appendChild(bauKnopf('Alle Spieler löschen', 'btn-block btn-danger', clearAllPlayers));
    }
}

/** Seit dem Umbau nur noch ein Neuzeichnen (wird auch vom Ticker gerufen). */
function renderRosterList() {
    if (Vollbild.istOffen(KADER_ID)) zeichneKader();
}

/** Foto hochladen; gibt die Adresse zurueck oder null. */
async function ladeFotoHoch(datei) {
    const formData = new FormData();
    formData.append('avatar', datei);
    try {
        const res = await fetch('/api/upload-avatar', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.ok && data.avatarUrl) return data.avatarUrl;
        if (window.Toast) window.Toast(data.error || 'Foto-Upload fehlgeschlagen.', { type: 'error' });
    } catch (e) {
        console.error('Upload failed', e);
        if (window.Toast) window.Toast('Foto-Upload fehlgeschlagen – keine Verbindung?', { type: 'error' });
    }
    return null;
}

/** Blatt zum Anlegen (id = null) oder Bearbeiten eines Spielers. */
function spielerBlatt(id) {
    const p = id === null ? null : window.Store.getSPIELER().find(function (x) { return String(x.id) === String(id); });
    if (id !== null && !p) return;
    const istGast = !!p && window.Store.istGast(p);

    blatt(p ? 'Spieler bearbeiten' : 'Neuer Spieler', function (panel, zu) {
        const name = document.createElement('input');
        name.type = 'text'; name.id = 'input-name'; name.className = 'feld';
        name.autocomplete = 'off'; name.enterKeyHint = 'done'; name.placeholder = 'Name';
        name.value = p ? p.name : '';
        const nr = document.createElement('input');
        nr.type = 'number'; nr.id = 'input-number'; nr.className = 'feld';
        nr.min = '0'; nr.inputMode = 'numeric'; nr.enterKeyHint = 'done'; nr.placeholder = 'Nr.';
        nr.value = p ? p.nummer : '';
        const pos = document.createElement('select');
        pos.id = 'input-position'; pos.className = 'feld';
        POSITIONS_AUSWAHL.forEach(function (o) {
            const opt = document.createElement('option');
            opt.value = o[0]; opt.textContent = o[1];
            pos.appendChild(opt);
        });
        pos.value = p ? p.position : 'N/A';
        const foto = document.createElement('input');
        foto.type = 'file'; foto.id = 'input-avatar'; foto.className = 'feld'; foto.accept = 'image/*';

        // Reihenfolge ist Absicht: Name, Nummer, Position, dann der Knopf. Das
        // Foto steht ganz unten, damit die Tastatur den Knopf nicht verdeckt.
        const l1 = bauEl('label', 'feld-label', 'Name'); l1.htmlFor = 'input-name';
        const l2 = bauEl('label', 'feld-label', 'Nummer'); l2.htmlFor = 'input-number';
        const l3 = bauEl('label', 'feld-label', 'Position'); l3.htmlFor = 'input-position';
        const l4 = bauEl('label', 'feld-label', 'Foto (optional)'); l4.htmlFor = 'input-avatar';
        [l1, name, l2, nr, l3, pos].forEach(function (e) { panel.appendChild(e); });

        const speichern = bauKnopf(p ? 'Speichern' : 'Hinzufügen', 'btn-primary btn-block kader-ok', async function () {
            const n = String(name.value).trim();
            const num = parseInt(nr.value, 10);
            if (!n || isNaN(num)) {
                if (window.Toast) window.Toast('Bitte Name und Nummer angeben.', { type: 'warn' });
                return;
            }
            speichern.disabled = true;
            let url = null;
            if (foto.files.length > 0) url = await ladeFotoHoch(foto.files[0]);
            if (p) {
                window.Store.updatePlayerData(p.id, { name: n, nummer: num, position: pos.value });
                if (url) window.Store.updatePlayerAvatar(p.id, url);
                zu();
                if (window.Toast) window.Toast('Spieler geändert.', { type: 'success', duration: 2500 });
            } else {
                window.Store.addPlayerToStore(n, num, pos.value, url);
                name.value = ''; nr.value = ''; foto.value = '';
                if (window.Toast) window.Toast('#' + num + ' ' + n + ' hinzugefügt.', { type: 'success', duration: 2000 });
                // Offen lassen: so tippt man einen ganzen Kader am Stueck ein.
                try { name.focus({ preventScroll: true }); } catch (e) { name.focus(); }
            }
            speichern.disabled = false;
            zeichneKader();
            updateUI();
        });
        [name, nr].forEach(function (f) {
            f.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); speichern.click(); }
            });
        });
        panel.appendChild(l4);
        panel.appendChild(foto);
        speichern.style.marginTop = '16px';
        panel.appendChild(speichern);

        if (!p) {
            panel.appendChild(bauKnopf('Fertig', 'btn-block', zu));
            return;
        }

        // Eigener Ticker-Spruch (liegt hier, weil man den Spieler ohnehin anfasst)
        if (!istGast && window.TickerUI) {
            const behaelter = bauEl('div', 'roster-ticker');
            const hat = window.TickerUI.hatRegeln(p.id);
            panel.appendChild(bauKnopf('Eigener Ticker-Spruch' + (hat ? ' (gesetzt)' : ''), 'btn-block',
                function () { window.TickerUI.toggleSpielerRegeln(p.id, behaelter); }));
            panel.appendChild(behaelter);
        }
        if (!istGast) {
            panel.appendChild(bauKnopf('Spieler löschen', 'btn-block btn-danger', async function () {
                const ja = await bestaetigen({
                    titel: '#' + p.nummer + ' ' + p.name + ' löschen?',
                    text: 'Der Spieler verschwindet aus dem Kader.', okText: 'Löschen', gefahr: true
                });
                if (!ja) return;
                window.Store.removePlayerFromStore(p.id);
                if (selectedPlayerId && String(selectedPlayerId) === String(p.id)) selectedPlayerId = null;
                zu();
                zeichneKader();
                updateUI();
            }));
        } else {
            panel.appendChild(bauEl('p', 'sheet-text', '„Gegner“ zählt die gegnerischen Tore und kann nicht gelöscht werden.'));
        }
    });
    const erstes = document.getElementById('input-name');
    if (erstes && !p) { try { erstes.focus({ preventScroll: true }); } catch (e) { /* egal */ } }
}

/** Blatt: aktuellen Kader als neue Mannschaft speichern. */
function teamSpeichernBlatt() {
    const spieler = window.Store.getSPIELER();
    if (!spieler.some(function (p) { return !window.Store.istGast(p); })) {
        if (window.Toast) window.Toast('Der Kader ist leer.', { type: 'warn' });
        return;
    }
    blatt('Mannschaft speichern', function (panel, zu) {
        const l = bauEl('label', 'feld-label', 'Name der Mannschaft'); l.htmlFor = 'new-team-name';
        const f = document.createElement('input');
        f.type = 'text'; f.id = 'new-team-name'; f.className = 'feld'; f.autocomplete = 'off'; f.enterKeyHint = 'done';
        panel.appendChild(l);
        panel.appendChild(f);
        const ok = bauKnopf('Speichern', 'btn-primary btn-block kader-ok', async function () {
            const name = f.value.trim();
            if (!name) {
                if (window.Toast) window.Toast('Bitte einen Namen eingeben.', { type: 'warn' });
                return;
            }
            ok.disabled = true;
            const r = await window.Store.saveTeam({ name, players: window.Store.getSPIELER() });
            ok.disabled = false;
            if (!r) return;
            zu();
            if (window.Toast) window.Toast('Mannschaft „' + name + '“ gespeichert.', { type: 'success' });
            await ladeTeamsNeu();
        });
        f.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
        ok.style.marginTop = '16px';
        panel.appendChild(ok);
        try { f.focus({ preventScroll: true }); } catch (e) { /* egal */ }
    });
}

async function ladeTeamsNeu() {
    kaderTeams = await window.Store.getTeams();
    kaderTeamsStatus = 'ok';
    if (Vollbild.istOffen(KADER_ID)) zeichneKader();
}

/** Blatt zu einer gespeicherten Mannschaft: laden, ueberschreiben, loeschen. */
function teamBlatt(team) {
    blatt(team.name, function (panel, zu) {
        const n = (team.players || []).filter(function (p) { return !window.Store.istGast(p); }).length;
        panel.appendChild(bauEl('p', 'sheet-text', n + ' Spieler' + ' gespeichert.'));
        panel.appendChild(bauKnopf('In den Kader laden', 'btn-primary btn-block', function () {
            zu();
            teamLaden(team);
        }));
        panel.appendChild(bauKnopf('Mit aktuellem Kader überschreiben', 'btn-block', async function () {
            if (!window.Store.getSPIELER().some(function (p) { return !window.Store.istGast(p); })) {
                if (window.Toast) window.Toast('Der aktuelle Kader ist leer.', { type: 'warn' });
                return;
            }
            const ja = await bestaetigen({
                titel: '„' + team.name + '“ überschreiben?',
                text: 'Die gespeicherte Mannschaft bekommt den aktuellen Kader.', okText: 'Überschreiben'
            });
            if (!ja) return;
            const r = await window.Store.saveTeam({ id: team.id, name: team.name, players: window.Store.getSPIELER() });
            if (!r) return;
            zu();
            if (window.Toast) window.Toast('Mannschaft „' + team.name + '“ aktualisiert.', { type: 'success' });
            await ladeTeamsNeu();
        }));
        panel.appendChild(bauKnopf('Mannschaft löschen', 'btn-block btn-danger', async function () {
            const ja = await bestaetigen({
                titel: '„' + team.name + '“ löschen?', text: 'Der aktuelle Kader bleibt unverändert.',
                okText: 'Löschen', gefahr: true
            });
            if (!ja) return;
            const r = await window.Store.deleteTeam(team.id);
            if (!r) return;
            zu();
            await ladeTeamsNeu();
        }));
    });
}

async function teamLaden(team) {
    if (!team || !team.players) return;
    const eigene = window.Store.getSPIELER().filter(function (p) { return !window.Store.istGast(p); });
    const spielLaeuft = window.Store.loadActions().length > 0;
    let modus = 'hinzufuegen';   // ohne eigene Spieler gibt es nichts zu ersetzen

    if (eigene.length > 0 && spielLaeuft) {
        // Aktionen haengen an der Spieler-id: ein Austausch mitten im Spiel
        // wuerde sie verwaisen. Hinzufuegen geht trotzdem.
        const ja = await bestaetigen({
            titel: 'Spieler hinzufügen?',
            text: 'Im laufenden Spiel kann der Kader nicht ersetzt werden, weil schon Aktionen erfasst sind. '
                + 'Die Spieler der Mannschaft werden stattdessen hinzugefügt.',
            okText: 'Hinzufügen'
        });
        if (!ja) return;
    } else if (eigene.length > 0) {
        modus = await new Promise(function (fertig) {
            // Jeder Weg schliesst das Blatt; fertig(null) nach einer Antwort ist wirkungslos.
            blatt('Mannschaft laden', function (panel, schliesse) {
                panel.appendChild(bauEl('p', 'sheet-text', 'Soll „' + team.name + '“ den aktuellen Kader ersetzen oder dazukommen?'));
                panel.appendChild(bauKnopf('Kader ersetzen', 'btn-primary btn-block', function () { fertig('ersetzen'); schliesse(); }));
                panel.appendChild(bauKnopf('Dazu hinzufügen', 'btn-block', function () { fertig('hinzufuegen'); schliesse(); }));
                panel.appendChild(bauKnopf('Abbrechen', 'btn-block', schliesse));
            }, function () { fertig(null); });
        });
        if (!modus) return;
    }

    const r = window.Store.ladeMannschaft(team.players, modus);
    if (!r.ok) {
        if (window.Toast) window.Toast('Im laufenden Spiel kann der Kader nicht ersetzt werden, weil schon Aktionen erfasst sind.',
            { type: 'warn', duration: 6000 });
        return;
    }
    selectedPlayerId = null;
    if (window.Toast) window.Toast('Mannschaft „' + team.name + '“ geladen (' + r.hinzugefuegt + ' Spieler).', { type: 'success' });
    zeichneKader();
    updateUI();
}

async function clearAllPlayers() {
    const eigene = window.Store.getSPIELER().filter(function (p) { return !window.Store.istGast(p); });
    if (eigene.length === 0) return;
    const ja = await bestaetigen({
        titel: 'Alle Spieler löschen?', text: 'Der ganze Kader (' + eigene.length + ' Spieler) wird entfernt.',
        okText: 'Alle löschen', gefahr: true
    });
    if (!ja) return;
    eigene.forEach(function (p) { window.Store.removePlayerFromStore(p.id); });
    selectedPlayerId = null;
    zeichneKader();
    updateUI();
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

    const gezogen = window.Store.getSPIELER().find(p => String(p.id) === String(draggedPlayerId));
    if (!gezogen) return;

    // Gesperrte Spieler lassen sich nirgends hinziehen
    if (window.Store.istGesperrt(gezogen)) {
        if (window.Toast) window.Toast(window.Store.sperreText(gezogen), { type: 'warn', duration: 3000 });
        updateUI();
        return;
    }

    if (newPosition !== 'Bank' && newPosition !== 'Gast' && newPosition !== 'N/A') {
        // Gesperrte Plaetze nehmen niemanden auf; ein Spieler vom Feld tauscht (Store)
        const r = window.Store.platziereSpieler(gezogen.id, newPosition, window.Timer.getTimerState().spielzeitSekunden);
        if (!r.ok && window.Toast) window.Toast(r.grund, { type: 'warn', duration: 4000 });
        updateUI();
        return;
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
let letzterTapAm = 0;

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
        letzterTapAm = Date.now();
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
    // Wer steht wo, welche Plaetze sind wegen einer Zeitstrafe gesperrt
    const jetzt = window.Timer ? window.Timer.getTimerState().spielzeitSekunden : 0;
    const phase = window.Timer ? window.Timer.getTimerState().phase : 'vor';
    // Laesst die Uhr gerade nichts zu (Pause, Abpfiff), bleibt keine Auswahl stehen
    if (selectedPlayerId && window.Timer && !window.Timer.darfErfassen(null).ok) {
        selectedPlayerId = null;
        selectedPrimaryAction = null;
        selectedPrimaryActionCategory = null;
    }
    const feld = window.Store.berechneFeld(jetzt);

    // 1. Gegner: eigener Streifen ueber dem Feld (quer: oben in der Seitenleiste)
    const opponentArea = document.createElement('div');
    opponentArea.className = 'court-opponent-area';
    const guestPlayer = spieler.find(p => window.Store.istGast(p));
    if (guestPlayer) {
        const oppBtn = document.createElement('button');
        oppBtn.type = 'button';
        oppBtn.className = 'court-opponent-btn';
        // "Gast / Gegner (0)" war unbeholfen - die Trikotnummer des
        // Pseudo-Spielers sagt niemandem etwas. Jetzt steht dort der
        // eingestellte Gastname, sonst schlicht "Gegner".
        const gastName = window.Store.getTeamNames().gast;
        const oppText = (gastName && gastName !== 'GAST') ? gastName : 'Gegner';
        oppBtn.textContent = oppText;
        oppBtn.title = oppText;   // der Name wird bei Platzmangel gekuerzt
        oppBtn.setAttribute('aria-label', 'Gegner: ' + oppText);
        onTap(oppBtn, function () { selectPlayer(guestPlayer.id); });
        if (selectedPlayerId === guestPlayer.id) oppBtn.classList.add('is-selected');
        opponentArea.appendChild(oppBtn);

        // Gleiches Sheet wie bei den eigenen Spielern. Frueher wuchs hier ein
        // zweispaltiges Menue IN die Gegner-Zeile und schob das Feld nach unten.
        if (selectedPlayerId === guestPlayer.id) openActionSheet(guestPlayer.id);
    }
    container.appendChild(opponentArea);

    // 2. Feld. Die Buehne gibt den verfuegbaren Platz vor, das Feld darin
    // behaelt sein Seitenverhaeltnis (siehe CSS) und scrollt nie.
    const stage = document.createElement('div');
    stage.className = 'court-stage';
    const courtArea = document.createElement('div');
    courtArea.className = 'court-active-area';
    courtArea.onclick = () => {
        if (istTapEcho()) return;
        if (selectedPlayerId) selectPlayer(selectedPlayerId);
    };

    // Leere Plaetze (zugleich Ziel beim Ziehen)
    const positions = ['TW', 'LA', 'RL', 'RM', 'RR', 'RA', 'KM'];
    positions.forEach(pos => {
        const dropZone = document.createElement('div');
        dropZone.className = `court-drop-zone pos-${pos}`;
        dropZone.dataset.pos = pos;
        const gesperrtVon = feld.blockiert[pos];
        // Das Tor ist leer, obwohl es Torhueter im Kader gibt (der Torwart sitzt auf
        // der Strafbank): auffaellig kennzeichnen, bis jemand dort steht.
        const torFehlt = pos === 'TW' && !feld.belegt.TW && phase !== 'vor'
            && window.Store.getSPIELER().some(function (q) { return !window.Store.istGast(q) && (window.Store.isGoalkeeper(q) || q.warTorwart); });
        if (gesperrtVon) {
            // Gesperrter Platz: grau, ohne Spieler, mit der Restzeit der Strafe
            dropZone.classList.add('is-blocked');
            const rest = window.Store.sperreRest(gesperrtVon, jetzt);
            dropZone.title = 'Platz ' + pos + ' gesperrt (Zeitstrafe ' + gesperrtVon.name + ')';
            dropZone.setAttribute('aria-label', dropZone.title);
            dropZone.innerHTML = '<span class="dz-sperre">2 Min</span>'
                + `<span class="dz-rest" data-pid="${escapeHtml(gesperrtVon.id)}">${formatRestZeit(rest)}</span>`;
        } else if (torFehlt) {
            dropZone.classList.add('is-fehlt');
            dropZone.innerHTML = '<span class="dz-label">Torwart fehlt</span>';
        } else {
            // Beschriftung macht aus dem raetselhaften gestrichelten Kreis
            // einen erkennbar leeren Platz
            dropZone.innerHTML = `<span class="dz-label">${escapeHtml(pos)}</span>`;
        }
        dropZone.addEventListener('dragover', handleDragOver);
        dropZone.addEventListener('dragleave', handleDragLeave);
        dropZone.addEventListener('drop', (e) => handleDrop(e, pos));
        courtArea.appendChild(dropZone);
    });
    stage.appendChild(courtArea);

    // 3. Bank: hochkant eine Reihe, die INNEN waagrecht scrollt (so bleibt das
    // Feld gross); quer eine Spalte neben dem Feld.
    const benchArea = document.createElement('div');
    benchArea.className = 'court-bench-area';
    benchArea.setAttribute('aria-label', 'Auswechselbank');
    benchArea.addEventListener('dragover', handleDragOver);
    benchArea.addEventListener('dragleave', handleDragLeave);
    benchArea.addEventListener('drop', (e) => handleDrop(e, 'Bank'));

    const courtPlayers = Object.keys(feld.belegt).map(function (pos) {
        return { player: feld.belegt[pos], posClass: pos };
    });
    const benchPlayers = feld.bank.map(function (p) {
        return { player: p, posClass: window.Store.normalisiertePosition(p) };
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
        if (selectedPlayerId === player.id) node.classList.add('selected');
        const gesperrt = window.Store.istGesperrt(player, jetzt);
        if (gesperrt) node.classList.add('is-gesperrt');
        node.setAttribute('role', 'button');
        node.tabIndex = 0;
        node.setAttribute('aria-label', '#' + player.nummer + ' ' + player.name + (gesperrt ? ' (gesperrt)' : ''));
        node.setAttribute('aria-pressed', selectedPlayerId === player.id ? 'true' : 'false');

        // Nur der Vorname: der Platz unter dem Kreis ist knapp. Der volle Name
        // steht im title und im Aktions-Sheet, sobald man den Spieler antippt.
        const vorname = String(player.name).split(' ')[0];
        node.innerHTML = getPlayerDisplayHtml(player, 'var(--feld-badge, 44px)')
            + `<span class="name" title="${escapeHtml(player.name)}">${escapeHtml(vorname)}</span>`;
        // Gesperrte lassen sich nicht ziehen (auch nicht auf die Bank - dort sind sie schon)
        node.draggable = !gesperrt;
        node.addEventListener('dragstart', (e) => {
            if (gesperrt) { e.preventDefault(); return; }
            handleDragStart(e, player.id);
        });
        node.addEventListener('dragend', handleDragEnd);
        node.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPlayer(player.id); }
        });

        if (area === courtArea) {
            node.addEventListener('dragover', handleDragOver);
            node.addEventListener('dragleave', handleDragLeave);
            node.addEventListener('drop', (e) => handleDrop(e, posClass));
        }

        onTap(node, function () { selectPlayer(player.id); });

        area.appendChild(node);

        if (selectedPlayerId === player.id) openActionSheet(player.id, posClass);
    });

    container.appendChild(stage);
    container.appendChild(benchArea);
}

window.UI = {
    Vollbild,
    bestaetigen,
    updateUI,
    renderHistory,
    openHistoryView,
    closeHistoryView,
    openMenue,
    closeMenue,
    menueWahl,
    openSpielInfo,
    closeSpielInfo,
    spielInfoNamenAendern,
    frageArchivieren,
    archivFrageWahl,
    archivierenStarten,
    zeigeAuszeitWahl,
    auszeitWahl,
    auszeitAbbrechen,
    refreshBalken,
    sperreBeendet,
    vergissUhrWahl,
    verlasseSpiel,
    closeActionSheet,
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
    selectPlayer,
    selectAction,
    resetActionSelection,
    confirmAssist,
    closeAssistOverlay,
    assistAbfrageAus,
    setAssistAbfrage,
    setHalbzeitLaenge,
    assistAbfrageAktiv,
    togglePlayerManagement,
    renderRosterList,
    clearAllPlayers,
    openTimeEdit,
    closeTimeEdit,
    applyTimeEdit,
    parseTimeInput,
    renderTeamNames,
    openTeamNameEdit,
    closeTeamNameEdit,
    applyTeamNameEdit,
    openGoalkeeperPicker,
    closeGoalkeeperPicker,
    selectGoalkeeper,
    escapeHtml
};
