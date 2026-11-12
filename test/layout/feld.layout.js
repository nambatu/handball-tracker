#!/usr/bin/env node
'use strict';
// ===================================================================
// LAYOUT-TEST DER SPIELANSICHT (FELD)
// ===================================================================
// Warum es den gibt: das Layout fuers Handy musste bisher immer wieder
// nachgearbeitet werden, weil niemand es auf zehn Bildschirmgroessen
// durchgeklickt hat. Dieser Test macht das automatisch: er oeffnet das
// Spielfeld in zehn Groessen (Handy hoch und quer, Tablet), spielt echte
// Aktionen per Touch durch und misst, ob etwas ueber den Rand ragt, zu
// klein zum Treffen ist, sich ueberlappt oder abgeschnitten wird.
//
// Aufruf:   node test/layout/feld.layout.js
// Umgebung: HT_TEST_USER_B / HT_TEST_PASS_B (Testkonto; NIE ins Repo schreiben)
//           HT_LAYOUT_OUT   Ordner fuer die Screenshots (sonst ein Temp-Ordner)
//           HT_ONLY         nur diese Groessen, z.B. "320x568,844x390"
// Ende:     Exit-Code 1, sobald irgendeine Pruefung durchfaellt.
//
// Pruefungen (Spalten der Tabelle):
//   1 kein waagrechtes Scrollen        6 Feld ganz sichtbar, nichts scrollt
//   2 alles bedienbare im Bild         7 Schriftgroessen (Namen, Stand)
//   3 Touch-Ziele mind. 44 px          8 keine Fehler in der Konsole
//   4 nichts ueberlappt                9 echte Eingabe per Tippen
//   5 kein abgeschnittener Text       10 Overlays: Schliessen erreichbar
// Die Zustaende, in denen 1-8 gemessen werden: a Feld ruhig, b Spieler
// gewaehlt, c Unterauswahl offen, d nach 3:2, e Menue offen, f Verlauf offen
// (dazu die Hinweis-Sheets "Uhr laeuft nicht" und "Assist", wenn sie kommen).
// ===================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const USER = process.env.HT_TEST_USER_B;
const PASS = process.env.HT_TEST_PASS_B;
if (!USER || !PASS) {
    console.error('HT_TEST_USER_B / HT_TEST_PASS_B fehlen (siehe Kopf dieser Datei).');
    process.exit(2);
}

const OUT = process.env.HT_LAYOUT_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'ht-layout-'));
fs.mkdirSync(OUT, { recursive: true });

// Mobil (isMobile) fuer alle Handys, auch quer. Tablets: Touch ja, Mobil-Modus nein.
const VIEWPORTS = [
    { w: 320, h: 568, handy: true }, { w: 360, h: 640, handy: true }, { w: 375, h: 667, handy: true },
    { w: 390, h: 844, handy: true }, { w: 412, h: 915, handy: true }, { w: 430, h: 932, handy: true },
    { w: 667, h: 375, handy: true }, { w: 844, h: 390, handy: true },
    { w: 768, h: 1024, handy: false }, { w: 1024, h: 768, handy: false }
];

const CHECKS = [
    '', 'kein H-Scroll', 'im Bild', 'Touch 44', 'ueberlappt nicht', 'Text ganz',
    'Feld sichtbar', 'Schrift', 'Konsole', 'Eingabe', 'Overlays'
];

// Realistischer Kader: 14 eigene Spieler, zwei Torhueter mit langen Namen,
// Nummern bis 99. Sieben stehen auf dem Feld, sieben auf der Bank.
const KADER = [
    ['Maximilian Oberhuber', 1, 'TW'], ['Konstantin Bergmüller', 16, 'TW'],
    ['Lukas Meier', 7, 'LA'], ['Felix Brandstätter', 9, 'RL'], ['Jonas Weber', 10, 'M'],
    ['Sebastian Hoffmann-Lang', 11, 'RR'], ['Noah Schmid', 14, 'RA'], ['Emil Krämer', 99, 'K'],
    ['Paul Wagner', 2, 'N/A'], ['Ben Fischer', 3, 'N/A'], ['Leon Becker', 5, 'N/A'],
    ['Finn Schulz', 8, 'N/A'], ['Elias Richter', 13, 'N/A'], ['Anton Wolf', 23, 'N/A']
];
const TEAM_HEIM = 'HSG Langenau-Elchingen';
const TEAM_GAST = 'TSV Musterdorf-Nord';

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

