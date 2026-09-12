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
    const isGuest = (name) => window.Store.isGuestTeam(name);

    const perPlayer = {};
    spieler.forEach(s => {
        perPlayer[s.id] = {
            id: s.id,
            name: s.name,
            nummer: s.nummer,
            position: s.position,
            istGast: isGuest(s.name),
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

function showStats() {
    const data = currentStats();
    const view = document.getElementById('stats-view');
    const body = document.getElementById('stats-content');
    if (!view || !body) return;

    body.innerHTML = renderFieldTable(data) + renderKeeperTable(data) + renderMatrix(data);
    view.style.display = 'flex';
}

function closeStats() {
    const view = document.getElementById('stats-view');
    if (view) view.style.display = 'none';
}

function renderFieldTable(data) {
    const rows = Object.values(data.spieler)
        .filter(p => !p.istGast)
        .sort((a, b) => b.tore - a.tore || a.nummer - b.nummer);

    let html = '<h3>Feldspieler</h3>';
    html += '<div class="stats-scroll"><table class="stats-table"><thead><tr>'
        + '<th class="col-name">Spieler</th><th>Einsatz</th><th>Tore</th><th>Würfe</th>'
        + '<th>Quote</th><th>7m</th><th>Assists</th><th>Ballverl.</th><th>Ballgew.</th>'
        + '<th>7m raus</th><th>2min</th><th>🟨</th><th>🟥</th><th>🟦</th></tr></thead><tbody>';

    rows.forEach(p => {
        html += '<tr>'
            + `<td class="col-name"><strong>#${esc(p.nummer)}</strong> ${esc(p.name)}</td>`
            + `<td>${fmtTime(p.playtimeSeconds)}</td>`
            + `<td class="num strong">${p.tore}</td>`
            + `<td class="num">${p.wuerfe}</td>`
            + `<td class="num ${quoteClass(p.wurfquote)}">${fmtQuote(p.wurfquote)}</td>`
            + `<td class="num">${p.siebenMeterWuerfe ? p.siebenMeterTore + '/' + p.siebenMeterWuerfe : '–'}</td>`
            + `<td class="num">${p.assists}</td>`
            + `<td class="num">${p.fehler}</td>`
            + `<td class="num">${p.ballgewinne}</td>`
            + `<td class="num">${p.siebenMeterRaus}</td>`
            + `<td class="num">${p.zeitstrafen}</td>`
            + `<td class="num">${p.gelb || ''}</td>`
            + `<td class="num">${p.rot || ''}</td>`
            + `<td class="num">${p.blau || ''}</td>`
            + '</tr>';
    });

    const t = data.team;
    html += `<tr class="stats-total"><td class="col-name">Team gesamt</td><td></td>`
        + `<td class="num strong">${t.tore}</td><td class="num">${t.wuerfe}</td>`
        + `<td class="num">${fmtQuote(t.wurfquote)}</td><td colspan="9"></td></tr>`;

    html += '</tbody></table></div>';
    return html;
}

function renderKeeperTable(data) {
    const keepers = Object.values(data.torhueter).sort((a, b) => b.paraden - a.paraden);

    let html = '<h3>Torhüter</h3>';

    if (keepers.length === 0) {
        return html + '<p class="stats-empty">Noch keine Torwart-Aktionen erfasst.</p>';
    }

    html += '<div class="stats-scroll"><table class="stats-table"><thead><tr>'
        + '<th class="col-name">Torhüter</th><th>Einsatz</th><th>Paraden</th>'
        + '<th>Gegentore</th><th>Würfe aufs Tor</th><th>Fangquote</th></tr></thead><tbody>';

    keepers.forEach(p => {
        html += '<tr>'
            + `<td class="col-name"><strong>#${esc(p.nummer)}</strong> ${esc(p.name)}</td>`
            + `<td>${fmtTime(p.playtimeSeconds)}</td>`
            + `<td class="num strong">${p.paraden}</td>`
            + `<td class="num">${p.gegentore}</td>`
            + `<td class="num">${p.wuerfeAufsTor}</td>`
            + `<td class="num ${quoteClass(p.fangquote, 30)}">${fmtQuote(p.fangquote)}</td>`
            + '</tr>';
    });
    html += '</tbody></table></div>';

    // Aufschluesselung nach Wurfzone
    const zones = new Set();
    keepers.forEach(p => {
        Object.keys(p.paradenNachZone).forEach(z => zones.add(z));
        Object.keys(p.gegentoreNachZone).forEach(z => zones.add(z));
    });

    if (zones.size > 0) {
        const zoneList = [...zones].sort();
        html += '<h4>Fangquote nach Wurfposition</h4>';
        html += '<div class="stats-scroll"><table class="stats-table"><thead><tr><th class="col-name">Torhüter</th>';
        zoneList.forEach(z => { html += `<th>${esc(zoneLabel(z))}</th>`; });
        html += '</tr></thead><tbody>';
        keepers.forEach(p => {
            html += `<tr><td class="col-name"><strong>#${esc(p.nummer)}</strong> ${esc(p.name)}</td>`;
            zoneList.forEach(z => {
                const hits = p.paradenNachZone[z] || 0;
                const goals = p.gegentoreNachZone[z] || 0;
                const total = hits + goals;
                html += total
                    ? `<td class="num" title="${hits} gehalten / ${total} Würfe">${hits}/${total}</td>`
                    : '<td class="num muted">–</td>';
            });
            html += '</tr>';
        });
        html += '</tbody></table></div>';
    }

    return html;
}

function zoneLabel(typ) {
    for (const key in window.Store.UNTERAKTIONEN) {
        const found = window.Store.UNTERAKTIONEN[key].find(u => u.typ === typ);
        if (found) return found.label;
    }
    return typ;
}

function renderMatrix(data) {
    let html = '<h3>Alle Aktionen im Detail</h3>';
    html += '<div class="stats-scroll"><table class="stats-table stats-matrix"><thead><tr>'
        + '<th class="col-name">Spieler</th><th>Einsatz</th>';
    data.allActionTypes.forEach(t => {
        html += `<th title="${esc(t)}">${esc(t.replace(/_/g, ' '))}</th>`;
    });
    html += '</tr></thead><tbody>';

    Object.values(data.spieler).forEach(p => {
        html += `<tr><td class="col-name"><strong>#${esc(p.nummer)}</strong> ${esc(p.name)}</td>`
            + `<td>${fmtTime(p.playtimeSeconds)}</td>`;
        data.allActionTypes.forEach(t => {
            const c = p.aktionen[t] || 0;
            html += c > 0 ? `<td class="num strong">${c}</td>` : '<td class="num muted">0</td>';
        });
        html += '</tr>';
    });
    html += '</tbody></table></div>';
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
    const s = String(value === null || value === undefined ? '' : value);
    return '"' + s.replace(/"/g, '""') + '"';
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
    csv += "=== SPIELER STATISTIK ===\n";
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
    csv += "\n=== TORHÜTER ===\n";
    const keepers = Object.values(data.torhueter).sort((a, b) => b.paraden - a.paraden);
    if (keepers.length === 0) {
        csv += "Keine Torwart-Aktionen erfasst\n";
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
            csv += "\n=== FANGQUOTE NACH WURFPOSITION ===\n";
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
    csv += "\n=== ALLE AKTIONEN IM DETAIL ===\n";
    csv += csvRow(['Nr.', 'Name', 'Spielzeit'].concat(data.allActionTypes.map(x => x.replace(/_/g, ' '))));
    Object.values(data.spieler).forEach(p => {
        csv += csvRow([p.nummer, p.name, fmtTime(p.playtimeSeconds)]
            .concat(data.allActionTypes.map(typ => p.aktionen[typ] || 0)));
    });

    // --- 4. Spielverlauf ---
    csv += "\n=== SPIELVERLAUF ===\n";
    csv += csvRow(['Halbzeit', 'Spielzeit', 'Spielstand', 'Nr.', 'Name', 'Aktion', 'Detail', 'Assist', 'Torhüter']);

    const sorted = [...aktionen].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    let homeGoals = 0, guestGoals = 0;

    sorted.forEach(a => {
        const player = spieler.find(p => p.id === a.spielerId);
        const pName = player ? player.name : "Unbekannt";
        const pNum = player ? player.nummer : "?";

        if (a.typ && a.typ.includes("WurfTor")) {
            if (window.Store.isGuestTeam(pName)) guestGoals++; else homeGoals++;
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

async function openArchiveModal() {
    document.getElementById('archive-view').style.display = 'flex';
    const list = document.getElementById('archive-list');
    list.innerHTML = '<li><div style="padding: 15px; text-align: center;">Lade Archive...</div></li>';
    try {
        const res = await fetch('/api/archives');
        const archives = await res.json();
        if (archives.length === 0) {
            list.innerHTML = '<li><div style="padding: 15px; text-align: center;">Keine archivierten Spiele gefunden.</div></li>';
            return;
        }
        list.innerHTML = '';
        archives.forEach(a => {
            const li = document.createElement('li');
            li.className = 'archive-item';

            const d = new Date(a.date);
            const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            li.innerHTML = `
                <div>
                    <strong style="font-size: 1.1rem;">${esc(dateStr)}</strong>
                    <div style="font-size: 0.85em; color: var(--text-muted);">${esc(a.filename)}</div>
                </div>
                <div class="archive-btns">
                    <button class="add-btn js-report">📄 Bericht</button>
                    <button class="control-btn js-csv">⬇️ CSV</button>
                </div>
            `;
            li.querySelector('.js-report').onclick = () => window.Report.showArchiveReport(a.filename);
            li.querySelector('.js-csv').onclick = () => downloadArchive(a.filename);
            list.appendChild(li);
        });
    } catch (e) {
        list.innerHTML = '<li>Fehler beim Laden (offline?).</li>';
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
    quote
};

window.openArchiveModal = openArchiveModal;
