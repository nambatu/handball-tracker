// ===================================================================
// STATS & CSV EXPORT
// ===================================================================
// Zentrale Idee: alle Auswertungen gehen durch buildStats(), damit die
// Anzeige im Browser und der CSV-Export garantiert dieselben Zahlen
// liefern - egal ob laufendes Spiel oder Archiv.
// ===================================================================

function esc(str) {
    return (window.UI && window.UI.escapeHtml)
        ? window.UI.escapeHtml(str)
        : String(str === null || str === undefined ? '' : str);
}

function fmtTime(seconds) {
    return window.Timer ? window.Timer.formatTime(seconds) : "00:00";
}

/** Quote als Prozentwert; null, wenn es keine Grundgesamtheit gibt. */
function quote(treffer, gesamt) {
    if (!gesamt) return null;
    return Math.round((treffer / gesamt) * 1000) / 10;
}

function fmtQuote(q) {
    return q === null ? '–' : q.toFixed(1).replace('.', ',') + ' %';
}

// ===================================================================
// KERNAUSWERTUNG
// ===================================================================

/**
 * @param {Array} spieler
 * @param {Array} aktionen
 * @returns {{spieler: Object, torhueter: Object, team: Object, allActionTypes: Array}}
 */
function buildStats(spieler, aktionen) {
    // Archivspiele koennen noch ohne team-Feld gespeichert sein - hier
    // nachtragen, damit die Auswertung nicht auf den Namen zurueckfallen muss.
    if (window.Store.migriereTeamFeld) window.Store.migriereTeamFeld(spieler);

    const perPlayer = {};
    spieler.forEach(s => {
        perPlayer[s.id] = {
            id: s.id,
            name: s.name,
            nummer: s.nummer,
            position: s.position,
            istGast: window.Store.istGast(s),
            playtimeSeconds: s.playtimeSeconds || 0,

            tore: 0,
            fehlwuerfe: 0,
            assists: 0,
            fehler: 0,            // Ballverluste
            ballgewinne: 0,
            siebenMeterRaus: 0,
            siebenMeterTore: 0,
            siebenMeterWuerfe: 0,
            zeitstrafen: 0,
            gelb: 0,
            rot: 0,
            blau: 0,

            // Torwart
            paraden: 0,
            gegentore: 0,
            paradenNachZone: {},
            gegentoreNachZone: {},

            aktionen: {}
        };
    });

    const team = {
        tore: 0, fehlwuerfe: 0, gegentore: 0, ballverluste: 0, ballgewinne: 0,
        gegnerTore: 0, gegnerWuerfe: 0
    };

    // Alle vorkommenden Aktionstypen fuer die Detailmatrix
    let allActionTypes = [];
    window.Store.HAUPTAKTIONEN.forEach(h => {
        if (h.category && window.Store.UNTERAKTIONEN[h.category]) {
            window.Store.UNTERAKTIONEN[h.category].forEach(u => {
                allActionTypes.push(`${h.typ}_${u.typ}`);
            });
        } else {
            allActionTypes.push(h.typ);
        }
    });
    allActionTypes = [...new Set([...allActionTypes, ...aktionen.map(a => a.typ)])].sort();
    Object.values(perPlayer).forEach(p => {
        allActionTypes.forEach(t => { p.aktionen[t] = 0; });
    });

    /** Wurfzone aus dem zusammengesetzten Typ herausziehen, z.B. WurfTor_Kreis -> Kreis */
    function zoneOf(typ) {
        const parts = String(typ || '').split('_');
        return parts.length > 1 ? parts.slice(1).join('_') : 'Ohne Angabe';
    }

    aktionen.forEach(a => {
        const p = perPlayer[a.spielerId];
        const typ = String(a.typ || '');

        if (p && p.aktionen.hasOwnProperty(typ)) p.aktionen[typ]++;

        const istGastAktion = p ? p.istGast : false;

        if (typ.includes('WurfTor')) {
            if (istGastAktion) {
                team.gegnerTore++;
                team.gegnerWuerfe++;
                team.gegentore++;
                // Gegentor dem Torwart zurechnen, der laut Aufzeichnung
                // in diesem Moment im Tor stand.
                const gk = a.torwartId ? perPlayer[a.torwartId] : null;
                if (gk) {
                    gk.gegentore++;
                    const z = zoneOf(typ);
                    gk.gegentoreNachZone[z] = (gk.gegentoreNachZone[z] || 0) + 1;
                }
            } else if (p) {
                p.tore++;
                team.tore++;
                if (typ.includes('7Meter')) { p.siebenMeterTore++; p.siebenMeterWuerfe++; }
            }
        } else if (typ.includes('WurfOhneTor')) {
            if (istGastAktion) {
                team.gegnerWuerfe++;
            } else if (p) {
                p.fehlwuerfe++;
                team.fehlwuerfe++;
                if (typ.includes('7Meter')) p.siebenMeterWuerfe++;
            }
        } else if (typ.includes('Ballverlust')) {
            if (p) p.fehler++;
            if (!istGastAktion) team.ballverluste++;
        } else if (typ.includes('Ballgewinn')) {
            if (p) p.ballgewinne++;
            if (!istGastAktion) team.ballgewinne++;
        } else if (typ.includes('Parade')) {
            if (p) {
                p.paraden++;
                const z = zoneOf(typ);
                p.paradenNachZone[z] = (p.paradenNachZone[z] || 0) + 1;
            }
        } else if (typ.includes('SiebenMeterRaus')) {
            if (p) p.siebenMeterRaus++;
        } else if (typ.includes('Zeitstrafe')) {
            if (p) p.zeitstrafen++;
        } else if (typ.includes('Karte_Gelb')) {
            if (p) p.gelb++;
        } else if (typ.includes('Karte_Rot')) {
            if (p) p.rot++;
        } else if (typ.includes('Karte_Blau')) {
            if (p) p.blau++;
        }

        if (a.assistId && perPlayer[a.assistId]) perPlayer[a.assistId].assists++;
    });

    // Abgeleitete Quoten
    Object.values(perPlayer).forEach(p => {
        p.wuerfe = p.tore + p.fehlwuerfe;
        p.wurfquote = quote(p.tore, p.wuerfe);
        p.siebenMeterQuote = quote(p.siebenMeterTore, p.siebenMeterWuerfe);
        p.wuerfeAufsTor = p.paraden + p.gegentore;
        p.fangquote = quote(p.paraden, p.wuerfeAufsTor);
    });

    team.wuerfe = team.tore + team.fehlwuerfe;
    team.wurfquote = quote(team.tore, team.wuerfe);

    // Als Torhueter gilt, wer Paraden/Gegentore hat oder auf TW steht
    const torhueter = {};
    Object.values(perPlayer).forEach(p => {
        if (p.istGast) return;
        if (p.paraden > 0 || p.gegentore > 0 || p.position === 'TW') torhueter[p.id] = p;
    });

    return { spieler: perPlayer, torhueter: torhueter, team: team, allActionTypes: allActionTypes };
}