// ---------------------------------------------------------------
// Statischer Server fuer public/ (ohne Abhaengigkeit)
// ---------------------------------------------------------------
const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function starteServer() {
    return new Promise(function (fertig) {
        const srv = http.createServer(function (req, rsp) {
            let p = decodeURIComponent(req.url.split('?')[0]);
            if (p === '/') p = '/index.html';
            const datei = path.join(PUBLIC, path.normalize(p));
            if (datei.indexOf(PUBLIC) !== 0) { rsp.writeHead(403); rsp.end(); return; }
            fs.readFile(datei, function (err, buf) {
                if (err) { rsp.writeHead(404); rsp.end('nicht gefunden'); return; }
                rsp.writeHead(200, {
                    'Content-Type': MIME[path.extname(datei)] || 'application/octet-stream',
                    'Cache-Control': 'no-store'
                });
                rsp.end(buf);
            });
        });
        srv.listen(0, '127.0.0.1', function () { fertig(srv); });
    });
}

// ---------------------------------------------------------------
// Messung im Browser. Laeuft IN der Seite, gibt nur Befunde zurueck.
// ---------------------------------------------------------------
function messen(opt) {
    // Soll-Groesse aus der Testkonfiguration, NICHT window.innerWidth: ragt etwas
    // seitlich heraus, zoomt der mobile Browser heraus und innerWidth waere dann
    // schon die zu grosse Seite - der Fehler bliebe unsichtbar.
    const vw = opt.vw;
    const vh = opt.vh;
    const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [onclick], .court-player-node';
    const befund = { h: [], lage: [], touch: [], touchHinweis: [], ueber: [], text: [], feld: [], schrift: [], namen: null };

    function beschr(el) {
        let t = (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 26);
        let k = '';
        if (el.className && typeof el.className === 'string') k = '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
        return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + k + (t ? ' "' + t + '"' : '');
    }

    function sichtbar(el) {
        for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
            const cs = getComputedStyle(p);
            if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
        }
        const r = el.getBoundingClientRect();
        return r.width >= 1 && r.height >= 1;
    }

    // frei = zuoberst an seinem Mittelpunkt; sonst verdeckt (z.B. vom Sheet)
    function zustand(el, r) {
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) return 'ausserhalb';
        const top = document.elementFromPoint(cx, cy);
        if (top && (el.contains(top) || top.contains(el))) return 'frei';
        return 'verdeckt';
    }

    function ebene(el) {
        const e = el.closest('.court-action-sheet, .sheet-panel, .toast, .overlay-view');
        return e ? (e.id || e.className) : 'seite';
    }

    const scrollerGeprueft = new Set();

    function lage(el, r) {
        const probleme = [];
        let exX = false;
        let exY = false;
        for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
            const cs = getComputedStyle(p);
            const pr = p.getBoundingClientRect();
            const ax = cs.overflowX;
            const ay = cs.overflowY;
            const sx = (ax === 'auto' || ax === 'scroll') && p.scrollWidth > p.clientWidth + 1;
            const sy = (ay === 'auto' || ay === 'scroll') && p.scrollHeight > p.clientHeight + 1;
            if (sx || sy) scrollerGeprueft.add(p);
            // Ein innerer Scroller "verbraucht" die Achse: die Elemente duerfen dort
            // ueber seinen Rand ragen (sie sind per Wischen erreichbar), und die
            // aeusseren Huellen schneiden sie nicht mehr. Der Scroller selbst wird
            // unten auf "im Bild" geprueft.
            if (sx) exX = true;
            else if (!exX && ax !== 'visible' && (r.left < pr.left - 1 || r.right > pr.right + 1)) {
                probleme.push('ragt seitlich aus ' + beschr(p));
            }
            if (sy) exY = true;
            else if (!exY && ay !== 'visible' && (r.top < pr.top - 1 || r.bottom > pr.bottom + 1)) {
                probleme.push('ragt oben/unten aus ' + beschr(p));
            }
        }
        if (!exX && (r.left < -0.5 || r.right > vw + 0.5)) probleme.push('seitlich ausserhalb (x ' + Math.round(r.left) + '..' + Math.round(r.right) + ' von ' + vw + ')');
        if (!exY && (r.top < -0.5 || r.bottom > vh + 0.5)) probleme.push('oben/unten ausserhalb (y ' + Math.round(r.top) + '..' + Math.round(r.bottom) + ' von ' + vh + ')');
        return probleme;
    }

    // 1: kein waagrechtes Scrollen der Seite
    const de = document.documentElement;
    if (de.scrollWidth > vw) befund.h.push('documentElement.scrollWidth ' + de.scrollWidth + ' > ' + vw);
    if (document.body.scrollWidth > vw) befund.h.push('body.scrollWidth ' + document.body.scrollWidth + ' > ' + vw);

    // 2-4: bedienbare Elemente
    const alle = Array.prototype.slice.call(document.querySelectorAll(SEL)).filter(sichtbar);
    const frei = [];
    alle.forEach(function (el) {
        const r = el.getBoundingClientRect();
        const z = zustand(el, r);
        if (z === 'verdeckt') return;               // liegt unter einem Sheet: gerade nicht bedienbar
        const lp = lage(el, r);
        lp.forEach(function (t) { befund.lage.push(beschr(el) + ': ' + t); });
        if (z === 'ausserhalb' && lp.length === 0) return;   // in innerem Scroller, nicht im Bild
        if (z === 'ausserhalb') return;
        frei.push({ el: el, r: r });
        if (opt.touch) {
            const imFeld = !!el.closest('.court-active-area');
            const min = 44;
            if (r.width < min - 0.5 || r.height < min - 0.5) {
                if (imFeld && r.width >= 39.5 && r.height >= 39.5) {
                    befund.touchHinweis.push(beschr(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
                } else {
                    befund.touch.push(beschr(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
                }
            }
        }
    });
    scrollerGeprueft.forEach(function (p) {
        if (!sichtbar(p)) return;
        const r = p.getBoundingClientRect();
        if (r.left < -0.5 || r.right > vw + 0.5) befund.lage.push('Scroll-Container ' + beschr(p) + ' ragt seitlich aus dem Bild');
    });

    // 4: Ueberlappung. Verschiedene Ebenen (Sheet ueber Feld, Toast) gelten als gewollt.
    if (opt.ueber) {
        for (let i = 0; i < frei.length; i++) {
            for (let j = i + 1; j < frei.length; j++) {
                const a = frei[i];
                const b = frei[j];
                if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
                if (ebene(a.el) !== ebene(b.el)) continue;
                const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
                const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
                if (ox > 2 && oy > 2) befund.ueber.push(beschr(a.el) + '  <->  ' + beschr(b.el) + ' (' + Math.round(ox) + 'x' + Math.round(oy) + ')');
            }
        }
    }

    // 5: abgeschnittener Text
    if (opt.text) {
        const kandidaten = Array.prototype.slice.call(document.body.querySelectorAll('*'));
        kandidaten.forEach(function (el) {
            if (/^(SCRIPT|STYLE|OPTION|OPTGROUP|SVG|PATH|INPUT|SELECT|TEXTAREA|BR)$/i.test(el.tagName)) return;
            let eigenerText = false;
            for (let c = el.firstChild; c; c = c.nextSibling) {
                if (c.nodeType === 3 && c.nodeValue.trim()) { eigenerText = true; break; }
            }
            if (!eigenerText) return;
            if (!sichtbar(el)) return;
            const cs = getComputedStyle(el);
            if (cs.display === 'inline') return;
            const r = el.getBoundingClientRect();
            if (zustand(el, r) !== 'frei') return;
            const ax = cs.overflowX;
            const ay = cs.overflowY;
            const brSchmal = el.scrollWidth > el.clientWidth + 1;
            if (brSchmal && cs.textOverflow === 'ellipsis' && (ax === 'hidden' || ax === 'clip')) {
                const titel = (el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();
                if (!titel) befund.text.push(beschr(el) + ': gekuerzt (…) ohne title');
            } else if (brSchmal && !(ax === 'auto' || ax === 'scroll')) {
                befund.text.push(beschr(el) + ': Text breiter als Feld (' + el.scrollWidth + ' > ' + el.clientWidth + ')');
            }
            if ((ay === 'hidden' || ay === 'clip') && el.scrollHeight > el.clientHeight + 1) {
                befund.text.push(beschr(el) + ': Text hoeher als Feld (' + el.scrollHeight + ' > ' + el.clientHeight + ')');
            }
        });
    }

    // Namen im Anzeiger: wie viele Zeichen sieht man?
    function sichtbareZeichen(el) {
        const cs = getComputedStyle(el);
        const text = el.textContent;
        if (el.scrollWidth <= el.clientWidth + 1) return text.length;
        const c = document.createElement('canvas').getContext('2d');
        c.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        const ls = parseFloat(cs.letterSpacing) || 0;
        const platz = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
        const punkte = c.measureText('…').width;
        let w = 0;
        let n = 0;
        for (; n < text.length; n++) {
            const cw = c.measureText(text[n]).width + ls;
            if (w + cw + punkte > platz) break;
            w += cw;
        }
        return n;
    }
    const heim = document.getElementById('team-name');
    const gast = document.getElementById('guest-name');
    if (heim && gast && sichtbar(heim)) {
        befund.namen = { heim: sichtbareZeichen(heim), gast: sichtbareZeichen(gast) };
    }

    // 6: Feld
    if (opt.feld) {
        const f = document.querySelector('.court-active-area');
        if (!f || !sichtbar(f)) {
            befund.feld.push('Feld nicht sichtbar');
        } else {
            const r = f.getBoundingClientRect();
            if (r.left < -0.5 || r.right > vw + 0.5 || r.top < -0.5 || r.bottom > vh + 0.5) {
                befund.feld.push('Feld nicht ganz im Bild (' + Math.round(r.left) + ',' + Math.round(r.top) + ' bis ' + Math.round(r.right) + ',' + Math.round(r.bottom) + ' von ' + vw + 'x' + vh + ')');
            }
            if (opt.hochHandy && r.height < 0.55 * vh) {
                befund.feld.push('Feld nur ' + Math.round(100 * r.height / vh) + '% der Hoehe (' + Math.round(r.height) + ' von ' + vh + ')');
            }
            if (f.scrollHeight > f.clientHeight + 1 || f.scrollWidth > f.clientWidth + 1) befund.feld.push('Feld scrollt');
            befund.feldMass = Math.round(r.width) + 'x' + Math.round(r.height);
        }
        if (de.scrollHeight > vh + 1) befund.feld.push('Seite scrollt senkrecht (' + de.scrollHeight + ' > ' + vh + ')');
        const dv = document.getElementById('dynamic-view-container');
        if (dv && dv.scrollHeight > dv.clientHeight + 1) befund.feld.push('Spielbereich scrollt senkrecht');
    }

    // 7: Schrift
    if (opt.schrift) {
        Array.prototype.slice.call(document.querySelectorAll('.court-player-node .name')).filter(sichtbar).forEach(function (el) {
            const fs = parseFloat(getComputedStyle(el).fontSize);
            if (fs < 12) befund.schrift.push('Spielername ' + fs + 'px: ' + el.textContent);
        });
        ['score-home', 'score-guest'].forEach(function (id) {
            const el = document.getElementById(id);
            if (!el || !sichtbar(el)) { befund.schrift.push('#' + id + ' nicht sichtbar'); return; }
            const fs = parseFloat(getComputedStyle(el).fontSize);
            if (fs < 24) befund.schrift.push('#' + id + ' ' + fs + 'px');
        });
    }
    return befund;
}

// ---------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------
const ergebnis = [];   // { vp, fehler: {1:[],...}, notiz: [] }
let gesamtFehler = 0;

function neu(vp) {
    const e = { vp: vp.w + 'x' + vp.h, f: {}, notiz: [] };
    for (let i = 1; i <= 10; i++) e.f[i] = [];
    ergebnis.push(e);
    return e;
}

function melde(e, nr, zustand, text) {
    e.f[nr].push('[' + zustand + '] ' + text);
}

async function messe(page, e, vp, zustand, opt) {
    opt = Object.assign({ touch: true, ueber: true, text: true, feld: false, schrift: true, hochHandy: false, vw: vp.w, vh: vp.h }, opt || {});
    await page.evaluate(function () { document.querySelectorAll('.toast').forEach(function (t) { t.remove(); }); });
    await sleep(120);
    const b = await page.evaluate(messen, opt);
    b.h.forEach(function (t) { melde(e, 1, zustand, t); });
    b.lage.forEach(function (t) { melde(e, 2, zustand, t); });
    if (opt.touch) b.touch.forEach(function (t) { melde(e, 3, zustand, t); });
    b.touchHinweis.forEach(function (t) { e.notiz.push('[' + zustand + '] Touch-Ziel im Feld knapp (40-43 px): ' + t); });
    b.ueber.forEach(function (t) { melde(e, 4, zustand, t); });
    b.text.forEach(function (t) { melde(e, 5, zustand, t); });
    b.feld.forEach(function (t) { melde(e, 6, zustand, t); });
    b.schrift.forEach(function (t) { melde(e, 7, zustand, t); });
    if (b.namen && vp.w === 360 && vp.h === 640) {
        const min = Math.min(b.namen.heim, b.namen.gast);
        if (min < 10) melde(e, 5, zustand, 'Teamnamen zeigen nur ' + b.namen.heim + '/' + b.namen.gast + ' Zeichen (mind. 10 bei 360 px)');
    }
    if (b.namen && zustand === 'a') e.notiz.push('Teamnamen sichtbar: ' + b.namen.heim + '/' + b.namen.gast + ' Zeichen');
    if (b.feldMass && zustand === 'a') e.notiz.push('Feld ' + b.feldMass);
    return b;
}

async function foto(page, vp, zustand) {
    try {
        await page.screenshot({ path: path.join(OUT, 'feld-' + vp.w + 'x' + vp.h + '-' + zustand + '.png') });
    } catch (err) { /* ein fehlendes Foto soll den Lauf nicht kippen */ }
}

async function anmelden(page, base) {
    await page.goto(base + '/?backend=supabase');
    await page.waitForSelector('#auth-username', { state: 'visible', timeout: 20000 });
    await page.fill('#auth-username', USER);
    await page.fill('#auth-password', PASS);
    await page.press('#auth-password', 'Enter');
    await page.waitForFunction(function () {
        const b = document.body.classList;
        if (b.contains('ansicht-spiel')) return true;
        const inh = document.getElementById('start-inhalt');
        return b.contains('ansicht-start') && inh && !inh.hidden;
    }, null, { timeout: 30000 });
    await sleep(600);
}

// Kader sicherstellen, Aktionen leeren, ueber die Startseite ein frisches Spiel beginnen.
async function spielBereitstellen(page) {
    await page.evaluate(async function (arg) {
        const kader = arg.kader;
        const eigene = window.Store.getSPIELER().filter(function (p) { return !window.Store.istGast(p); });
        const passt = eigene.length === kader.length && kader.every(function (k) {
            return eigene.some(function (p) { return p.name === k[0] && String(p.nummer) === String(k[1]) && p.position === k[2]; });
        });
        if (!passt) {
            eigene.forEach(function (p) { window.Store.removePlayerFromStore(p.id); });
            kader.forEach(function (k) { window.Store.addPlayerToStore(k[0], k[1], k[2]); });
        }
        await window.Sync.reset({
            spieler: window.Store.getSPIELER(), aktionen: [], spielId: 'g' + Date.now()
        });
        window.Start.zeige();
    }, { kader: KADER });
    await page.waitForSelector('#start-formular', { state: 'visible', timeout: 10000 });
    await page.fill('#start-spielname', 'Layouttest');
    await page.fill('#start-team-heim', TEAM_HEIM);
    await page.fill('#start-team-gast', TEAM_GAST);
    await page.tap('#start-los');
    await page.waitForSelector('.court-active-area', { state: 'visible', timeout: 10000 });
    await sleep(400);
}

async function zahlen(page) {
    return page.evaluate(function () {
        return {
            heim: document.getElementById('score-home').textContent.trim(),
            gast: document.getElementById('score-guest').textContent.trim(),
            anzahl: (document.getElementById('action-count') || {}).textContent
        };
    });
}

// Hinweis-Sheets, die nach dem Tippen auf eine Zone kommen koennen
async function hinweiseBeantworten(page, e, vp, einmal) {
    for (let runde = 0; runde < 4; runde++) {
        await sleep(350);
        const uhr = await page.$('#uhr-hinweis:visible');
        if (uhr) {
            if (!einmal.uhr) { einmal.uhr = true; await messe(page, e, vp, 'uhr', { feld: false }); }
            await page.tap('#uhr-hinweis .btn-primary');
            continue;
        }
        const assist = await page.$('#assist-overlay:visible');
        if (assist) {
            if (!einmal.assist) { einmal.assist = true; await messe(page, e, vp, 'assist', { touch: false, feld: false, schrift: false, text: false }); }
            await page.tap('#assist-overlay >> text=Kein Assist');
            continue;
        }
        break;
    }
}

async function waehle(page, wer) {
    if (wer === 'gegner') {
        await page.locator('.court-opponent-btn').tap({ timeout: 8000 });
    } else {
        await page.locator('.court-player-node', { hasText: wer }).first().tap({ timeout: 8000 });
    }
    await page.waitForSelector('#court-action-sheet', { state: 'visible', timeout: 5000 });
    // Ein Mensch tippt nicht schneller als nach ~350 ms auf die naechste Taste;
    // die App ignoriert Klicks davor (Geisterklick nach dem Spielertipp).
    await sleep(450);
}

// Ein Tor ueber die Oberflaeche: Spieler -> Wurf mit Tor -> Zone (-> Hinweise)
async function tor(page, e, vp, wer, einmal, zwischen) {
    await waehle(page, wer);
    if (zwischen && zwischen.b) { await zwischen.b(); }
    await page.locator('#court-action-sheet .court-action-btn', { hasText: 'Wurf mit Tor' }).tap({ timeout: 8000 });
    await sleep(250);
    if (zwischen && zwischen.c) { await zwischen.c(); }
    await page.locator('#court-action-sheet .court-action-btn', { hasText: 'Außen' }).tap({ timeout: 8000 });
    await hinweiseBeantworten(page, e, vp, einmal);
    await sleep(250);
}

async function overlayOeffnen(page, name) {
    const hatMenue = await page.$('#menue-btn');
    if (hatMenue) {
        await page.tap('#menue-btn');
        await page.waitForSelector('#menue', { state: 'visible', timeout: 5000 });
        await sleep(250);
        await page.locator('[data-menue="' + name + '"]').tap({ timeout: 8000 });
    } else {
        await page.evaluate(function (n) {
            const f = {
                verlauf: function () { window.UI.openHistoryView(); },
                statistik: function () { window.Stats.showStats(); },
                bericht: function () { window.Report.showCurrentReport(); },
                kader: function () { window.UI.togglePlayerManagement(); },
                ticker: function () { window.TickerUI.oeffne(); },
                archiv: function () { window.openArchiveModal(); }
            };
            f[n]();
        }, name);
    }
}

const OVERLAY_ID = {
    verlauf: '#history-view', statistik: '#stats-view', bericht: '#report-view',
    kader: '#player-management-view', ticker: '#ticker-view', archiv: '#archive-view'
};

async function laufViewport(browser, base, vp) {
    const e = neu(vp);
    const ctx = await browser.newContext({
        viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1,
        isMobile: vp.handy, hasTouch: true, serviceWorkers: 'block'
    });
    await ctx.addInitScript(function () {
        // Alter Wert aus der Zeit mit zwei Ansichten: darf nichts mehr bewirken
        try { localStorage.setItem('UI_MODE', 'court'); } catch (err) { /* egal */ }
    });
    const page = await ctx.newPage();
    const fehler = [];
    page.on('pageerror', function (err) { fehler.push('pageerror: ' + err.message); });
    page.on('console', function (m) {
        if (m.type() !== 'error') return;
        const u = (m.location() && m.location().url) || '';
        if (u.indexOf(base) === 0 || u === '') fehler.push('console.error: ' + m.text() + (u ? ' @' + u.replace(base, '') : ''));
    });
    page.on('dialog', function (d) { d.accept().catch(function () {}); });
    const hochHandy = vp.handy && vp.h > vp.w;
    const einmal = {};

    try {
        await anmelden(page, base);
        await spielBereitstellen(page);
        const nullStand = await zahlen(page);

        // (a) ruhiges Feld
        await messe(page, e, vp, 'a', { feld: true, hochHandy: hochHandy });
        await foto(page, vp, 'a');

        // 9 + (b) + (c): ein Tor per Touch, dann zuruecknehmen
        try {
            await tor(page, e, vp, 'Lukas', einmal, {
                b: async function () {
                    await messe(page, e, vp, 'b', {});
                },
                c: async function () {
                    await messe(page, e, vp, 'c', {});
                    await foto(page, vp, 'c');
                }
            });
            const z1 = await zahlen(page);
            if (z1.heim !== String(Number(nullStand.heim) + 1)) melde(e, 9, 'tor', 'Stand heim nach Tor ' + z1.heim + ' statt ' + (Number(nullStand.heim) + 1));
            if (Number(z1.anzahl) !== Number(nullStand.anzahl) + 1) melde(e, 9, 'tor', 'Aktionszahl nach Tor ' + z1.anzahl + ' statt ' + (Number(nullStand.anzahl) + 1));
            // Rueckgaengig ueber den Toast
            const rueck = page.locator('.toast-action', { hasText: 'Rückgängig' }).first();
            await rueck.waitFor({ state: 'visible', timeout: 4000 });
            const tb = await rueck.boundingBox();
            if (tb && (tb.width < 43.5 || tb.height < 43.5)) melde(e, 3, 'toast', 'Rueckgaengig-Knopf ' + Math.round(tb.width) + 'x' + Math.round(tb.height));
            const tt = await page.evaluate(function (g) {
                const t = document.querySelector('.toast');
                const r = t.getBoundingClientRect();
                return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: g.w, h: g.h };
            }, { w: vp.w, h: vp.h });
            if (tt.l < -0.5 || tt.r > tt.w + 0.5 || tt.t < -0.5 || tt.b > tt.h + 0.5) melde(e, 2, 'toast', 'Toast ragt aus dem Bild');
            await rueck.tap({ timeout: 5000 });
            await sleep(400);
            const z2 = await zahlen(page);
            if (z2.heim !== nullStand.heim || Number(z2.anzahl) !== Number(nullStand.anzahl)) {
                melde(e, 9, 'rueckgaengig', 'Stand nach Rueckgaengig ' + z2.heim + ':' + z2.gast + ' / ' + z2.anzahl + ' statt ' + nullStand.heim + ':' + nullStand.gast + ' / ' + nullStand.anzahl);
            }
        } catch (err) {
            melde(e, 9, 'tor', 'Ablauf abgebrochen: ' + String(err.message).split('\n').slice(0, 7).join(' | '));
            await page.evaluate(function () { if (window.UI && window.UI.verlasseSpiel) window.UI.verlasseSpiel(); });
        }

        // (d) 3 Tore fuer uns, 2 fuer den Gegner
        try {
            for (const wer of ['Felix', 'Noah', 'Emil', 'gegner', 'gegner']) {
                const vorher = await zahlen(page);
                await tor(page, e, vp, wer, einmal);
                const nachher = await zahlen(page);
                if (process.env.HT_DEBUG) console.log(wer, vorher.anzahl, '->', nachher.anzahl, await page.evaluate(function () { return Array.from(document.querySelectorAll('.toast')).map(function (t) { return t.textContent; }).join(' / '); }));
                if (Number(nachher.anzahl) !== Number(vorher.anzahl) + 1) melde(e, 9, 'd', 'Tor von ' + wer + ' nicht eingetragen (Aktionen ' + vorher.anzahl + ' -> ' + nachher.anzahl + ')');
            }
            const z3 = await zahlen(page);
            if (process.env.HT_DEBUG) console.log(JSON.stringify(await page.evaluate(function () { return window.Sync.getState().aktionen.map(function (a) { var p = window.Store.getSPIELER().find(function (x) { return x.id === a.spielerId; }); return [p && p.name, a.typ, a.spielzeit]; }); })));
            if (z3.heim !== '3' || z3.gast !== '2') melde(e, 9, 'd', 'Stand ' + z3.heim + ':' + z3.gast + ' statt 3:2');
        } catch (err) {
            melde(e, 9, 'd', 'Tore eintragen abgebrochen: ' + String(err.message).split('\n').slice(0, 7).join(' | '));
        }
        await messe(page, e, vp, 'd', {});

        // (e) Kopfmenue
        try {
            const menueKnopf = await page.$('#menue-btn');
            if (menueKnopf) {
                await page.tap('#menue-btn');
                await page.waitForSelector('#menue', { state: 'visible', timeout: 5000 });
                await sleep(300);
                await messe(page, e, vp, 'e', {});
                await foto(page, vp, 'e');
                await page.tap('#menue-zu');
                await page.waitForSelector('#menue', { state: 'hidden', timeout: 5000 });
            } else {
                e.notiz.push('Kein Menue-Knopf (#menue-btn) - Zustand e entfaellt.');
                await foto(page, vp, 'e');
            }
        } catch (err) {
            melde(e, 9, 'e', 'Menue: ' + String(err.message).split('\n')[0]);
        }

        // (f) Verlauf auf und wieder zu
        try {
            await overlayOeffnen(page, 'verlauf');
            await page.waitForSelector('#history-view', { state: 'visible', timeout: 5000 });
            await sleep(300);
            await messe(page, e, vp, 'f', { schrift: false });
            await schliesseOverlay(page, e, 'verlauf', 'f');
        } catch (err) {
            melde(e, 9, 'f', 'Verlauf: ' + String(err.message).split('\n')[0]);
        }

        // 10: alle weiteren Overlays aus dem Menue
        for (const n of ['statistik', 'bericht', 'kader', 'ticker', 'archiv']) {
            try {
                await overlayOeffnen(page, n);
                await page.waitForSelector(OVERLAY_ID[n], { state: 'visible', timeout: 5000 });
                await sleep(600);
                const b = await page.evaluate(messen, { touch: false, ueber: false, text: false, feld: false, schrift: false, vw: vp.w, vh: vp.h });
                b.h.forEach(function (t) { melde(e, 1, n, t); });
                b.lage.forEach(function (t) { melde(e, 2, n, t); });
                await schliesseOverlay(page, e, n, n);
            } catch (err) {
                melde(e, 10, n, 'Overlay: ' + String(err.message).split('\n')[0]);
                await page.evaluate(function () {
                    document.querySelectorAll('.overlay-view').forEach(function (o) { o.style.display = 'none'; });
                    const a = document.getElementById('app-container'); if (a) a.style.display = '';
                });
            }
        }
    } catch (err) {
        melde(e, 9, 'lauf', 'Lauf abgebrochen: ' + String(err.stack || err.message).split('\n').slice(0, 3).join(' | '));
    } finally {
        fehler.forEach(function (t) { melde(e, 8, 'lauf', t); });
        // Testkonto ohne Aktionen hinterlassen
        try {
            await page.evaluate(async function () {
                await window.Sync.reset({ spieler: window.Store.getSPIELER(), aktionen: [], spielId: 'g' + Date.now() });
            });
        } catch (err) { e.notiz.push('Aufraeumen: ' + err.message); }
        await ctx.close();
    }
}

// Schliessen-Knopf im Overlay: sichtbar, im Bild, schliesst, Feld wieder da
async function schliesseOverlay(page, e, name, zustand) {
    const ov = OVERLAY_ID[name];
    const kn = page.locator(ov + ' button').filter({ hasText: /^\s*(Schließen|Zurück)\s*$/ });
    const n = await kn.count();
    let gewaehlt = null;
    for (let i = 0; i < n; i++) {
        const k = kn.nth(i);
        if (await k.isVisible()) {
            const bb = await k.boundingBox();
            const vpGroesse = page.viewportSize();
            if (bb && bb.x >= -0.5 && bb.y >= -0.5 && bb.x + bb.width <= vpGroesse.width + 0.5 && bb.y + bb.height <= vpGroesse.height + 0.5) {
                gewaehlt = k;
                break;
            }
        }
    }
    if (!gewaehlt) {
        melde(e, 10, zustand, 'Kein sichtbarer Schliessen/Zurueck-Knopf im Bild (' + n + ' gefunden)');
        await page.evaluate(function (sel) {
            const o = document.querySelector(sel);
            if (o) o.style.display = 'none';
            const a = document.getElementById('app-container'); if (a) a.style.display = '';
        }, ov);
        return;
    }
    await gewaehlt.tap({ timeout: 5000 });
    await sleep(350);
    const zu = await page.evaluate(function (sel) {
        const o = document.querySelector(sel);
        return !o || getComputedStyle(o).display === 'none';
    }, ov);
    if (!zu) melde(e, 10, zustand, 'Overlay schliesst nicht');
    const feld = await page.isVisible('.court-active-area');
    if (!feld) melde(e, 10, zustand, 'Nach dem Schliessen ist das Spielfeld nicht wieder da');
}

function ausgabe() {
    const col = 11;
    let kopf = 'Groesse'.padEnd(10);
    for (let i = 1; i <= 10; i++) kopf += String(i).padStart(5);
    console.log('\n' + kopf);
    ergebnis.forEach(function (e) {
        let z = e.vp.padEnd(10);
        for (let i = 1; i <= 10; i++) {
            const n = e.f[i].length;
            z += (n === 0 ? 'ok' : 'F' + n).padStart(5);
            gesamtFehler += n;
        }
        console.log(z);
    });
    console.log('\nSpalten: ' + CHECKS.map(function (c, i) { return i ? i + '=' + c : ''; }).filter(Boolean).join(', '));
    ergebnis.forEach(function (e) {
        const hat = Object.keys(e.f).some(function (k) { return e.f[k].length; });
        if (!hat && !e.notiz.length) return;
        console.log('\n=== ' + e.vp + ' ===');
        Object.keys(e.f).forEach(function (k) {
            e.f[k].forEach(function (t) { console.log('  FEHLER Pruefung ' + k + ' (' + CHECKS[k] + '): ' + t); });
        });
        e.notiz.forEach(function (t) { console.log('  Hinweis: ' + t); });
    });
    console.log('\nScreenshots: ' + OUT);
    console.log(gesamtFehler === 0 ? 'ALLES OK' : gesamtFehler + ' Befunde - Test FEHLGESCHLAGEN');
}

(async function () {
    const srv = await starteServer();
    const base = 'http://127.0.0.1:' + srv.address().port;
    const nur = (process.env.HT_ONLY || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    const browser = await chromium.launch();
    try {
        for (const vp of VIEWPORTS) {
            if (nur.length && nur.indexOf(vp.w + 'x' + vp.h) === -1) continue;
            process.stdout.write('lauf ' + vp.w + 'x' + vp.h + ' ... ');
            await laufViewport(browser, base, vp);
            console.log('fertig');
        }
    } finally {
        await browser.close();
        srv.close();
    }
    ausgabe();
    process.exit(gesamtFehler === 0 ? 0 : 1);
})().catch(function (err) {
    console.error(err);
    process.exit(2);
});
