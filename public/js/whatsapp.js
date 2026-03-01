// ===================================================================
// WHATSAPP INTEGRATION SERVICE (Frontend)
// ===================================================================

const API_BASE = '/api/whatsapp';

async function checkStatus() {
    try {
        const res = await fetch(`${API_BASE}/status`);
        const data = await res.json();
        return data.authenticated;
    } catch (err) {
        console.error("Error checking WhatsApp status:", err);
        return false;
    }
}

async function startBot(password) {
    try {
        const res = await fetch(`${API_BASE}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        return { success: res.ok, message: data.message || data.error };
    } catch (err) {
        console.error("Error starting bot:", err);
        return { success: false, message: "Network error" };
    }
}

// Function that handles broadcasting an event to WhatsApp via backend
async function broadcastEvent(action, player, assistId, scoreString) {

    let timerStr = window.Timer ? window.Timer.formatTime(action.spielzeit) : "";
    let messageStr = "";

    // Formatting rules to make a nice ticker text
    if (action.typ.includes("WurfTor")) {
        const spieler = window.Store.getSPIELER();
        const isEnemy = window.Store.isGuestTeam(player.name);
        if (isEnemy) {
            messageStr = `⚽ *Tor für die Gäste!* Stand: ${scoreString} (${timerStr})`;
        } else {
            const assistStr = assistId ? ` (Assist: ${spieler.find(p => p.id === assistId)?.name || 'Unbekannt'})` : '';
            messageStr = `🟢 *TOR!* #${player.nummer} ${player.name} trifft (${action.label})${assistStr}. Neuer Spielstand: *${scoreString}* (${timerStr})`;
        }
    } else if (action.typ.includes("Ballverlust")) {
        // Optional: Send turnovers? Often too chatty, maybe skip for now.
        // messageStr = `🔴 *Ballverlust:* #${player.nummer} ${player.name} (${action.label}) (${timerStr})`;
        return;
    } else if (action.typ.includes("Parade")) {
        messageStr = `🧤 *Starke Parade!* #${player.nummer} ${player.name} hält den Ball. (${timerStr})`;
    } else if (action.typ.includes("Zeitstrafe") || action.typ.includes("Karte")) {
        // You can add logic for other key events (cards, 2min) here
        messageStr = `⚠️ *Aktion:* #${player.nummer} ${player.name} - ${action.label} (${timerStr})`;
    } else {
        return; // Don't send minor events like simple missed shots
    }

    try {
        const res = await fetch(`${API_BASE}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: messageStr
            })
        });
        const result = await res.json();
        if (!result.success) {
            console.error("Failed to send WhatsApp message:", result.error);
        }
    } catch (err) {
        console.error("Network error sending WhatsApp message:", err);
    }
}

window.WhatsAppMod = {
    checkStatus,
    startBot,
    broadcastEvent
};