function currentStats() {
    return buildStats(window.Store.getSPIELER(), window.Store.loadActions());
}

// Kompakte Zusammenfassung fuer die Spielerliste
function getPlayerSummaryStats() {
    const data = currentStats();
    const summary = {};
    Object.values(data.spieler).forEach(p => {
        summary[p.id] = {
            tore: p.tore,
            fehler: p.fehler,
            paraden: p.paraden,
            gesamtAktionen: p.tore + p.fehlwuerfe + p.fehler + p.paraden + p.ballgewinne
        };
    });
    return summary;
}

function getHighLevelStats() {
    return currentStats().spieler;
}

// ===================================================================
// ANZEIGE (In-Page-Overlay statt Popup)
// ===================================================================
// Das alte window.open() wurde auf dem Handy haeufig blockiert, und der
// CSV-Button im Popup rief window.Stats auf - im Popup-Fenster gibt es
// das Objekt aber gar nicht, der Button hat also nie funktioniert.

const STATS_ID = 'stats-view';

function showStats() {
    const data = currentStats();
    const inhalt = window.UI.Vollbild.oeffne({
        id: STATS_ID,
        titel: 'Statistik',
        aktion: { text: 'CSV', onClick: exportAsCSV }
    });
    let body = document.getElementById('stats-content');
    if (!body) {
        body = document.createElement('div');
        body.id = 'stats-content';
        inhalt.appendChild(body);
    }
    body.innerHTML = renderTeamKarte(data) + renderFeldKarten(data)
        + renderKeeperKarten(data) + renderDetails(data);
}

