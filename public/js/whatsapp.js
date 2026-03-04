// ===================================================================
// WHATSAPP INTEGRATION SERVICE (Frontend)
// ===================================================================

const API_BASE = '/api/whatsapp';

function getAuthHeader() {
    const pwd = sessionStorage.getItem('wa_admin_password');
    return pwd ? `Bearer ${pwd}` : null;
}

// Function that handles broadcasting an event to WhatsApp via backend
async function broadcastEvent(action, player, assistId, scoreString) {
    const authHeader = getAuthHeader();
    if (!authHeader) return; // Silent return if not logged in

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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader
            },
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
    broadcastEvent,
    getAuthHeader
};
