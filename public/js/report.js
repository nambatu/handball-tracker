// ===================================================================
// SPIELBERICHT
// ===================================================================
// Erzeugt einen druckfertigen Bericht aus Kader und Aktionen - fuer das
// laufende Spiel wie fuer jedes Archivspiel.
//
// Bewusst HELL gestaltet, obwohl die App dunkel ist: Der Bericht ist ein
// Dokument. Was am Bildschirm steht, kommt so auch aus dem Drucker, und
// ein dunkler Bogen frisst Tinte und liest sich auf Papier schlecht.
//
// Diagramme sind handgeschriebenes Inline-SVG - keine Bibliothek. Damit
// funktioniert der Bericht offline, druckt scharf in jeder Groesse und
// haengt an keinem CDN.
//
// Farben (gegen die Vorgaben validiert, heller Untergrund):
//   Eigenes Team   #2a78d6   (blau, Slot 1)
//   Gegner         #eb6834   (orange, Slot 2)
//   Fehlwuerfe     #86b6ef   (blau, heller Schritt - ordinal zum Tor-Blau)
// Blau/Orange: CVD-Delta-E 24.7, Normalsicht 33.6 - beide deutlich ueber
// den Schwellen. Die Ordinalstufen unterscheiden sich in der Helligkeit,
// bleiben also auch im Graustufendruck auseinanderzuhalten.
// ===================================================================

