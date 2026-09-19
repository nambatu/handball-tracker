require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');

// whatsapp-web.js, puppeteer und qrcode werden absichtlich NICHT hier oben
// geladen. Sie ziehen zusammen ein paar hundert MB an Abhaengigkeiten und
// belegen auf dem Pi unnoetig Speicher, solange die Integration aus ist.
// Das require passiert erst in initializeWhatsAppClient().

// Die Daten gehoeren NICHT in den Projektordner: ein "git pull" oder ein
// Neuaufsetzen wuerde sie sonst mitreissen. Auf dem Pi zeigt DATA_DIR auf
// /var/lib/handball-tracker (siehe .env), lokal bleibt es ./data.
const DATA_DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, '.jwt_secret');

try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
    console.error(`[FATAL] Datenverzeichnis ${DATA_DIR} nicht anlegbar: ${e.message}`);
    process.exit(1);
}

// Frueh pruefen, ob wirklich geschrieben werden kann - sonst faellt das
// erst mitten im Spiel auf, wenn die erste Aktion gesichert werden soll.
try {
    const probe = path.join(DATA_DIR, '.writetest');
    fs.writeFileSync(probe, String(Date.now()));
    fs.unlinkSync(probe);
} catch (e) {
    console.error(`[FATAL] Keine Schreibrechte in ${DATA_DIR}: ${e.message}`);
    console.error('        Rechte pruefen, z.B.:  sudo chown -R $USER /var/lib/handball-tracker');
    process.exit(1);
}
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([]));
}

// ==========================================
// SICHERHEITS-HELFER
// ==========================================

/**
 * Schreibt JSON atomar: erst in eine temporaere Datei, dann umbenennen.
 * Verhindert, dass ein Absturz / Stromausfall mitten im Schreiben
 * eine halb geschriebene (= kaputte) state.json hinterlaesst.
 */
function writeJsonAtomic(filePath, data) {
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
}

/**
 * Reduziert eine vom Client gelieferte Zeichenkette auf einen reinen
 * Dateinamen. Blockt "../", absolute Pfade und URL-kodierte Varianten.
 */
function safeFilename(name) {
    const base = path.basename(String(name || ''));
    if (!base || base === '.' || base === '..') return null;
    if (base.includes('\0')) return null;
    return base;
}

/**
 * Stellt sicher, dass der aufgeloeste Pfad wirklich innerhalb des
 * erwarteten Verzeichnisses liegt (zweite Verteidigungslinie).
 */
function resolveInside(baseDir, filename) {
    const safe = safeFilename(filename);
    if (!safe) return null;
    const full = path.resolve(baseDir, safe);
    const root = path.resolve(baseDir) + path.sep;
    if (!full.startsWith(root)) return null;
    return full;
}

/**
 * Normalisiert einen Benutzernamen auf den Ordnernamen.
 * Wird sowohl beim Anlegen des Ordners als auch bei der
 * Kollisionspruefung in der Registrierung verwendet.
 */
