// ===================================================================
// MAIN INITIALIZATION & AUTHENTICATION
// ===================================================================

let isLoginMode = true;

const originalFetch = window.fetch;
window.fetch = async function() {
    let [resource, config] = arguments;
    if (!config) config = {};
    if (!config.headers) config.headers = {};

    const token = localStorage.getItem('auth_token');
    if (token) {
        config.headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await originalFetch(resource, config);
    // 401 handling for main api (not whatsapp which uses its own admin token logic)
    if (response.status === 401 && resource.toString().startsWith('/api') && !resource.toString().includes('/api/whatsapp') && !resource.toString().includes('/api/login') && !resource.toString().includes('/api/register')) {
        logoutUser();
    }
    return response;
};

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
    const token = localStorage.getItem('auth_token');
    if (!token) {
        showAuthOverlay();
        return;
    }

    // Token UND bekannter Name vorhanden: nicht erst den Server fragen.
    // In der Halle heisst jede Rueckfrage Wartezeit vor einem leeren
    // Bildschirm, und der lokale Stand traegt das Spiel ohnehin allein.
    // Die Pruefung laeuft trotzdem - ein abgelaufenes Token fliegt dann
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
    document.getElementById('app-container').style.display = 'flex';
    document.getElementById('controls').style.display = 'flex';
    document.getElementById('auth-logout-btn').style.display = 'inline-block';
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

    // 5. WhatsApp-UI (nur relevant, wenn die Integration aktiv ist)
    checkWhatsAppStatusOnLoad();
}

function showAuthOverlay() {
    document.getElementById('auth-overlay').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('controls').style.display = 'none';

    // Ohne Netz ist jeder Anmeldeversuch zwecklos - das gehoert hingeschrieben,
    // statt den Nutzer stumm gegen ein Formular laufen zu lassen.
    if (!navigator.onLine) {
        const hinweis = document.getElementById('auth-error-msg');
        if (hinweis) {
            hinweis.style.color = 'var(--warning-color)';
            hinweis.innerText = 'Keine Verbindung zum Server. Zum Anmelden brauchst du einmal Internet — '
                + 'danach startet die App auch offline.';
        }
    }
}

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? 'Login' : 'Register';
    document.getElementById('auth-submit-btn').innerText = isLoginMode ? 'Login' : 'Register';
    document.getElementById('auth-toggle-btn').innerText = isLoginMode ? 'Need an account? Register' : 'Already have an account? Login';
    document.getElementById('auth-error-msg').innerText = '';

    // Einladungscode nur bei der Registrierung anzeigen
    const codeEl = document.getElementById('auth-code');
    if (codeEl) codeEl.style.display = isLoginMode ? 'none' : 'block';

    const hintEl = document.getElementById('auth-hint');
    if (hintEl) hintEl.innerText = isLoginMode ? '' : 'Passwort: mindestens 8 Zeichen.';
}

window.loginUser = async function() {
    const user = document.getElementById('auth-username').value;
    const pass = document.getElementById('auth-password').value;
    const err = document.getElementById('auth-error-msg');
    err.innerText = '';

    if(!user || !pass) return err.innerText = 'Fill all fields';

    const endpoint = isLoginMode ? '/api/login' : '/api/register';

    const payload = { username: user, password: pass };
    if (!isLoginMode) {
        const codeEl = document.getElementById('auth-code');
        if (codeEl && codeEl.value) payload.code = codeEl.value;
    }

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok) {
            if (isLoginMode) {
                localStorage.setItem('auth_token', data.token);
                localStorage.setItem('auth_username', data.username);
                enterApp(data.username);
            } else {
                err.style.color = 'green';
                err.innerText = 'Registered! Please login now.';
                setTimeout(() => toggleAuthMode(), 1500);
            }
        } else {
            err.style.color = 'red';
            err.innerText = data.error || 'Error';
        }
    } catch(e) {
        err.style.color = 'red';
        err.innerText = 'Network error';
    }
};

window.logoutUser = function() {
    // Nicht ausloggen, solange noch ungesicherte Aktionen offen sind -
    // sonst waere das Spiel nach dem Reload nur noch lokal vorhanden.
    if (window.Sync && window.Sync.isPending()) {
        const weiter = confirm(
            'Es sind noch nicht alle Aktionen zum Server uebertragen.\n' +
            'Trotzdem ausloggen? Die lokalen Daten bleiben auf diesem Geraet erhalten.'
        );
        if (!weiter) return;
    }
    localStorage.removeItem('auth_token');
    location.reload();
};

async function checkWhatsAppStatusOnLoad() {
    if (window.WhatsAppMod && typeof window.WhatsAppMod.checkStatus === 'function') {
        const isAuth = await window.WhatsAppMod.checkStatus();
        console.log("WhatsApp Authenticated:", isAuth);
    }
}
