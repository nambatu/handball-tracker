// ===================================================================
// MAIN INITIALIZATION
// ===================================================================

window.onload = () => {
    // 1. Initialize logic
    window.Store.loadPlayers();
    window.Timer.loadGameState();

    // 2. Initialize UI
    window.UI.updateActionCount();
    window.UI.renderHistory();
    window.UI.updateUI();

    // 3. Initialize WhatsApp UI logic (if modal is present)
    checkWhatsAppStatusOnLoad();
};

async function checkWhatsAppStatusOnLoad() {
    if (window.WhatsAppMod) {
        const isAuth = await window.WhatsAppMod.checkStatus();
        console.log("WhatsApp Authenticated:", isAuth);
        // UI updates for WhatsApp button will go here later
    }
}
