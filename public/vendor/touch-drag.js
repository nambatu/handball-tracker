// ===================================================================
// TOUCH -> DRAG & DROP
// ===================================================================
// Ersetzt DragDropTouch von einer fremden GitHub-Pages-Adresse. Diese
// Datei ist Teil der App: ohne Netz waere das Auswechseln per Ziehen
// sonst tot, und genau in der Halle ist kein Netz.
//
// Warum ueberhaupt noetig: HTML5-Drag&Drop kennen mobile Browser nicht.
// Ein Finger erzeugt touchstart/touchmove/touchend - die dragstart-,
// dragover- und drop-Handler der App feuern nie. Dieser Shim uebersetzt
// das eine ins andere.
//
// Bewusst zurueckhaltend: erst ab 12 Pixel Bewegung UND 120 ms Halten
// wird gezogen. Sonst wuerde jeder Tipp auf einen Spieler als Ziehen
// beginnen und die Aktionsauswahl blockieren.

(function () {
    'use strict';

    // Kennt der Browser Drag&Drop von Haus aus, ist hier nichts zu tun.
    const brauchtShim = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (!brauchtShim) return;

    const SCHWELLE_PX = 12;
    const HALTEN_MS = 120;

    let quelle = null;        // Element, an dem der Finger aufgesetzt hat
    let start = null;         // { x, y, t }
    let zieht = false;
    let schatten = null;      // mitlaufende Kopie unter dem Finger
    let letztesZiel = null;   // Element, ueber dem der Finger zuletzt war

    // Ein eigener DataTransfer-Ersatz: der echte laesst sich nicht bauen.
    const daten = {
        _werte: {},
        effectAllowed: 'move',
        dropEffect: 'move',
        setData: function (typ, wert) { this._werte[String(typ)] = String(wert); },
        getData: function (typ) { return this._werte[String(typ)] || ''; },
        clearData: function () { this._werte = {}; },
        setDragImage: function () { /* wir zeichnen selbst */ },
        types: []
    };

    function elementUnter(x, y) {
        if (schatten) schatten.style.display = 'none';
        const el = document.elementFromPoint(x, y);
        if (schatten) schatten.style.display = '';
        return el;
    }

    function feuere(el, name, x, y) {
        if (!el) return false;
        const ev = new MouseEvent(name, {
            bubbles: true, cancelable: true, clientX: x, clientY: y, view: window
        });
        ev.dataTransfer = daten;
        return !el.dispatchEvent(ev);   // true = jemand hat preventDefault gerufen
    }

    function schattenAnlegen(el, x, y) {
        const r = el.getBoundingClientRect();
        const kopie = el.cloneNode(true);
        kopie.style.cssText =
            'position:fixed;pointer-events:none;z-index:99999;opacity:0.75;' +
            'width:' + r.width + 'px;height:' + r.height + 'px;' +
            'left:0;top:0;margin:0;transform:translate(' +
            (x - r.width / 2) + 'px,' + (y - r.height / 2) + 'px);';
        kopie.setAttribute('aria-hidden', 'true');
        document.body.appendChild(kopie);
        return kopie;
    }

    function schattenBewegen(x, y) {
        if (!schatten) return;
        const r = schatten.getBoundingClientRect();
        schatten.style.transform = 'translate(' + (x - r.width / 2) + 'px,' + (y - r.height / 2) + 'px)';
    }

    function aufraeumen() {
        if (schatten && schatten.parentNode) schatten.parentNode.removeChild(schatten);
        schatten = null;
        quelle = null;
        start = null;
        zieht = false;
        letztesZiel = null;
        daten.clearData();
    }

    document.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) return;
        const el = e.target.closest && e.target.closest('[draggable="true"]');
        if (!el) return;
        quelle = el;
        const t = e.touches[0];
        start = { x: t.clientX, y: t.clientY, t: Date.now() };
        zieht = false;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
        if (!quelle || e.touches.length !== 1) return;
        const t = e.touches[0];
        const weit = Math.abs(t.clientX - start.x) > SCHWELLE_PX
                  || Math.abs(t.clientY - start.y) > SCHWELLE_PX;

        if (!zieht) {
            if (!weit || Date.now() - start.t < HALTEN_MS) return;
            zieht = true;
            daten.clearData();
            feuere(quelle, 'dragstart', t.clientX, t.clientY);
            schatten = schattenAnlegen(quelle, t.clientX, t.clientY);
        }

        // Ab jetzt gehoert die Geste uns - die Seite darf nicht mitscrollen.
        if (e.cancelable) e.preventDefault();
        schattenBewegen(t.clientX, t.clientY);

        const ziel = elementUnter(t.clientX, t.clientY);
        if (ziel !== letztesZiel) {
            if (letztesZiel) feuere(letztesZiel, 'dragleave', t.clientX, t.clientY);
            letztesZiel = ziel;
        }
        if (ziel) feuere(ziel, 'dragover', t.clientX, t.clientY);
    }, { passive: false });

    function beenden(e) {
        if (!quelle) return;
        if (!zieht) { aufraeumen(); return; }

        const t = (e.changedTouches && e.changedTouches[0]) || null;
        const x = t ? t.clientX : 0;
        const y = t ? t.clientY : 0;

        const ziel = elementUnter(x, y);
        if (ziel) {
            feuere(ziel, 'dragleave', x, y);
            feuere(ziel, 'drop', x, y);
        }
        feuere(quelle, 'dragend', x, y);
        // Den nachgereichten Klick des Browsers unterdruecken, sonst waehlt
        // das Loslassen zusaetzlich einen Spieler aus.
        if (e.cancelable) e.preventDefault();
        aufraeumen();
    }

    document.addEventListener('touchend', beenden, { passive: false });
    document.addEventListener('touchcancel', function () { aufraeumen(); }, { passive: true });
})();
