#!/bin/bash
#
# Handball Tracker - Setup auf einem frischen VPS (Ubuntu 22.04/24.04 oder Debian 12)
#
# Als root ausfuehren:
#   curl -fsSL https://raw.githubusercontent.com/nambatu/handball-tracker/main/deploy/setup_vps.sh -o setup_vps.sh
#   DOMAIN=tracker.langschwerts.de bash setup_vps.sh
#
# Solange der A-Record noch nicht gesetzt ist, geht auch ein Test-Hostname,
# der ohne DNS-Aenderung auf die Server-IP zeigt und trotzdem ein echtes
# Zertifikat bekommt:
#   DOMAIN=tracker.203-0-113-7.sslip.io bash setup_vps.sh      (IP mit Bindestrichen)
# Spaeter einfach mit der richtigen Domain noch einmal starten.
#
# Richtet ein: Benutzer "tracker", Node.js 20, PM2 mit Autostart, Caddy mit
# Let's-Encrypt-Zertifikat, Firewall, Datenverzeichnis, naechtliches Backup.
# Wiederholt ausfuehrbar: vorhandene .env und vorhandene Daten bleiben unangetastet.
#
# Der Pi-Weg (setup_pi.sh, ngrok) bleibt davon unberuehrt.

set -euo pipefail

DOMAIN="${DOMAIN:-tracker.langschwerts.de}"
APP_USER="tracker"
APP_DIR="/opt/handball-tracker"
DATA_DIR="/var/lib/handball-tracker"
LOG_DIR="/var/log/handball-tracker"
BACKUP_DIR="/var/backups/handball-tracker"
REPO="https://github.com/nambatu/handball-tracker.git"

if [ "$(id -u)" -ne 0 ]; then
    echo "Bitte als root ausfuehren (sudo bash setup_vps.sh)."
    exit 1
fi

echo "======================================"
echo "  Handball Tracker - VPS Setup"
echo "  Domain: $DOMAIN"
echo "======================================"

export DEBIAN_FRONTEND=noninteractive

echo "[1/8] Systempakete ..."
apt-get update
apt-get upgrade -y
apt-get install -y curl git ufw rsync ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

echo "[2/8] Node.js ..."
NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
command -v pm2 > /dev/null || npm install -g pm2

echo "[3/8] Caddy ..."
if ! command -v caddy > /dev/null; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
fi

echo "[4/8] Benutzer und Verzeichnisse ..."
id "$APP_USER" > /dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR" "$DATA_DIR" "$LOG_DIR" "$BACKUP_DIR"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR" "$DATA_DIR" "$LOG_DIR" "$BACKUP_DIR"
chmod 700 "$DATA_DIR"

echo "[5/8] Code ..."
if [ -d "$APP_DIR/.git" ]; then
    sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
else
    sudo -u "$APP_USER" git clone "$REPO" "$APP_DIR"
fi
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm install --omit=dev"
chmod +x "$APP_DIR/scripts/backup.sh" "$APP_DIR/scripts/restore.sh"

echo "[6/8] Konfiguration ..."
NEW_ENV=0
if [ -f "$APP_DIR/.env" ]; then
    echo "  .env existiert bereits - bleibt unveraendert."
else
    NEW_ENV=1
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
    TICKER="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
    CODE="HB-$(node -e "const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';console.log(Array.from({length:8},()=>a[require('crypto').randomInt(a.length)]).join(''))")"
    sed -i "s|^HOST=.*|HOST=127.0.0.1|" "$APP_DIR/.env"
    sed -i "s|^DATA_DIR=.*|DATA_DIR=${DATA_DIR}|" "$APP_DIR/.env"
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${SECRET}|" "$APP_DIR/.env"
    sed -i "s|^REGISTRATION_CODE=.*|REGISTRATION_CODE=${CODE}|" "$APP_DIR/.env"
    sed -i "s|^TICKER_TOKEN=.*|TICKER_TOKEN=${TICKER}|" "$APP_DIR/.env"
    # Das Gateway sitzt (noch) hinter CGNAT und ist von hier nicht erreichbar.
    sed -i "s|^GATEWAY_URL=.*|GATEWAY_URL=|" "$APP_DIR/.env"
    sed -i "s|^GATEWAY_TOKEN=.*|GATEWAY_TOKEN=|" "$APP_DIR/.env"
    chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
    chmod 600 "$APP_DIR/.env"
