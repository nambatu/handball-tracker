// ===================================================================
// STATS & CSV EXPORT
// ===================================================================

function getPlayerSummaryStats() {
    const aktionen = window.Store.loadActions();
    const spieler = window.Store.getSPIELER();
    let summary = {};

    spieler.forEach(s => {
        summary[s.id] = { tore: 0, fehler: 0, paraden: 0, gesamtAktionen: 0 };
    });

    aktionen.forEach(action => {
        if (!summary[action.spielerId]) return;
        const type = action.typ;
        if (type.includes("WurfTor")) summary[action.spielerId].tore++;
        if (type.includes("Ballverlust")) summary[action.spielerId].fehler++;
        if (type.includes("Parade")) summary[action.spielerId].paraden++;
        summary[action.spielerId].gesamtAktionen++;
    });

    return summary;
}

function showStats_GetDetailedData() {
    const aktionen = window.Store.loadActions();
    const spieler = window.Store.getSPIELER();
    let stats = {};
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

    const storedTypes = [...new Set(aktionen.map(a => a.typ))];
    allActionTypes = [...new Set([...allActionTypes, ...storedTypes])].sort();

    spieler.forEach(s => {
        stats[s.id] = { name: s.name, nummer: s.nummer, aktionen: {} };
        allActionTypes.forEach(typ => stats[s.id].aktionen[typ] = 0);
    });

    aktionen.forEach(action => {
        if (stats[action.spielerId] && stats[action.spielerId].aktionen.hasOwnProperty(action.typ)) {
            stats[action.spielerId].aktionen[action.typ]++;
        }
    });

    return { stats: stats, allActionTypes: allActionTypes };
}

function showStats() {
    const data = showStats_GetDetailedData();
    const stats = data.stats;
    const allActionTypes = data.allActionTypes;

    let html = "<h2>Statistikübersicht</h2>";
    html += "<table border='1' cellspacing='0' cellpadding='5' width='100%'>";
    html += "<thead style='background:#f2f2f2;'><tr><th style='text-align:left;'>Spieler</th>";

    allActionTypes.forEach(typ => {
        html += `<th style='font-size:0.8em;'>${typ.replace('_', ' ')}</th>`;
    });
    html += "</tr></thead><tbody>";

    Object.values(stats).forEach(p => {
        html += `<tr><td style='font-weight:bold;'>#${p.nummer} ${p.name}</td>`;
        allActionTypes.forEach(typ => {
            const count = p.aktionen[typ] || 0;
            const style = count > 0 ? "font-weight:bold;" : "color:#ccc;";
            html += `<td style='text-align:center;${style}'>${count}</td>`;
        });
        html += "</tr>";
    });
    html += "</tbody></table>";

    const win = window.open('', 'Statistik', 'width=1000,height=600');
    if (win) {
        win.document.write(`<html><head><title>Stats</title><style>body{font-family:sans-serif;padding:20px;}table{border-collapse:collapse;}td,th{border:1px solid #ddd;}</style></head><body>${html}<br><button onclick="window.Stats.exportAsCSV()">CSV Export</button></body></html>`);
        win.document.close();
    }
}

function getHighLevelStats() {
    const aktionen = window.Store.loadActions();
    const spieler = window.Store.getSPIELER();
    let stats = {};

    spieler.forEach(s => {
        stats[s.id] = {
            name: s.name,
            nummer: s.nummer,
            tore: 0,
            fehlwuerfe: 0,
            assists: 0,
            fehler: 0,
            paraden: 0
        };
    });

    aktionen.forEach(a => {
        if (!stats[a.spielerId]) return;

        const typ = a.typ;

        if (typ.includes("WurfTor")) {
            stats[a.spielerId].tore++;
        }
        else if (typ.includes("WurfOhneTor")) {
            stats[a.spielerId].fehlwuerfe++;
        }
        else if (typ.includes("Ballverlust")) {
            stats[a.spielerId].fehler++;
        }
        else if (typ.includes("Parade")) {
            stats[a.spielerId].paraden++;
        }

        if (a.assistId && stats[a.assistId]) {
            stats[a.assistId].assists++;
        }
    });

    return stats;
}

function exportAsCSV() {
    const aktionen = window.Store.loadActions();
    const spieler = window.Store.getSPIELER();

    if (aktionen.length === 0) {
        alert("Keine Daten zum Exportieren.");
        return;
    }

    let csv = "\uFEFF";
    csv += "=== SPIELER STATISTIK ===\n";
    csv += "Nr.,Name,Tore,Assists,Fehlwürfe,Tech. Fehler,Paraden\n";

    const summary = getHighLevelStats();

    const sortedPlayerIds = Object.keys(summary).sort((a, b) => {
        return summary[b].tore - summary[a].tore;
    });

    sortedPlayerIds.forEach(id => {
        const s = summary[id];
        csv += `${s.nummer},"${s.name}",${s.tore},${s.assists},${s.fehlwuerfe},${s.fehler},${s.paraden}\n`;
    });

    csv += "\n";
    csv += "=== SPIELVERLAUF ===\n";
    csv += "Halbzeit,Spielzeit,Spielstand,Nr.,Name,Aktion,Detail,Assist\n";

    const sortedActions = [...aktionen].sort((a, b) => a.timestamp - b.timestamp);

    let homeGoals = 0;
    let guestGoals = 0;

    sortedActions.forEach(a => {
        const player = spieler.find(p => p.id === a.spielerId);
        const pName = player ? player.name : "Unbekannt";
        const pNum = player ? player.nummer : "?";

        if (a.typ && a.typ.includes("WurfTor")) {
            if (window.Store.isGuestTeam(pName)) {
                guestGoals++;
            } else {
                homeGoals++;
            }
        }

        let timeString = "00:00";
        if (window.Timer && typeof window.Timer.formatTime === "function") {
            timeString = window.Timer.formatTime(parseInt(a.spielzeit));
        }

        const assistPlayer = a.assistId ? spieler.find(p => p.id === a.assistId) : null;
        const assistName = assistPlayer ? assistPlayer.name : "";

        const cleanLabel = a.label;

        csv += `${a.halbzeit},${timeString},"${homeGoals}:${guestGoals}",${pNum},"${pName}","${a.category}","${cleanLabel}","${assistName}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `handball_match_report_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

window.Stats = {
    getPlayerSummaryStats,
    showStats,
    exportAsCSV,
    getHighLevelStats
};
