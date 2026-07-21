// ===================================================================
// MAIN INITIALIZATION
// ===================================================================

window.onload = async () => {
    // 1. Load Server State
    await window.Store.loadInitialState();

    // 2. Initialize logic
    window.Store.loadPlayers();
    window.Timer.loadGameState();

    // 3. Initialize UI
    window.UI.updateActionCount();
    window.UI.renderHistory();
    window.UI.updateUI();

    // 4. Initialize WhatsApp UI logic (if modal is present)
    checkWhatsAppStatusOnLoad();
};

async function checkWhatsAppStatusOnLoad() {
    if (window.WhatsAppMod) {
        const isAuth = await window.WhatsAppMod.checkStatus();
        console.log("WhatsApp Authenticated:", isAuth);
        // UI updates for WhatsApp button will go here later
    }
}
