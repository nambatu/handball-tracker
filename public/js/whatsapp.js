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
        const isEnemy = window.Store.istGast(player);
        if (isEnemy) {
            messageStr = `⚽ *Tor für die Gäste!* Stand: ${scoreString} (${timerStr})`;
        } else {
            const assistStr = assistId ? ` (Assist: ${spieler.find(p => p.id === assistId)?.name || 'Unbekannt'})` : '';
            messageStr = `🟢 *TOR!* #${player.nummer} ${player.name} trifft (${action.label})${assistStr}. Neuer Spielstand: *${scoreString}* (${timerStr})`;
        }
    } else if (action.typ.includes("Ballverlust") || action.typ.includes("Ballgewinn")) {
        // Zu kleinteilig fuer den Ticker - wuerde die Gruppe zuspammen.
        return;
    } else if (action.typ.includes("Parade")) {
        messageStr = `🧤 *Starke Parade!* #${player.nummer} ${player.name} hält den Ball. (${timerStr})`;
    } else if (action.typ.includes("Karte_Gelb")) {
        messageStr = `🟨 *Gelbe Karte* für #${player.nummer} ${player.name}. (${timerStr})`;
    } else if (action.typ.includes("Karte_Rot")) {
        messageStr = `🟥 *ROTE KARTE!* #${player.nummer} ${player.name} muss vom Feld. (${timerStr})`;
    } else if (action.typ.includes("Karte_Blau")) {
        messageStr = `🟦 *BLAUE KARTE!* #${player.nummer} ${player.name} — Disqualifikation mit Bericht. (${timerStr})`;
    } else if (action.typ.includes("Zeitstrafe")) {
        messageStr = `⏱️ *2 Minuten* für #${player.nummer} ${player.name}. (${timerStr})`;
    } else if (action.typ.includes("SiebenMeterRaus")) {
        messageStr = `🎯 *Siebenmeter herausgeholt* von #${player.nummer} ${player.name}. (${timerStr})`;
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
