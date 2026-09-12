#!/bin/bash
#
# Handball Tracker - Setup auf dem Raspberry Pi
#
# Richtet ein: Node.js, Abhaengigkeiten, Datenverzeichnis ausserhalb des
# Projektordners, .env mit erzeugten Secrets, PM2 inklusive Autostart nach
# Reboot, naechtliches Backup und optional den Cloudflare-Tunnel.
#
# Das Skript ist wiederholt ausfuehrbar: vorhandene .env und vorhandene
# Daten werden nicht angetastet.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${DATA_DIR:-/var/lib/handball-tracker}"
LOG_DIR="/var/log/handball-tracker"
BACKUP_DIR="/var/backups/handball-tracker"

echo "======================================"
echo "  Handball Tracker - Pi Setup         "
echo "======================================"
echo "  Projekt: $PROJECT_DIR"
echo "  Daten:   $DATA_DIR"
echo ""

# ---------------------------------------------------------------
echo "[1/8] Systempakete aktualisieren ..."
sudo apt-get update
sudo apt-get upgrade -y

# ---------------------------------------------------------------
echo ""
echo "[2/8] Node.js pruefen ..."
NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)"
if [ "${NODE_MAJOR:-0}" -ge 20 ]; then
    echo "  Node.js $(node -v) ist bereits installiert."
else
    echo "  Installiere Node.js 20 ..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# ---------------------------------------------------------------
echo ""
echo "[3/8] Datenverzeichnis und Logs anlegen ..."
# Bewusst AUSSERHALB des Projektordners: so ueberstehen die Daten ein
# "git pull", einen Umzug des Codes und ein komplettes Neuaufsetzen.
sudo mkdir -p "$DATA_DIR" "$LOG_DIR" "$BACKUP_DIR"
sudo chown -R "$USER":"$USER" "$DATA_DIR" "$LOG_DIR" "$BACKUP_DIR"
sudo chmod 700 "$DATA_DIR"
echo "  $DATA_DIR"
echo "  $LOG_DIR"
echo "  $BACKUP_DIR"

# Vorhandene Daten aus dem alten Ort uebernehmen
if [ -d "$PROJECT_DIR/data" ] && [ -z "$(ls -A "$DATA_DIR" 2>/dev/null)" ]; then
    echo ""
    echo "  Es liegen noch Daten unter $PROJECT_DIR/data."
    read -r -p "  Nach $DATA_DIR verschieben? [J/n] " move
    case "$move" in
        [nN]) echo "  Uebersprungen." ;;
        *)
            cp -a "$PROJECT_DIR/data/." "$DATA_DIR/"
            mv "$PROJECT_DIR/data" "$PROJECT_DIR/data.verschoben-$(date +%Y%m%d)"
            echo "  Verschoben. Der alte Ordner wurde umbenannt, nicht geloescht."
            ;;
    esac
fi

# ---------------------------------------------------------------
echo ""
echo "[4/8] Projektabhaengigkeiten installieren ..."
cd "$PROJECT_DIR"
if [ "${WITH_WHATSAPP:-0}" = "1" ]; then
    npm install
else
    # Ohne WhatsApp sparen wir Chromium und Puppeteer - auf einer
    # SD-Karte sind das mehrere hundert MB und viel Schreiblast.
    npm install --omit=optional
    echo "  (WhatsApp-Integration ist aus. Fuer die Installation mit WhatsApp:"
    echo "   WITH_WHATSAPP=1 ./setup_pi.sh)"
fi

# ---------------------------------------------------------------
echo ""
echo "[5/8] Konfiguration ..."
if [ -f .env ]; then
    echo "  .env existiert bereits - bleibt unveraendert."
