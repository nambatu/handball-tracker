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
    checkAuthStatus();
};

async function checkAuthStatus() {
    const token = localStorage.getItem('auth_token');
    if (!token) {
        showAuthOverlay();
        return;
    }

    try {
        const res = await fetch('/api/me');
        if (res.ok) {
            const data = await res.json();
            localStorage.setItem('auth_username', data.username);
            enterApp(data.username);
        } else {
            // Echte Ablehnung (401/403): Token ist ungueltig
            showAuthOverlay();
        }
    } catch(e) {
        // Netzwerkfehler, NICHT abgelehnt: In der Halle ohne Empfang muss
        // die App trotzdem starten. Der lokale Stand reicht zum Weitertracken.
        const cachedUser = localStorage.getItem('auth_username');
        if (cachedUser) {
            console.warn('[App] Offline gestartet - arbeite mit lokalem Stand.');
            enterApp(cachedUser);
            if (window.Toast) {
                window.Toast('Offline gestartet. Aktionen werden lokal gesichert und spaeter uebertragen.',
                    { type: 'warn', duration: 7000 });
            }
        } else {
            showAuthOverlay();
        }
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
