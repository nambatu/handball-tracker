// PM2-Konfiguration fuer den Handball Tracker
//
// Start:    pm2 start ecosystem.config.js --env production
// Status:   pm2 status
// Logs:     pm2 logs handball-tracker
// Neustart: pm2 restart handball-tracker
//
// WICHTIG - damit der Tracker einen Reboot ueberlebt, sind nach dem
// ersten Start EINMALIG zwei weitere Befehle noetig:
//     pm2 startup      (gibt eine sudo-Zeile aus, die ausgefuehrt werden muss)
//     pm2 save         (merkt sich die laufenden Prozesse)
// Ohne diese beiden Schritte ist der Tracker nach einem Stromausfall weg.

module.exports = {
    apps: [
        {
            name: 'handball-tracker',
            script: 'server.js',
            cwd: __dirname,

            // Ein einzelner Prozess. Cluster-Modus waere hier falsch: der
            // Server schreibt JSON-Dateien, mehrere Prozesse wuerden sich
            // gegenseitig ueberschreiben.
            instances: 1,
            exec_mode: 'fork',

            // Nach Absturz neu starten, aber nicht in einer Endlosschleife
            // wenn die Konfiguration kaputt ist.
            autorestart: true,
            min_uptime: '20s',
            max_restarts: 10,
            restart_delay: 4000,

            // Der Pi hat wenig RAM. Falls ein Speicherleck auftritt, lieber
            // neu starten als den ganzen Pi in den Swap-Tod treiben.
            max_memory_restart: '400M',

            // Quelldateien nicht ueberwachen - ein versehentlicher
            // Schreibvorgang soll nicht mitten im Spiel neu starten.
            watch: false,

            time: true,
            merge_logs: true,
            out_file: '/var/log/handball-tracker/out.log',
            error_file: '/var/log/handball-tracker/error.log',

            env: {
                NODE_ENV: 'development'
            },
            env_production: {
                NODE_ENV: 'production',
                // Nur lokal lauschen - nach aussen geht ausschliesslich
                // der Cloudflare-Tunnel.
                HOST: '127.0.0.1',
                PORT: 3000
            }
        }
    ]
};