function usernameSlug(username) {
    return String(username || '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// --- JWT Secret -------------------------------------------------------
// Kein hartkodiertes Fallback mehr. Fehlt JWT_SECRET in der .env, wird
// einmalig ein zufaelliges Secret erzeugt und in data/.jwt_secret abgelegt,
// damit Logins einen Serverneustart ueberleben.
function loadJwtSecret() {
    const fromEnv = process.env.JWT_SECRET;
    if (fromEnv && fromEnv.length >= 32) return fromEnv;

    if (fromEnv) {
        console.warn('[WARN] JWT_SECRET ist kuerzer als 32 Zeichen und wird ignoriert.');
    }

    if (fs.existsSync(SECRET_FILE)) {
        const stored = fs.readFileSync(SECRET_FILE, 'utf8').trim();
        if (stored.length >= 32) return stored;
    }

    const generated = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
    console.warn(`[WARN] Kein JWT_SECRET gesetzt. Es wurde eines erzeugt und in ${SECRET_FILE} gespeichert.`);
    console.warn('[WARN] Fuer den Produktivbetrieb bitte JWT_SECRET in der .env setzen (mind. 32 Zeichen).');
    return generated;
}

const JWT_SECRET = loadJwtSecret();

// --- Einfaches In-Memory Rate-Limit ----------------------------------
const rateBuckets = new Map();

function rateLimit({ windowMs, max, key }) {
    return function (req, res, next) {
        const id = `${key}:${req.ip}`;
        const now = Date.now();
        const bucket = rateBuckets.get(id);

        if (!bucket || now > bucket.resetAt) {
            rateBuckets.set(id, { count: 1, resetAt: now + windowMs });
            return next();
        }

        bucket.count++;
        if (bucket.count > max) {
            const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
            res.set('Retry-After', String(retryAfter));
            return res.status(429).json({
                error: `Zu viele Versuche. Bitte in ${retryAfter} Sekunden erneut probieren.`
            });
        }
        next();
    };
}

// Speicher gelegentlich aufraeumen, damit die Map nicht unbegrenzt waechst
setInterval(() => {
    const now = Date.now();
    for (const [id, bucket] of rateBuckets) {
        if (now > bucket.resetAt) rateBuckets.delete(id);
    }
}, 10 * 60 * 1000).unref();

// ==========================================
// BENUTZER-VERZEICHNISSE
// ==========================================

function getUserDir(username) {
    const safeUsername = usernameSlug(username);
    const dir = path.join(DATA_DIR, safeUsername);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(path.join(dir, 'archives'))) fs.mkdirSync(path.join(dir, 'archives'), { recursive: true });
    if (!fs.existsSync(path.join(dir, 'avatars'))) fs.mkdirSync(path.join(dir, 'avatars'), { recursive: true });
    return dir;
}

function getUserPaths(username) {
    const dir = getUserDir(username);
    return {
        state: path.join(dir, 'state.json'),
        teams: path.join(dir, 'teams.json'),
        archives: path.join(dir, 'archives'),
        avatars: path.join(dir, 'avatars')
    };
}

function readUsers() {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

// ==========================================
// AVATAR-UPLOAD (MIME-Whitelist + Groessenlimit)
// ==========================================

const ALLOWED_IMAGE_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif'
};

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!req.user || !req.user.username) return cb(new Error('Unauthorized'), false);
        const dirs = getUserPaths(req.user.username);
        cb(null, dirs.avatars);
    },
    filename: function (req, file, cb) {
        // Endung NIE aus dem Client-Dateinamen uebernehmen, sondern aus dem
        // geprueften MIME-Typ ableiten. Der Name ist zufaellig und damit nicht
        // erratbar - das ist der Zugriffsschutz fuer die Auslieferung unten.
        const ext = ALLOWED_IMAGE_TYPES[file.mimetype] || '.bin';
        cb(null, crypto.randomBytes(16).toString('hex') + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024, // 2 MB
        files: 1
    },
    fileFilter: function (req, file, cb) {
        if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
            return cb(new Error('Nur Bilder erlaubt (JPEG, PNG, WebP, GIF)'), false);
        }
        cb(null, true);
    }
});

const app = express();
const PORT = process.env.PORT || 3000;

// Hinter einem Reverse Proxy (Caddy/nginx) die echte Client-IP verwenden,
// damit das Rate-Limit nicht alle Nutzer in einen Topf wirft.
app.set('trust proxy', 1);

// Middleware to parse JSON bodies
app.use(express.json({ limit: '5mb' }));

