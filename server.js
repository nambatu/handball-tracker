require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_fallback_key';
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'));
}
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([]));
}

function getUserDir(username) {
    // Sanitize username to prevent directory traversal
    const safeUsername = username.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const dir = path.join(__dirname, 'data', safeUsername);
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

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!req.user || !req.user.username) return cb(new Error("Unauthorized"), false);
        const dirs = getUserPaths(req.user.username);
        cb(null, dirs.avatars);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// User auth logic will read from USERS_FILE


const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

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

    waClient = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            executablePath: '/usr/bin/chromium',
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
    });

    waClient.on('auth_failure', msg => {
        console.error('WhatsApp AUTHENTICATION FAILURE', msg);
        isAuthenticated = false;
    });

    waClient.on('disconnected', (reason) => {
        console.log('WhatsApp Client was disconnected', reason);
        isAuthenticated = false;
        // Re-initialize to get a new QR code eventually
        initializeWhatsAppClient();
    });

    console.log("Initializing WhatsApp Client...");
    waClient.initialize().catch(err => {
        console.error('Failed to initialize WhatsApp Client', err);
        waClient = null;
        isInitializing = false;
    });
}

// ==========================================
// API ENDPOINTS (AUTH)
// ==========================================

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
        
        const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ username, password: hashedPassword });
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        
        res.json({ success: true, message: 'User registered successfully' });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
        
        const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, username: user.username });
    } catch (e) {
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

    if (providedPassword !== adminPassword) {
        return res.status(401).json({ error: 'Unauthorized: Incorrect password' });
    }

    next();
}

// 1. Get Authentication Status (Protected)
app.get('/api/whatsapp/status', requireAdminPassword, (req, res) => {
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
            waClient.destroy();
            waClient = null;
            isAuthenticated = false;
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

app.post('/api/state', requireUser, (req, res) => {
    try {
        const paths = getUserPaths(req.user.username);
        fs.writeFileSync(paths.state, JSON.stringify(req.body, null, 2));
        res.json({ success: true });
    } catch (e) {
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
            const stat = fs.statSync(path.join(paths.archives, f));
            return { filename: f, date: stat.mtime };
        });
        archives.sort((a,b) => b.date - a.date);
        res.json(archives);
    } catch(e) {
        res.status(500).json({ error: 'Failed to list archives' });
    }
});

app.post('/api/archive', requireUser, (req, res) => {
    try {
        const paths = getUserPaths(req.user.username);
        const { spieler, aktionen } = req.body;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `game-${timestamp}.json`;
        fs.writeFileSync(path.join(paths.archives, filename), JSON.stringify({ spieler, aktionen }, null, 2));
        res.json({ success: true, filename });
    } catch(e) {
        res.status(500).json({ error: 'Failed to archive game' });
    }
});

app.get('/api/archive/:filename', requireUser, (req, res) => {
    try {
        const paths = getUserPaths(req.user.username);
        const filepath = path.join(paths.archives, req.params.filename);
        if (fs.existsSync(filepath)) {
            const data = fs.readFileSync(filepath, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.status(404).json({ error: 'Archive not found' });
        }
    } catch(e) {
        res.status(500).json({ error: 'Failed to read archive' });
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
        fs.writeFileSync(paths.teams, JSON.stringify(teams, null, 2));
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
        fs.writeFileSync(paths.teams, JSON.stringify(teams, null, 2));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete team' });
    }
});

// ==========================================
// API ENDPOINTS (AVATARS)
// ==========================================

app.post('/api/upload-avatar', requireUser, upload.single('avatar'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        // Return the relative URL to the avatar
        // To serve these, we need to map a static route to the user's avatar folder
        const avatarUrl = `/api/avatars/${req.user.username}/${req.file.filename}`;
        res.json({ success: true, avatarUrl });
    } catch (e) {
        res.status(500).json({ error: 'Failed to upload avatar' });
    }
});

app.get('/api/avatars/:username/:filename', requireUser, (req, res) => {
    // Only allow users to access their own avatars (or maybe allow public if you want)
    if (req.user.username !== req.params.username) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const paths = getUserPaths(req.params.username);
    const filepath = path.join(paths.avatars, req.params.filename);
    if (fs.existsSync(filepath)) {
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

// Start the headless bot immediately on boot
initializeWhatsAppClient();

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
