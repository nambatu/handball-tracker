#!/bin/bash
#
# Spielt ein Backup des Handball Trackers zurueck.
#
#   ./scripts/restore.sh                                      # neuestes Backup
#   ./scripts/restore.sh /var/backups/.../handball-data_x.tar.gz
#
# Ein Backup, das noch nie zurueckgespielt wurde, ist nur eine Vermutung.
# Einmal im ruhigen Moment ausprobieren, nicht erst wenn die Karte hin ist.

set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/handball-tracker}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/handball-tracker}"

archive="${1:-}"
if [ -z "$archive" ]; then
    archive="$(find "$BACKUP_DIR" -name 'handball-data_*.tar.gz' | sort | tail -1)"
    if [ -z "$archive" ]; then
        echo "Kein Backup in $BACKUP_DIR gefunden."
        exit 1
    fi
    echo "Neuestes Backup: $archive"
fi

if [ ! -f "$archive" ]; then
    echo "Datei nicht gefunden: $archive"
    exit 1
fi

echo ""
echo "Zurueckspielen nach: $DATA_DIR"
echo "Der aktuelle Inhalt wird vorher zur Seite gelegt."
read -r -p "Fortfahren? [j/N] " answer
case "$answer" in
    [jJyY]) ;;
    *) echo "Abgebrochen."; exit 0 ;;
esac

# Den Server anhalten, damit niemand waehrend des Zurueckspielens schreibt
if command -v pm2 > /dev/null && pm2 describe handball-tracker > /dev/null 2>&1; then
    echo "Stoppe handball-tracker ..."
    pm2 stop handball-tracker
    restart_needed=1
fi

# Aktuellen Stand nicht loeschen, sondern beiseite schieben
if [ -d "$DATA_DIR" ]; then
    aside="${DATA_DIR}.vor-restore_$(date +%Y-%m-%d_%H%M)"
    mv "$DATA_DIR" "$aside"
    echo "Bisheriger Stand liegt jetzt unter: $aside"
fi

mkdir -p "$(dirname "$DATA_DIR")"
tar -xzf "$archive" -C "$(dirname "$DATA_DIR")"
echo "Backup eingespielt."

if [ "${restart_needed:-0}" = "1" ]; then
    pm2 start handball-tracker
    echo "handball-tracker laeuft wieder."
fi

echo ""
echo "Hinweis: Auf den Geraeten liegt der zuletzt getrackte Stand weiterhin"
echo "im Browser-Speicher. Hat ein Handy eine hoehere Revisionsnummer als der"
echo "zurueckgespielte Server-Stand, gewinnt beim naechsten Oeffnen automatisch"
echo "das Handy - der Server holt sich den neueren Stand also von selbst."
