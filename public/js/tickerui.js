// ===================================================================
// TICKER-OBERFLAECHE
// ===================================================================
// Zwei Orte, mit Absicht:
//
//   1. Eine Ticker-Ansicht fuer alles Team-weite: an/aus, Zielgruppe,
//      welche Ereignisse ueberhaupt getickert werden, Standardtexte.
//
//   2. Ein Feld direkt an der Spielerzeile in der Verwaltung. Kein
//      abstrakter Regel-Editor irgendwo anders - man stellt den Spruch
//      dort ein, wo man den Spieler ohnehin anfasst.
//
// Die Vorschau laeuft ueber den Server und rechnet mit dem ECHTEN
// Spielstand. Eine Vorschau mit erfundenen Zahlen waere kaum etwas wert:
// gerade {stand} und {anzahl} will man ja pruefen.

(function () {
    'use strict';

    function esc(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function el(id) { return document.getElementById(id); }

    let entwurf = null;      // Arbeitskopie, erst beim Speichern uebernommen
    let vorschauUhr = null;

    // ---------------------------------------------------------------
    // Oeffnen / Schliessen
    // ---------------------------------------------------------------

    async function oeffne() {
        const sicht = el('ticker-view');
        if (!sicht) return;
        sicht.style.display = 'flex';
        el('ticker-body').innerHTML = '<p class="ticker-laden">Lade Einstellungen…</p>';

        const k = await window.Ticker.laden();
        if (!k) {
            el('ticker-body').innerHTML = '<p class="ticker-fehler">Einstellungen nicht ladbar. Ohne Verbindung geht das nicht.</p>';
            return;
        }
        entwurf = JSON.parse(JSON.stringify(k));
        zeichne();
    }

    function schliesse() {
        const sicht = el('ticker-view');
        if (sicht) sicht.style.display = 'none';
        entwurf = null;
    }

    // ---------------------------------------------------------------
    // Zeichnen
    // ---------------------------------------------------------------

    function zeichne() {
        const ereignisse = window.Ticker.ereignisse;
        const standard = window.Ticker.standardvorlagen;

        const schalter = ereignisse.map(function (e) {
            const an = entwurf.ereignisse[e.schluessel] !== false;
            return '<label class="ticker-schalter">'
                + '<input type="checkbox" data-ereignis="' + esc(e.schluessel) + '"' + (an ? ' checked' : '') + '>'
                + '<span>' + esc(e.label) + '</span></label>';
        }).join('');

        const vorlagen = ereignisse.map(function (e) {
            const eigen = entwurf.vorlagen[e.schluessel];
            const wert = eigen !== undefined && eigen !== null ? eigen : (standard[e.schluessel] || '');
            const geaendert = eigen !== undefined && eigen !== null && eigen !== standard[e.schluessel];
            return '<div class="ticker-vorlage">'
                + '<div class="ticker-vorlage-kopf">'
                + '<strong>' + esc(e.label) + '</strong>'
                + (geaendert ? '<button class="ticker-zurueck" data-reset="' + esc(e.schluessel) + '">Auf Standard zurücksetzen</button>' : '')
                + '</div>'
                + '<textarea rows="2" data-vorlage="' + esc(e.schluessel) + '">' + esc(wert) + '</textarea>'
                + '<div class="ticker-vorschau" data-vorschau="' + esc(e.schluessel) + '"></div>'
                + '</div>';
        }).join('');

        el('ticker-body').innerHTML = ''
            + '<div class="ticker-block">'
            + '  <label class="ticker-schalter ticker-haupt">'
            + '    <input type="checkbox" id="ticker-aktiv"' + (entwurf.aktiv ? ' checked' : '') + '>'
            + '    <span><strong>Ticker aktiv</strong></span>'
            + '  </label>'
            + '  <p class="ticker-hinweis">Es wird nur <em>live</em> getickert. Aktionen, die länger als zwei Minuten '
            + '  zurückliegen, gehen nicht mehr raus — ein Ticker, der nach der Halbzeitpause dreißig Nachrichten '
            + '  nachschiebt, hilft niemandem.</p>'
            + '</div>'

            + '<div class="ticker-block">'
            + '  <h3>Zielgruppe</h3>'
            + '  <div class="ticker-gruppe-zeile">'
            + '    <select id="ticker-gruppe"><option value="">— Gruppe wählen —</option></select>'
            + '    <button id="ticker-gruppen-laden" class="add-btn">Gruppen laden</button>'
            + '  </div>'
            + '  <label class="ticker-feld">Oder Gruppen-ID direkt eintragen'
            + '    <input type="text" id="ticker-chatid" value="' + esc(entwurf.chatId || '') + '" placeholder="4915112345678-1234567890@g.us">'
            + '  </label>'
            + '  <p class="ticker-hinweis" id="ticker-gruppen-hinweis"></p>'
            + '</div>'

            + '<div class="ticker-block">'
            + '  <h3>Was wird getickert?</h3>'
            + '  <div class="ticker-schalter-liste">' + schalter + '</div>'
            + '</div>'

            + '<div class="ticker-block">'
            + '  <h3>KI-Analyse zum Spielende</h3>'
            + (window.Ticker.kiVorhanden
                ? '  <label class="ticker-schalter">'
                + '    <input type="checkbox" id="ticker-ki"' + (entwurf.kiAnalyse !== false ? ' checked' : '') + '>'
                + '    <span>Nach dem Schlusspfiff eine kurze Analyse posten</span>'
                + '  </label>'
                + '  <label class="ticker-feld">Hinweis an die KI (optional)'
                + '    <input type="text" id="ticker-kihinweis" value="' + esc(entwurf.kiHinweis || '') + '"'
                + '      placeholder="z. B. Lobe Julian sarkastisch bis in den Himmel.">'
                + '  </label>'
                + '  <p class="ticker-hinweis">Kommt als eigene Nachricht, ein paar Sekunden nach der '
                + '  Zusammenfassung. Antwortet das Modell nicht, bleibt es einfach aus — die Zahlen sind '
                + '  ohnehin schon in der Gruppe.</p>'
                : '  <p class="ticker-hinweis">Nicht eingerichtet. Dafür muss <code>GEMINI_API_KEY</code> '
                + '  in der <code>.env</code> des Servers stehen.</p>')
            + '</div>'

            + '<div class="ticker-block">'
            + '  <h3>Standardtexte</h3>'
            + '  <p class="ticker-hinweis">Platzhalter: <code>{nr} {name} {vorname} {kurzname} {assist} {stand} {zeit} '
            + '  {halbzeit} {sub} {gegner} {anzahl} {torwart}</code>. WhatsApp-Auszeichnung wie <code>*fett*</code> '
            + '  funktioniert. Für einzelne Spieler gibt es eigene Sprüche in der Spielerverwaltung.</p>'
            + vorlagen
            + '</div>';

        verdrahte();
        alleVorschauen();
    }

    function verdrahte() {
        el('ticker-aktiv').onchange = function () { entwurf.aktiv = this.checked; };
        el('ticker-chatid').oninput = function () { entwurf.chatId = this.value.trim() || null; };
        el('ticker-gruppen-laden').onclick = ladeGruppen;

        const kiSchalter = el('ticker-ki');
        if (kiSchalter) kiSchalter.onchange = function () { entwurf.kiAnalyse = this.checked; };
        const kiHinweis = el('ticker-kihinweis');
        if (kiHinweis) kiHinweis.oninput = function () { entwurf.kiHinweis = this.value; };

        el('ticker-gruppe').onchange = function () {
            if (!this.value) return;
            entwurf.chatId = this.value;
            el('ticker-chatid').value = this.value;
        };

        Array.prototype.forEach.call(document.querySelectorAll('input[type=checkbox][data-ereignis]'), function (box) {
            box.onchange = function () {
                entwurf.ereignisse[this.dataset.ereignis] = this.checked;
            };
        });

        Array.prototype.forEach.call(document.querySelectorAll('[data-vorlage]'), function (feld) {
            feld.oninput = function () {
                entwurf.vorlagen[this.dataset.vorlage] = this.value;
                planeVorschau(this.dataset.vorlage, this.value);
            };
        });

        Array.prototype.forEach.call(document.querySelectorAll('[data-reset]'), function (knopf) {
            knopf.onclick = function () {
                delete entwurf.vorlagen[this.dataset.reset];
                zeichne();
            };
        });
    }

    // ---------------------------------------------------------------
    // Gruppen
    // ---------------------------------------------------------------

    async function ladeGruppen() {
        const hinweis = el('ticker-gruppen-hinweis');
        hinweis.textContent = 'Frage das Gateway…';
        const d = await window.Ticker.gruppen(true);
        const auswahl = el('ticker-gruppe');

        if (d.error || !d.chats || d.chats.length === 0) {
            // Kein Beinbruch: steht der Tracker spaeter auf dem VPS, ist
            // das Gateway hinter CGNAT gar nicht erreichbar. Der
            // Nachrichtenweg selbst braucht diese Liste nie.
            hinweis.textContent = (d.error || 'Keine Gruppen gefunden')
                + ' — die Gruppen-ID lässt sich unten auch von Hand eintragen.';
            return;
        }

        auswahl.innerHTML = '<option value="">— Gruppe wählen —</option>'
            + d.chats.map(function (c) {
                const gewaehlt = c.id === entwurf.chatId ? ' selected' : '';
                return '<option value="' + esc(c.id) + '"' + gewaehlt + '>' + esc(c.name || c.id) + '</option>';
            }).join('');
        hinweis.textContent = d.chats.length + ' Gruppe(n) gefunden.';
    }

    // ---------------------------------------------------------------
    // Vorschau
    // ---------------------------------------------------------------

    const TYP_FUER_EREIGNIS = {
        tor: 'WurfTor', torGast: 'WurfTor', parade: 'Parade',
        siebenmeterRaus: 'SiebenMeterRaus', zeitstrafe: 'Zeitstrafe',
        gelb: 'Karte_Gelb', rot: 'Karte_Rot', blau: 'Karte_Blau',
        fehlwurf: 'Fehlwurf', ballverlust: 'Ballverlust', ballgewinn: 'Ballgewinn'
    };

    function spielerFuer(ereignis) {
        const alle = (window.Store && window.Store.getSPIELER && window.Store.getSPIELER()) || [];
        if (ereignis === 'torGast') {
            const gast = alle.find(function (p) { return window.Store.istGast(p); });
            return gast ? gast.id : null;
        }
        const eigen = alle.filter(function (p) { return !window.Store.istGast(p); });
        if (ereignis === 'parade') {
            const tw = eigen.find(function (p) { return window.Store.isGoalkeeper && window.Store.isGoalkeeper(p); });
            if (tw) return tw.id;
        }
        return eigen.length ? eigen[0].id : null;
    }

    function planeVorschau(ereignis, vorlage) {
        clearTimeout(vorschauUhr);
        vorschauUhr = setTimeout(function () { zeigeVorschau(ereignis, vorlage); }, 350);
    }

    async function zeigeVorschau(ereignis, vorlage) {
        const ziel = document.querySelector('[data-vorschau="' + ereignis + '"]');
        if (!ziel) return;
        const d = await window.Ticker.vorschau({
            ereignis: ereignis,
            typ: TYP_FUER_EREIGNIS[ereignis] || 'WurfTor',
            spielerId: spielerFuer(ereignis),
            vorlage: vorlage
        });
        ziel.textContent = d.text || d.hinweis || '';
        ziel.className = 'ticker-vorschau' + (d.text ? '' : ' ticker-vorschau-leer');
    }

    function alleVorschauen() {
        const standard = window.Ticker.standardvorlagen;
        window.Ticker.ereignisse.forEach(function (e) {
            const eigen = entwurf.vorlagen[e.schluessel];
            zeigeVorschau(e.schluessel, eigen !== undefined && eigen !== null ? eigen : standard[e.schluessel]);
        });
    }

    // ---------------------------------------------------------------
    // Speichern
    // ---------------------------------------------------------------

    async function speichere() {
        const knopf = el('ticker-speichern');
        const meldung = el('ticker-meldung');
        knopf.disabled = true;
        meldung.textContent = '';

        // Texte, die dem Standard entsprechen, gar nicht erst ablegen -
        // sonst friert eine spaeter verbesserte Standardvorlage ein.
        const standard = window.Ticker.standardvorlagen;
        const vorlagen = {};
        Object.keys(entwurf.vorlagen).forEach(function (k) {
            const v = entwurf.vorlagen[k];
            if (v !== undefined && v !== null && v !== standard[k]) vorlagen[k] = v;
        });

        try {
            await window.Ticker.sichern({
                aktiv: entwurf.aktiv,
                chatId: entwurf.chatId,
                ereignisse: entwurf.ereignisse,
                vorlagen: vorlagen,
                regeln: entwurf.regeln,
                kiAnalyse: entwurf.kiAnalyse,
                kiHinweis: entwurf.kiHinweis
            });
            window.Ticker.zeichneZustand();
            meldung.className = 'ticker-meldung ticker-ok';
            meldung.textContent = 'Gespeichert.';
            if (window.Toast) window.Toast('Ticker-Einstellungen gespeichert.', { type: 'success' });
            setTimeout(schliesse, 400);
        } catch (e) {
            meldung.className = 'ticker-meldung ticker-fehler';
            meldung.textContent = e.message;
        } finally {
            knopf.disabled = false;
        }
    }

    // ---------------------------------------------------------------
    // Regeln je Spieler (in der Spielerverwaltung)
    // ---------------------------------------------------------------
    // Eine Zeile je Ereignisart, ein Textfeld je Zeile. Leer heisst:
    // fuer diesen Spieler gilt der Standardtext.

    const SPIELER_EREIGNISSE = ['tor', 'parade', 'siebenmeterRaus', 'zeitstrafe', 'gelb', 'rot'];

    let offenerSpieler = null;

    async function toggleSpielerRegeln(spielerId, behaelter) {
        if (offenerSpieler === String(spielerId)) {
            offenerSpieler = null;
            behaelter.innerHTML = '';
            return;
        }
        offenerSpieler = String(spielerId);
        behaelter.innerHTML = '<p class="ticker-laden">Lade…</p>';

        let k = window.Ticker.konfiguration;
        if (!k) k = await window.Ticker.laden();
        if (!k) { behaelter.innerHTML = '<p class="ticker-fehler">Ohne Verbindung nicht änderbar.</p>'; return; }

        const label = {};
        window.Ticker.ereignisse.forEach(function (e) { label[e.schluessel] = e.label; });

        const zeilen = SPIELER_EREIGNISSE.map(function (ereignis) {
            const regel = findeRegel(k.regeln, spielerId, ereignis);
            const wert = regel ? (regel.dann[0] && regel.dann[0].text) || '' : '';
            return '<label class="ticker-spielerzeile">'
                + '<span>' + esc(label[ereignis] || ereignis) + '</span>'
                + '<input type="text" data-spielerregel="' + esc(ereignis) + '" value="' + esc(wert) + '"'
                + ' placeholder="leer = Standardtext">'
                + '</label>';
        }).join('');

        behaelter.innerHTML = '<div class="ticker-spielerregeln">'
            + '<p class="ticker-hinweis">Eigener Spruch für diesen Spieler. Leer lassen = Standardtext.</p>'
            + zeilen
            + '<div class="ticker-spieler-vorschau" id="ticker-sp-vorschau"></div>'
            + '<button class="add-btn" id="ticker-sp-speichern">Sprüche speichern</button>'
            + '</div>';

        const felder = behaelter.querySelectorAll('[data-spielerregel]');
        Array.prototype.forEach.call(felder, function (f) {
            f.oninput = function () {
                clearTimeout(vorschauUhr);
                const ereignis = this.dataset.spielerregel;
                const text = this.value;
                vorschauUhr = setTimeout(async function () {
                    const ziel = el('ticker-sp-vorschau');
                    if (!ziel) return;
                    if (!text.trim()) { ziel.textContent = ''; return; }
                    const d = await window.Ticker.vorschau({
                        ereignis: ereignis,
                        typ: TYP_FUER_EREIGNIS[ereignis] || 'WurfTor',
                        spielerId: spielerId,
                        vorlage: text
                    });
                    ziel.textContent = d.text || d.hinweis || '';
                }, 350);
            };
        });

        el('ticker-sp-speichern').onclick = function () {
            speichereSpielerRegeln(spielerId, felder, this);
        };
    }

    function findeRegel(regeln, spielerId, ereignis) {
        return (regeln || []).find(function (r) {
            return r && r.wenn && String(r.wenn.spielerId) === String(spielerId)
                && r.wenn.ereignis === ereignis
                && !r.wenn.subtyp && !r.wenn.anzahl && !r.wenn.stand && !r.wenn.phase;
        }) || null;
    }

    async function speichereSpielerRegeln(spielerId, felder, knopf) {
        knopf.disabled = true;
        const k = window.Ticker.konfiguration || { regeln: [] };
        // Nur die schlichten Regeln dieses Spielers ersetzen. Alles mit
        // Zusatzbedingung (Hattrick, Schlussphase) bleibt unangetastet -
        // sonst loescht ein Klick hier still eine Regel, die man an einer
        // ganz anderen Stelle angelegt hat.
        const behalten = (k.regeln || []).filter(function (r) {
            return !(r && r.wenn && String(r.wenn.spielerId) === String(spielerId)
                && SPIELER_EREIGNISSE.indexOf(r.wenn.ereignis) >= 0
                && !r.wenn.subtyp && !r.wenn.anzahl && !r.wenn.stand && !r.wenn.phase);
        });

        const neue = [];
        Array.prototype.forEach.call(felder, function (f) {
            const text = f.value.trim();
            if (!text) return;
            neue.push({
                wenn: { spielerId: String(spielerId), ereignis: f.dataset.spielerregel },
                dann: [{ text: text }]
            });
        });

        try {
            await window.Ticker.sichern({ regeln: behalten.concat(neue) });
            if (window.Toast) window.Toast('Sprüche gespeichert.', { type: 'success' });
            offenerSpieler = null;
            // Die Zeile bekommt den Haken erst nach einem Neuzeichnen.
            if (window.UI && window.UI.renderRosterList) window.UI.renderRosterList();
        } catch (e) {
            if (window.Toast) window.Toast('Nicht gespeichert: ' + e.message, { type: 'warn' });
        } finally {
            knopf.disabled = false;
        }
    }

    window.TickerUI = {
        oeffne: oeffne,
        schliesse: schliesse,
        speichere: speichere,
        toggleSpielerRegeln: toggleSpielerRegeln,
        hatRegeln: function (spielerId) {
            const k = window.Ticker && window.Ticker.konfiguration;
            if (!k) return false;
            return (k.regeln || []).some(function (r) {
                return r && r.wenn && String(r.wenn.spielerId) === String(spielerId);
            });
        }
    };
})();
