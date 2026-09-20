'use strict';

const fs = require('fs');
const crypto = require('crypto');
const Ticker = require('./tickerlauf');
const TickerRegeln = require('./ticker');

// ===================================================================
// TICKER-ROUTEN
// ===================================================================
// Bewusst ein eigenes Modul und nicht direkt in server.js: so laeuft im
// Test exakt derselbe Code, der auch ausgeliefert wird. Der Vertrag mit
// dem Gateway ist die Stelle, an der ein Nachbau im Test am meisten
// schaden wuerde - man testet dann seine eigene Vorstellung davon.
//
// Gegenstelle: wa-gateway/src/outbox.js. Drei Regeln daraus:
//   - `since` ist die HOECHSTE GESEHENE seq, nicht der Quittungsstand.
//   - Quittiert wird erst nach dem Senden, nicht beim Abholen.
//   - Der Long-Poll muss wirklich blockieren; eine sofortige leere
//     Antwort laesst die Gateway-Schleife heisslaufen.

function registriere(app, deps) {
    const {
        outbox,
        getUserPaths,
        requireUser,
        tickerToken = '',
        gateway = {}
    } = deps;

    function requireTickerToken(req, res, next) {
        if (!tickerToken) {
            return res.status(503).json({ error: 'TICKER_TOKEN ist nicht gesetzt' });
        }
        const kopf = req.headers.authorization || '';
        if (!kopf.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Bearer-Token fehlt' });
        }
        const a = Buffer.from(String(kopf.slice(7)));
        const b = Buffer.from(String(tickerToken));
        // Zeitkonstant, damit sich das Token nicht ueber Laufzeit-
        // unterschiede Zeichen fuer Zeichen erraten laesst.
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            return res.status(401).json({ error: 'Token ungueltig' });
        }
        next();
    }

    // ---------------------------------------------------------------
    // Fuer das Gateway
    // ---------------------------------------------------------------

    app.get('/api/ticker/outbox', requireTickerToken, async (req, res) => {
        const since = Number(req.query.since) || 0;
        // Gedeckelt: ein "wait=99999" duerfte keine Verbindung ewig binden.
        const wartenMs = Math.min(60, Math.max(0, Number(req.query.wait) || 0)) * 1000;

        let beendet = false;
        res.on('close', () => { beendet = true; });

        try {
            const eintraege = await outbox.warten(since, wartenMs);
            if (beendet) return;
            res.json({ eintraege: eintraege, letzteSeq: outbox.seq });
        } catch (e) {
            if (!beendet) res.status(500).json({ error: 'Outbox nicht lesbar' });
        }
    });

    app.post('/api/ticker/ack', requireTickerToken, (req, res) => {
        const bisSeq = Number(req.body && req.body.bisSeq) || 0;
        const entfernt = outbox.quittieren(bisSeq);
        res.json({ success: true, entfernt: entfernt, offen: outbox.eintraege.length });
    });

    // ---------------------------------------------------------------
    // Fuer die Oberflaeche
    // ---------------------------------------------------------------

    app.get('/api/ticker/config', requireUser, (req, res) => {
        try {
            const paths = getUserPaths(req.user.username);
            res.json({
                konfiguration: Ticker.leseKonfiguration(paths.ticker),
                ereignisse: Ticker.EREIGNISSE,
                standardvorlagen: Ticker.STANDARDVORLAGEN,
                gatewayVorhanden: !!(gateway.url && gateway.token),
                kiVorhanden: require('./ki').verfuegbar(),
                stand: outbox.stand()
            });
        } catch (e) {
            res.status(500).json({ error: 'Ticker-Einstellungen nicht lesbar' });
        }
    });

    app.put('/api/ticker/config', requireUser, (req, res) => {
        try {
            const paths = getUserPaths(req.user.username);
            const alt = Ticker.leseKonfiguration(paths.ticker);
            const ein = req.body || {};

            const neu = {
                aktiv: ein.aktiv === undefined ? alt.aktiv : !!ein.aktiv,
                chatId: ein.chatId === undefined ? alt.chatId : (ein.chatId || null),
                ereignisse: Object.assign({}, alt.ereignisse, ein.ereignisse || {}),
                vorlagen: ein.vorlagen === undefined ? alt.vorlagen : (ein.vorlagen || {}),
                regeln: Array.isArray(ein.regeln) ? ein.regeln : alt.regeln,
                pauseHinweis: ein.pauseHinweis === undefined ? alt.pauseHinweis : !!ein.pauseHinweis,
                kiAnalyse: ein.kiAnalyse === undefined ? alt.kiAnalyse : !!ein.kiAnalyse,
                kiHinweis: ein.kiHinweis === undefined ? alt.kiHinweis : String(ein.kiHinweis || '').slice(0, 600)
            };

            // Ein Ticker ohne Ziel wuerde still nichts tun. Lieber hier
            // sagen, als den Trainer in der Halle raten lassen, warum
            // nichts in der Gruppe ankommt.
            if (neu.aktiv && !neu.chatId) {
                return res.status(400).json({ error: 'Ohne Zielgruppe lässt sich der Ticker nicht einschalten.' });
            }
            if (neu.regeln.length > 200) {
                return res.status(400).json({ error: 'Zu viele Regeln (max. 200).' });
            }

            Ticker.schreibeKonfiguration(paths.ticker, neu);
            res.json({ success: true, konfiguration: neu });
        } catch (e) {
            console.error('Ticker-Einstellungen nicht schreibbar', e);
            res.status(500).json({ error: 'Ticker-Einstellungen nicht schreibbar' });
        }
    });

    /**
     * Live-Vorschau: was wuerde bei DIESER Aktion tatsaechlich rausgehen?
     * Baut auf dem echten Spielstand auf, damit {stand} und {anzahl}
     * stimmen - eine Vorschau mit erfundenen Zahlen waere kaum etwas wert.
     */
    app.post('/api/ticker/preview', requireUser, (req, res) => {
        try {
            const paths = getUserPaths(req.user.username);
            const konfiguration = Ticker.leseKonfiguration(paths.ticker);
            const ein = req.body || {};

            let state = { spieler: [], aktionen: [], teamGast: null };
            if (fs.existsSync(paths.state)) {
                try { state = JSON.parse(fs.readFileSync(paths.state, 'utf8')); } catch (e) { /* Standard */ }
            }

            const spieler = Array.isArray(state.spieler) ? state.spieler : [];
            const akteur = spieler.find(p => String(p.id) === String(ein.spielerId)) || spieler[0];
            if (!akteur) return res.json({ text: '', hinweis: 'Noch keine Spieler angelegt.' });

            const beispiel = {
                id: 'vorschau',
                spielerId: akteur.id,
                assistId: ein.assistId || null,
                torwartId: state.aktiverTorwartId || null,
                typ: ein.typ || 'WurfTor',
                label: ein.subtyp || 'Rückraum',
                halbzeit: 2,
                spielzeit: Number(ein.spielzeit) || 2535,
                timestamp: Date.now()
            };

            // Die Beispielaktion ans Ende des ECHTEN Verlaufs haengen statt
            // auf einen leeren Stand zu setzen: sonst steht in der Vorschau
            // immer 1:0 und eine Regel "beim Ausgleich" liesse sich gar
            // nicht ausprobieren.
            const aktionen = (Array.isArray(state.aktionen) ? state.aktionen : []).concat([beispiel]);

            const eigene = Object.assign({}, konfiguration);
            if (ein.vorlage) {
                // Nur fuer diese eine Vorschau: der getippte Text schlaegt
                // alles, damit man ihn ausprobieren kann, bevor er gilt.
                eigene.regeln = [{ wenn: { spielerId: akteur.id, typ: beispiel.typ }, dann: [{ text: ein.vorlage }] }];
            }
            if (ein.ereignis) {
                // Ein abgeschaltetes Ereignis soll die Vorschau nicht leer
                // lassen, wenn man genau dessen Text gerade bearbeitet.
                eigene.ereignisse = Object.assign({}, eigene.ereignisse);
                eigene.ereignisse[ein.ereignis] = true;
            }

            const gebaut = TickerRegeln.nachrichtFuer(beispiel, {
                aktionen: aktionen,
                spieler: spieler,
                konfiguration: eigene,
                teamGast: state.teamGast,
                halbzeitSekunden: Number(state.halbzeitSekunden) || 1800
            });

            res.json({
                text: gebaut ? gebaut.text : '',
                ereignis: gebaut ? gebaut.ereignis : null,
                hinweis: gebaut ? null : 'Zu dieser Aktion wird nichts getickert (Ereignis abgeschaltet?).'
            });
        } catch (e) {
            console.error('Vorschau fehlgeschlagen', e);
            res.status(500).json({ error: 'Vorschau fehlgeschlagen' });
        }
    });

    /**
     * Gruppenliste fuer die Zielauswahl. Bewusst nur ein Komfort-Endpunkt:
     * schlaegt er fehl, laesst sich die Gruppen-ID von Hand eintragen.
     * Das ist kein Schoenheitsfehler, sondern noetig - steht der Tracker
     * spaeter auf dem VPS, ist das Gateway hinter CGNAT gar nicht
     * erreichbar. Der Nachrichtenweg selbst braucht es nie.
     */
    app.get('/api/ticker/chats', requireUser, async (req, res) => {
        if (!gateway.url || !gateway.token) {
            return res.status(503).json({ error: 'Kein Gateway konfiguriert (GATEWAY_URL/GATEWAY_TOKEN).', chats: [] });
        }
        const abbruch = new AbortController();
        const uhr = setTimeout(() => abbruch.abort(), 8000);
        try {
            const sitzung = encodeURIComponent(gateway.session || 'default');
            const antwort = await fetch(`${gateway.url}/sessions/${sitzung}/chats`, {
                headers: { Authorization: `Bearer ${gateway.token}` },
                signal: abbruch.signal
            });
            if (!antwort.ok) throw new Error('HTTP ' + antwort.status);
            const liste = await antwort.json();
            res.json({ chats: Array.isArray(liste) ? liste.filter(c => c && c.isGroup) : [] });
        } catch (e) {
            res.status(502).json({ error: 'Gateway nicht erreichbar: ' + e.message, chats: [] });
        } finally {
            clearTimeout(uhr);
        }
    });
}

module.exports = { registriere };
