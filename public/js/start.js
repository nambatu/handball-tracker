// ===================================================================
// STARTSEITE
// ===================================================================
// Bis jetzt landete man nach der Anmeldung mitten im Spiel: Spielfeld,
// ein Dutzend Knoepfe, und niemand sagte, womit man anfangen soll. Die
// Startseite stellt die wenigen Fragen, die vor einem Spiel zu klaeren
// sind (Name, Mannschaft, Gegner, Halbzeitlaenge, Ticker) und beginnt von
// hier aus das Spiel.
//
// Ansichten sind einfaches Ein- und Ausblenden grosser Bereiche - wie
// bisher. Nur steht das Umschalten jetzt an EINER Stelle: ansicht() setzt
// eine Klasse am <body> (ansicht-login / ansicht-start / ansicht-spiel),
// und das CSS blendet danach ein, was dazugehoert. Die Verwaltungs-,
// Archiv- und Ticker-Ansichten sind Overlays ueber dem jeweiligen
// Bereich; schliesst man sie, liegt darunter wieder die Startseite -
// der Rueckweg "zur Startseite" ergibt sich also von selbst.
//
// Was die Startseite NICHT tut: sie loescht nie etwas. Ein laufendes Spiel
// laesst sich nur ueber den bestehenden Weg beenden (Timer.endGame), und der
// archiviert zuerst.

