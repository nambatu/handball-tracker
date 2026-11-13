// ===================================================================
// MAIN INITIALIZATION & AUTHENTICATION
// ===================================================================

let isLoginMode = true;

// Der fetch-Wrapper (Anmeldung, 401-Abmeldung, Server oder Supabase) steckt in js/api.js.

window.onload = async () => {
    registriereServiceWorker();
    checkAuthStatus();
};

/**
 * Service Worker anmelden - damit sich die App in der Halle ohne Netz
 * ueberhaupt oeffnen laesst.
 *
 * Braucht einen sicheren Kontext: ueber https (ngrok, spaeter der VPS)
 * oder localhost. Ueber blankes http im WLAN passiert hier bewusst
 * nichts, statt mit einer Fehlermeldung aufzufallen.
 */
function registriereServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!window.isSecureContext) {
        console.log('[App] Kein sicherer Kontext - Offline-Start nicht moeglich (http).');
        return;
    }
    // Alte Adresse (Pi hinter ngrok): kein Offline-Speicher mehr, siehe
    // sw.js. Nicht neu anmelden, vorhandene Worker abmelden. Kommt dieser
    // Code wegen eines kaputten Caches gar nicht zum Zug, erledigt das der
    // neue sw.js beim naechsten Update-Check des Browsers.
    if (/\.ngrok(-free)?\.(dev|app|io)$/.test(location.hostname)) {
        navigator.serviceWorker.getRegistrations().then(function (liste) {
            liste.forEach(function (r) { r.unregister(); });
        }).catch(function () { /* egal */ });
        return;
    }
    navigator.serviceWorker.register('sw.js').then(function (reg) {
        // Ein wartendes Update sofort uebernehmen lassen. Ohne das laeuft
        // nach einem Deploy noch tagelang die alte Fassung weiter.
        if (reg.waiting) reg.waiting.postMessage('skipWaiting');
        reg.addEventListener('updatefound', function () {
            const neu = reg.installing;
            if (!neu) return;
            neu.addEventListener('statechange', function () {
                if (neu.state === 'installed' && navigator.serviceWorker.controller) {
                    neu.postMessage('skipWaiting');
                    if (window.Toast) {
                        window.Toast('Neue Version geladen. Beim nächsten Öffnen ist sie aktiv.',
                            { type: 'success', duration: 6000 });
                    }
                }
            });
        });
    }).catch(function (e) {
        console.warn('[App] Service Worker nicht registrierbar:', e.message);
    });
}

// Ein totes Netz meldet sich nicht ab, es antwortet nur nie. Ohne
// Zeitgrenze bleibt die App genau hier stehen - der Startbildschirm ist
// dann alles, was man sieht. Nach vier Sekunden gilt der Server als nicht
// erreichbar; der lokale Stand reicht zum Weiterspielen.
const ANMELDE_GEDULD_MS = 4000;

function frageServerNachAnmeldung() {
    const abbruch = new AbortController();
    const uhr = setTimeout(function () { abbruch.abort(); }, ANMELDE_GEDULD_MS);
    return fetch('/api/me', { signal: abbruch.signal }).finally(function () { clearTimeout(uhr); });
}

async function checkAuthStatus() {
    if (!window.Api.hatAnmeldung()) {
        showAuthOverlay();
        return;
    }

    // Anmeldung UND bekannter Name vorhanden: nicht erst den Server fragen.
    // In der Halle heisst jede Rueckfrage Wartezeit vor einem leeren
    // Bildschirm, und der lokale Stand traegt das Spiel ohnehin allein.
    // Die Pruefung laeuft trotzdem - eine abgelaufene Anmeldung fliegt dann
    // ueber den 401-Weg raus, genau wie bei jeder anderen Anfrage auch.
    const bekannterName = localStorage.getItem('auth_username');
    if (bekannterName) {
        enterApp(bekannterName);
        frageServerNachAnmeldung().then(function (res) {
            if (res.ok) return res.json().then(function (d) {
                if (d && d.username) localStorage.setItem('auth_username', d.username);
            });
            if (res.status === 401 || res.status === 403) showAuthOverlay();
        }).catch(function () {
            console.warn('[App] Offline gestartet - arbeite mit lokalem Stand.');
            if (window.Toast) {
                window.Toast('Offline gestartet. Aktionen werden lokal gesichert und später übertragen.',
                    { type: 'warn', duration: 7000 });
            }
        });
        return;
    }

    try {
        const res = await frageServerNachAnmeldung();
        if (res.ok) {
            const data = await res.json();
            localStorage.setItem('auth_username', data.username);
            enterApp(data.username);
        } else {
            // Echte Ablehnung (401/403): Token ist ungueltig
            showAuthOverlay();
        }
    } catch(e) {
        // Ohne Netz UND ohne gespeicherte Anmeldung kommt man nicht weiter -
        // das aber bitte sagen, statt nur ein Anmeldeformular hinzustellen,
        // in dem jeder Versuch stumm scheitert.
        showAuthOverlay();   // zeigt selbst den Offline-Hinweis
    }
}

function enterApp(username) {
    document.getElementById('auth-overlay').style.display = 'none';
    // Welche Ansicht gerade sichtbar ist (Anmeldung, Startseite, Spiel),
    // entscheidet allein window.Start. Bis der Spielstand da ist, steht
    // die Startseite mit "Wird geladen" - nicht das halbleere Spiel.
    window.Start.ansicht('start');
    window.Start.zeigeName(username);
    initializeApp(username);
}