// Serve static files from the 'public' directory
//
// Der Kopfzeilen-Stempel ist fuer den Service Worker: nur eine Seite MIT
// diesem Stempel darf er als App-Huelle speichern. Ohne das legt er auch
// eine Zwischenseite ab, die zwischen Browser und App haengt (die
// ngrok-Warnseite, ein WLAN-Anmeldeportal) - und zeigt die dann offline
// statt der App. Genau so ein Fall laesst sich sonst kaum finden, weil
// online alles funktioniert.
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: function (res, filePath) {
        if (filePath.endsWith('index.html')) {
            res.setHeader('X-App-Shell', 'handball-tracker');
        }
        // Der Service Worker selbst darf nie aus dem Cache kommen, sonst
        // laesst sich eine kaputte Fassung nicht mehr ersetzen.
        if (filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// Global state for WhatsApp
let waClient = null;
let isAuthenticated = false;
let isInitializing = false;
let currentQRBase64 = null;

// Initialize WhatsApp Client
function initializeWhatsAppClient() {
    if (waClient || isInitializing) {
        console.log("Client is already initialized or initializing.");
        return;
    }

    isInitializing = true;

    // Erst hier laden - siehe Kommentar am Dateianfang.
    let Client, LocalAuth, qrcodeTerminal, QRCode;
    try {
        ({ Client, LocalAuth } = require('whatsapp-web.js'));
        qrcodeTerminal = require('qrcode-terminal');
        QRCode = require('qrcode');
    } catch (e) {
        console.error('WhatsApp-Pakete nicht installiert - Integration bleibt aus.', e.message);
        isInitializing = false;
        return;
    }

    try {
        waClient = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage', // Helps with Pi memory issues
                    '--disable-gpu',
                    '--no-zygote',
                    '--single-process'
                ],
                timeout: 60000 // Give the Pi 60 seconds to boot the browser instead of the default 30
            }
        });

        waClient.on('qr', async (qr) => {
            console.log('\n======================================================');
            console.log('                 WhatsApp Authentication Required                 ');
            console.log('======================================================\n');
            console.log('Please scan the QR code below with your WhatsApp app:\n');
            qrcodeTerminal.generate(qr, { small: true });
            console.log('\n======================================================\n');

            try {
                currentQRBase64 = await QRCode.toDataURL(qr);
            } catch (e) {
                console.error('Failed to generate QR DataURL', e);
            }
        });

        waClient.on('ready', async () => {
            console.log('WhatsApp Client is ready!');
            isAuthenticated = true;
            isInitializing = false;
            currentQRBase64 = null;

            // Print available groups to console to help user configure .env
            try {
                console.log('\n--- Fetching available groups for configuration... ---');
                let chats = [];
                let retries = 5;
                while (retries > 0) {
                    try {
                        if (retries < 5) await new Promise(r => setTimeout(r, 3000));
                        chats = await waClient.getChats();
                        break;
                    } catch (err) {
                        retries--;
                    }
                }
                if (chats.length > 0) {
                    const groups = chats.filter(chat => chat.isGroup);
                    console.log(`\nFound ${groups.length} groups. Here are their IDs. Copy the correct ID into your .env file as TARGET_GROUP_ID:\n`);
                    groups.forEach(g => {
                        console.log(`- "${g.name}":   ${g.id._serialized}`);
                    });
                    console.log('\n----------------------------------------------------\n');
                }
            } catch (e) {
                console.error('Failed to pre-fetch groups for logging', e);
            }
        });

        waClient.on('authenticated', () => {
            console.log('WhatsApp Client is authenticated');
            isAuthenticated = true;
            isInitializing = false;
        });

        waClient.on('auth_failure', msg => {
            console.error('WhatsApp AUTHENTICATION FAILURE', msg);
            isAuthenticated = false;
            isInitializing = false;
        });

        waClient.on('disconnected', async (reason) => {
            console.log('WhatsApp Client was disconnected', reason);
            isAuthenticated = false;
            currentQRBase64 = null;

            // WICHTIG: erst aufraeumen, sonst blockiert der Guard oben
            // den Neustart und der Bot bleibt nach einem Abbruch tot.
            try {
                await waClient.destroy();
            } catch (e) {
                console.error('Failed to destroy WhatsApp client', e.message);
            }
            waClient = null;
            isInitializing = false;

            setTimeout(initializeWhatsAppClient, 5000);
        });

        console.log("Initializing WhatsApp Client...");
        waClient.initialize().catch(err => {
            console.error('Failed to initialize WhatsApp Client. Is Chromium installed?', err.message);
            waClient = null;
            isInitializing = false;
        });
    } catch (error) {
        console.error("WhatsApp Client could not be created. Disabling WhatsApp integration.", error.message);
        waClient = null;
        isInitializing = false;
    }
}

// ==========================================
// API ENDPOINTS (AUTH)
// ==========================================

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: 'login' });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, key: 'register' });