(function () {
    'use strict';

    const C = {
        heim: '#2a78d6',
        gast: '#eb6834',
        miss: '#86b6ef',
        surface: '#ffffff',
        grid: '#e1e0d9',
        axis: '#c3c2b7',
        ink: '#0b0b0b',
        ink2: '#52514e',
        muted: '#898781'
    };

    function esc(v) {
        return String(v === null || v === undefined ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function mmss(sec) {
        return window.Timer ? window.Timer.formatTime(sec) : '00:00';
    }

    function pct(q) {
        return q === null || q === undefined ? '–' : q.toFixed(1).replace('.', ',') + ' %';
    }

    /** Grobe Textbreite, um Beschriftungen nur dort zu setzen, wo sie passen. */
    function textWidth(str, fontSize) {
        return String(str).length * fontSize * 0.58;
    }

    function niceCeil(v) {
        if (v <= 5) return 5;
        if (v <= 10) return 10;
        const step = Math.pow(10, Math.floor(Math.log10(v))) / 2;
        return Math.ceil(v / step) * step;
    }

    // ===============================================================
    // DIAGRAMM 1 — SPIELSTANDVERLAUF
    // ===============================================================
    // Verlauf ueber die Zeit, zwei Serien -> Stufenlinie. Der Spielstand
    // springt im Moment des Tores, deshalb Stufen und keine Diagonalen:
    // dazwischen stand es tatsaechlich unveraendert.

    function chartScoreProgress(aktionen, spieler, names) {
        const goals = aktionen
            .filter(a => a.typ && a.typ.includes('WurfTor'))
            .sort((a, b) => (a.spielzeit || 0) - (b.spielzeit || 0));

        if (goals.length === 0) return '';

        let h = 0, g = 0;
        const pts = [{ t: 0, h: 0, g: 0 }];
        goals.forEach(a => {
            const p = spieler.find(x => x.id === a.spielerId);
            if (p && window.Store.isGuestTeam(p.name)) g++; else h++;
            pts.push({ t: a.spielzeit || 0, h: h, g: g });
        });

        const W = 680, H = 250;
        const padL = 40, padR = 46, padT = 14, padB = 34;
        const plotW = W - padL - padR, plotH = H - padT - padB;

        const maxT = Math.max(pts[pts.length - 1].t, 60);
        const maxY = niceCeil(Math.max(h, g, 1));

        const x = t => padL + (t / maxT) * plotW;
        const y = v => padT + plotH - (v / maxY) * plotH;

        function stepPath(key) {
            let d = `M ${x(0).toFixed(1)} ${y(0).toFixed(1)}`;
            let prev = 0;
            pts.forEach(pt => {
                d += ` L ${x(pt.t).toFixed(1)} ${y(prev).toFixed(1)}`;
                d += ` L ${x(pt.t).toFixed(1)} ${y(pt[key]).toFixed(1)}`;
                prev = pt[key];
            });
            d += ` L ${x(maxT).toFixed(1)} ${y(prev).toFixed(1)}`;
            return d;
        }

        // Waagerechte Hilfslinien - haarfein, durchgezogen, zurueckhaltend
        let grid = '';
        const yStep = maxY <= 10 ? 2 : Math.ceil(maxY / 6 / 5) * 5;
        for (let v = 0; v <= maxY; v += yStep) {
            grid += `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${padL + plotW}" y2="${y(v).toFixed(1)}" stroke="${C.grid}" stroke-width="1"/>`
                + `<text x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${C.muted}" style="font-variant-numeric:tabular-nums">${v}</text>`;
        }

        // Zeitachse alle 5 Minuten
        let xticks = '';
        for (let t = 0; t <= maxT; t += 300) {
            xticks += `<text x="${x(t).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="${C.muted}" style="font-variant-numeric:tabular-nums">${Math.round(t / 60)}'</text>`;
        }

        // Endpunkte: Marker mit 2px Ring in Flaechenfarbe, damit sie sich
        // auch dort abheben, wo die beiden Linien uebereinanderliegen.
        const endH = { x: x(maxT), y: y(h) };
        const endG = { x: x(maxT), y: y(g) };
        const spread = Math.abs(endH.y - endG.y) < 16;

        return `
<figure class="rep-figure">
  <figcaption class="rep-cap">Spielstandverlauf</figcaption>
  <div class="rep-legend">
    <span class="rep-key"><span class="rep-swatch" style="background:${C.heim}"></span>${esc(names.heim)}</span>
    <span class="rep-key"><span class="rep-swatch" style="background:${C.gast}"></span>${esc(names.gast)}</span>
  </div>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Spielstandverlauf über die Spielzeit" class="rep-svg">
    ${grid}
    <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="${C.axis}" stroke-width="1"/>
    ${xticks}
    <path d="${stepPath('g')}" fill="none" stroke="${C.gast}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${stepPath('h')}" fill="none" stroke="${C.heim}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${endG.x.toFixed(1)}" cy="${endG.y.toFixed(1)}" r="4.5" fill="${C.gast}" stroke="${C.surface}" stroke-width="2"/>
    <circle cx="${endH.x.toFixed(1)}" cy="${endH.y.toFixed(1)}" r="4.5" fill="${C.heim}" stroke="${C.surface}" stroke-width="2"/>
    <text x="${(endH.x + 11).toFixed(1)}" y="${(endH.y + (spread ? -5 : 5)).toFixed(1)}" font-size="15" font-weight="800" fill="${C.ink}" style="font-variant-numeric:tabular-nums">${h}</text>
    <text x="${(endG.x + 11).toFixed(1)}" y="${(endG.y + (spread ? 15 : 5)).toFixed(1)}" font-size="15" font-weight="800" fill="${C.ink2}" style="font-variant-numeric:tabular-nums">${g}</text>
  </svg>
</figure>`;
    }

    // ===============================================================
    // DIAGRAMM 2 — WUERFE NACH ZONE
    // ===============================================================
    // Groesse je Kategorie mit Anteil -> gestapelter Balken. Beide Teile
    // gehoeren derselben Groesse an ("unsere Wuerfe"), deshalb zwei Stufen
    // EINER Hue statt zweier Farben: der dunkle Teil ging rein.

    function chartShotsByZone(stats) {
        const zones = {};
        Object.values(stats.spieler).forEach(p => {
            if (p.istGast) return;
            Object.keys(p.aktionen).forEach(typ => {
                const n = p.aktionen[typ] || 0;
                if (!n) return;
                if (!typ.startsWith('WurfTor_') && !typ.startsWith('WurfOhneTor_')) return;
                const zone = typ.split('_').slice(1).join('_');
                zones[zone] = zones[zone] || { tore: 0, daneben: 0 };
                if (typ.startsWith('WurfTor_')) zones[zone].tore += n;
                else zones[zone].daneben += n;
            });
        });

        const rows = Object.keys(zones)
            .map(z => ({ zone: z, label: zoneLabel(z), ...zones[z] }))
            .map(r => ({ ...r, gesamt: r.tore + r.daneben }))
            .filter(r => r.gesamt > 0)
            .sort((a, b) => b.gesamt - a.gesamt);

        if (rows.length === 0) return '';

        const barH = 18, gap = 14, labelW = 128, valueW = 86;
        const W = 680, padT = 10, padB = 26;
        const plotW = W - labelW - valueW;
        const H = padT + rows.length * (barH + gap) + padB;
        const maxV = niceCeil(Math.max(...rows.map(r => r.gesamt)));
        const sx = v => (v / maxV) * plotW;

        let grid = '';
        const step = maxV <= 10 ? 2 : Math.ceil(maxV / 5 / 5) * 5;
        for (let v = 0; v <= maxV; v += step) {
            const gx = labelW + sx(v);
            grid += `<line x1="${gx.toFixed(1)}" y1="${padT}" x2="${gx.toFixed(1)}" y2="${H - padB}" stroke="${C.grid}" stroke-width="1"/>`
                + `<text x="${gx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${C.muted}" style="font-variant-numeric:tabular-nums">${v}</text>`;
        }

        let bars = '';
        rows.forEach((r, i) => {
            const yTop = padT + i * (barH + gap);
            const wTore = sx(r.tore);
            const wMiss = sx(r.daneben);
            // 2px Fuge in Flaechenfarbe zwischen den Segmenten - kein Rahmen
            const missX = labelW + wTore + (wTore > 0 && wMiss > 0 ? 2 : 0);
            const quote = r.gesamt ? Math.round((r.tore / r.gesamt) * 1000) / 10 : null;

            bars += `<text x="${labelW - 10}" y="${(yTop + barH / 2 + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="${C.ink2}">${esc(r.label)}</text>`;

            if (wTore > 0) {
                bars += `<path d="${roundedRightBar(labelW, yTop, wTore, barH, wMiss > 0 ? 0 : 4)}" fill="${C.heim}"/>`;
            }
            if (wMiss > 0) {
                bars += `<path d="${roundedRightBar(missX, yTop, Math.max(wMiss - 2, 1), barH, 4)}" fill="${C.miss}"/>`;
            }

            // Beschriftung im Segment nur, wenn sie mit Luft hineinpasst
            const toreLabel = String(r.tore);
            if (wTore > textWidth(toreLabel, 11) + 14) {
                bars += `<text x="${(labelW + wTore / 2).toFixed(1)}" y="${(yTop + barH / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#ffffff" style="font-variant-numeric:tabular-nums">${toreLabel}</text>`;
            }

            bars += `<text x="${(labelW + sx(r.gesamt) + 10).toFixed(1)}" y="${(yTop + barH / 2 + 4).toFixed(1)}" font-size="11" fill="${C.ink2}" style="font-variant-numeric:tabular-nums">${r.tore}/${r.gesamt} · ${pct(quote)}</text>`;
        });

        return `
<figure class="rep-figure">
  <figcaption class="rep-cap">Würfe nach Position</figcaption>
  <div class="rep-legend">
    <span class="rep-key"><span class="rep-swatch" style="background:${C.heim}"></span>Tor</span>
    <span class="rep-key"><span class="rep-swatch" style="background:${C.miss}"></span>kein Tor</span>
  </div>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Würfe nach Wurfposition, Tore und Fehlwürfe" class="rep-svg">
    ${grid}
    <line x1="${labelW}" y1="${padT}" x2="${labelW}" y2="${H - padB}" stroke="${C.axis}" stroke-width="1"/>
    ${bars}
  </svg>
</figure>`;
    }

    /** Balken mit 4px gerundetem Datenende, am Nullpunkt eckig. */
    function roundedRightBar(x, y, w, h, r) {
        const rad = Math.min(r, w / 2, h / 2);
        if (rad <= 0) return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
        return `M ${x} ${y} h ${w - rad} a ${rad} ${rad} 0 0 1 ${rad} ${rad}`
            + ` v ${h - 2 * rad} a ${rad} ${rad} 0 0 1 ${-rad} ${rad}`
            + ` h ${-(w - rad)} Z`;
    }

    // ===============================================================
    // DIAGRAMM 3 — TORVERTEILUNG
    // ===============================================================
    // Eine Serie, Groesse nach Identitaet -> waagerechte Balken, eine Farbe
    // fuer alle. Keine Legende (bei einer Serie sagt die Ueberschrift alles).

    function chartGoalsPerPlayer(stats) {
        const rows = Object.values(stats.spieler)
            .filter(p => !p.istGast && p.tore > 0)
            .sort((a, b) => b.tore - a.tore);

        if (rows.length === 0) return '';

        const barH = 16, gap = 10, labelW = 150, valueW = 56;
        const W = 680, padT = 8, padB = 8;
        const plotW = W - labelW - valueW;
        const H = padT + rows.length * (barH + gap) + padB;
        const maxV = Math.max(...rows.map(r => r.tore));
        const sx = v => (v / maxV) * plotW;

        let bars = '';
        rows.forEach((r, i) => {
            const yTop = padT + i * (barH + gap);
            const w = Math.max(sx(r.tore), 2);
            bars += `<text x="${labelW - 10}" y="${(yTop + barH / 2 + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="${C.ink2}">#${esc(r.nummer)} ${esc(String(r.name).split(' ')[0])}</text>`
                + `<path d="${roundedRightBar(labelW, yTop, w, barH, 4)}" fill="${C.heim}"/>`
                + `<text x="${(labelW + w + 8).toFixed(1)}" y="${(yTop + barH / 2 + 4).toFixed(1)}" font-size="12" font-weight="700" fill="${C.ink}" style="font-variant-numeric:tabular-nums">${r.tore}</text>`;
        });

        return `
<figure class="rep-figure">
  <figcaption class="rep-cap">Tore je Spieler</figcaption>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tore je Spieler" class="rep-svg">
    ${bars}
  </svg>
</figure>`;
    }

    function zoneLabel(typ) {
        const U = window.Store.UNTERAKTIONEN;
        for (const key in U) {
            const f = U[key].find(u => u.typ === typ);
            if (f) return f.label;
        }
        return typ || 'Ohne Angabe';
    }

    // ===============================================================
    // BERICHT
    // ===============================================================

    function buildReport(spieler, aktionen, meta) {
        meta = meta || {};
        const stats = window.Stats.buildStats(spieler, aktionen);
        const names = meta.names || { heim: 'HEIM', gast: 'GAST' };

        let heimTore = 0, gastTore = 0;
        const hz = { 1: { heim: 0, gast: 0 }, 2: { heim: 0, gast: 0 } };
        aktionen.forEach(a => {
            if (!a.typ || !a.typ.includes('WurfTor')) return;
            const p = spieler.find(x => x.id === a.spielerId);
            const gast = p && window.Store.isGuestTeam(p.name);
            if (gast) gastTore++; else heimTore++;
            const half = (a.halbzeit === 2) ? 2 : 1;
            if (gast) hz[half].gast++; else hz[half].heim++;
        });

        const dauer = aktionen.length
            ? Math.max(...aktionen.map(a => a.spielzeit || 0))
            : (meta.spielzeit || 0);

        return `
<div class="rep-sheet">
  ${reportHead(names, heimTore, gastTore, hz, dauer, meta)}
  ${reportKpis(stats, heimTore, gastTore)}
  ${chartScoreProgress(aktionen, spieler, names)}
  ${reportPlayerTable(stats)}
  ${chartGoalsPerPlayer(stats)}
  ${reportKeepers(stats)}
  ${chartShotsByZone(stats)}
  ${reportHalves(hz, aktionen, spieler)}
  ${reportDiscipline(stats)}
  ${reportGoalSequence(aktionen, spieler, names)}
  ${reportGlossary()}
  <p class="rep-foot">Erstellt am ${new Date().toLocaleDateString('de-AT')} um ${new Date().toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} · Handball Tracker</p>
</div>`;
    }

    function reportHead(names, h, g, hz, dauer, meta) {
        const datum = meta.datum ? new Date(meta.datum) : new Date();
        const result = h > g ? 'rep-win' : (h < g ? 'rep-loss' : 'rep-draw');
        return `
<header class="rep-head">
  <div class="rep-teams">
    <div class="rep-team"><span class="rep-team-name">${esc(names.heim)}</span></div>
    <div class="rep-score ${result}">
      <span class="rep-score-num">${h}</span><span class="rep-score-sep">:</span><span class="rep-score-num">${g}</span>
    </div>
    <div class="rep-team rep-team-right"><span class="rep-team-name">${esc(names.gast)}</span></div>
  </div>
  <p class="rep-submeta">
    Halbzeit ${hz[1].heim}:${hz[1].gast} · 2. Hälfte ${hz[2].heim}:${hz[2].gast}
    &nbsp;·&nbsp; Spieldauer ${mmss(dauer)}
    &nbsp;·&nbsp; ${datum.toLocaleDateString('de-AT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
  </p>
</header>`;
    }

    function reportKpis(stats, h, g) {
        const t = stats.team;
        const keeper = Object.values(stats.torhueter);
        const paraden = keeper.reduce((s, k) => s + k.paraden, 0);
        const gegentore = keeper.reduce((s, k) => s + k.gegentore, 0);
        const fangquote = (paraden + gegentore) ? Math.round((paraden / (paraden + gegentore)) * 1000) / 10 : null;

        const sieben = Object.values(stats.spieler).filter(p => !p.istGast)
            .reduce((acc, p) => ({ tore: acc.tore + p.siebenMeterTore, w: acc.w + p.siebenMeterWuerfe }), { tore: 0, w: 0 });

        const tiles = [
            { label: 'Tore', value: t.tore },
            { label: 'Wurfquote', value: pct(t.wurfquote), sub: `${t.tore} von ${t.wuerfe}` },
            { label: 'Siebenmeter', value: sieben.w ? `${sieben.tore}/${sieben.w}` : '–' },
            { label: 'Ballverluste', value: t.ballverluste },
            { label: 'Ballgewinne', value: t.ballgewinne },
            { label: 'Paraden', value: paraden },
            { label: 'Fangquote', value: pct(fangquote), sub: `${paraden} von ${paraden + gegentore}` }
        ];

        return `<section class="rep-kpis">` + tiles.map(x => `
  <div class="rep-tile">
    <span class="rep-tile-label">${esc(x.label)}</span>
    <span class="rep-tile-value">${esc(x.value)}</span>
    ${x.sub ? `<span class="rep-tile-sub">${esc(x.sub)}</span>` : ''}
  </div>`).join('') + `</section>`;
    }

    function reportPlayerTable(stats) {
        const rows = Object.values(stats.spieler)
            .filter(p => !p.istGast)
            .sort((a, b) => b.tore - a.tore || a.nummer - b.nummer);

        if (rows.length === 0) return '';

        const body = rows.map(p => `
  <tr>
    <td class="rep-num">${esc(p.nummer)}</td>
    <td class="rep-name">${esc(p.name)}</td>
    <td class="rep-pos">${esc(p.position)}</td>
    <td>${mmss(p.playtimeSeconds)}</td>
    <td class="rep-strong">${p.tore}</td>
    <td>${p.wuerfe}</td>
    <td class="${quoteCls(p.wurfquote)}">${pct(p.wurfquote)}</td>
    <td>${p.siebenMeterWuerfe ? p.siebenMeterTore + '/' + p.siebenMeterWuerfe : '–'}</td>
    <td>${p.assists || '–'}</td>
    <td>${p.fehler || '–'}</td>
    <td>${p.ballgewinne || '–'}</td>
    <td>${p.siebenMeterRaus || '–'}</td>
    <td>${p.zeitstrafen || '–'}</td>
  </tr>`).join('');

        const t = stats.team;
        return `
<section class="rep-block">
  <h2>Feldspieler</h2>
  <table class="rep-table">
    <thead><tr>
      <th>Nr</th><th class="rep-name">Name</th><th>Pos</th><th>Einsatz</th>
      <th>Tore</th><th>Würfe</th><th>Quote</th><th>7m</th>
      <th>Assists</th><th>Ballverl.</th><th>Ballgew.</th><th>7m&nbsp;raus</th><th>2min</th>
    </tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr>
      <td></td><td class="rep-name">Mannschaft</td><td></td><td></td>
      <td class="rep-strong">${t.tore}</td><td>${t.wuerfe}</td><td>${pct(t.wurfquote)}</td>
      <td></td><td></td><td>${t.ballverluste}</td><td>${t.ballgewinne}</td><td></td><td></td>
    </tr></tfoot>
  </table>
</section>`;
    }

    function reportKeepers(stats) {
        const keepers = Object.values(stats.torhueter).sort((a, b) => b.paraden - a.paraden);
        if (keepers.length === 0) return '';

        const zones = new Set();
        keepers.forEach(k => {
            Object.keys(k.paradenNachZone).forEach(z => zones.add(z));
            Object.keys(k.gegentoreNachZone).forEach(z => zones.add(z));
        });
        const zoneList = [...zones].sort();

        const main = keepers.map(k => `
  <tr>
    <td class="rep-num">${esc(k.nummer)}</td>
    <td class="rep-name">${esc(k.name)}</td>
    <td>${mmss(k.playtimeSeconds)}</td>
    <td class="rep-strong">${k.paraden}</td>
    <td>${k.gegentore}</td>
    <td>${k.wuerfeAufsTor}</td>
    <td class="${quoteCls(k.fangquote, 30)}">${pct(k.fangquote)}</td>
  </tr>`).join('');

        let zoneTable = '';
        if (zoneList.length) {
            zoneTable = `
  <h3>Fangquote nach Wurfposition</h3>
  <table class="rep-table rep-table-compact">
    <thead><tr><th class="rep-name">Torhüter</th>${zoneList.map(z => `<th>${esc(zoneLabel(z))}</th>`).join('')}</tr></thead>
    <tbody>${keepers.map(k => `
      <tr><td class="rep-name">#${esc(k.nummer)} ${esc(k.name)}</td>${zoneList.map(z => {
                const hHit = k.paradenNachZone[z] || 0;
                const gG = k.gegentoreNachZone[z] || 0;
                const tot = hHit + gG;
                return tot ? `<td>${hHit}/${tot}</td>` : '<td class="rep-dim">–</td>';
            }).join('')}</tr>`).join('')}
    </tbody>
  </table>
  <p class="rep-note">Gelesen als „gehalten / Würfe aufs Tor“ aus dieser Position.</p>`;
        }

        return `
<section class="rep-block">
  <h2>Torhüter</h2>
  <table class="rep-table">
    <thead><tr><th>Nr</th><th class="rep-name">Name</th><th>Einsatz</th><th>Paraden</th><th>Gegentore</th><th>Würfe aufs Tor</th><th>Fangquote</th></tr></thead>
    <tbody>${main}</tbody>
  </table>
  ${zoneTable}
</section>`;
    }

    function reportHalves(hz, aktionen, spieler) {
        function half(n) {
            const acts = aktionen.filter(a => (a.halbzeit === 2 ? 2 : 1) === n);
            let tore = 0, fehl = 0, verl = 0, gew = 0;
            acts.forEach(a => {
                const p = spieler.find(x => x.id === a.spielerId);
                if (p && window.Store.isGuestTeam(p.name)) return;
                const t = a.typ || '';
                if (t.includes('WurfTor')) tore++;
                else if (t.includes('WurfOhneTor')) fehl++;
                else if (t.includes('Ballverlust')) verl++;
                else if (t.includes('Ballgewinn')) gew++;
            });
            const w = tore + fehl;
            return { tore, w, quote: w ? Math.round((tore / w) * 1000) / 10 : null, verl, gew };
        }
        const a = half(1), b = half(2);
        if (a.w + b.w === 0) return '';

        return `
<section class="rep-block">
  <h2>Halbzeitvergleich</h2>
  <table class="rep-table">
    <thead><tr><th class="rep-name">Hälfte</th><th>Tore</th><th>Gegentore</th><th>Würfe</th><th>Wurfquote</th><th>Ballverluste</th><th>Ballgewinne</th></tr></thead>
    <tbody>
      <tr><td class="rep-name">1. Hälfte</td><td class="rep-strong">${a.tore}</td><td>${hz[1].gast}</td><td>${a.w}</td><td class="${quoteCls(a.quote)}">${pct(a.quote)}</td><td>${a.verl}</td><td>${a.gew}</td></tr>
      <tr><td class="rep-name">2. Hälfte</td><td class="rep-strong">${b.tore}</td><td>${hz[2].gast}</td><td>${b.w}</td><td class="${quoteCls(b.quote)}">${pct(b.quote)}</td><td>${b.verl}</td><td>${b.gew}</td></tr>
    </tbody>
  </table>
</section>`;
    }

    function reportDiscipline(stats) {
        const rows = Object.values(stats.spieler)
            .filter(p => !p.istGast && (p.zeitstrafen || p.gelb || p.rot || p.blau))
            .sort((a, b) => (b.zeitstrafen + b.rot * 3 + b.blau * 3) - (a.zeitstrafen + a.rot * 3 + a.blau * 3));

        if (rows.length === 0) {
            return `<section class="rep-block"><h2>Disziplin</h2><p class="rep-note">Keine Zeitstrafen oder Karten — saubere Partie.</p></section>`;
        }

        return `
<section class="rep-block">
  <h2>Disziplin</h2>
  <table class="rep-table">
    <thead><tr><th>Nr</th><th class="rep-name">Name</th><th>2 Minuten</th><th>Gelb</th><th>Rot</th><th>Blau</th></tr></thead>
    <tbody>${rows.map(p => `
      <tr><td class="rep-num">${esc(p.nummer)}</td><td class="rep-name">${esc(p.name)}</td>
      <td>${p.zeitstrafen || '–'}</td><td>${p.gelb || '–'}</td><td>${p.rot || '–'}</td><td>${p.blau || '–'}</td></tr>`).join('')}
    </tbody>
  </table>
</section>`;
    }

    function reportGoalSequence(aktionen, spieler, names) {
        const goals = aktionen
            .filter(a => a.typ && a.typ.includes('WurfTor'))
            .sort((a, b) => (a.spielzeit || 0) - (b.spielzeit || 0));
        if (goals.length === 0) return '';

        let h = 0, g = 0;
        const items = goals.map(a => {
            const p = spieler.find(x => x.id === a.spielerId);
            const isGast = p && window.Store.isGuestTeam(p.name);
            if (isGast) g++; else h++;
            const assist = a.assistId ? spieler.find(x => x.id === a.assistId) : null;
            return `<li class="${isGast ? 'rep-goal-gast' : 'rep-goal-heim'}">
      <span class="rep-goal-time">${mmss(a.spielzeit)}</span>
      <span class="rep-goal-score">${h}:${g}</span>
      <span class="rep-goal-who">${isGast ? esc(names.gast) : '#' + esc(p ? p.nummer : '?') + ' ' + esc(p ? p.name : 'Unbekannt')}</span>
      <span class="rep-goal-det">${esc(zoneLabel((a.typ || '').split('_').slice(1).join('_')))}${assist ? ' · Assist ' + esc(String(assist.name).split(' ')[0]) : ''}</span>
    </li>`;
        }).join('');

        return `
<section class="rep-block rep-break">
  <h2>Torfolge</h2>
  <ol class="rep-goals">${items}</ol>
</section>`;
    }

    function reportGlossary() {
        return `
<section class="rep-block rep-glossary">
  <h2>Wie die Zahlen zu lesen sind</h2>
  <dl>
    <dt>Wurfquote</dt><dd>Tore geteilt durch alle Würfe. Sagt, wie oft ein Abschluss drin war.</dd>
    <dt>Fangquote</dt><dd>Paraden geteilt durch alle Würfe aufs Tor. Die zentrale Kennzahl für den Torhüter.</dd>
    <dt>7m raus</dt><dd>Siebenmeter, die dieser Spieler herausgeholt hat — nicht die, die er geworfen hat.</dd>
    <dt>Ballgewinn</dt><dd>Abgefangener Pass, abgenommener Ball oder Block.</dd>
    <dt>Einsatz</dt><dd>Zeit auf dem Feld. Spieler auf der Bank sammeln keine Einsatzzeit.</dd>
  </dl>
</section>`;
    }

    function quoteCls(q, good) {
        if (q === null || q === undefined) return 'rep-dim';
        const s = good || 50;
        if (q >= s) return 'rep-q-good';
        if (q >= s * 0.6) return 'rep-q-mid';
        return 'rep-q-low';
    }

    // ===============================================================
    // ANZEIGE & DRUCK
    // ===============================================================

    function showReport(spieler, aktionen, meta) {
        const view = document.getElementById('report-view');
        const body = document.getElementById('report-content');
        if (!view || !body) return;
        body.innerHTML = buildReport(spieler, aktionen, meta);
        view.style.display = 'flex';
        body.scrollTop = 0;
    }

    function showCurrentReport() {
        const aktionen = window.Store.loadActions();
        if (aktionen.length === 0) {
            if (window.Toast) window.Toast('Noch keine Aktionen erfasst — der Bericht wäre leer.', { type: 'warn' });
            return;
        }
        showReport(window.Store.getSPIELER(), aktionen, { names: window.Store.getTeamNames() });
    }

    async function showArchiveReport(filename) {
        // Die Archivliste liegt im HTML NACH dem Bericht und hat denselben
        // z-index - sie bleibt also darueber liegen und verdeckt ihn. Genau
        // deshalb ging "Bericht" aus dem Archiv nur manchmal auf: naemlich
        // dann, wenn die Liste vorher schon zu war.
        const archiv = document.getElementById('archive-view');
        if (archiv) archiv.style.display = 'none';
        try {
            const res = await fetch('/api/archive/' + encodeURIComponent(filename));
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            const m = String(filename).match(/game-(\d{4}-\d{2}-\d{2})/);
            showReport(data.spieler || [], data.aktionen || [], {
                names: {
                    heim: data.teamHeim || 'HEIM',
                    gast: data.teamGast || 'GAST'
                },
                datum: m ? m[1] : null
            });
        } catch (e) {
            if (window.Toast) window.Toast('Archivspiel konnte nicht geladen werden.', { type: 'error' });
        }
    }

    function closeReport() {
        const view = document.getElementById('report-view');
        if (view) view.style.display = 'none';
    }

    function printReport() {
        window.print();
    }

    window.Report = {
        buildReport,
        showReport,
        showCurrentReport,
        showArchiveReport,
        closeReport,
        printReport
    };
})();