fi

echo "[7/8] PM2, Autostart, Backup ..."
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && (pm2 delete handball-tracker > /dev/null 2>&1 || true) && pm2 start ecosystem.config.js --env production && pm2 save"
# Autostart nach Reboot - ohne das ist der Dienst nach dem ersten Neustart weg.
env PATH="$PATH" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" > /dev/null
CRON_LINE="30 3 * * * DATA_DIR=${DATA_DIR} ${APP_DIR}/scripts/backup.sh >> ${LOG_DIR}/backup.log 2>&1"
if ! sudo -u "$APP_USER" crontab -l 2>/dev/null | grep -qF "backup.sh"; then
    (sudo -u "$APP_USER" crontab -l 2>/dev/null || true; echo "$CRON_LINE") | sudo -u "$APP_USER" crontab -
fi

echo "[8/8] Caddy und Firewall ..."
cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
    encode gzip
    reverse_proxy 127.0.0.1:3000
}
CADDY
systemctl enable caddy > /dev/null 2>&1 || true
systemctl reload caddy || systemctl restart caddy
ufw allow OpenSSH > /dev/null
ufw allow 80/tcp > /dev/null
ufw allow 443/tcp > /dev/null
ufw --force enable > /dev/null

sleep 3
echo ""
echo "======================================"
echo "          Setup abgeschlossen"
echo "======================================"
echo ""
echo "Lokal:    $(curl -s http://127.0.0.1:3000/healthz || echo 'KEINE ANTWORT - pm2 logs pruefen')"
echo "Aussen:   https://${DOMAIN}/healthz   (Zertifikat kommt, sobald der DNS-Eintrag auf diesen Server zeigt)"
echo "Daten:    $(sudo -u "$APP_USER" pm2 logs handball-tracker --lines 50 --nostream 2>/dev/null | grep -m1 Datenverzeichnis || echo 'im Startlog nachsehen')"
echo ""
if [ "$NEW_ENV" = "1" ]; then
    cat <<EOF2
WICHTIG - die .env wurde mit NEUEN Secrets erzeugt. Fuer den Umzug vom Pi
muessen drei Werte aus der .env des Pi uebernommen werden:

    JWT_SECRET          sonst sind alle Geraete ausgeloggt
    REGISTRATION_CODE   sonst gilt ein neuer Einladungscode
    TICKER_TOKEN        sonst findet das wa-gateway die Outbox nicht mehr

    nano $APP_DIR/.env
    sudo -u $APP_USER pm2 restart handball-tracker --update-env

EOF2
fi
cat <<EOF3
Daten vom Pi uebernehmen:
    (Pi)   ./scripts/backup.sh
    (Pi)   scp /var/backups/handball-tracker/handball-data_*.tar.gz root@<VPS-IP>:$BACKUP_DIR/
    (VPS)  sudo -u $APP_USER pm2 stop handball-tracker
    (VPS)  $APP_DIR/scripts/restore.sh            # als root: schiebt den leeren Stand beiseite
    (VPS)  chown -R $APP_USER: $DATA_DIR && chmod 700 $DATA_DIR
    (VPS)  sudo -u $APP_USER pm2 start handball-tracker
    (VPS)  sudo -u $APP_USER pm2 logs handball-tracker --lines 50 --nostream | grep Datenverzeichnis

Update nach einem Push:
    sudo -u $APP_USER bash -c 'cd $APP_DIR && git pull --ff-only && npm install --omit=dev && pm2 restart handball-tracker'
EOF3
