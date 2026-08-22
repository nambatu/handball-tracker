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
            console.log("Logged in as:", data.username);
            document.getElementById('auth-overlay').style.display = 'none';
            document.getElementById('auth-logout-btn').style.display = 'inline-block';
            initializeApp();
        } else {
            showAuthOverlay();
        }
    } catch(e) {
        showAuthOverlay();
    }
}

async function initializeApp() {
    // 1. Load Server State
    await window.Store.loadInitialState();

    // 2. Initialize logic
    window.Store.loadPlayers();
    window.Timer.loadGameState();

    // 3. Initialize UI
    if (window.UI) {
        window.UI.updateActionCount();
        window.UI.renderHistory();
        window.UI.updateUI();
    }

    // 4. Initialize WhatsApp UI logic (if modal is present)
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
}

window.loginUser = async function() {
    const user = document.getElementById('auth-username').value;
    const pass = document.getElementById('auth-password').value;
    const err = document.getElementById('auth-error-msg');
    err.innerText = '';
    
    if(!user || !pass) return err.innerText = 'Fill all fields';
    
    const endpoint = isLoginMode ? '/api/login' : '/api/register';
    
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username: user, password: pass})
        });
        
        const data = await res.json();
        if (res.ok) {
            if (isLoginMode) {
                localStorage.setItem('auth_token', data.token);
                document.getElementById('auth-overlay').style.display = 'none';
                document.getElementById('app-container').style.display = 'flex';
                document.getElementById('controls').style.display = 'flex';
                document.getElementById('auth-logout-btn').style.display = 'inline-block';
                initializeApp();
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
    localStorage.removeItem('auth_token');
    location.reload();
};

async function checkWhatsAppStatusOnLoad() {
    if (window.WhatsAppMod && typeof window.WhatsAppMod.checkStatus === 'function') {
        const isAuth = await window.WhatsAppMod.checkStatus();
        console.log("WhatsApp Authenticated:", isAuth);
    }
}
