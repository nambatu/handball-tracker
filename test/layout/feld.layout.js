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
// (dazu das "Assist"-Sheet, wenn es kommt).
// Dazu kommen die Spielphasen und die Auszeit (vor, Planzeit erreicht, Auszeit-
// Wahl, Auszeit laeuft, Verlauf mit Auszeit, Pause, Abpfiff,
// Archiv-Frage) - jeweils mit denselben Pruefungen 1-8 - und auf 390x844 ein
// Durchlauf des ganzen Ablaufs (Anpfiff bis Archivieren, siehe ablaufTest).
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

// Sheets, die nach dem Tippen auf eine Zone kommen koennen (nur die Assist-Abfrage)
async function hinweiseBeantworten(page, e, vp, einmal) {
    for (let runde = 0; runde < 4; runde++) {
        await sleep(350);
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

// ---------------------------------------------------------------
// Spielphasen und Auszeit
// ---------------------------------------------------------------
const tippe = async function (page, sel) { await page.tap(sel, { timeout: 8000 }); await sleep(350); };
const text = async function (page, sel) { return ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim(); };
const zustandUhr = function (page) {
    return page.evaluate(function () {
        const t = window.Timer.getTimerState();
        return { phase: t.phase, half: t.currentHalf, laeuft: t.isTimerRunning, sek: t.spielzeitSekunden, hz: t.halbzeitSekunden };
    });
};
const balkenText = async function (page) {
    return page.evaluate(function () {
        const b = document.getElementById('spiel-balken');
        return b ? b.textContent.replace(/\s+/g, ' ').trim() : null;
    });
};

// Zeitstrafe (2 Minuten) ueber die Oberflaeche geben
async function strafe(page, wer) {
    await waehle(page, wer);
    await page.locator('#court-action-sheet .court-action-btn', { hasText: '2-Minuten' }).tap({ timeout: 8000 });
    await sleep(600);
}

const sperrZahl = function (page) { return page.locator('.court-drop-zone.is-blocked').count(); };

// Kader und Uhr nach den Strafen-Zustaenden zuruecksetzen
async function kaderWiederherstellen(page) {
    await page.evaluate(function (kader) {
        window.Store.getSPIELER().forEach(function (p) {
            const k = kader.find(function (x) { return x[0] === p.name; });
            if (k) p.position = k[2];
            p.suspendedUntilGameTime = null;
            p.sperrePlatz = null;
        });
        window.Sync.touch();
        window.UI.updateUI();
    }, KADER);
    await sleep(300);
}

// Die Phasen der Reihe nach. Die Uhr laeuft dabei in der 1. Halbzeit (vorher
// hat ein Tor sie angepfiffen). Gemessen wird in jedem neuen Zustand wie sonst.
async function phasenZustaende(page, e, vp, hochHandy) {
    const sollText = async function (zustand, sel, erwartet) {
        const t = await text(page, sel);
        if (t.indexOf(erwartet) === -1) melde(e, 9, zustand, sel + ' zeigt "' + t + '" statt "' + erwartet + '"');
    };
    try {
        const hz = (await zustandUhr(page)).hz;

        // Zeitstrafen: ein gesperrter Platz mit grauem Bankspieler, dann auch der Torwart
        await strafe(page, 'Lukas');
        if ((await sperrZahl(page)) !== 1) melde(e, 9, 'strafe', 'erwartet 1 gesperrten Platz, gefunden ' + await sperrZahl(page));
        if (!(await page.$('.court-bench-area .court-player-node.is-gesperrt'))) melde(e, 9, 'strafe', 'kein grauer Spieler auf der Bank');
        await messe(page, e, vp, 'strafe', { feld: true, hochHandy: hochHandy });
        await foto(page, vp, 'strafe');
        await strafe(page, 'Maximilian');
        if ((await sperrZahl(page)) !== 2) melde(e, 9, 'strafe-torwart', 'erwartet 2 gesperrte Plaetze, gefunden ' + await sperrZahl(page));
        if (!(await page.$('.court-drop-zone.pos-TW.is-fehlt'))) melde(e, 9, 'strafe-torwart', 'Torwart-Platz nicht als "fehlt" markiert');
        await messe(page, e, vp, 'strafe-torwart', { feld: true, hochHandy: hochHandy });
        await foto(page, vp, 'strafe-torwart');
        await kaderWiederherstellen(page);

        // Planzeit erreicht: Taste "Halbzeit" und schmaler Balken, die Uhr laeuft weiter
        await page.evaluate(function (s) { window.Timer.setGameTime(s); }, hz);
        await sleep(800);
        await sollText('planzeit', '#timer-btn', 'Halbzeit');
        const b1 = await balkenText(page);
        if (!b1 || b1.indexOf('30:00 erreicht') === -1) melde(e, 9, 'planzeit', 'Balken fehlt oder falsch: ' + b1);
        if (!(await zustandUhr(page)).laeuft) melde(e, 9, 'planzeit', 'Uhr hat von selbst angehalten');
        await messe(page, e, vp, 'planzeit', { feld: true, hochHandy: hochHandy });
        await foto(page, vp, 'planzeit');

        // Auszeit: Wahl-Sheet, dann der Zaehler im Balken
        await tippe(page, '#az-btn');
        await page.waitForSelector('#auszeit-wahl', { state: 'visible', timeout: 5000 });
        if ((await zustandUhr(page)).laeuft) melde(e, 9, 'az-wahl', 'Uhr laeuft nach dem Tipp auf Auszeit weiter');
        await messe(page, e, vp, 'az-wahl', { feld: false });
        await foto(page, vp, 'az-wahl');
        await tippe(page, '#auszeit-heim');
        await sleep(500);
        const b2 = await balkenText(page);
        if (!b2 || !/^Auszeit .* · [01]:\d\d$/.test(b2)) melde(e, 9, 'az-lauft', 'Auszeit-Balken fehlt oder falsch: ' + b2);
        await messe(page, e, vp, 'az-lauft', { feld: true, hochHandy: hochHandy });
        await foto(page, vp, 'az-lauft');

        // Verlauf zeigt die Auszeit mit Loeschknopf
        await overlayOeffnen(page, 'verlauf');
        await page.waitForSelector('#history-view', { state: 'visible', timeout: 5000 });
        await sleep(300);
        if (!(await page.$('#history-view .history-weg'))) melde(e, 9, 'verlauf-az', 'keine Auszeit im Verlauf');
        await messe(page, e, vp, 'verlauf-az', { schrift: false });
        await schliesseOverlay(page, e, 'verlauf', 'verlauf-az');

        // Weiter, dann Halbzeit -> Pause
        await tippe(page, '#timer-btn');
        if (await balkenText(page) === null || (await balkenText(page)).indexOf('Auszeit') !== -1) melde(e, 9, 'az-weiter', 'Auszeit-Balken nach "Weiter" noch da');
        await tippe(page, '#timer-btn');
        const pz = await zustandUhr(page);
        if (pz.phase !== 'pause') melde(e, 9, 'pause', 'Phase ' + pz.phase + ' statt pause');
        await messe(page, e, vp, 'pause', { feld: true, hochHandy: hochHandy });
        await foto(page, vp, 'pause');

        // Anpfiff 2. Halbzeit, Planzeit, Abpfiff -> Ende
        await tippe(page, '#timer-btn');
        await page.evaluate(function (s) { window.Timer.setGameTime(2 * s); }, hz);
        await sleep(800);
        await sollText('abpfiff-erreicht', '#timer-btn', 'Abpfiff');
        await messe(page, e, vp, 'abpfiff-erreicht', { feld: true, hochHandy: hochHandy });
        await tippe(page, '#timer-btn');
        const ez = await zustandUhr(page);
        if (ez.phase !== 'ende') melde(e, 9, 'ende', 'Phase ' + ez.phase + ' statt ende');
        await messe(page, e, vp, 'ende', { feld: true, hochHandy: hochHandy });
        await foto(page, vp, 'ende');

        // Tipp auf einen Spieler nach dem Abpfiff: kein Sheet, nur ein Hinweis
        await page.locator('.court-player-node', { hasText: 'Lukas' }).first().tap({ timeout: 8000 });
        await sleep(500);
        if (await page.$('#court-action-sheet')) melde(e, 9, 'ende', 'Aktions-Sheet nach dem Abpfiff');

        // Spiel archivieren fragt nach (Abbrechen laesst alles stehen)
        await tippe(page, '#timer-btn');
        await page.waitForSelector('#archiv-frage', { state: 'visible', timeout: 5000 });
        await messe(page, e, vp, 'archiv-frage', { feld: false });
        await page.tap('#archiv-frage .btn:not(.btn-primary)');
        await sleep(300);
        if ((await zustandUhr(page)).phase !== 'ende') melde(e, 9, 'archiv-frage', 'Abbrechen hat die Phase veraendert');
    } catch (err) {
        melde(e, 9, 'phasen', 'Ablauf abgebrochen: ' + String(err.message).split('\n').slice(0, 5).join(' | '));
    }
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

        // (a) ruhiges Feld - zugleich der Zustand "vor dem Spiel"
        if ((await text(page, '#timer-btn')) !== 'Anpfiff') melde(e, 9, 'vor', 'Haupttaste vor dem Spiel: "' + await text(page, '#timer-btn') + '" statt "Anpfiff"');
        if ((await page.isVisible('#az-btn'))) melde(e, 9, 'vor', 'Auszeit-Taste schon vor dem Anpfiff sichtbar');
        await messe(page, e, vp, 'a', { feld: true, hochHandy: hochHandy });
        await foto(page, vp, 'a');
        await messe(page, e, vp, 'vor', { feld: true, hochHandy: hochHandy });
        await foto(page, vp, 'vor');

        // Anpfiff: ohne laufende Uhr laesst sich nichts eintragen (siehe sperrTest)
        await tippe(page, '#timer-btn');

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
            await foto(page, vp, 'verlauf');
            // Baukasten: Kopfzeile mit Zurueck, Titel; Inhalt scrollt darunter
            const kopf = await page.evaluate(function () {
                const k = document.querySelector('#history-view .vollbild-kopf');
                const z = document.querySelector('#history-view .vollbild-zurueck');
                const t = document.querySelector('#history-view .vollbild-titel');
                const i = document.querySelector('#history-view .vollbild-inhalt');
                if (!k || !z || !t || !i) return { fehlt: true };
                const kr = k.getBoundingClientRect(), tr = t.getBoundingClientRect();
                return {
                    kopfOben: kr.top, kopfHoehe: kr.height, titel: t.textContent.trim(),
                    titelMitte: Math.abs((tr.left + tr.width / 2) - window.innerWidth / 2),
                    scrollt: getComputedStyle(i).overflowY === 'auto',
                    emoji: /\p{Extended_Pictographic}/u.test(document.getElementById('history-view').textContent)
                };
            });
            if (kopf.fehlt) melde(e, 9, 'f', 'Verlauf: Kopfzeile/Zurueck/Titel/Inhalt fehlen');
            else {
                if (kopf.kopfOben !== 0) melde(e, 2, 'f', 'Verlauf: Kopfzeile nicht ganz oben (' + kopf.kopfOben + ')');
                if (kopf.titel !== 'Verlauf') melde(e, 9, 'f', 'Verlauf: Titel "' + kopf.titel + '"');
                if (!kopf.scrollt) melde(e, 9, 'f', 'Verlauf: Inhalt scrollt nicht');
                if (kopf.emoji) melde(e, 9, 'f', 'Verlauf: Emoji im Text');
                if (kopf.titelMitte > 24) melde(e, 2, 'f', 'Verlauf: Titel nicht mittig (' + Math.round(kopf.titelMitte) + ' px daneben)');
            }
            await schliesseOverlay(page, e, 'verlauf', 'f');

            // Baukasten: Bestaetigungsblatt (Abbrechen -> false, Knopf -> true)
            await page.evaluate(function () {
                window.__antwort = 'offen';
                window.UI.bestaetigen({ titel: 'Auszeit löschen?', text: 'Die Auszeit verschwindet aus dem Spiel.', okText: 'Löschen', gefahr: true })
                    .then(function (a) { window.__antwort = a; });
            });
            await page.waitForSelector('[role="alertdialog"]', { state: 'visible', timeout: 3000 });
            await sleep(200);
            await messe(page, e, vp, 'f-bestaetigen', { schrift: false });
            await foto(page, vp, 'bestaetigen');
            await page.locator('[role="alertdialog"] button', { hasText: 'Abbrechen' }).tap({ timeout: 3000 });
            await sleep(150);
            if ((await page.evaluate(function () { return window.__antwort; })) !== false) melde(e, 9, 'f-bestaetigen', 'Abbrechen liefert nicht false');
            await page.evaluate(function () {
                window.__antwort = 'offen';
                window.UI.bestaetigen({ titel: 'Sicher?' }).then(function (a) { window.__antwort = a; });
            });
            await page.locator('[role="alertdialog"] button', { hasText: 'OK' }).tap({ timeout: 3000 });
            await sleep(150);
            if ((await page.evaluate(function () { return window.__antwort; })) !== true) melde(e, 9, 'f-bestaetigen', 'OK liefert nicht true');
            if (await page.$('[role="alertdialog"]')) melde(e, 9, 'f-bestaetigen', 'Blatt schliesst nicht');
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

        // Phasen, Auszeit (Zustaende, die nur nach dem Anpfiff vorkommen)
        await phasenZustaende(page, e, vp, hochHandy);
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

// ---------------------------------------------------------------
// Durchlauf des ganzen Ablaufs auf 390x844 (echte Bedienung, eigener Browser)
// ---------------------------------------------------------------
async function neuesTestSpiel(browser, base, vp) {
    const ctx = await browser.newContext({
        viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1,
        isMobile: true, hasTouch: true, serviceWorkers: 'block'
    });
    const page = await ctx.newPage();
    const fehler = [];
    page.on('pageerror', function (err) { fehler.push('pageerror: ' + err.message); });
    page.on('console', function (m) {
        if (m.type() !== 'error') return;
        const u = (m.location() && m.location().url) || '';
        if (u.indexOf(base) === 0 || u === '') fehler.push('console.error: ' + m.text());
    });
    page.on('dialog', function (d) { d.dismiss().catch(function () {}); fehler.push('Browser-Dialog: ' + d.message()); });
    await anmelden(page, base);
    return { ctx: ctx, page: page, fehler: fehler };
}

// Neu laden: mit laufendem Spiel kommt die App direkt ins Feld; zur Startseite geht es dann ueber Start.zeige()
async function neuLaden(page) {
    await page.evaluate(function () { return window.Sync.flush(); });
    await page.reload();
    await page.waitForFunction(function () {
        const b = document.body.classList;
        const i = document.getElementById('start-inhalt');
        return (b.contains('ansicht-spiel') || (b.contains('ansicht-start') && i && !i.hidden)) && window.Timer && window.Sync;
    }, null, { timeout: 30000 });
    await sleep(700);
    await page.evaluate(function () { window.Start.zeige(); });
    await sleep(400);
}

const archivListe = function (page) {
    return page.evaluate(async function () {
        const r = await fetch('/api/archives');
        const l = await r.json();
        return (Array.isArray(l) ? l : []).map(function (x) { return x.filename; });
    });
};

// Test-Spiel archivieren (ohne Rueckfrage), Stand leeren, Kader wie erwartet, Test-Archive loeschen
async function testAufraeumen(page, e, archive0) {
    try {
        await page.evaluate(async function (kader) {
            window.Store.getSPIELER().forEach(function (p) {
                const k = kader.find(function (x) { return x[0] === p.name; });
                if (k) p.position = k[2];
                p.suspendedUntilGameTime = null;
                p.sperrePlatz = null;
            });
            if (window.Timer.getTimerState().phase !== 'vor' || window.Sync.getState().aktionen.length) {
                await window.Timer.endGame({ bestaetigt: true });
            }
            await window.Sync.reset({ spieler: window.Store.getSPIELER(), aktionen: [], spielId: 'g' + Date.now() });
        }, KADER);
        const alle = await archivListe(page);
        const weg = alle.filter(function (f) { return archive0.indexOf(f) === -1; });
        for (const f of weg) {
            await page.evaluate(function (name) { return fetch('/api/archive/' + encodeURIComponent(name), { method: 'DELETE' }); }, f);
        }
        if ((await archivListe(page)).length !== archive0.length) e.notiz.push('Aufraeumen: Test-Archive nicht vollstaendig geloescht');
    } catch (err) { e.notiz.push('Aufraeumen: ' + err.message); }
}

// Drop auf ein Element, wie ihn der Browser beim Ziehen schickt (mit Spieler-id)
const ziehe = function (page, spielerId, zielSelektor) {
    return page.evaluate(function (a) {
        const ziel = document.querySelector(a.sel);
        if (!ziel) throw new Error('Ziel fehlt: ' + a.sel);
        const dt = new DataTransfer();
        dt.setData('text/plain', a.id);
        ziel.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        ziel.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, { id: spielerId, sel: zielSelektor });
};

// Zeitstrafen und gesperrte Plaetze auf 390x844, echte Bedienung
async function strafenTest(browser, base) {
    const vp = { w: 390, h: 844, handy: true };
    const e = neu({ w: 'Strafen 390', h: '844' });
    const t = await neuesTestSpiel(browser, base, vp);
    const page = t.page;
    const ok = function (bedingung, zustand, meldung) { if (!bedingung) melde(e, 9, zustand, meldung); };
    const archive0 = [];
    const info = function () {
        return page.evaluate(function () {
            const feld = window.Store.berechneFeld();
            const pos = {};
            window.Store.getSPIELER().forEach(function (p) { pos[p.name.split(' ')[0]] = p.position; });
            return {
                blockiert: Object.keys(feld.blockiert).sort(),
                belegt: Object.keys(feld.belegt).sort().map(function (k) { return k + ':' + feld.belegt[k].name.split(' ')[0]; }),
                pos: pos,
                aktionen: window.Sync.getState().aktionen.length
            };
        });
    };
    const idVon = function (vorname) {
        return page.evaluate(function (n) {
            const p = window.Store.getSPIELER().find(function (x) { return x.name.split(' ')[0] === n; });
            return p ? p.id : null;
        }, vorname);
    };
    try {
        archive0.push.apply(archive0, await archivListe(page));
        await spielBereitstellen(page);
        await tippe(page, '#timer-btn');            // Anpfiff: die Uhr laeuft

        // 1. Feldspieler (Lukas, LA) bekommt 2 Minuten
        await strafe(page, 'Lukas');
        let i = await info();
        ok(i.pos.Lukas === 'Bank', 'strafe', 'Lukas nicht auf der Bank: ' + i.pos.Lukas);
        ok(JSON.stringify(i.blockiert) === '["LA"]', 'strafe', 'gesperrt: ' + i.blockiert);
        ok(!i.belegt.some(function (b) { return b.indexOf('Lukas') !== -1; }), 'strafe', 'Lukas steht noch im Feld');
        const zone = await text(page, '.court-drop-zone.pos-LA');
        ok(/^2 Min\s*[01]:\d\d$/.test(zone), 'strafe', 'Text im gesperrten Platz: "' + zone + '"');
        ok(!!(await page.$('.court-active-area .court-player-node.pos-LA')) === false, 'strafe', 'Spielerknoten im gesperrten Platz');
        const bankKnoten = page.locator('.court-bench-area .court-player-node.is-gesperrt', { hasText: 'Lukas' });
        ok((await bankKnoten.count()) === 1, 'strafe', 'Lukas nicht grau auf der Bank');
        ok(/[01]:\d\d/.test(await bankKnoten.innerText()), 'strafe', 'Restzeit fehlt am Bankspieler');
        ok((await bankKnoten.getAttribute('draggable')) === 'false', 'strafe', 'Lukas ist ziehbar');
        await foto(page, vp, 'strafen-feld');

        // 2. Antippen: Hinweis statt Sheet
        await bankKnoten.tap();
        await sleep(500);
        ok(!(await page.$('#court-action-sheet')), 'tippen', 'Aktions-Sheet fuer gesperrten Spieler');
        const toastText = await page.evaluate(function () { const l = document.querySelectorAll('.toast'); return l.length ? l[l.length - 1].textContent : ''; });
        ok(/Lukas .*ist noch [01]:\d\d gesperrt/.test(toastText), 'tippen', 'Hinweis: "' + toastText + '"');

        // 3. Ziehen: gesperrter Spieler -> Platz, Bankspieler -> gesperrter Platz, beides abgelehnt
        const lukas = await idVon('Lukas');
        await ziehe(page, lukas, '.court-drop-zone.pos-RA');
        i = await info();
        ok(i.pos.Lukas === 'Bank' && i.belegt.indexOf('RA:Noah') !== -1, 'ziehen', 'gesperrter Spieler liess sich ziehen: ' + JSON.stringify(i.pos));
        await ziehe(page, await idVon('Paul'), '.court-drop-zone.pos-LA');
        i = await info();
        ok(i.pos.Paul === 'N/A' && JSON.stringify(i.blockiert) === '["LA"]', 'ziehen', 'Bankspieler auf gesperrten Platz: ' + JSON.stringify(i.pos));

        // 4. Tausch: Felix (RL) auf den gesperrten Platz -> RL wird gesperrt
        await ziehe(page, await idVon('Felix'), '.court-drop-zone.pos-LA');
        i = await info();
        ok(JSON.stringify(i.blockiert) === '["RL"]' && i.belegt.indexOf('LA:Felix') !== -1 && i.pos.Felix === 'LA', 'tausch', 'nach Tausch: ' + JSON.stringify(i));
        ok((await sperrZahl(page)) === 1, 'tausch', 'Zahl gesperrter Plaetze ' + await sperrZahl(page));

        // 5. Uhr 2 Minuten vor: Platz frei, Lukas waehlbar, bleibt auf der Bank
        const sek = await page.evaluate(function () { return window.Timer.getTimerState().spielzeitSekunden; });
        await page.evaluate(function (s) { window.Timer.setGameTime(s + 125); }, sek);
        await sleep(700);
        i = await info();
        ok(i.blockiert.length === 0 && (await sperrZahl(page)) === 0, 'ablauf', 'Platz noch gesperrt: ' + i.blockiert);
        ok(i.pos.Lukas === 'Bank', 'ablauf', 'Lukas wurde aufs Feld gestellt');
        const toast2 = await page.evaluate(function () { return Array.from(document.querySelectorAll('.toast')).map(function (x) { return x.textContent; }).join(' / '); });
        ok(toast2.indexOf('Lukas Meier darf wieder spielen') !== -1, 'ablauf', 'Hinweis "darf wieder spielen" fehlt: ' + toast2);
        await page.locator('.court-bench-area .court-player-node', { hasText: 'Lukas' }).tap();
        await page.waitForSelector('#court-action-sheet', { state: 'visible', timeout: 4000 });
        await page.evaluate(function (id) { window.UI.selectPlayer(id); }, lukas);
        await kaderWiederherstellen(page);

        // 6. Torwart: Tor leer und markiert, Sperre auf dem Kreislaeufer-Platz
        await strafe(page, 'Maximilian');
        i = await info();
        ok(i.pos.Maximilian === 'Bank', 'torwart', 'Torwart nicht auf der Bank: ' + i.pos.Maximilian);
        ok(JSON.stringify(i.blockiert) === '["KM"]', 'torwart', 'gesperrt: ' + i.blockiert);
        ok(!i.belegt.some(function (b) { return b.indexOf('TW:') === 0; }), 'torwart', 'Tor nicht leer: ' + i.belegt);
        ok(i.pos.Emil === 'Bank', 'torwart', 'Kreislaeufer nicht auf der Bank: ' + i.pos.Emil);
        ok(/Torwart fehlt/.test(await text(page, '.court-drop-zone.pos-TW')), 'torwart', 'Torwart-Platz nicht markiert');
        const gkListe = await page.evaluate(function () {
            window.UI.openGoalkeeperPicker();
            const t = document.getElementById('gk-picker-list').textContent;
            window.UI.closeGoalkeeperPicker();
            return t;
        });
        ok(gkListe.indexOf('Maximilian') === -1, 'torwart', 'gesperrter Torwart in der Torwart-Auswahl');
        await foto(page, vp, 'strafen-torwart');

        // 7. Rueckgaengig (Toast): Sperre weg, Torwart bleibt auf der Bank und ist wieder waehlbar
        await page.locator('.toast-action', { hasText: 'Rückgängig' }).first().tap({ timeout: 5000 });
        await sleep(500);
        i = await info();
        ok(i.blockiert.length === 0 && i.pos.Maximilian === 'Bank', 'rueckgaengig', 'nach Rueckgaengig: ' + JSON.stringify(i));
        ok(!(await page.evaluate(function () { return window.Store.istGesperrt(window.Store.getSPIELER().find(function (p) { return p.name.indexOf('Maximilian') === 0; })); })), 'rueckgaengig', 'Maximilian noch gesperrt');
        await kaderWiederherstellen(page);

        // 8. Zwei Strafen gleichzeitig, danach Neuladen mitten in der Sperre
        await strafe(page, 'Noah');
        await strafe(page, 'Jonas');
        i = await info();
        ok(JSON.stringify(i.blockiert) === '["RA","RM"]' && (await sperrZahl(page)) === 2, 'zwei', 'gesperrt: ' + i.blockiert);
        await neuLadenAmSpiel(page);
        i = await info();
        ok(JSON.stringify(i.blockiert) === '["RA","RM"]', 'reload', 'nach Neuladen gesperrt: ' + i.blockiert);
        const rest = await page.evaluate(function () {
            const t = window.Timer.getTimerState().spielzeitSekunden;
            return window.Store.getSPIELER().filter(function (p) { return p.sperrePlatz; }).map(function (p) { return window.Store.sperreRest(p, t); });
        });
        ok(rest.length === 2 && rest.every(function (r) { return r > 60 && r <= 120; }), 'reload', 'Restzeiten nach Neuladen: ' + rest);
        ok((await sperrZahl(page)) === 2 && /[01]:\d\d/.test(await text(page, '.court-drop-zone.is-blocked')), 'reload', 'Platz zeigt Restzeit nicht');
    } catch (err) {
        melde(e, 9, 'strafen', 'Ablauf abgebrochen: ' + String(err.stack || err.message).split('\n').slice(0, 4).join(' | '));
        try { await page.screenshot({ path: path.join(OUT, 'strafen-abbruch.png') }); } catch (err2) { /* egal */ }
    } finally {
        t.fehler.forEach(function (x) { melde(e, 8, 'strafen', x); });
        await testAufraeumen(page, e, archive0);
        await t.ctx.close();
    }
}

// Erfassen nur, wenn die Uhr es zulaesst (Timer.darfErfassen), auf 390x844, echte Bedienung
async function sperrTest(browser, base) {
    const vp = { w: 390, h: 844, handy: true };
    const e = neu({ w: 'Sperre 390', h: '844' });
    const t = await neuesTestSpiel(browser, base, vp);
    const page = t.page;
    const ok = function (bedingung, zustand, meldung) { if (!bedingung) melde(e, 9, zustand, meldung); };
    const archive0 = [];
    const anzahl = function () { return page.evaluate(function () { return window.Sync.getState().aktionen.length; }); };
    const sheetDa = async function () { return !!(await page.$('#court-action-sheet')); };
    const letzterToast = function () {
        return page.evaluate(function () { const l = document.querySelectorAll('.toast'); return l.length ? l[l.length - 1].textContent : ''; });
    };
    const tippeSpieler = async function (wer) {
        if (wer === 'gegner') await page.locator('.court-opponent-btn').tap({ timeout: 8000 });
        else await page.locator('.court-player-node', { hasText: wer }).first().tap({ timeout: 8000 });
        await sleep(600);
    };
    const knoepfe = function () {
        return page.$$eval('#court-action-sheet .court-action-btn', function (l) { return l.map(function (b) { return b.textContent.trim(); }); });
    };
    // Aktion nicht erlaubt: kein Sheet, gleiche Anzahl, Hinweis mit dem Grund
    const abgelehnt = async function (zustand, wer, grund) {
        const vorher = await anzahl();
        await tippeSpieler(wer);
        ok(!(await sheetDa()), zustand, 'Aktions-Sheet offen bei ' + wer);
        ok((await anzahl()) === vorher, zustand, 'Aktionszahl hat sich geaendert');
        const tt = await letzterToast();
        ok(tt.indexOf(grund) !== -1, zustand, 'Hinweis "' + tt + '" statt "' + grund + '"');
    };
    try {
        archive0.push.apply(archive0, await archivListe(page));
        await spielBereitstellen(page);

        // 1. Vor dem Anpfiff: Spieler und Gegner tippen oeffnet nichts
        const a0 = await anzahl();
        await abgelehnt('vor', 'Lukas', 'Vor dem Anpfiff – erst „Anpfiff“ tippen.');
        await abgelehnt('vor-gegner', 'gegner', 'Vor dem Anpfiff');
        ok((await anzahl()) === a0, 'vor', 'Aktionszahl nach Tippen vor dem Anpfiff');

        // 2. Nach dem Anpfiff: ein Tor wird eingetragen
        await tippe(page, '#timer-btn');
        await tor(page, e, vp, 'Lukas', {});
        ok((await anzahl()) === a0 + 1, 'laeuft', 'Tor nach Anpfiff nicht eingetragen: ' + await anzahl());
        const aTor = await anzahl();

        // 3. Unterbrechen: Sheet zeigt nur Strafen, 2-Minuten wird eingetragen
        await tippe(page, '#timer-btn');   // "Unterbrechen"
        ok((await zustandUhr(page)).laeuft === false, 'steht', 'Uhr laeuft trotz Unterbrechen');
        await tippeSpieler('Felix');
        ok(await sheetDa(), 'steht', 'Sheet bei stehender Uhr fehlt (Strafen muessen gehen)');
        const k = await knoepfe();
        ok(k.length === 2 && k.some(function (x) { return x.indexOf('2-Minuten') !== -1; }) && k.some(function (x) { return x.indexOf('Karte') !== -1; }),
            'steht', 'Tasten bei stehender Uhr: ' + JSON.stringify(k));
        ok(/Uhr steht – nur Strafen\. „Weiter“ tippen für alles andere\./.test(await text(page, '#court-action-sheet')), 'steht', 'Hinweiszeile fehlt');
        await foto(page, vp, 'sperre-nur-strafen');
        await page.locator('#court-action-sheet .court-action-btn', { hasText: '2-Minuten' }).tap({ timeout: 8000 });
        await sleep(600);
        ok((await anzahl()) === aTor + 1, 'steht', '2-Minuten nicht eingetragen');
        const hatStrafe = await page.evaluate(function () { return window.Sync.getState().aktionen.some(function (a) { return a.typ === 'Zeitstrafe'; }); });
        ok(hatStrafe, 'steht', 'Zeitstrafe fehlt im Stand');
        const aStrafe = await anzahl();

        // 4. Direkter Aufruf der Speicherfunktion mit einem Tor bei stehender Uhr: abgelehnt
        const direkt = await page.evaluate(function () {
            const p = window.Store.getSPIELER().find(function (x) { return x.name.indexOf('Noah') === 0; });
            const r = window.Store.erfasseAktion(p, 'WurfTor', 'Wurf mit Tor', 'Wurf', null);
            return { ok: r.ok, grund: r.grund || '' };
        });
        ok(direkt.ok === false && /Uhr steht/.test(direkt.grund), 'direkt', 'Store.erfasseAktion bei stehender Uhr: ' + JSON.stringify(direkt));
        ok((await anzahl()) === aStrafe, 'direkt', 'Aktionszahl nach direktem Aufruf geaendert');

        // 5. Wettlauf: Sheet offen, Uhr haelt an, dann Tipp auf "Wurf mit Tor"
        await tippe(page, '#timer-btn');   // "Weiter"
        ok((await zustandUhr(page)).laeuft === true, 'wettlauf', 'Uhr laeuft nach Weiter nicht');
        await tippeSpieler('Noah');
        const torKnopf = await page.evaluate(function () {
            // Knopf merken: die Uhr haelt an, ohne dass die Anzeige das Sheet neu baut (etwa ein Stopp von aussen)
            window.__torKnopf = Array.from(document.querySelectorAll('#court-action-sheet .court-action-btn')).find(function (b) { return /Wurf mit Tor/.test(b.textContent); });
            return !!window.__torKnopf;
        });
        ok(torKnopf, 'wettlauf', 'Wurf mit Tor nicht im Sheet bei laufender Uhr');
        await page.evaluate(function () { window.Timer.hauptknopf(); });   // Unterbrechen
        await sleep(400);
        const vorRennen = await anzahl();
        await page.evaluate(function () { window.__torKnopf.click(); });
        await sleep(600);
        ok((await anzahl()) === vorRennen, 'wettlauf', 'Tor trotz stehender Uhr eingetragen');
        ok(!(await sheetDa()), 'wettlauf', 'Sheet nach abgelehntem Tipp noch offen');
        ok(/Uhr steht/.test(await letzterToast()), 'wettlauf', 'Hinweis fehlt: "' + await letzterToast() + '"');
        ok(!(await page.$('#assist-overlay:visible')), 'wettlauf', 'Assist-Abfrage offen');

        // 6. Halbzeitpause: nichts geht
        await page.evaluate(function () { window.Timer.hauptknopf(); });   // Weiter
        await sleep(300);
        await page.evaluate(function (s) { window.Timer.setGameTime(s); }, await page.evaluate(function () { return window.Timer.getTimerState().halbzeitSekunden; }));
        await sleep(600);
        await tippe(page, '#timer-btn');   // Halbzeit
        ok((await zustandUhr(page)).phase === 'pause', 'pause', 'Phase ' + (await zustandUhr(page)).phase + ' statt pause');
        await abgelehnt('pause', 'Lukas', 'Halbzeitpause – Aktionen erst nach „Anpfiff 2. Halbzeit“.');
        await abgelehnt('pause-gegner', 'gegner', 'Halbzeitpause');
        const direktPause = await page.evaluate(function () {
            const p = window.Store.getSPIELER().find(function (x) { return x.name.indexOf('Lukas') === 0; });
            return window.Store.erfasseAktion(p, 'Zeitstrafe', '2-Minuten', 'Strafe', null).ok;
        });
        ok(direktPause === false, 'pause', 'Strafe in der Pause direkt erfasst');

        // 7. Abpfiff: nichts geht, Rueckgaengig einer frueheren Aktion schon
        await tippe(page, '#timer-btn');   // Anpfiff 2. Halbzeit
        await page.evaluate(function (s) { window.Timer.setGameTime(2 * s); }, await page.evaluate(function () { return window.Timer.getTimerState().halbzeitSekunden; }));
        await sleep(600);
        await tippe(page, '#timer-btn');   // Abpfiff
        ok((await zustandUhr(page)).phase === 'ende', 'ende', 'Phase ' + (await zustandUhr(page)).phase + ' statt ende');
        await abgelehnt('ende', 'Lukas', 'Spiel ist abgepfiffen.');
        await abgelehnt('ende-gegner', 'gegner', 'Spiel ist abgepfiffen.');
        const vorUndo = await anzahl();
        await page.evaluate(function () { window.UI.undoLastAction(); });
        await sleep(500);
        ok((await anzahl()) === vorUndo - 1, 'ende', 'Rueckgaengig nach dem Abpfiff: ' + vorUndo + ' -> ' + await anzahl());
    } catch (err) {
        melde(e, 9, 'sperre', 'Ablauf abgebrochen: ' + String(err.stack || err.message).split('\n').slice(0, 4).join(' | '));
        try { await page.screenshot({ path: path.join(OUT, 'sperre-abbruch.png') }); } catch (err2) { /* egal */ }
    } finally {
        t.fehler.forEach(function (x) { melde(e, 8, 'sperre', x); });
        await testAufraeumen(page, e, archive0);
        await t.ctx.close();
    }
}

// Neu laden und im Spiel bleiben (mit laufendem Spiel oeffnet die App direkt das Feld)
async function neuLadenAmSpiel(page) {
    // Erst sichern: mit ungesicherten Aenderungen fragt der Browser beim Verlassen nach
    await page.evaluate(function () { return window.Sync.flush(); });
    await page.reload();
    await page.waitForFunction(function () {
        return document.body.classList.contains('ansicht-spiel') && document.querySelector('.court-active-area') && window.Timer && window.Sync;
    }, null, { timeout: 30000 });
    await sleep(800);
}

async function ablaufTest(browser, base) {
    const vp = { w: 390, h: 844, handy: true };
    const e = neu({ w: 'Ablauf 390', h: '844' });
    const t = await neuesTestSpiel(browser, base, vp);
    const page = t.page;
    const ok = function (bedingung, zustand, meldung) { if (!bedingung) melde(e, 9, zustand, meldung); };
    const archive0 = [];
    let neueArchive = [];
    try {
        archive0.push.apply(archive0, await archivListe(page));
        await spielBereitstellen(page);
        // frische Uhr: ein vorheriger Lauf kann sie verstellt haben
        let z = await zustandUhr(page);
        ok(z.phase === 'vor', 'vor', 'Phase ' + z.phase + ' statt vor');
        ok(await text(page, '#timer-btn') === 'Anpfiff', 'vor', 'Taste "' + await text(page, '#timer-btn') + '"');
        ok((await text(page, '#half-indicator')).indexOf('Vor dem Spiel') !== -1, 'vor', 'Status fehlt');

        // Anpfiff
        await tippe(page, '#timer-btn');
        z = await zustandUhr(page);
        ok(z.phase === 'hz1' && z.laeuft, 'anpfiff', 'nach Anpfiff: ' + JSON.stringify(z));
        ok(await text(page, '#timer-btn') === 'Unterbrechen', 'anpfiff', 'Taste "' + await text(page, '#timer-btn') + '"');
        ok(await text(page, '#half-indicator') === '1. Halbzeit', 'anpfiff', 'Status "' + await text(page, '#half-indicator') + '"');

        // Tor
        await tor(page, e, vp, 'Lukas', {});
        const nTore = await page.evaluate(function () { return window.Sync.getState().aktionen.length; });
        ok(nTore === 1, 'tor', 'Aktionen ' + nTore);

        // Auszeit eigenes Team: Uhr steht, Marke im Stand, keine Aktion
        await tippe(page, '#az-btn');
        ok(!(await zustandUhr(page)).laeuft, 'auszeit', 'Uhr laeuft nach Auszeit-Tipp');
        await page.waitForSelector('#auszeit-wahl', { state: 'visible', timeout: 5000 });
        await tippe(page, '#auszeit-heim');
        const st1 = await page.evaluate(function () {
            const s = window.Sync.getState();
            return { aktionen: s.aktionen.length, marken: s.tickerMarken.filter(function (m) { return m.art === 'auszeit'; }), spielId: s.spielId };
        });
        ok(st1.aktionen === 1, 'auszeit', 'Auszeit steht in den Aktionen (' + st1.aktionen + ')');
        ok(st1.marken.length === 1 && st1.marken[0].team === 'heim' && st1.marken[0].id.indexOf(st1.spielId) !== -1
            && st1.marken[0].halbzeit === 1 && typeof st1.marken[0].timestamp === 'number', 'auszeit', 'Marke: ' + JSON.stringify(st1.marken));
        ok((await text(page, '#az-heim')) === 'AZ 1', 'auszeit', 'Zaehler "' + await text(page, '#az-heim') + '"');
        await sleep(1300);
        const bz = await balkenText(page);
        ok(bz && /· 0:5\d$/.test(bz), 'auszeit', 'Countdown "' + bz + '"');
        ok(await text(page, '#timer-btn') === 'Weiter', 'auszeit', 'Taste "' + await text(page, '#timer-btn') + '"');
        ok((await page.evaluate(function () { return !window.Timer.getTimerState().isTimerRunning; })), 'auszeit', 'Uhr laeuft waehrend der Auszeit');
        await tippe(page, '#timer-btn');
        ok((await zustandUhr(page)).laeuft && (await balkenText(page)) === null, 'auszeit', 'nach Weiter: laeuft/Balken weg');

        // Halbzeit: Uhr rastet auf die Halbzeitlaenge ein
        const hz = z.hz;
        await page.evaluate(function (s) { window.Timer.setGameTime(s + 7); }, hz);
        await sleep(900);
        ok(await text(page, '#timer-btn') === 'Halbzeit', 'halbzeit', 'Taste "' + await text(page, '#timer-btn') + '"');
        ok(((await balkenText(page)) || '').indexOf('30:00 erreicht') === 0, 'halbzeit', 'Balken "' + await balkenText(page) + '"');
        await tippe(page, '#timer-btn');
        z = await zustandUhr(page);
        ok(z.phase === 'pause' && !z.laeuft && z.sek === hz, 'halbzeit', 'Pause: ' + JSON.stringify(z));
        ok(await text(page, '#game-timer') === '30:00', 'halbzeit', 'Uhr "' + await text(page, '#game-timer') + '"');
        ok(await text(page, '#timer-btn') === 'Anpfiff 2. Halbzeit', 'halbzeit', 'Taste "' + await text(page, '#timer-btn') + '"');
        ok(await text(page, '#half-indicator') === 'Halbzeitpause', 'halbzeit', 'Status "' + await text(page, '#half-indicator') + '"');
        ok(!(await page.isVisible('#az-btn')), 'halbzeit', 'Auszeit-Taste in der Pause sichtbar');

        // Zurueck in die 1. Halbzeit: Wert von vor dem Tipp, gestoppt
        await tippe(page, '#spiel-balken .balken-knopf');
        z = await zustandUhr(page);
        ok(z.phase === 'hz1' && !z.laeuft && z.sek >= hz + 7 && z.sek <= hz + 10, 'zurueck', 'nach Zurueck: ' + JSON.stringify(z));
        ok(await text(page, '#timer-btn') === 'Halbzeit', 'zurueck', 'Taste "' + await text(page, '#timer-btn') + '"');

        // Halbzeit noch einmal, dann Anpfiff 2. Halbzeit: Uhr laeuft ab der Halbzeitlaenge
        await tippe(page, '#timer-btn');
        ok((await zustandUhr(page)).phase === 'pause', 'halbzeit2', 'keine Pause');
        await tippe(page, '#timer-btn');
        await sleep(1300);
        z = await zustandUhr(page);
        ok(z.phase === 'hz2' && z.half === 2 && z.laeuft && z.sek >= hz + 1 && z.sek <= hz + 4, 'anpfiff2', '2. Halbzeit: ' + JSON.stringify(z));

        // Spielzeit erreicht -> Abpfiff -> Ende
        await page.evaluate(function (s) { window.Timer.setGameTime(2 * s); }, hz);
        await sleep(900);
        ok(await text(page, '#timer-btn') === 'Abpfiff', 'abpfiff', 'Taste "' + await text(page, '#timer-btn') + '"');
        ok(((await balkenText(page)) || '').indexOf('Spielzeit erreicht') === 0, 'abpfiff', 'Balken "' + await balkenText(page) + '"');
        await tippe(page, '#timer-btn');
        z = await zustandUhr(page);
        ok(z.phase === 'ende' && !z.laeuft && z.sek === 2 * hz, 'abpfiff', 'Ende: ' + JSON.stringify(z));
        ok(await text(page, '#timer-btn') === 'Spiel archivieren', 'abpfiff', 'Taste "' + await text(page, '#timer-btn') + '"');
        ok((await text(page, '#half-indicator')).indexOf('Spiel beendet · 1:0') === 0, 'abpfiff', 'Status "' + await text(page, '#half-indicator') + '"');

        // Weiterspielen -> Abpfiff
        await tippe(page, '#spiel-balken .balken-knopf');
        z = await zustandUhr(page);
        ok(z.phase === 'hz2' && !z.laeuft && z.sek >= 2 * hz, 'weiterspielen', 'nach Weiterspielen: ' + JSON.stringify(z));
        ok(await text(page, '#timer-btn') === 'Abpfiff', 'weiterspielen', 'Taste "' + await text(page, '#timer-btn') + '"');
        await tippe(page, '#timer-btn');
        ok((await zustandUhr(page)).phase === 'ende', 'abpfiff2', 'kein Ende');

        // Reload im Ende: Phase bleibt
        await neuLaden(page);
        ok((await zustandUhr(page)).phase === 'ende', 'reload-ende', 'Phase nach Reload ' + (await zustandUhr(page)).phase);
        ok(await text(page, '#start-weiter') === 'Spiel archivieren', 'reload-ende', 'Startseite: "' + await text(page, '#start-weiter') + '"');
        ok((await text(page, '#laufend-meta')).indexOf('Spiel beendet') !== -1, 'reload-ende', 'Startseite-Meta "' + await text(page, '#laufend-meta') + '"');
        await page.evaluate(function () { window.Start.zumSpiel(); });
        await page.waitForSelector('.court-active-area', { state: 'visible', timeout: 10000 });
        await sleep(400);

        // Archivieren: Abbrechen laesst alles stehen
        await tippe(page, '#timer-btn');
        await page.waitForSelector('#archiv-frage', { state: 'visible', timeout: 5000 });
        ok((await text(page, '#archiv-frage-titel')) === 'Spiel archivieren?', 'archiv', 'Titel "' + await text(page, '#archiv-frage-titel') + '"');
        await tippe(page, '#archiv-frage .btn:not(.btn-primary)');
        const st2 = await page.evaluate(function () {
            const s = window.Sync.getState();
            return { a: s.aktionen.length, m: s.tickerMarken.filter(function (x) { return x.art === 'auszeit'; }).length, phase: window.Timer.getTimerState().phase };
        });
        ok(st2.a === 1 && st2.m === 1 && st2.phase === 'ende', 'archiv-abbruch', 'nach Abbrechen: ' + JSON.stringify(st2));
        ok((await archivListe(page)).length === archive0.length, 'archiv-abbruch', 'Archiv hat sich veraendert');

        // Archivieren: Startseite, Archiv vorhanden, Stand leer, Uhr vor dem Spiel
        await tippe(page, '#timer-btn');
        await page.waitForSelector('#archiv-frage', { state: 'visible', timeout: 5000 });
        await tippe(page, '#archiv-frage .btn-primary');
        await page.waitForFunction(function () {
            const f = document.getElementById('start-formular');
            return document.body.classList.contains('ansicht-start') && f && !f.hidden;
        }, null, { timeout: 20000 });
        const nach = await archivListe(page);
        neueArchive = nach.filter(function (f) { return archive0.indexOf(f) === -1; });
        ok(neueArchive.length === 1, 'archiv', 'neue Archive: ' + neueArchive.length);
        const st3 = await page.evaluate(function () {
            const s = window.Sync.getState();
            return { a: s.aktionen.length, m: s.tickerMarken.length, phase: window.Timer.getTimerState().phase, sek: window.Timer.getTimerState().spielzeitSekunden };
        });
        ok(st3.a === 0 && st3.m === 0 && st3.phase === 'vor' && st3.sek === 0, 'archiv', 'nach Archivieren: ' + JSON.stringify(st3));

        // Reload in der Pause: Phase bleibt
        await page.fill('#start-spielname', 'Layouttest');
        await page.tap('#start-los');
        await page.waitForSelector('.court-active-area', { state: 'visible', timeout: 10000 });
        await sleep(300);
        await tippe(page, '#timer-btn');
        await page.evaluate(function (s) { window.Timer.setGameTime(s); }, hz);
        await sleep(700);
        await tippe(page, '#timer-btn');
        ok((await zustandUhr(page)).phase === 'pause', 'reload-pause', 'keine Pause');
        await neuLaden(page);
        z = await zustandUhr(page);
        ok(z.phase === 'pause' && z.sek === hz && !z.laeuft, 'reload-pause', 'nach Reload: ' + JSON.stringify(z));
        ok((await text(page, '#laufend-meta')).indexOf('Halbzeitpause') !== -1, 'reload-pause', 'Startseite-Meta "' + await text(page, '#laufend-meta') + '"');
    } catch (err) {
        melde(e, 9, 'ablauf', 'Ablauf abgebrochen: ' + String(err.stack || err.message).split('\n').slice(0, 4).join(' | '));
        try {
            e.notiz.push('Stand beim Abbruch: ' + await page.evaluate(function () { return document.body.className + ' / ' + location.href; }));
            await page.screenshot({ path: path.join(OUT, 'ablauf-abbruch.png') });
        } catch (err2) { /* egal */ }
    } finally {
        t.fehler.forEach(function (x) { melde(e, 8, 'ablauf', x); });
        await testAufraeumen(page, e, archive0);
        await t.ctx.close();
    }
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
        if (!nur.length || nur.indexOf('390x844') !== -1) {
            process.stdout.write('lauf Ablauf 390x844 ... ');
            await ablaufTest(browser, base);
            console.log('fertig');
            process.stdout.write('lauf Sperre 390x844 ... ');
            await sperrTest(browser, base);
            console.log('fertig');
            process.stdout.write('lauf Strafen 390x844 ... ');
            await strafenTest(browser, base);
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