function closeStats() {
    window.UI.Vollbild.schliesse(STATS_ID);
}

/** Eine Kennzahl: Beschriftung klein, Wert gross (Handy-tauglich, kein Tabellenkopf). */
function zahl(label, wert, klasse) {
    return `<div class="stat-zahl"><span class="stat-wert ${klasse || ''}">${wert}</span>`
        + `<span class="stat-label">${esc(label)}</span></div>`;
}

/** Zeile "Beschriftung ... Wert" fuer die weniger wichtigen Angaben. */
function zeile(label, wert) {
    return `<div class="stat-zeile"><span>${esc(label)}</span><span class="stat-wert-klein">${wert}</span></div>`;
}

function spielerKopf(p) {
    return `<div class="stat-kopf"><span class="stat-nr">${esc(p.nummer)}</span>`
        + `<span class="stat-name">${esc(p.name)}</span>`
        + `<span class="stat-zeit">${fmtTime(p.playtimeSeconds)}</span></div>`;
}

function renderTeamKarte(data) {
    const t = data.team;
    return '<section class="karte stat-karte"><h3 class="karte-titel">Team gesamt</h3>'
        + '<div class="stat-zahlen">'
        + zahl('Tore', t.tore, 'strong')
        + zahl('Würfe', t.wuerfe)
        + zahl('Quote', fmtQuote(t.wurfquote))
        + zahl('Gegentore', t.gegentore)
        + '</div>'
        + zeile('Ballverluste', t.ballverluste)
        + zeile('Ballgewinne', t.ballgewinne)
        + '</section>';
}

function renderFeldKarten(data) {
    const rows = Object.values(data.spieler)
        .filter(p => !p.istGast)
        .sort((a, b) => b.tore - a.tore || a.nummer - b.nummer);

    let html = '<h3 class="stat-abschnitt">Feldspieler</h3>';
    if (rows.length === 0) return html + '<p class="stats-empty">Keine Spieler im Kader.</p>';
    rows.forEach(p => {
        html += '<section class="karte stat-karte">' + spielerKopf(p)
            + '<div class="stat-zahlen">'
            + zahl('Tore', p.tore, 'strong')
            + zahl('Würfe', p.wuerfe)
            + zahl('Quote', fmtQuote(p.wurfquote), quoteClass(p.wurfquote))
            + '</div>'
            + zeile('7-Meter', p.siebenMeterWuerfe ? p.siebenMeterTore + ' / ' + p.siebenMeterWuerfe : '–')
            + zeile('Assists', p.assists)
            + zeile('Ballverluste', p.fehler)
            + zeile('Ballgewinne', p.ballgewinne)
            + zeile('7m herausgeholt', p.siebenMeterRaus)
            + zeile('2-Minuten-Strafen', p.zeitstrafen)
            + zeile('Karten (Gelb / Rot / Blau)', `${p.gelb} / ${p.rot} / ${p.blau}`)
            + '</section>';
    });
    return html;
}