async function initializeApp(username) {
    // 1. Lokalen Stand laden und mit dem Server abgleichen
    await window.Store.loadInitialState(username);

    // 2. Spieluhr wiederherstellen
    window.Timer.loadGameState();

    // 3. UI aufbauen
    if (window.UI) {
        window.UI.updateActionCount();
        window.UI.renderHistory();
        window.UI.updateUI();
    }

    // 4. Bei uebernommenem Fremdstand (anderes Geraet) neu zeichnen
    window.Sync.onChange(() => {
        if (window.UI) {
            window.UI.updateActionCount();
            window.UI.renderHistory();
            window.UI.updateUI();
        }
    });

    window.Sync.renderBadge();

    // 5. Startseite oder - bei laufendem Spiel - gleich das Spiel
    window.Start.init(username);

    // 6. WhatsApp-UI (nur relevant, wenn die Integration aktiv ist)
    checkWhatsAppStatusOnLoad();
}

function showAuthOverlay() {
    window.Start.ansicht('login');
    document.getElementById('auth-overlay').style.display = 'flex';

    // Ohne Netz ist jeder Anmeldeversuch zwecklos - das gehoert hingeschrieben,
    // statt den Nutzer stumm gegen ein Formular laufen zu lassen.
    if (!navigator.onLine) {
        zeigeAuthMeldung('Keine Verbindung zum Server. Zum Anmelden brauchst du einmal Internet — '
            + 'danach startet die App auch offline.', 'warn');
    }
}

// Die Farbe der Meldung kommt aus der Klasse (auth-meldung ist-fehler /
// ist-ok / ist-warn), nicht aus einem Inline-Stil.
function zeigeAuthMeldung(text, art) {
    const el = document.getElementById('auth-error-msg');
    if (!el) return;
    el.className = 'auth-meldung' + (text && art ? ' ist-' + art : '');
    el.innerText = text || '';
}

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? 'Anmelden' : 'Konto anlegen';
    document.getElementById('auth-submit-btn').innerText = isLoginMode ? 'Anmelden' : 'Konto anlegen';
    document.getElementById('auth-toggle-btn').innerText = isLoginMode ? 'Noch kein Konto? Konto anlegen' : 'Schon ein Konto? Anmelden';
    document.getElementById('auth-password').setAttribute('autocomplete', isLoginMode ? 'current-password' : 'new-password');
    zeigeAuthMeldung('');

    // Einladungscode gibt es nur noch beim alten Server (Pi). Auf Supabase
    // ist die Registrierung offen.
    const codeEl = document.getElementById('auth-code');
    const zeigeCode = !isLoginMode && window.Api.modus === 'server';
    if (codeEl) codeEl.style.display = zeigeCode ? 'block' : 'none';
    const codeGruppe = document.getElementById('auth-code-gruppe');
    if (codeGruppe) codeGruppe.classList.toggle('ist-sichtbar', zeigeCode);

    const hintEl = document.getElementById('auth-hint');
    if (hintEl) hintEl.innerText = isLoginMode ? '' : 'Das Passwort braucht mindestens 8 Zeichen.';
}

window.loginUser = async function() {
    const user = document.getElementById('auth-username').value;
    const pass = document.getElementById('auth-password').value;
    zeigeAuthMeldung('');

    if (!user || !pass) return zeigeAuthMeldung('Bitte Benutzername und Passwort eingeben.', 'fehler');

    try {
        if (isLoginMode) {
            const r = await window.Api.login(user, pass);
            if (r.ok) {
                enterApp(r.username);
            } else {
                zeigeAuthMeldung(r.error || 'Anmeldung fehlgeschlagen.', 'fehler');
            }
        } else {
            const codeEl = document.getElementById('auth-code');
            const r = await window.Api.register(user, pass, codeEl && codeEl.value ? codeEl.value : undefined);
            if (r.ok) {
                // Sofort auf "Anmelden" umschalten; die Meldung bleibt stehen.
                toggleAuthMode();
                zeigeAuthMeldung('Konto angelegt. Bitte jetzt anmelden.', 'ok');
            } else {
                zeigeAuthMeldung(r.error || 'Konto konnte nicht angelegt werden.', 'fehler');
            }
        }
    } catch(e) {
        zeigeAuthMeldung('Keine Verbindung zum Server.', 'fehler');
    }
};

// Enter schickt das Formular ab. Ein <form> mit mehreren Feldern und ohne
// Absende-Knopf tut das von sich aus nicht.
['auth-username', 'auth-password', 'auth-code'].forEach(function (id) {
    const feld = document.getElementById(id);
    if (!feld) return;
    feld.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); window.loginUser(); }
    });
});

// Mehrere parallele Anfragen koennen gleichzeitig ein 401 bekommen und
// alle logoutUser() rufen. Ohne Sperre erschiene die Rueckfrage mehrfach.
let abmeldungLaeuft = false;

window.logoutUser = function() {
    if (abmeldungLaeuft) return;
    // Nicht ausloggen, solange noch ungesicherte Aktionen offen sind -
    // sonst waere das Spiel nach dem Reload nur noch lokal vorhanden.
    if (window.Sync && window.Sync.isPending()) {
        const weiter = confirm(
            'Es sind noch nicht alle Aktionen zum Server uebertragen.\n' +
            'Trotzdem ausloggen? Die lokalen Daten bleiben auf diesem Geraet erhalten.'
        );
        if (!weiter) return;
    }
    abmeldungLaeuft = true;
    // Auch das Abmelden darf nie am Netz haengen: Api.logout() raeumt nur
    // lokal auf. Danach neu laden, damit alles vom Anmeldeformular aus startet.
    Promise.resolve(window.Api.logout()).catch(function () {}).then(function () {
        location.reload();
    });
};

async function checkWhatsAppStatusOnLoad() {
    if (window.WhatsAppMod && typeof window.WhatsAppMod.checkStatus === 'function') {
        const isAuth = await window.WhatsAppMod.checkStatus();
        console.log("WhatsApp Authenticated:", isAuth);
    }
}
