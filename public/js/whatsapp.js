// ===================================================================
// TICKER (Frontend)
// ===================================================================
// Frueher hat diese Datei bei jeder Aktion selbst ein fetch auf
// /api/whatsapp/send gefeuert. Das ist weg - die Nachricht entsteht
// serverseitig aus dem State-Push. Hier bleibt: Einstellungen,
// Regeln je Spieler, Live-Vorschau, Zustandsanzeige.
//
// Was das aufloest:
//   - Das ADMIN_PASSWORD lag im sessionStorage jedes Trackenden.
//   - Ein Reload hat Aktionen erneut getickert.
//   - Ein Undo kam immer zu spaet, die Nachricht war schon raus.
//   - Die Zielgruppe war global (TARGET_GROUP_ID); jetzt je Benutzer.

(function () {
    'use strict';

    let konfiguration = null;
    let ereignisse = [];
    let standardvorlagen = {};
    let gatewayVorhanden = false;
    let kiVorhanden = false;
    let offeneGruppen = null;     // Zwischenspeicher der Gruppenliste

    // ---------------------------------------------------------------
    // Laden und Sichern
    // ---------------------------------------------------------------

    async function laden() {
        try {
            const res = await fetch('/api/ticker/config');
            if (!res.ok) return null;
            const d = await res.json();
            konfiguration = d.konfiguration;
            ereignisse = d.ereignisse || [];
            standardvorlagen = d.standardvorlagen || {};
            gatewayVorhanden = !!d.gatewayVorhanden;
            kiVorhanden = !!d.kiVorhanden;
            return konfiguration;
        } catch (e) {
            console.warn('[Ticker] Einstellungen nicht ladbar:', e.message);
            return null;
        }
    }

    async function sichern(teil) {
        const res = await fetch('/api/ticker/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(teil)
        });
        const d = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(d.error || 'Speichern fehlgeschlagen');
        konfiguration = d.konfiguration;
        return konfiguration;
    }

    async function gruppen(neuLaden) {
        if (offeneGruppen && !neuLaden) return offeneGruppen;
        try {
            const res = await fetch('/api/ticker/chats');
            const d = await res.json().catch(function () { return {}; });
            if (!res.ok) return { error: d.error || ('HTTP ' + res.status), chats: [] };
            offeneGruppen = d;
            return d;
        } catch (e) {
            return { error: 'Gateway nicht erreichbar', chats: [] };
        }
    }

    async function vorschau(anfrage) {
        try {
            const res = await fetch('/api/ticker/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(anfrage || {})
            });
            if (!res.ok) return { text: '', hinweis: 'Vorschau nicht verfügbar' };
            return await res.json();
        } catch (e) {
            return { text: '', hinweis: 'Vorschau nicht verfügbar' };
        }
    }

    // ---------------------------------------------------------------
    // Zustandsanzeige im Kopf
    // ---------------------------------------------------------------
    // Der Ticker laeuft nur live. Ohne Verbindung wird nicht nachgetickert,
    // und das gehoert sichtbar gemacht - sonst glaubt die tickernde Person,
    // die Gruppe bekomme Updates, waehrend nichts ankommt.

    let ausgelassenGesamt = 0;

    function zeichneZustand() {
        const el = document.getElementById('ticker-status');
        if (!el) return;

        if (!konfiguration || !konfiguration.aktiv) {
            el.style.display = 'none';
            return;
        }
        el.style.display = '';

        if (!navigator.onLine) {
            el.className = 'ticker-badge ticker-pause';
            el.title = 'Ohne Verbindung wird nicht getickert. Die Aktionen selbst sind lokal gesichert.';
            el.innerHTML = '<span>📡</span><span class="ticker-text">Ticker pausiert</span>';
            return;
        }

        el.className = 'ticker-badge ticker-aktiv';
        el.title = ausgelassenGesamt > 0
            ? ausgelassenGesamt + ' Aktion(en) wurden nicht getickert (zu spät).'
            : 'Der Ticker läuft.';
        el.innerHTML = '<span>📡</span><span class="ticker-text">Ticker aktiv</span>';
    }

    /**
     * Wird vom Sync nach jedem erfolgreichen Push mit der Serverantwort
     * gerufen. `ausgelassen` sind Aktionen, die aelter als das
     * Frischefenster waren - typischerweise nach einer Empfangsluecke.
     */
    function meldeLauf(ticker) {
        if (!ticker) return;
        if (ticker.ausgelassen > 0) {
            ausgelassenGesamt += ticker.ausgelassen;
            if (window.Toast) {
                window.Toast(ticker.ausgelassen + ' Aktion(en) wurden nicht getickert – zu lange her.',
                    { type: 'warn', duration: 6000 });
            }
        }
        zeichneZustand();
    }

    window.addEventListener('online', zeichneZustand);
    window.addEventListener('offline', zeichneZustand);

    window.Ticker = {
        laden: laden,
        sichern: sichern,
        gruppen: gruppen,
        vorschau: vorschau,
        meldeLauf: meldeLauf,
        zeichneZustand: zeichneZustand,
        get konfiguration() { return konfiguration; },
        get ereignisse() { return ereignisse; },
        get standardvorlagen() { return standardvorlagen; },
        get gatewayVorhanden() { return gatewayVorhanden; },
        get kiVorhanden() { return kiVorhanden; }
    };

    // Alter Name, damit nichts ins Leere laeuft, was ihn noch kennt.
    window.WhatsAppMod = {
        checkStatus: async function () {
            const k = await laden();
            zeichneZustand();
            return !!(k && k.aktiv);
        }
    };
})();
