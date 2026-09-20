'use strict';

// ===================================================================
// KI-ANALYSE ZUM SPIELENDE
// ===================================================================
// Dasselbe Vorgehen wie im handball.net-Bot: Gemini, ein starkes Modell
// mit einem schnellen als Rueckfall, und ohne Schluessel passiert
// einfach nichts.
//
// Anders als dort OHNE die Bibliothek @google/genai. Die REST-Schnitt-
// stelle tut dasselbe, Node 20 bringt fetch mit, und der Pi spart sich
// eine Abhaengigkeit samt Speicher - bei 904 MB und einem Chromium
// daneben ist das kein akademisches Argument.
//
// Die Analyse ist eine EIGENE Nachricht, nicht Teil der Zusammenfassung.
// Grund: die Zahlen sollen sofort in der Gruppe stehen. Auf eine KI zu
// warten, die gerade ueberlastet ist, waere genau der Fall, in dem am
// Ende gar nichts kommt.
// ===================================================================

const BASIS = process.env.GEMINI_BASE_URL
    || 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';
const MODELL_RUECKFALL = process.env.GEMINI_MODEL_FALLBACK || 'gemini-3-flash-preview';
const GEDULD_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 25000;

function schluessel() {
    return process.env.GEMINI_API_KEY || '';
}

function verfuegbar() {
    return !!schluessel();
}

async function frage(modell, prompt) {
    const abbruch = new AbortController();
    const uhr = setTimeout(function () { abbruch.abort(); }, GEDULD_MS);
    try {
        const res = await fetch(
            BASIS + '/' + encodeURIComponent(modell) + ':generateContent?key=' + encodeURIComponent(schluessel()),
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
                signal: abbruch.signal
            }
        );
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const d = await res.json();
        const teile = d && d.candidates && d.candidates[0]
            && d.candidates[0].content && d.candidates[0].content.parts;
        const text = Array.isArray(teile)
            ? teile.map(function (t) { return t && t.text ? t.text : ''; }).join('').trim()
            : '';
        if (!text) throw new Error('leere Antwort');
        return text;
    } finally {
        clearTimeout(uhr);
    }
}

function bauePrompt(daten, hinweis) {
    const zeilen = [
        'Du bist ein witziger, leicht sarkastischer und fachkundiger deutscher Handball-Kommentator.',
        'Schreibe eine kurze, unterhaltsame Zusammenfassung (2-4 Saetze) fuer ein gerade beendetes Spiel.',
        '',
        'Du schreibst fuer die Mannschaftsgruppe von "' + daten.heim + '". Halte zu diesem Team,',
        'du darfst den Gegner auch gerne freundlich aufziehen.',
        '',
        'Spieldaten:',
        '- Heim: ' + daten.heim,
        '- Gast: ' + daten.gast,
        '- Endstand: ' + daten.endstand,
        '- Halbzeitstand: ' + daten.halbzeitstand,
        '- Spielverlauf: ' + daten.verlauf,
        '- Torschuetzen: ' + daten.torschuetzen,
        '- Wurfquote: ' + daten.wurfquote,
        '- Paraden: ' + daten.paraden,
        '- Zeitstrafen: ' + daten.zeitstrafen,
        '- Herausgeholte Siebenmeter: ' + daten.siebenmeter,
        '',
        'Anweisungen:',
        '1. Beginne mit einer kreativen, reisserischen Ueberschrift in *Sternchen* (WhatsApp-Fettdruck).',
        '2. Nutze die Statistiken fuer spitze Kommentare - aber nur, wenn sie fuer dieses Spiel',
        '   wirklich etwas hergeben. Nicht jede Zahl muss vorkommen.',
        '3. Bleibe bei den Fakten. Erfinde nichts hinzu, was sich aus den Daten nicht ergibt',
        '   (keine "zu offensive Abwehr", wenn davon nirgends etwas steht).',
        '4. Keine Standardfloskeln. Gib dem Text Persoenlichkeit.',
        '5. Nur Ueberschrift und Text, keine Einleitung wie "Zusammenfassung:".'
    ];
    // Freitext aus den Ticker-Einstellungen. Damit bleiben persoenliche
    // Eigenheiten (Insider, Lieblingsspieler) da, wo sie hingehoeren -
    // beim Verein und nicht fest im Code.
    if (hinweis && String(hinweis).trim()) {
        zeilen.push('', 'Zusaetzlicher Hinweis der Mannschaft: ' + String(hinweis).trim().slice(0, 600));
    }
    return zeilen.join('\n');
}

/**
 * @returns {Promise<string|null>} fertige Nachricht oder null
 */
async function analyse(daten, optionen) {
    if (!verfuegbar()) return null;
    const prompt = bauePrompt(daten, (optionen || {}).hinweis);

    let text = null;
    try {
        text = await frage(MODELL, prompt);
    } catch (e) {
        console.warn('[KI] ' + MODELL + ' fehlgeschlagen (' + e.message + '), versuche ' + MODELL_RUECKFALL);
        try {
            text = await frage(MODELL_RUECKFALL, prompt);
        } catch (e2) {
            // Bewusst KEINE Fehlermeldung in die Gruppe. Die Zahlen sind
            // dort schon angekommen; eine zweite Nachricht, die nur sagt
            // "die KI war ueberlastet", interessiert niemanden.
            console.error('[KI] auch der Rueckfall fehlgeschlagen:', e2.message);
            return null;
        }
    }

    return '🤖 *KI-Analyse zum Spiel:*\n\n' + text;
}

module.exports = { analyse, verfuegbar, bauePrompt };