app.post('/api/register', registerLimiter, async (req, res) => {
    try {
        const { username, password, code } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

        // Optionaler Einladungscode: wenn REGISTRATION_CODE gesetzt ist,
        // kann sich niemand mehr ohne den Code registrieren.
        const requiredCode = process.env.REGISTRATION_CODE;
        if (requiredCode && code !== requiredCode) {
            return res.status(403).json({ error: 'Ungueltiger Einladungscode' });
        }

        if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
            return res.status(400).json({
                error: 'Username: 3-32 Zeichen, nur Buchstaben, Ziffern, _ und -'
            });
        }
        if (String(password).length < 8) {
            return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen lang sein' });
        }

        const users = readUsers();
        const slug = usernameSlug(username);

        // Gegen den NORMALISIERTEN Namen pruefen: sonst landen z.B.
        // "Ju.Lang" und "Ju_Lang" im selben Datenverzeichnis.
        if (users.find(u => usernameSlug(u.username) === slug)) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ username, slug, password: hashedPassword, createdAt: new Date().toISOString() });
        writeJsonAtomic(USERS_FILE, users);

        res.json({ success: true, message: 'User registered successfully' });
    } catch (e) {
        console.error('Register failed', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

        const users = readUsers();
        const user = users.find(u => u.username.toLowerCase() === String(username).toLowerCase());

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, username: user.username });
    } catch (e) {
        console.error('Login failed', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// Middleware for user accounts (JWT)
function requireUser(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

app.get('/api/me', requireUser, (req, res) => {
    res.json({ username: req.user.username });
});

// ==========================================
// API ENDPOINTS (WHATSAPP)
// ==========================================

// Middleware for password protection
function requireAdminPassword(req, res, next) {
    const authHeader = req.headers.authorization;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
        return res.status(500).json({ error: 'Server misconfiguration: ADMIN_PASSWORD not set' });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    const providedPassword = authHeader.split(' ')[1];

    // Zeitkonstanter Vergleich, damit sich das Passwort nicht ueber
    // Laufzeitunterschiede Zeichen fuer Zeichen erraten laesst.
    const a = Buffer.from(String(providedPassword));
    const b = Buffer.from(String(adminPassword));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ error: 'Unauthorized: Incorrect password' });
    }

    next();
}

const waLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, key: 'wa' });

// 1. Get Authentication Status (Protected)
app.get('/api/whatsapp/status', waLimiter, requireAdminPassword, (req, res) => {
    res.json({
        authenticated: isAuthenticated,
        running: !!waClient,
        qr: currentQRBase64
    });
});

// 1b. Logout WhatsApp (Protected)
app.post('/api/whatsapp/logout', requireAdminPassword, async (req, res) => {
    if (waClient) {
        try {
            await waClient.logout();
            await waClient.destroy();
            waClient = null;
            isAuthenticated = false;
            isInitializing = false;
            currentQRBase64 = null;
            initializeWhatsAppClient();
            res.json({ success: true, message: 'Logged out and re-initializing.' });
        } catch (e) {
            res.status(500).json({ error: 'Failed to logout' });
        }
    } else {
        res.json({ success: true, message: 'Not running.' });
    }
});

// ==========================================
// GAME STATE API
// ==========================================

