#!/usr/bin/env node
'use strict';
// Layout-Test des Sheets "Passwort aendern" (Startseite, Supabase-Modus).
// Aufruf: node test/layout/passwort.layout.js
// Umgebung: HT_TEST_USER_A / HT_TEST_PASS_A (aendert KEIN Passwort, meldet nur an)
// Nutzt die Messfunktion aus feld.layout.js (Pruefungen 1-5), damit es nur
// eine Definition von "Layout ok" gibt.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const USER = process.env.HT_TEST_USER_A;
const PASS = process.env.HT_TEST_PASS_A;
if (!USER || !PASS) { console.error('HT_TEST_USER_A / HT_TEST_PASS_A fehlen.'); process.exit(2); }

const quelle = fs.readFileSync(path.join(__dirname, 'feld.layout.js'), 'utf8');
const a = quelle.indexOf('function messen(opt) {');
const b = quelle.indexOf('// Ablauf', a);
const messenQuelle = quelle.slice(a, quelle.lastIndexOf('\n// ----', b));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function starteServer() {
    return new Promise(function (fertig) {
        const srv = http.createServer(function (req, rsp) {
            let p = decodeURIComponent(req.url.split('?')[0]);
            if (p === '/') p = '/index.html';
            const datei = path.join(PUBLIC, path.normalize(p));
            if (datei.indexOf(PUBLIC) !== 0) { rsp.writeHead(403); rsp.end(); return; }
            fs.readFile(datei, function (err, buf) {
                if (err) { rsp.writeHead(404); rsp.end(); return; }
                rsp.writeHead(200, { 'Content-Type': MIME[path.extname(datei)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
                rsp.end(buf);
            });
        });
        srv.listen(0, '127.0.0.1', function () { fertig(srv); });
    });
}

const GROESSEN = [[320, 568], [390, 844], [844, 390]];
let fehler = 0;

(async function () {
    const srv = await starteServer();
    const base = 'http://127.0.0.1:' + srv.address().port;
    const browser = await chromium.launch();
    try {
        for (const [w, h] of GROESSEN) {
            const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
            const page = await ctx.newPage();
            await page.goto(base + '/?backend=supabase');
            await page.waitForSelector('#auth-username', { state: 'visible', timeout: 20000 });
            await page.fill('#auth-username', USER);
            await page.fill('#auth-password', PASS);
            await page.press('#auth-password', 'Enter');
            await page.waitForFunction(function () {
                const i = document.getElementById('start-inhalt');
                const bd = document.body.classList;
                return (bd.contains('ansicht-start') && i && !i.hidden) || bd.contains('ansicht-spiel');
            }, null, { timeout: 30000 });
            if (await page.evaluate(function () { return document.body.classList.contains('ansicht-spiel'); })) {
                await page.evaluate(function () { window.Start.zeige(); });
            }
            await page.waitForTimeout(500);
            const zustaende = ['Startseite', 'Sheet leer', 'Sheet mit Fehler'];
            for (let i = 0; i < zustaende.length; i++) {
                if (i === 1) await page.evaluate(function () { window.Start.passwortOeffnen(); });
                if (i === 2) {
                    await page.fill('#pw-alt', 'x');
                    await page.fill('#pw-neu', 'kurz');
                    await page.fill('#pw-neu2', 'kurz');
                    await page.click('#pw-speichern');
                    await page.waitForSelector('#pw-fehler:not([hidden])');
                }
                const b = await page.evaluate('(' + messenQuelle + ')(' + JSON.stringify({ vw: w, vh: h, touch: true, ueber: true, text: true }) + ')');
                const probleme = [].concat(b.h, b.lage, b.touch, b.ueber, b.text);
                if (i > 0) {
                    const imBild = await page.evaluate(function () {
                        const p = document.querySelector('#passwort-sheet .sheet-panel');
                        const r = p.getBoundingClientRect();
                        return { ok: r.top >= -0.5 && r.bottom <= innerHeight + 0.5 || p.scrollHeight > p.clientHeight, sk: p.scrollHeight > p.clientHeight };
                    });
                    if (!imBild.ok) probleme.push('Sheet ragt aus dem Bild');
                }
                console.log(w + 'x' + h + ' ' + zustaende[i] + ': ' + (probleme.length ? 'FEHLER' : 'ok'));
                probleme.forEach(function (t) { console.log('   ' + t); fehler++; });
            }
            await ctx.close();
        }
    } finally {
        await browser.close();
        srv.close();
    }
    console.log(fehler === 0 ? 'ALLES OK' : fehler + ' Befunde - FEHLGESCHLAGEN');
    process.exit(fehler === 0 ? 0 : 1);
})().catch(function (e) { console.error(e); process.exit(2); });