(function () {
    'use strict';

    const ANSICHTEN = ['login', 'start', 'spiel'];
    const HALBZEIT_AUSWAHL = [20, 25, 30];
    // Geduld fuer Ticker und Mannschaftsliste. Beides darf die Seite nie
    // aufhalten: sie steht sofort, die Angaben kommen nach.
    const NACHLADEN_GEDULD_MS = 6000;

    // Diese Ansichten liegen als Overlay ueber der Startseite oder dem Spiel.
    const OVERLAYS = ['player-management-view', 'stats-view', 'archive-view',
                      'ticker-view', 'report-view', 'history-view'];

    let aktuell = 'login';
    let initialisiert = false;
    let teams = [];
    let teamsStatus = 'lade';          // 'lade' | 'ok' | 'fehler'
    let ticker = { art: 'lade', konfiguration: null, hinweis: null };
    let neuHinweisOffen = false;       // "Neues Spiel beginnen" bei laufendem Spiel aufgeklappt
    let letzterAutoName = '';          // zuletzt automatisch eingesetzter Mannschaftsname
    let uhr = null;

    function el(id) { return document.getElementById(id); }

    // ---------------------------------------------------------------
    // Umschalten zwischen Anmeldung, Startseite und Spiel
    // ---------------------------------------------------------------

    function ansicht(name) {
        aktuell = name;
        ANSICHTEN.forEach(function (n) {
            document.body.classList.toggle('ansicht-' + n, n === name);
        });
        badgeUmhaengen(name === 'start');
        // Wer die Spielansicht verlaesst, laesst nichts offen: kein Aktions-Sheet,
        // kein Menue, keinen gewaehlten Spieler.
        if (name !== 'spiel' && window.UI && window.UI.verlasseSpiel) window.UI.verlasseSpiel();
        if (name === 'start') starteUhr(); else stoppeUhr();
    }

    // Es gibt nur EINEN Sync-Zustand im Dokument (#sync-status, den zeichnet
    // sync.js). Statt ihn zu verdoppeln, zieht er zwischen Uhrzeile und
    // Startseite um - dann stimmt er an beiden Orten zwangslaeufig.
    function badgeUmhaengen(zurStartseite) {
        const badge = el('sync-status');
        if (!badge) return;
        const ziel = zurStartseite ? el('start-sync-platz') : el('uhr-sync');
        if (!ziel || badge.parentNode === ziel) return;
        ziel.appendChild(badge);
    }

    function zeige() {
        neuHinweisOffen = false;
        ansicht('start');
        fuelleFormular();
        zeichne();
        scrolleNachOben();
    }

    function zumSpiel() {
        ansicht('spiel');
        // Neu zeichnen, weil sich Kader oder Teamnamen geaendert haben koennen,
        // waehrend das Spiel verdeckt war.
        if (window.UI) {
            window.UI.updateUI();
            window.UI.updateActionCount();
            window.UI.renderHistory();
        }
        scrolleNachOben();
    }

    function scrolleNachOben() {
        const sicht = el('start-view');
        if (sicht) sicht.scrollTop = 0;
        window.scrollTo(0, 0);
    }

    function zeigeName(name) {
        const n = el('start-user');
        if (n) n.textContent = name || '';
    }

    // ---------------------------------------------------------------
    // Laeuft schon ein Spiel?
    // ---------------------------------------------------------------
    // Regel: ja, wenn mindestens eine Aktion erfasst ist ODER die Uhr
    // angefasst wurde (laeuft, steht auf mehr als 0:00 oder ist nicht mehr in
    // der Phase "vor dem Spiel" - dazu zaehlt auch "abgepfiffen, noch nicht
    // archiviert"). Die Uhr zaehlt mit, weil man vor dem ersten Tor oft schon
    // angepfiffen hat - ein "neues Spiel" duerfte das nicht ueberschreiben.
    // Die Uhr liegt lokal auf dem Geraet (timer.js), die Aktionen im
    // synchronisierten Stand: auf einem zweiten Geraet entscheiden also die
    // Aktionen.
    function laeuftSpiel() {
        const aktionen = window.Store.loadActions();
        if (aktionen && aktionen.length > 0) return true;
        const t = window.Timer.getTimerState();
        return !!(t.isTimerRunning || t.spielzeitSekunden > 0 || t.phase !== 'vor');
    }

    function eigeneSpieler(liste) {
        return (liste || []).filter(function (p) {
            return p && !window.Store.istGast(p) && !window.Store.istGastName(p.name);
        });
    }

    function toreStand() {
        const spieler = window.Store.getSPIELER();
        let heim = 0, gast = 0;
        window.Store.loadActions().forEach(function (a) {
            if (!a.typ || a.typ.indexOf('WurfTor') === -1) return;
            const p = spieler.find(function (x) { return x.id === a.spielerId; });
            if (!p) return;
            if (window.Store.istGast(p)) gast++; else heim++;
        });
        return { heim: heim, gast: gast };
    }

    // ---------------------------------------------------------------
    // Zeichnen
    // ---------------------------------------------------------------

    // Aktualisiert, was sich aendern kann, waehrend man woanders war
    // (Kader, laufendes Spiel, Ticker). Eingaben im Formular bleiben stehen.
    function zeichne() {
        const laedt = el('start-laedt');
        const inhalt = el('start-inhalt');
        if (laedt) laedt.hidden = true;
        if (inhalt) inhalt.hidden = false;

        const laufend = laeuftSpiel();
        el('start-laufend').hidden = !laufend;
        el('start-formular').hidden = laufend;
        el('start-neu-knopf').hidden = !laufend || neuHinweisOffen;
        el('start-neu-hinweis').hidden = !laufend || !neuHinweisOffen;
        if (laufend) zeichneLaufend();

        zeichneKaderAuswahl();
        zeichneTicker();
        zeigeFehler('');
    }

    function zeichneLaufend() {
        const n = window.Store.getTeamNames();
        const name = window.Store.getSpielName() || (n.heim + ' – ' + n.gast);
        const stand = toreStand();
        const t = window.Timer.getTimerState();
        const anzahl = window.Store.loadActions().length;

        el('laufend-name').textContent = name;
        el('laufend-stand').textContent = stand.heim + ' : ' + stand.gast;
        let phase;
        if (t.phase === 'pause') phase = 'Halbzeitpause';
        else if (t.phase === 'ende') phase = 'Spiel beendet';
        else if (t.phase === 'vor') phase = 'Vor dem Spiel';
        else phase = t.currentHalf + '. Halbzeit · ' + window.Timer.formatTime(t.spielzeitSekunden);
        el('laufend-meta').textContent = anzahl + (anzahl === 1 ? ' Aktion' : ' Aktionen') + ' · ' + phase;

        // Nach dem Abpfiff ist der naechste Schritt das Archivieren
        const abgepfiffen = t.phase === 'ende';
        el('start-weiter').textContent = abgepfiffen ? 'Spiel archivieren' : 'Weiter tracken';
    }

    // "Weiter tracken" bzw. nach dem Abpfiff "Spiel archivieren"
    async function weiter() {
        if (window.Timer.getTimerState().phase !== 'ende') { zumSpiel(); return; }
        await laufendesBeenden();
    }

    // Die Zeit des laufenden Spiels laeuft auch auf der Startseite weiter
    function starteUhr() {
        if (uhr) return;
        uhr = setInterval(function () {
            const karte = el('start-laufend');
            if (karte && !karte.hidden) zeichneLaufend();
        }, 1000);
    }

    function stoppeUhr() {
        clearInterval(uhr);
        uhr = null;
    }

    // Setzt die Eingabefelder auf die Werte des Spielstands zurueck. Nur beim
    // Betreten der Startseite - nicht nach dem Schliessen von Kader oder Archiv,
    // sonst waere ein halb ausgefuelltes Formular dort weg.
    function fuelleFormular() {
        el('start-spielname').value = window.Store.getSpielName() || '';

        const n = window.Store.getTeamNames();
        el('start-team-heim').value = n.heim === 'HEIM' ? '' : n.heim;
        el('start-team-gast').value = n.gast === 'GAST' ? '' : n.gast;
        letzterAutoName = '';

        const gewaehlt = el('start-kader');
        if (gewaehlt) gewaehlt.value = '';

        baueHalbzeitAuswahl();
    }

    function baueHalbzeitAuswahl() {
        const aktuelleMinuten = window.Timer.getHalbzeitMinuten();
        const werte = HALBZEIT_AUSWAHL.slice();
        // Wer 2 x 15 (Turnier) eingestellt hat, soll das nicht unbemerkt
        // verlieren - der Wert bekommt dann einen eigenen Abschnitt.
        if (werte.indexOf(aktuelleMinuten) === -1) werte.push(aktuelleMinuten);
        werte.sort(function (a, b) { return a - b; });

        const box = el('start-halbzeit');
        box.innerHTML = '';
        werte.forEach(function (m) {
            const label = document.createElement('label');
            label.className = 'segment-teil';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'start-hz';
            radio.value = String(m);
            radio.checked = (m === aktuelleMinuten);
            const text = document.createElement('span');
            text.textContent = m + ' Min.';
            label.appendChild(radio);
            label.appendChild(text);
            box.appendChild(label);
        });
    }

    function gewaehlteMinuten() {
        const r = document.querySelector('input[name="start-hz"]:checked');
        return r ? Number(r.value) : window.Timer.getHalbzeitMinuten();
    }

    // ---------------------------------------------------------------
    // Mannschaft
    // ---------------------------------------------------------------

    function gewaehlteMannschaft() {
        const id = el('start-kader').value;
        if (!id) return null;
        return teams.find(function (t) { return String(t.id) === String(id); }) || null;
    }

    function zeichneKaderAuswahl() {
        const select = el('start-kader');
        const bisher = select.value;
        const anzahl = eigeneSpieler(window.Store.getSPIELER()).length;

        select.innerHTML = '';
        const behalten = document.createElement('option');
        behalten.value = '';
        behalten.textContent = 'Aktuellen Kader behalten (' + anzahl + (anzahl === 1 ? ' Spieler)' : ' Spieler)');
        select.appendChild(behalten);

        teams.forEach(function (t) {
            const o = document.createElement('option');
            o.value = t.id;
            const n = eigeneSpieler(t.players).length;
            o.textContent = t.name + ' (' + n + (n === 1 ? ' Spieler)' : ' Spieler)');
            select.appendChild(o);
        });
        // Auswahl beibehalten, falls es die Mannschaft noch gibt
        select.value = teams.some(function (t) { return String(t.id) === String(bisher); }) ? bisher : '';

        const hinweis = el('start-kader-hinweis');
        if (select.value) {
            hinweis.textContent = 'Diese Mannschaft ersetzt beim Start den bisherigen Kader.';
        } else if (teamsStatus === 'lade') {
            hinweis.textContent = 'Gespeicherte Mannschaften werden geladen …';
        } else if (teamsStatus === 'fehler') {
            hinweis.textContent = 'Gespeicherte Mannschaften sind gerade nicht erreichbar.';
        } else if (teams.length === 0) {
            hinweis.textContent = 'Noch keine Mannschaft gespeichert. Unter „Kader verwalten“ lässt sich der aktuelle Kader speichern.';
        } else {
            hinweis.textContent = '';
        }
    }

    function mannschaftGewaehlt() {
        const t = gewaehlteMannschaft();
        const feld = el('start-team-heim');
        // Den Namen nur ueberschreiben, wenn er leer oder noch der zuletzt
        // eingesetzte ist - was jemand selbst getippt hat, bleibt.
        if (t && t.name && (feld.value.trim() === '' || feld.value === letzterAutoName)) {
            feld.value = t.name;
            letzterAutoName = t.name;
        }
        zeichneKaderAuswahl();
    }

    function teamsLaden() {
        teamsStatus = 'lade';
        const frist = setTimeout(function () {
            if (teamsStatus === 'lade') { teamsStatus = 'fehler'; if (aktuell === 'start') zeichneKaderAuswahl(); }
        }, NACHLADEN_GEDULD_MS);

        window.Store.getTeams({ leise: true }).then(function (liste) {
            clearTimeout(frist);
            teams = Array.isArray(liste) ? liste : [];
            // getTeams meldet einen Fehler als leere Liste. Ohne Netz ist
            // "keine Mannschaft gespeichert" eine falsche Auskunft.
            teamsStatus = (teams.length === 0 && !navigator.onLine) ? 'fehler' : 'ok';
            if (aktuell === 'start') zeichneKaderAuswahl();
        }).catch(function () {
            clearTimeout(frist);
            teamsStatus = 'fehler';
            if (aktuell === 'start') zeichneKaderAuswahl();
        });
    }

    // ---------------------------------------------------------------
    // WhatsApp-Ticker
    // ---------------------------------------------------------------

    function tickerLaden() {
        ticker = { art: 'lade', konfiguration: null, hinweis: null };
        const frist = setTimeout(function () {
            if (ticker.art === 'lade') { ticker = { art: 'fehler', konfiguration: null, hinweis: null }; zeichneTicker(); }
        }, NACHLADEN_GEDULD_MS);

        // Nie warten: die Seite steht schon, der Schalter wacht spaeter auf.
        Promise.resolve().then(function () { return window.Ticker.laden(); }).then(function (k) {
            clearTimeout(frist);
            ticker = k
                ? { art: 'ok', konfiguration: k, hinweis: null }
                : { art: 'fehler', konfiguration: null, hinweis: window.Ticker.ladeHinweis };
            zeichneTicker();
        }).catch(function () {
            clearTimeout(frist);
            ticker = { art: 'fehler', konfiguration: null, hinweis: null };
            zeichneTicker();
        });
    }

    function zeichneTicker() {
        const cb = el('start-ticker');
        const info = el('start-ticker-info');
        if (!cb || !info) return;
        info.textContent = '';

        if (ticker.art === 'lade') {
            cb.disabled = true;
            cb.checked = false;
            info.textContent = 'Wird geladen …';
            return;
        }
        if (ticker.art === 'fehler') {
            cb.disabled = true;
            cb.checked = false;
            info.textContent = ticker.hinweis || 'Ticker nicht verfügbar';
            return;
        }

        const k = ticker.konfiguration;
        cb.disabled = false;
        cb.checked = !!k.aktiv;
        info.appendChild(document.createTextNode(
            (k.chatId ? 'Gruppe: ' + k.chatId : 'Noch keine Gruppe eingestellt') + ' · '));
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'btn-link';
        link.textContent = 'Ticker einstellen';
        link.onclick = function () { window.TickerUI.oeffne(); };
        info.appendChild(link);
    }

    function tickerUmschalten() {
        const cb = el('start-ticker');
        const wunsch = cb.checked;
        cb.disabled = true;
        window.Ticker.sichern({ aktiv: wunsch }).then(function (k) {
            ticker = { art: 'ok', konfiguration: k, hinweis: null };
            window.Ticker.zeichneZustand();
        }).catch(function (e) {
            if (window.Toast) window.Toast('Ticker nicht geändert: ' + e.message, { type: 'warn' });
        }).then(function () {
            zeichneTicker();   // zeigt in jedem Fall den echten Stand
        });
    }

    // ---------------------------------------------------------------
    // Spiel starten
    // ---------------------------------------------------------------

    function zeigeFehler(text, mitKaderLink) {
        const f = el('start-fehler');
        if (!f) return;
        f.textContent = text || '';
        f.hidden = !text;
        if (text && mitKaderLink) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn-link';
            b.textContent = 'Kader verwalten';
            b.onclick = kaderVerwalten;
            f.appendChild(document.createTextNode(' '));
            f.appendChild(b);
        }
    }

    function starten() {
        // Mit laufendem Spiel ist das Formular gar nicht sichtbar - die
        // Pruefung faengt nur einen Doppeltipp oder einen Stand von einem
        // zweiten Geraet ab.
        if (laeuftSpiel()) { zeichne(); return; }

        const mannschaft = gewaehlteMannschaft();
        const anzahl = mannschaft
            ? eigeneSpieler(mannschaft.players).length
            : eigeneSpieler(window.Store.getSPIELER()).length;
        if (anzahl < 1) {
            zeigeFehler('Die eigene Mannschaft hat noch keinen Spieler.', true);
            return;
        }

        // Erst den Kader, dann die Spieldaten: beginneSpiel setzt zum Schluss
        // mit EINEM touch() alles auf einmal in den Sync.
        if (mannschaft) {
            const r = window.Store.ladeMannschaft(mannschaft.players);
            if (!r.ok) { zeigeFehler('Die Mannschaft lässt sich nicht laden: Im Spiel sind schon Aktionen erfasst.'); return; }
        }
        // Neues Spiel: die Wahl "ohne Uhr eintragen" vom letzten gilt nicht mehr
        if (window.UI) window.UI.vergissUhrWahl();
        window.Store.beginneSpiel({
            spielName: el('start-spielname').value,
            teamHeim: el('start-team-heim').value,
            teamGast: el('start-team-gast').value,
            halbzeitMinuten: gewaehlteMinuten()
        });
        zumSpiel();
    }

    function neuesSpielZeigen() {
        neuHinweisOffen = true;
        zeichne();
        el('start-neu-hinweis').scrollIntoView({ block: 'nearest' });
    }

    async function laufendesBeenden() {
        const knopf = el('start-beenden');
        knopf.disabled = true;
        let geschafft = false;
        try {
            geschafft = await window.Timer.endGame();
        } catch (e) {
            geschafft = false;
        }
        knopf.disabled = false;
        // Bei Abbruch oder Fehler bleibt alles, wie es war - endGame hat dann
        // schon gemeldet, warum.
        if (geschafft) {
            neuHinweisOffen = false;
            fuelleFormular();
            zeichne();
            el('start-formular').scrollIntoView({ block: 'start' });
        }
    }

    // ---------------------------------------------------------------
    // Weitere Ansichten (die bestehenden)
    // ---------------------------------------------------------------

    function kaderVerwalten() {
        window.UI.togglePlayerManagement();
    }

    function archivOeffnen() {
        window.openArchiveModal();
    }

    // Wird ein Overlay geschlossen, hat sich darunter womoeglich etwas
    // geaendert (Kader gespeichert, Ticker umgestellt, Spiel geloescht).
    // Statt jede Schliessen-Funktion einzeln zu erweitern, schaut ein
    // Beobachter auf die Overlays.
    function beobachteOverlays() {
        if (!window.MutationObserver) return;
        const beobachter = new MutationObserver(function (eintraege) {
            if (aktuell !== 'start') return;
            let tickerZu = false;
            let irgendeinZu = false;
            eintraege.forEach(function (m) {
                if (m.target.style.display !== 'none') return;
                irgendeinZu = true;
                if (m.target.id === 'ticker-view') tickerZu = true;
            });
            if (tickerZu) tickerLaden();
            if (irgendeinZu) zeichne();
        });
        OVERLAYS.forEach(function (id) {
            const e = el(id);
            if (e) beobachter.observe(e, { attributes: true, attributeFilter: ['style'] });
        });
    }

    // ---------------------------------------------------------------
    // Start (nach der Anmeldung, wenn der Spielstand da ist)
    // ---------------------------------------------------------------

    function init(username) {
        zeigeName(username);
        if (!initialisiert) {
            initialisiert = true;
            window.Sync.onChange(function () { if (aktuell === 'start') zeichne(); });
            beobachteOverlays();
            el('start-kader').addEventListener('change', mannschaftGewaehlt);
            el('start-ticker').addEventListener('change', tickerUmschalten);
        }
        teamsLaden();
        tickerLaden();

        // Ein laufendes Spiel (z.B. nach einem Neuladen mitten in der
        // Halbzeit) geht vor: ein Tipp zu viel kostet in der Halle Zeit.
        // Die Startseite ist ueber "Startseite" im Spielkopf erreichbar.
        if (laeuftSpiel()) zumSpiel(); else zeige();
    }

    window.Start = {
        init: init,
        ansicht: ansicht,
        zeige: zeige,
        zumSpiel: zumSpiel,
        zeigeName: zeigeName,
        starten: starten,
        neuesSpielZeigen: neuesSpielZeigen,
        laufendesBeenden: laufendesBeenden,
        weiter: weiter,
        kaderVerwalten: kaderVerwalten,
        archivOeffnen: archivOeffnen,
        laeuftSpiel: laeuftSpiel
    };
})();
