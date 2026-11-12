# Handball Tracker

Web-App zum Tracken von Handball-Spielaktionen (Tore, Paraden, Strafen) mit Offline-Betrieb,
Mehrgeraete-Sync, Statistik/Spielbericht und WhatsApp-Ticker. Ziel-Adresse: `tracker.langschwerts.de`.

Sprache: Code-Kommentare, Logs, Commit-Nachrichten und UI sind **deutsch** (Umlaute im Code als ae/oe/ue).
Der Besitzer hat keinen Informatik-Hintergrund - Erklaerungen schlicht halten, Befehle zum Kopieren liefern.

## Aufbau

- `server.js` - Express 5, ein Prozess, speichert **JSON-Dateien** unter `DATA_DIR` (keine Datenbank).
  Login per JWT, Registrierung nur mit `REGISTRATION_CODE`. `/healthz` ohne Login.
- `lib/outbox.js` - Warteschlange fuer Ticker-Nachrichten. Das `wa-gateway` **holt per Long-Poll ab**
  (Auth: `TICKER_TOKEN`); der Tracker ruft das Gateway nie an. Eintraege verfallen nach 5 min.
- `lib/ticker.js`, `lib/tickerlauf.js`, `lib/tickerrouten.js` - Ticker-Texte, Ablauf, Routen.
- `lib/ki.js` - optionale Gemini-Analyse zum Spielende.
- `public/` - Frontend ohne Build-Schritt (Vanilla JS, PWA mit `sw.js`). Bei Aenderungen an
  ausgelieferten Dateien die Cache-Version in `sw.js` anheben.
- `scripts/backup.sh`, `scripts/restore.sh` - Tarball von `DATA_DIR`.
- `setup_pi.sh` (Raspberry Pi hinter ngrok) und `deploy/setup_vps.sh` (VPS mit Caddy).

Verwandte Repos: `nambatu/wa-gateway` (WhatsApp-Sitzung, whatsapp-web.js + Chromium, hat Tests),
`nambatu/handball.net-whatsapp-liveticker` (Scraper fuer handball.net).

## Arbeiten

```bash
npm install
cp .env.example .env      # DATA_DIR leer lassen = ./data
npm start                 # http://127.0.0.1:3000
```

Es gibt keine Tests und keinen Linter in diesem Repo. Nach Aenderungen mindestens
`node --check <datei>` und den Server einmal starten.

## Regeln, die schon einmal wehgetan haben

- **Nie Cluster-Modus / mehrere Instanzen** - mehrere Prozesse wuerden sich die JSON-Dateien ueberschreiben.
- **Spieldaten und `.env` gehoeren nicht ins Repo.** `DATA_DIR` liegt bewusst ausserhalb des Projektordners.
- **Dem Startlog glauben, nicht der `.env`:** `pm2 logs handball-tracker --lines 50 --nostream | grep Datenverzeichnis`.
- **`pm2 save` nach jeder Aenderung an der Prozessliste**, sonst ist sie nach dem Reboot weg.
- **Zwei verschiedene Tokens:** `TICKER_TOKEN` = Gateway meldet sich beim Tracker;
  `GATEWAY_TOKEN` = Tracker meldet sich beim Gateway (nur Gruppenauswahl in der UI, auf dem VPS leer).
- Der Pi haengt hinter CGNAT: keine Portfreigabe, kein DynDNS, kein Caddy auf dem Pi vorschlagen.
- DNS von `langschwerts.de` nicht umziehen (Microsoft-365-Mail). Nur ein A-Record fuer `tracker.`.

## Deployment

Push nach `main`, dann auf dem Server `git pull --ff-only && npm install --omit=dev && pm2 restart handball-tracker`.
Ausfuehrliche Entscheidungen und Betriebsbefunde stehen in den Projekt-Dokumenten
(`deployment-pi.md`, `vps-umzug.md`, `whatsapp-gateway.md`, `sync-konflikte.md`, `roadmap-code-review.md`).
