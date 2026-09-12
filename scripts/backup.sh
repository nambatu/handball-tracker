#!/bin/bash
#
# Sichert das Datenverzeichnis des Handball Trackers als Tarball.
#
# Einrichten (naechtlich um 03:30):
#   crontab -e
#   30 3 * * * /opt/handball-tracker/scripts/backup.sh >> /var/log/handball-tracker/backup.log 2>&1
#
# Hintergrund: Die SD-Karte eines Pi haelt im Dauerbetrieb typischerweise
# ein bis drei Jahre. Das atomare Schreiben im Server schuetzt gegen eine
# halb geschriebene Datei bei Stromausfall - gegen eine sterbende Karte
# hilft nur eine Kopie woanders.

set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/handball-tracker}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/handball-tracker}"
KEEP_DAYS="${KEEP_DAYS:-14}"

# Optionales zweites Ziel, damit ein Backup den Tod des Pi ueberlebt.
# Beispiele:
#   REMOTE_TARGET="/media/usb-stick/handball-backups"     (USB-Stick)
#   REMOTE_TARGET="ju@nas.local:/volume1/backups/handball" (per rsync/SSH)
REMOTE_TARGET="${REMOTE_TARGET:-}"

timestamp="$(date +%Y-%m-%d_%H%M)"
archive="${BACKUP_DIR}/handball-data_${timestamp}.tar.gz"

if [ ! -d "$DATA_DIR" ]; then
    echo "[$(date -Is)] FEHLER: Datenverzeichnis $DATA_DIR existiert nicht."
    exit 1
fi

mkdir -p "$BACKUP_DIR"

# In eine temporaere Datei schreiben und erst danach umbenennen - sonst
# liegt bei einem Abbruch ein halbes Archiv herum, das wie ein gueltiges
# Backup aussieht.
tmp="${archive}.part"
tar -czf "$tmp" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
mv "$tmp" "$archive"

size="$(du -h "$archive" | cut -f1)"
echo "[$(date -Is)] Backup erstellt: $archive ($size)"

# Integritaet pruefen - ein Archiv, das sich nicht lesen laesst, ist kein Backup
if ! tar -tzf "$archive" > /dev/null 2>&1; then
    echo "[$(date -Is)] FEHLER: Archiv ist defekt, wird geloescht."
    rm -f "$archive"
    exit 1
fi

# Alte Backups aufraeumen
deleted="$(find "$BACKUP_DIR" -name 'handball-data_*.tar.gz' -mtime "+${KEEP_DAYS}" -print -delete | wc -l)"
if [ "$deleted" -gt 0 ]; then
    echo "[$(date -Is)] $deleted Backup(s) aelter als ${KEEP_DAYS} Tage entfernt."
fi

# Zweites Ziel
if [ -n "$REMOTE_TARGET" ]; then
    if rsync -a --quiet "$archive" "$REMOTE_TARGET/" 2>/dev/null; then
        echo "[$(date -Is)] Kopie abgelegt unter: $REMOTE_TARGET"
    else
        echo "[$(date -Is)] WARNUNG: Kopie nach $REMOTE_TARGET fehlgeschlagen."
    fi
fi

count="$(find "$BACKUP_DIR" -name 'handball-data_*.tar.gz' | wc -l)"
echo "[$(date -Is)] Fertig. $count Backup(s) vorhanden."