else
    cp .env.example .env
    SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
    CODE="HB-$(node -e "const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';console.log(Array.from({length:8},()=>a[Math.floor(Math.random()*a.length)]).join(''))")"

    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${SECRET}|" .env
    sed -i "s|^REGISTRATION_CODE=.*|REGISTRATION_CODE=${CODE}|" .env
    sed -i "s|^DATA_DIR=.*|DATA_DIR=${DATA_DIR}|" .env

    CHROMIUM_BIN="$(command -v chromium || command -v chromium-browser || true)"
    [ -n "$CHROMIUM_BIN" ] && sed -i "s|^CHROMIUM_PATH=.*|CHROMIUM_PATH=${CHROMIUM_BIN}|" .env

    chmod 600 .env
    echo "  .env erzeugt."
    echo ""
    echo "  >>> Einladungscode fuer die Registrierung: ${CODE}"
    echo "  >>> (steht auch in der .env, bitte notieren)"
fi

# ---------------------------------------------------------------
echo ""
echo "[6/8] PM2 einrichten ..."
command -v pm2 > /dev/null || sudo npm install -g pm2

pm2 delete handball-tracker > /dev/null 2>&1 || true
pm2 start ecosystem.config.js --env production

# DIESE BEIDEN SCHRITTE FEHLTEN BISHER - ohne sie ist der Tracker
# nach jedem Stromausfall weg.
echo ""
echo "  Autostart nach Reboot einrichten ..."
STARTUP_CMD="$(pm2 startup systemd -u "$USER" --hp "$HOME" | grep -E '^sudo ' || true)"
if [ -n "$STARTUP_CMD" ]; then
    eval "$STARTUP_CMD"
fi
pm2 save
echo "  Erledigt. Der Tracker startet jetzt beim Booten automatisch mit."

# ---------------------------------------------------------------
echo ""
echo "[7/8] Naechtliches Backup einrichten ..."
chmod +x "$PROJECT_DIR/scripts/backup.sh" "$PROJECT_DIR/scripts/restore.sh"
CRON_LINE="30 3 * * * DATA_DIR=${DATA_DIR} ${PROJECT_DIR}/scripts/backup.sh >> ${LOG_DIR}/backup.log 2>&1"
if crontab -l 2>/dev/null | grep -qF "backup.sh"; then
    echo "  Cron-Eintrag existiert bereits."
else
    (crontab -l 2>/dev/null || true; echo "$CRON_LINE") | crontab -
    echo "  Taeglich 03:30 Uhr, Aufbewahrung 14 Tage."
fi
echo "  Einmal jetzt testen:  ./scripts/backup.sh"

# ---------------------------------------------------------------
echo ""
echo "[8/8] Cloudflare Tunnel ..."
if command -v cloudflared > /dev/null; then
    echo "  cloudflared ist bereits installiert ($(cloudflared --version 2>&1 | head -1))."
else
    read -r -p "  cloudflared jetzt installieren? [J/n] " inst
    case "$inst" in
        [nN]) echo "  Uebersprungen." ;;
        *)
            ARCH="$(dpkg --print-architecture)"
            TMP="$(mktemp -d)"
            curl -fsSL -o "$TMP/cloudflared.deb" \
                "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
            sudo dpkg -i "$TMP/cloudflared.deb"
            rm -rf "$TMP"
            echo "  Installiert."
            ;;
    esac
fi

# ---------------------------------------------------------------
cat <<EOF

======================================
          Setup abgeschlossen
======================================

Laeuft der Server?
    pm2 status
    curl -s http://127.0.0.1:3000/healthz

Naechste Schritte fuer den Tunnel:

    cloudflared tunnel login
    cloudflared tunnel create handball-tracker
    cloudflared tunnel route dns handball-tracker tracker.langschwerts.de

    sudo cp deploy/cloudflared-config.yml.example /etc/cloudflared/config.yml
    sudo nano /etc/cloudflared/config.yml        # <TUNNEL-ID> eintragen
    sudo cloudflared service install
    sudo systemctl status cloudflared

Danach ist der Tracker unter https://tracker.langschwerts.de erreichbar.

Nuetzliche Befehle:
    pm2 logs handball-tracker      Logs live mitlesen
    pm2 restart handball-tracker   nach einem Update
    ./scripts/backup.sh            Backup von Hand
    ./scripts/restore.sh           Backup zurueckspielen

EOF