app.get('/api/state', requireUser, (req, res) => {
    try {
        const paths = getUserPaths(req.user.username);
        if (fs.existsSync(paths.state)) {
            const data = fs.readFileSync(paths.state, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json({ spieler: [], aktionen: [] });
        }
    } catch (e) {
        res.status(500).json({ error: 'Failed to read state' });
    }
});

const BACKUP_INTERVAL_MS = 5 * 60 * 1000;

app.post('/api/state', requireUser, (req, res) => {
    try {
        const paths = getUserPaths(req.user.username);
        const incoming = req.body || {};
        const incomingRev = Number(incoming.rev) || 0;

        let existing = null;
        let existingRev = 0;
        if (fs.existsSync(paths.state)) {
            try {
                existing = JSON.parse(fs.readFileSync(paths.state, 'utf8'));
                existingRev = Number(existing.rev) || 0;
            } catch (e) {
                console.error('Vorhandener State unlesbar, wird ersetzt.', e.message);
            }
        }

        // Veraltete Schreibvorgaenge abweisen. Zwei parallele Requests
        // koennen sich im Netz ueberholen - ohne diese Pruefung wuerde der
        // aeltere den neueren ueberschreiben und eine Aktion verschwinden.
        if (incomingRev && existingRev > incomingRev) {
            return res.status(409).json({
                error: 'stale',
                message: `Serverstand (rev ${existingRev}) ist neuer als der gesendete (rev ${incomingRev}).`,
                state: existing
            });
        }

        // Rollendes Backup der letzten guten Version (max. alle 5 Minuten,
        // um die SD-Karte des Pi nicht unnoetig zu beschreiben).
        if (existing) {
            const backupPath = paths.state + '.bak';
            let shouldBackup = true;
            try {
                if (fs.existsSync(backupPath)) {
                    shouldBackup = (Date.now() - fs.statSync(backupPath).mtimeMs) > BACKUP_INTERVAL_MS;
                }
            } catch (e) { /* im Zweifel sichern */ }
            if (shouldBackup) {
                try { writeJsonAtomic(backupPath, existing); } catch (e) { console.error('Backup fehlgeschlagen', e.message); }
            }
        }

        writeJsonAtomic(paths.state, {
            rev: incomingRev,
            updatedAt: Number(incoming.updatedAt) || Date.now(),
            spieler: Array.isArray(incoming.spieler) ? incoming.spieler : [],
            aktionen: Array.isArray(incoming.aktionen) ? incoming.aktionen : [],
            aktiverTorwartId: incoming.aktiverTorwartId || null,
            teamHeim: incoming.teamHeim || null,
            teamGast: incoming.teamGast || null
        });

        res.json({ success: true, rev: incomingRev });
    } catch (e) {
        console.error('Failed to write state', e);
        res.status(500).json({ error: 'Failed to write state' });
    }
});

// ==========================================
// ARCHIVE API
// ==========================================

app.get('/api/archives', requireUser, (req, res) => {
    try {
        const paths = getUserPaths(req.user.username);
        if (!fs.existsSync(paths.archives)) {
            return res.json([]);
        }
        const files = fs.readdirSync(paths.archives);
        const archives = files.filter(f => f.endsWith('.json')).map(f => {
            const voll = path.join(paths.archives, f);
            const stat = fs.statSync(voll);
            // Name, Gegner und Umfang mitgeben, damit die Liste ohne einen
            // Extra-Request pro Spiel lesbar ist. Ein kaputtes Archiv soll
            // die ganze Liste nicht sprengen.
            let label = null, teamHeim = null, teamGast = null, aktionen = null;
            try {
                const d = JSON.parse(fs.readFileSync(voll, 'utf8'));
                label = d.label || null;
                teamHeim = d.teamHeim || null;
                teamGast = d.teamGast || null;
                aktionen = Array.isArray(d.aktionen) ? d.aktionen.length : null;
            } catch (e) { /* unlesbar - trotzdem auflisten */ }
            return { filename: f, date: stat.mtime, label, teamHeim, teamGast, aktionen };
        });
        archives.sort((a, b) => b.date - a.date);
        res.json(archives);
    } catch (e) {
        res.status(500).json({ error: 'Failed to list archives' });
    }
});

app.post('/api/archive', requireUser, (req, res) => {
    try {
        const paths = getUserPaths(req.user.username);
        const { spieler, aktionen, teamHeim, teamGast } = req.body;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `game-${timestamp}.json`;
        writeJsonAtomic(path.join(paths.archives, filename), {
            spieler, aktionen,
            teamHeim: teamHeim || null,
            teamGast: teamGast || null,
            archivedAt: new Date().toISOString()
        });
        res.json({ success: true, filename });
    } catch (e) {
        res.status(500).json({ error: 'Failed to archive game' });
    }
});

app.get('/api/archive/:filename', requireUser, (req, res) => {
    try {
        const paths = getUserPaths(req.user.username);

        // Express dekodiert Route-Parameter: ohne diese Pruefung liest
        // "..%2F..%2Fusers.json" die Passwort-Hashes aller Nutzer aus.
        const filepath = resolveInside(paths.archives, req.params.filename);
        if (!filepath || !filepath.endsWith('.json')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        if (fs.existsSync(filepath)) {
            const data = fs.readFileSync(filepath, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.status(404).json({ error: 'Archive not found' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Failed to read archive' });
    }
});

/**
 * Archiviertes Spiel loeschen.
 * Gleiche Pfadpruefung wie beim Lesen: ohne resolveInside() liesse sich
 * ueber "..%2F..%2Fusers.json" die Benutzerdatei loeschen.
 */
app.delete('/api/archive/:filename', requireUser, (req, res) => {
    try {
        const paths = getUserPaths(req.user.username);
        const filepath = resolveInside(paths.archives, req.params.filename);
        if (!filepath || !filepath.endsWith('.json')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        if (!fs.existsSync(filepath)) {
            return res.status(404).json({ error: 'Archive not found' });
        }
        fs.unlinkSync(filepath);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete archive' });
    }
});

/**
 * Archiviertes Spiel benennen.
 *
 * Der Name wird IN die Datei geschrieben, die Datei selbst nicht umbenannt:
 * der Dateiname traegt den Archivzeitpunkt und ist der Schluessel, ueber den
 * Bericht und CSV das Spiel finden. Umbenennen wuerde Links brechen und
 * Namenskollisionen erlauben.
 */
app.patch('/api/archive/:filename', requireUser, (req, res) => {
    try {
        const paths = getUserPaths(req.user.username);
        const filepath = resolveInside(paths.archives, req.params.filename);
        if (!filepath || !filepath.endsWith('.json')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        if (!fs.existsSync(filepath)) {
            return res.status(404).json({ error: 'Archive not found' });
        }

        const roh = req.body && req.body.label;
        const label = roh === null || roh === undefined ? null : String(roh).trim().slice(0, 120);

        const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        if (label) data.label = label; else delete data.label;
        writeJsonAtomic(filepath, data);

        res.json({ success: true, label: label || null });
    } catch (e) {
        res.status(500).json({ error: 'Failed to rename archive' });
    }
});

// ==========================================
// TEAMS API
// ==========================================
app.get('/api/teams', requireUser, (req, res) => {
    try {
        const paths = getUserPaths(req.user.username);
        if (!fs.existsSync(paths.teams)) {
            return res.json([]);
        }
        const data = fs.readFileSync(paths.teams, 'utf8');
        res.json(JSON.parse(data));
    } catch (e) {
        res.status(500).json({ error: 'Failed to read teams' });
    }
});

app.post('/api/teams', requireUser, (req, res) => {
    try {
        const paths = getUserPaths(req.user.username);
        const newTeam = req.body;
        let teams = [];
        if (fs.existsSync(paths.teams)) {
            teams = JSON.parse(fs.readFileSync(paths.teams, 'utf8'));
        }
        if (!newTeam.id) {
            newTeam.id = "team_" + Date.now();
        }
        const existingIdx = teams.findIndex(t => t.id === newTeam.id);
        if (existingIdx !== -1) {
            teams[existingIdx] = newTeam;
        } else {
            teams.push(newTeam);
        }
        writeJsonAtomic(paths.teams, teams);
        res.json({ success: true, team: newTeam });
    } catch (e) {
        res.status(500).json({ error: 'Failed to save team' });
    }
});

app.delete('/api/teams/:id', requireUser, (req, res) => {
    try {
        const paths = getUserPaths(req.user.username);
        let teams = [];
        if (fs.existsSync(paths.teams)) {
            teams = JSON.parse(fs.readFileSync(paths.teams, 'utf8'));
        }
        teams = teams.filter(t => t.id !== req.params.id);
        writeJsonAtomic(paths.teams, teams);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete team' });
    }
});

// ==========================================
// API ENDPOINTS (AVATARS)
// ==========================================

app.post('/api/upload-avatar', requireUser, (req, res) => {
    upload.single('avatar')(req, res, function (err) {
        if (err) {
            const msg = err.code === 'LIMIT_FILE_SIZE'
                ? 'Bild ist zu gross (max. 2 MB)'
                : (err.message || 'Upload fehlgeschlagen');
            return res.status(400).json({ error: msg });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const avatarUrl = `/api/avatars/${usernameSlug(req.user.username)}/${req.file.filename}`;
        res.json({ success: true, avatarUrl });
    });
});

// Avatare werden OHNE Auth-Header ausgeliefert: ein <img src="..."> kann
// keinen Bearer-Token mitschicken, deshalb hat frueher jedes Avatarbild
// eine 403 zurueckgegeben. Der Schutz ist jetzt der zufaellige, nicht
// erratbare Dateiname (128 Bit).
app.get('/api/avatars/:username/:filename', (req, res) => {
    const slug = usernameSlug(req.params.username);
    const avatarDir = path.join(DATA_DIR, slug, 'avatars');

    const filepath = resolveInside(avatarDir, req.params.filename);
    if (!filepath || !/\.(jpg|png|webp|gif)$/i.test(filepath)) {
        return res.status(400).json({ error: 'Invalid filename' });
    }

    if (fs.existsSync(filepath)) {
        res.set('Cache-Control', 'private, max-age=86400');
        res.sendFile(filepath);
    } else {
        res.status(404).json({ error: 'Avatar not found' });
    }
});

// 2. Send Message to the Hardcoded Bot Group (Protected)
app.post('/api/whatsapp/send', requireAdminPassword, async (req, res) => {
    if (!isAuthenticated || !waClient) {
        return res.status(401).json({ error: 'WhatsApp client is not authenticated' });
    }

    const { message } = req.body;
    const targetGroupId = process.env.TARGET_GROUP_ID;

    if (!message) {
        return res.status(400).json({ error: 'Missing message' });
    }

    if (!targetGroupId) {
        return res.status(500).json({ error: 'TARGET_GROUP_ID is not configured in .env' });
    }

    try {
        await waClient.sendMessage(targetGroupId, message);
        console.log(`Sent message to group ${targetGroupId}: ${message}`);
        res.json({ success: true });
    } catch (error) {
        console.error("Failed to send message", error);
        res.status(500).json({ success: false, error: 'Failed to send WhatsApp message' });
    }
});

// Fallback to index.html for single page app routing if used
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Healthcheck - zum Pruefen, ob der Tunnel wirklich beim Server ankommt,
// und fuer externe Uptime-Ueberwachung. Bewusst ohne Login und ohne
// Angaben, die einem Fremden etwas nuetzen.
app.get('/healthz', (req, res) => {
    let dataOk = true;
    try {
        fs.accessSync(DATA_DIR, fs.constants.W_OK);
    } catch (e) {
        dataOk = false;
    }
    res.status(dataOk ? 200 : 503).json({
        status: dataOk ? 'ok' : 'degraded',
        uptimeSeconds: Math.round(process.uptime()),
        whatsapp: process.env.WHATSAPP_ENABLED === 'false' ? 'disabled' : (isAuthenticated ? 'online' : 'offline')
    });
});

// Start the headless bot immediately on boot
if (process.env.WHATSAPP_ENABLED !== 'false') {
    initializeWhatsAppClient();
} else {
    console.log('WhatsApp-Integration per .env deaktiviert (WHATSAPP_ENABLED=false).');
}

// Hinter dem Cloudflare-Tunnel soll der Server NUR lokal lauschen -
// nach aussen geht ausschliesslich der Tunnel. HOST=0.0.0.0 oeffnet ihn
// zusaetzlich im Heimnetz (z.B. zum Testen per LAN-IP).
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
    console.log(`Server laeuft auf http://${HOST}:${PORT}`);
    console.log(`Datenverzeichnis: ${DATA_DIR}`);
    if (!process.env.REGISTRATION_CODE) {
        console.warn('[WARN] REGISTRATION_CODE ist nicht gesetzt - die Registrierung ist oeffentlich.');
    }
    if (HOST === '0.0.0.0' && process.env.NODE_ENV === 'production') {
        console.warn('[WARN] Der Server lauscht auf allen Interfaces. Hinter einem Tunnel ist HOST=127.0.0.1 sicherer.');
    }
});

if (server && typeof server.on === 'function') {
    server.on('error', (e) => {
        console.error(`[FATAL] Port ${PORT} nicht belegbar: ${e.code}`);
        process.exit(1);
    });
}

// 127.0.0.1 ist reines IPv4. Manche Clients - darunter ngrok - loesen
// "localhost" zuerst zu ::1 auf und laufen dann ins Leere
// ("dial tcp [::1]:3000: connect: connection refused"). Deshalb bei
// Loopback-Bindung zusaetzlich auf IPv6 lauschen.
if (HOST === '127.0.0.1' || HOST === 'localhost') {
    try {
        const v6 = app.listen(PORT, '::1', () => {
            console.log(`Server laeuft zusaetzlich auf http://[::1]:${PORT}`);
        });
        if (v6 && typeof v6.on === 'function') {
            v6.on('error', (e) => {
                console.warn(`[WARN] IPv6-Loopback nicht verfuegbar (${e.code}) - IPv4 allein reicht auch.`);
            });
        }
    } catch (e) {
        console.warn('[WARN] IPv6-Loopback nicht moeglich:', e.message);
    }
}
