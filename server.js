require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const path = require('path');

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
            executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    waClient.on('qr', (qr) => {
        console.log('\n======================================================');
        console.log('                 WhatsApp Authentication Required                 ');
        console.log('======================================================\n');
        console.log('Please scan the QR code below with your WhatsApp app:\n');
        qrcodeTerminal.generate(qr, { small: true });
        console.log('\n======================================================\n');
    });

    waClient.on('ready', async () => {
        console.log('WhatsApp Client is ready!');
        isAuthenticated = true;

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
// API ENDPOINTS
// ==========================================

// 1. Get Authentication Status
app.get('/api/whatsapp/status', (req, res) => {
    res.json({ authenticated: isAuthenticated, running: !!waClient });
});

// 1b. Start WhatsApp Client
app.post('/api/whatsapp/start', (req, res) => {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword || password !== adminPassword) {
        return res.status(401).json({ error: 'Invalid password' });
    }

    if (waClient || isInitializing) {
        return res.json({ success: true, message: 'Bot is already running or starting' });
    }

    try {
        initializeWhatsAppClient();
        res.json({ success: true, message: 'Bot initialization started' });
    } catch (err) {
        console.error('Error starting bot:', err);
        res.status(500).json({ error: 'Failed to start bot' });
    }
});

// 2. Send Message to the Hardcoded Bot Group
app.post('/api/whatsapp/send', async (req, res) => {
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

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