function renderKeeperKarten(data) {
    const keepers = Object.values(data.torhueter).sort((a, b) => b.paraden - a.paraden);
    let html = '<h3 class="stat-abschnitt">Torhüter</h3>';
    if (keepers.length === 0) {
        return html + '<p class="stats-empty">Noch keine Torwart-Aktionen erfasst.</p>';
    }
    keepers.forEach(p => {
        html += '<section class="karte stat-karte">' + spielerKopf(p)
            + '<div class="stat-zahlen">'
            + zahl('Paraden', p.paraden, 'strong')
            + zahl('Gegentore', p.gegentore)
            + zahl('Fangquote', fmtQuote(p.fangquote), quoteClass(p.fangquote, 30))
            + '</div>'
            + zeile('Würfe aufs Tor', p.wuerfeAufsTor);
        // Aufschluesselung nach Wurfposition: nur Positionen mit Wuerfen
        const zonen = new Set([...Object.keys(p.paradenNachZone), ...Object.keys(p.gegentoreNachZone)]);
        [...zonen].sort().forEach(z => {
            const hits = p.paradenNachZone[z] || 0;
            const total = hits + (p.gegentoreNachZone[z] || 0);
            if (total) html += zeile('Position ' + zoneLabel(z), `${hits} / ${total} gehalten`);
        });
        html += '</section>';
    });
    return html;
}

function zoneLabel(typ) {
    for (const key in window.Store.UNTERAKTIONEN) {
        const found = window.Store.UNTERAKTIONEN[key].find(u => u.typ === typ);
        if (found) return found.label;
    }
    return typ;
}

/** Alle Aktionen je Spieler, nur was vorkam. Eingeklappt, damit die Seite kurz bleibt. */
function renderDetails(data) {
    let html = '<h3 class="stat-abschnitt">Alle Aktionen im Detail</h3>';
    let any = false;
    Object.values(data.spieler).forEach(p => {
        const zeilen = data.allActionTypes
            .filter(t => (p.aktionen[t] || 0) > 0)
            .map(t => zeile(t.replace(/_/g, ' '), p.aktionen[t]));
        if (!zeilen.length) return;
        any = true;
        html += `<details class="karte stat-karte stat-details"><summary>`
            + `<strong>${esc(p.nummer)}</strong> ${esc(p.name)}</summary>${zeilen.join('')}</details>`;
    });
    if (!any) html += '<p class="stats-empty">Noch keine Aktionen erfasst.</p>';
    return html;
}

function quoteClass(q, goodAt) {
    if (q === null) return 'muted';
    const schwelle = goodAt || 50;
    if (q >= schwelle) return 'q-good';
    if (q >= schwelle * 0.6) return 'q-mid';
    return 'q-low';
}

// ===================================================================
// CSV-EXPORT
// ===================================================================

