'use strict';

const fs = require('fs');
const path = require('path');

// ===================================================================
// TICKER-OUTBOX
// ===================================================================
// Der Pi haengt hinter CGNAT und nimmt keine eingehenden Verbindungen an.
// Ein Tracker auf einem VPS koennte das Gateway also gar nicht aufrufen.
// Deshalb andersherum: der Tracker legt hier ab, das Gateway holt per
// Long-Poll. Diese Datei ist die Tracker-Haelfte des Vertrags, den
// wa-gateway/src/outbox.js auf der anderen Seite erwartet.
//
// Drei Dinge, die daran leicht falsch gehen:
//
//   1. `seq` MUSS Neustarts ueberleben. Das Gateway merkt sich seinen
//      Quittungsstand auf Platte. Faengt der Tracker nach einem Neustart
//      wieder bei 1 an, liegt alles Neue unter dem Quittungsstand und
//      wird vom Gateway stillschweigend verworfen - der Ticker waere
//      danach fuer immer tot, ohne eine einzige Fehlermeldung.
//
//   2. Abgeholt ist NICHT quittiert. Eintraege bleiben liegen, bis das
//      Gateway sie quittiert (also gesendet hat) oder bis sie verfallen.
//      Nach einem Gateway-Neustart faellt dessen `since` auf den
//      Quittungsstand zurueck und es holt alles Offene erneut.
//
//   3. Der Long-Poll muss WIRKLICH blockieren. Antwortet der Tracker
//      sofort mit einer leeren Liste, dreht die Gateway-Schleife durch;
//      sie hat dafuer zwar eine 500-ms-Bremse, aber das ist deren
//      Sicherheitsnetz, nicht unsere Entschuldigung.
// ===================================================================

const VERFALL_MS = 5 * 60 * 1000;   // was so lange lag, ist als "live" wertlos
const MAX_EINTRAEGE = 500;          // Notbremse gegen unbegrenztes Wachsen

class Outbox {
    constructor({ datei, verfallMs = VERFALL_MS }) {
        this.datei = datei;
        this.verfallMs = verfallMs;
        this.eintraege = [];
        this.seq = 0;
        this.wartende = [];   // offene Long-Polls

        this.laden();
    }

    laden() {
        try {
            if (!fs.existsSync(this.datei)) return;
            const roh = JSON.parse(fs.readFileSync(this.datei, 'utf8'));
            this.seq = Number(roh.seq) || 0;
            this.eintraege = Array.isArray(roh.eintraege) ? roh.eintraege : [];
        } catch (e) {
            // Unlesbar ist kein Grund, den Tracker nicht zu starten. Die
            // Folge sind hoechstens ein paar verlorene Ticker-Nachrichten -
            // die Aktionen selbst liegen im State.
            console.error('[Outbox] Stand unlesbar, beginne leer:', e.message);
            this.seq = 0;
            this.eintraege = [];
        }
    }

    speichern() {
        try {
            const tmp = this.datei + '.tmp';
            fs.mkdirSync(path.dirname(this.datei), { recursive: true });
            fs.writeFileSync(tmp, JSON.stringify({ seq: this.seq, eintraege: this.eintraege }));
            fs.renameSync(tmp, this.datei);
        } catch (e) {
            console.error('[Outbox] Konnte nicht speichern:', e.message);
        }
    }

    aufraeumen() {
        const grenze = Date.now() - this.verfallMs;
        const vorher = this.eintraege.length;
        this.eintraege = this.eintraege.filter(e => e.erstelltAm >= grenze);
        if (this.eintraege.length > MAX_EINTRAEGE) {
            this.eintraege = this.eintraege.slice(-MAX_EINTRAEGE);
        }
        return vorher !== this.eintraege.length;
    }

    /**
     * Legt eine Nachrichtengruppe ab. `idempotencyKey` ist die Sperre
     * gegen Doppler - wird derselbe Schluessel noch einmal eingereicht,
     * passiert nichts.
     */
    einreihen({ chatId, idempotencyKey, nachrichten, erstelltAm }) {
        if (!chatId || !Array.isArray(nachrichten) || nachrichten.length === 0) return null;
        if (idempotencyKey && this.eintraege.some(e => e.idempotencyKey === idempotencyKey)) return null;

        this.aufraeumen();
        this.seq += 1;
        const eintrag = {
            seq: this.seq,
            chatId: chatId,
            idempotencyKey: idempotencyKey || ('outbox:' + this.seq),
            erstelltAm: Number(erstelltAm) || Date.now(),
            nachrichten: nachrichten
        };
        this.eintraege.push(eintrag);
        this.speichern();
        this.weckeWartende();
        return eintrag;
    }

    /**
     * Nimmt einen noch nicht abgeholten Eintrag wieder heraus - der
     * Undo-Fall. Ist er schon unterwegs, ist es dafuer zu spaet; dann
     * bleibt es dabei, denn im Chat steht die Nachricht dann ja auch.
     */
    zuruecknehmen(idempotencyKey) {
        const vorher = this.eintraege.length;
        this.eintraege = this.eintraege.filter(e => e.idempotencyKey !== idempotencyKey);
        if (this.eintraege.length !== vorher) {
            this.speichern();
            return true;
        }
        return false;
    }

    seitdem(since) {
        const s = Number(since) || 0;
        return this.eintraege.filter(e => e.seq > s);
    }

    /**
     * Quittung. Alles bis einschliesslich `bisSeq` ist gesendet (oder
     * aufgegeben) und kann weg.
     */
    quittieren(bisSeq) {
        const b = Number(bisSeq) || 0;
        const vorher = this.eintraege.length;
        this.eintraege = this.eintraege.filter(e => e.seq > b);
        if (this.eintraege.length !== vorher) this.speichern();
        return vorher - this.eintraege.length;
    }

    // ---------------------------------------------------------------
    // Long-Poll
    // ---------------------------------------------------------------

    /**
     * Wartet, bis es etwas neueres als `since` gibt, hoechstens aber
     * `wartenMs`. Gibt die Eintraege zurueck (moeglicherweise leer).
     */
    warten(since, wartenMs) {
        const sofort = this.seitdem(since);
        if (sofort.length > 0) return Promise.resolve(sofort);

        return new Promise(aufloesen => {
            const wartender = { since: Number(since) || 0, aufloesen: null, uhr: null };
            wartender.aufloesen = (eintraege) => {
                clearTimeout(wartender.uhr);
                const idx = this.wartende.indexOf(wartender);
                if (idx >= 0) this.wartende.splice(idx, 1);
                aufloesen(eintraege);
            };
            wartender.uhr = setTimeout(() => wartender.aufloesen([]), Math.max(0, wartenMs));
            // Damit ein wartender Long-Poll den Prozess nicht am Beenden
            // hindert (relevant in Tests und beim Neustart per pm2).
            if (wartender.uhr.unref) wartender.uhr.unref();
            this.wartende.push(wartender);
        });
    }

    weckeWartende() {
        // Kopie, weil aufloesen() aus der Liste entfernt.
        this.wartende.slice().forEach(w => {
            const neue = this.seitdem(w.since);
            if (neue.length > 0) w.aufloesen(neue);
        });
    }

    schliessen() {
        this.wartende.slice().forEach(w => w.aufloesen([]));
    }

    stand() {
        this.aufraeumen();
        return { seq: this.seq, offen: this.eintraege.length, wartende: this.wartende.length };
    }
}

module.exports = { Outbox, VERFALL_MS };
