// Verbindung zu Supabase. Der "publishable" Schluessel ist von Supabase
// bewusst oeffentlich gedacht (er steckt in jeder Web-App) und darf im Repo
// stehen - was er darf, regeln die Zugriffsregeln (RLS) in der Datenbank.
// Der geheime Service-Schluessel gehoert NIEMALS hierher.
window.HT_CONFIG = {
    supabaseUrl: 'https://pbkasfptpfzmkhhsyzgr.supabase.co',
    supabaseKey: 'sb_publishable_n9hw3qTLudjjwB-koEarvQ_wPB1dCoh',
    mailDomain: 'tracker.langschwerts.de'
};