function csvCell(value) {
    let s = String(value === null || value === undefined ? '' : value);
    // Excel wertet jede Zelle, die mit = + @ oder - beginnt, als FORMEL aus
    // und zeigt statt des Textes einen Fehler an. Genau daher kamen die
    // "Error"-Zellen in den Abschnitts-Ueberschriften. Ein vorangestelltes
    // Apostroph macht daraus wieder Text; Excel blendet es aus.
    // Negative Zahlen bleiben Zahlen, die sollen gerechnet werden duerfen.
    if (/^[=+@]/.test(s) || /^-[^\d.]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
}

// Abschnitts-Ueberschrift als eigene, sauber maskierte Zeile.
function csvHeading(text) {
    return csvRow(['## ' + text + ' ##']);
}

function csvRow(cells) {
    return cells.map(csvCell).join(',') + '\n';
}

function csvQuote(q) {
    // Komma als Dezimaltrennzeichen, damit Excel (DE) die Zahl erkennt
    return q === null ? '' : String(q).replace('.', ',');
}

/**
 * Baut den kompletten Spielbericht. Wird von laufendem Spiel UND
 * Archiv-Download genutzt, damit beide identisch aufgebaut sind.
 */
function buildCsv(spieler, aktionen) {
    const data = buildStats(spieler, aktionen);
    let csv = "﻿";

    // --- 1. Feldspieler ---
    csv += csvHeading("SPIELER STATISTIK");
    csv += csvRow(['Nr.', 'Name', 'Position', 'Spielzeit', 'Tore', 'Würfe', 'Wurfquote %',
        '7m Tore', '7m Würfe', '7m Quote %', 'Assists', 'Ballverluste', 'Ballgewinne',
        '7m herausgeholt', '2-Minuten', 'Gelbe Karte', 'Rote Karte', 'Blaue Karte']);

    Object.values(data.spieler)
        .filter(p => !p.istGast)
        .sort((a, b) => b.tore - a.tore || a.nummer - b.nummer)
        .forEach(p => {
            csv += csvRow([p.nummer, p.name, p.position, fmtTime(p.playtimeSeconds),
                p.tore, p.wuerfe, csvQuote(p.wurfquote),
                p.siebenMeterTore, p.siebenMeterWuerfe, csvQuote(p.siebenMeterQuote),
                p.assists, p.fehler, p.ballgewinne, p.siebenMeterRaus,
                p.zeitstrafen, p.gelb, p.rot, p.blau]);
        });

    const t = data.team;
    csv += csvRow(['', 'TEAM GESAMT', '', '', t.tore, t.wuerfe, csvQuote(t.wurfquote),
        '', '', '', '', t.ballverluste, t.ballgewinne, '', '', '', '', '']);

    // --- 2. Torhueter (Jakobs Wunsch: Quoten pro Keeper) ---
    csv += "\n" + csvHeading("TORHÜTER");
    const keepers = Object.values(data.torhueter).sort((a, b) => b.paraden - a.paraden);
    if (keepers.length === 0) {
        csv += csvRow(["Keine Torwart-Aktionen erfasst"]);
    } else {
        csv += csvRow(['Nr.', 'Name', 'Spielzeit', 'Paraden', 'Gegentore', 'Würfe aufs Tor', 'Fangquote %']);
        keepers.forEach(p => {
            csv += csvRow([p.nummer, p.name, fmtTime(p.playtimeSeconds),
                p.paraden, p.gegentore, p.wuerfeAufsTor, csvQuote(p.fangquote)]);
        });

        // Aufschluesselung nach Wurfzone
        const zones = new Set();
        keepers.forEach(p => {
            Object.keys(p.paradenNachZone).forEach(z => zones.add(z));
            Object.keys(p.gegentoreNachZone).forEach(z => zones.add(z));
        });
        if (zones.size > 0) {
            const zoneList = [...zones].sort();
            csv += "\n" + csvHeading("FANGQUOTE NACH WURFPOSITION");
            csv += csvRow(['Nr.', 'Name', 'Kennzahl'].concat(zoneList.map(zoneLabel)));
            keepers.forEach(p => {
                csv += csvRow([p.nummer, p.name, 'Paraden'].concat(zoneList.map(z => p.paradenNachZone[z] || 0)));
                csv += csvRow([p.nummer, p.name, 'Gegentore'].concat(zoneList.map(z => p.gegentoreNachZone[z] || 0)));
                csv += csvRow([p.nummer, p.name, 'Quote %'].concat(zoneList.map(z => {
                    const h = p.paradenNachZone[z] || 0;
                    const g = p.gegentoreNachZone[z] || 0;
                    return csvQuote(quote(h, h + g));
                })));
            });
        }
    }

    // --- 3. Detailmatrix (bisher nur im Statistik-Fenster sichtbar) ---
    csv += "\n" + csvHeading("ALLE AKTIONEN IM DETAIL");
    csv += csvRow(['Nr.', 'Name', 'Spielzeit'].concat(data.allActionTypes.map(x => x.replace(/_/g, ' '))));
    Object.values(data.spieler).forEach(p => {
        csv += csvRow([p.nummer, p.name, fmtTime(p.playtimeSeconds)]
            .concat(data.allActionTypes.map(typ => p.aktionen[typ] || 0)));
    });

    // --- 4. Spielverlauf ---
    csv += "\n" + csvHeading("SPIELVERLAUF");
    csv += csvRow(['Halbzeit', 'Spielzeit', 'Spielstand', 'Nr.', 'Name', 'Aktion', 'Detail', 'Assist', 'Torhüter']);

    const sorted = [...aktionen].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    let homeGoals = 0, guestGoals = 0;

    sorted.forEach(a => {
        const player = spieler.find(p => p.id === a.spielerId);
        const pName = player ? player.name : "Unbekannt";
        const pNum = player ? player.nummer : "?";

        if (a.typ && a.typ.includes("WurfTor")) {
            if (window.Store.istGast(player)) guestGoals++; else homeGoals++;
        }

        const assistPlayer = a.assistId ? spieler.find(p => p.id === a.assistId) : null;
        const keeper = a.torwartId ? spieler.find(p => p.id === a.torwartId) : null;

        csv += csvRow([
            a.halbzeit,
            fmtTime(parseInt(a.spielzeit, 10)),
            `${homeGoals}:${guestGoals}`,
            pNum,
            pName,
            a.category,
            a.label,
            assistPlayer ? assistPlayer.name : '',
            keeper ? `#${keeper.nummer} ${keeper.name}` : ''
        ]);
    });

    return csv;
}

function downloadCsv(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportAsCSV() {
    const aktionen = window.Store.loadActions();
    if (aktionen.length === 0) {
        if (window.Toast) window.Toast('Keine Daten zum Exportieren.', { type: 'warn' });
        else alert('Keine Daten zum Exportieren.');
        return;
    }
    const csv = buildCsv(window.Store.getSPIELER(), aktionen);
    downloadCsv(csv, `handball_match_report_${new Date().toISOString().slice(0, 10)}.csv`);
}

// ===================================================================
// ARCHIV
// ===================================================================

const ARCHIV_ID = 'archive-view';

function archivPaarung(a) {
    return (a.teamHeim || a.teamGast) ? `${a.teamHeim || 'Heim'} – ${a.teamGast || 'Gast'}` : null;
}

/**
 * Eine Karte der Archivliste.
 *
 * Ueberschrift ist der selbst vergebene Name, sonst die Paarung, sonst das
 * Datum - nach einer Saison sagt "game-2026-09-06T12-16-19-150Z.json"
 * naemlich niemandem mehr, welches Spiel das war. Antippen oeffnet ein
 * Blatt mit Bericht, CSV, Umbenennen und Loeschen.
 */
function archivKarte(a) {
    const U = window.UI;
    const d = new Date(a.date);
    const datum = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const paarung = archivPaarung(a);
    const karte = U.bauEl('button', 'kader-zeile archiv-karte');
    karte.type = 'button';
    const text = U.bauEl('span', 'kader-text');
    text.appendChild(U.bauEl('span', 'kader-name', a.label || paarung || datum));
    const zusatz = [a.label ? paarung : null, datum,
                    a.aktionen !== null && a.aktionen !== undefined ? a.aktionen + ' Aktionen' : null]
                   .filter(Boolean).join(' · ');
    text.appendChild(U.bauEl('span', 'kader-zusatz', zusatz));
    karte.appendChild(text);
    karte.addEventListener('click', function () { archivBlatt(a); });
    return karte;
}

/** Blatt zu einem Archivspiel: Bericht, CSV, Umbenennen, Loeschen. */
function archivBlatt(a) {
    const U = window.UI;
    U.blatt(a.label || archivPaarung(a) || 'Spiel', function (panel, zu) {
        panel.appendChild(U.bauKnopf('Bericht ansehen', 'btn-primary btn-block', function () {
            zu();
            window.Report.showArchiveReport(a.filename);
        }));
        panel.appendChild(U.bauKnopf('CSV herunterladen', 'btn-block', function () {
            zu();
            downloadArchive(a.filename);
        }));
        panel.appendChild(U.bauKnopf('Umbenennen', 'btn-block', function () {
            zu();
            renameArchive(a);
        }));
        panel.appendChild(U.bauKnopf('Spiel löschen', 'btn-block btn-danger', function () {
            zu();
            deleteArchive(a);
        }));
    });
}

/** Namensblatt statt prompt(). Leer lassen entfernt den Namen. */
function renameArchive(a) {
    const U = window.UI;
    U.blatt('Spiel benennen', function (panel, zu) {
        const l = U.bauEl('label', 'feld-label', 'Name des Spiels'); l.htmlFor = 'archiv-name';
        const f = document.createElement('input');
        f.type = 'text'; f.id = 'archiv-name'; f.className = 'feld'; f.autocomplete = 'off';
        f.enterKeyHint = 'done'; f.maxLength = 80;
        f.value = a.label || archivPaarung(a) || '';
        panel.appendChild(l);
        panel.appendChild(f);
        const ok = U.bauKnopf('Speichern', 'btn-primary btn-block kader-ok', async function () {
            const name = f.value;
            ok.disabled = true;
            try {
                const res = await fetch('/api/archive/' + encodeURIComponent(a.filename), {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ label: name })
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                zu();
                if (window.Toast) window.Toast(name.trim() ? 'Spiel benannt.' : 'Name entfernt.', { type: 'success' });
                openArchiveModal();
            } catch (e) {
                ok.disabled = false;
                if (window.Toast) window.Toast('Umbenennen fehlgeschlagen.', { type: 'error' });
            }
        });
        f.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
        panel.appendChild(ok);
        try { f.focus({ preventScroll: true }); } catch (e) { /* egal */ }
    });
}

async function deleteArchive(a) {
    const name = a.label || archivPaarung(a) || a.filename;
    // Bewusst mit Rueckfrage: ein archiviertes Spiel laesst sich nicht
    // wiederherstellen, es liegt nur einmal auf dem Server.
    const ja = await window.UI.bestaetigen({
        titel: `„${name}“ löschen?`,
        text: 'Das Spiel ist danach weg - auch der Bericht und der CSV-Export.',
        okText: 'Löschen', gefahr: true
    });
    if (!ja) return;
    try {
        const res = await fetch('/api/archive/' + encodeURIComponent(a.filename), { method: 'DELETE' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (window.Toast) window.Toast('Spiel gelöscht.', { type: 'success' });
        openArchiveModal();
    } catch (e) {
        if (window.Toast) window.Toast('Löschen fehlgeschlagen.', { type: 'error' });
    }
}

async function openArchiveModal() {
    const inhalt = window.UI.Vollbild.oeffne({ id: ARCHIV_ID, titel: 'Spiele-Archiv' });
    let liste = document.getElementById('archive-list');
    if (!liste) {
        liste = document.createElement('div');
        liste.id = 'archive-list';
        liste.className = 'karten-liste';
        inhalt.appendChild(liste);
    }
    const hinweis = function (t) {
        liste.innerHTML = '';
        liste.appendChild(window.UI.bauEl('p', 'history-empty', t));
    };
    hinweis('Lade Archive...');
    try {
        const res = await fetch('/api/archives');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const archives = await res.json();
        if (archives.length === 0) { hinweis('Keine archivierten Spiele gefunden.'); return; }
        liste.innerHTML = '';
        archives.forEach(a => liste.appendChild(archivKarte(a)));
    } catch (e) {
        hinweis('Fehler beim Laden (offline?).');
    }
}

async function downloadArchive(filename) {
    try {
        const res = await fetch('/api/archive/' + encodeURIComponent(filename));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const csv = buildCsv(data.spieler || [], data.aktionen || []);
        downloadCsv(csv, filename.replace('.json', '.csv'));
    } catch (e) {
        if (window.Toast) window.Toast('Archiv konnte nicht geladen werden.', { type: 'error' });
        else alert('Fehler beim Herunterladen des Archivs.');
    }
}

window.Stats = {
    buildStats,
    getPlayerSummaryStats,
    getHighLevelStats,
    showStats,
    closeStats,
    exportAsCSV,
    buildCsv,
    downloadArchive,
    renameArchive,
    deleteArchive,
    quote
};

window.openArchiveModal = openArchiveModal;
