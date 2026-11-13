# Spieldaten vom Pi nach Supabase übernehmen

Einmalig. Kopiert Spielstand, Mannschaften, archivierte Spiele und Avatare aller Nutzer
vom Pi nach Supabase. Die Konten müssen dort schon angelegt sein.

## 1. Schlüssel holen

Im Browser öffnen: https://supabase.com/dashboard/project/pbkasfptpfzmkhhsyzgr/settings/api-keys

Dort den Schlüssel `service_role` bzw. "secret" anzeigen und kopieren
(nicht den `anon`/"publishable"). Er ist ein Generalschlüssel: niemandem schicken,
nirgends abspeichern.

## 2. Auf dem Pi ausführen

Zeile für Zeile einfügen. Bei `read -rs` den Schlüssel einfügen (man sieht nichts, das ist
richtig) und Enter drücken. So steht er weder in einer Datei noch im Verlauf der Shell.

```
cd ~/handball-tracker && git pull --ff-only
read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY
node scripts/supabase_import.js --probe
node scripts/supabase_import.js --los
unset SUPABASE_SERVICE_ROLE_KEY
```

- `--probe` ist nur eine Vorschau: zeigt, was passieren würde, und schreibt nichts.
- `--los` überträgt wirklich.
- Liegen die Daten woanders als in der `.env` steht: `--data /pfad/zum/ordner` anhängen.

## 3. Was die Ausgabe bedeutet

- Pro Nutzer ein Block: Avatare, Spielstand, Mannschaften, Archive mit Zahlen.
- `schon da` = ist bereits in Supabase, wird nicht angefasst.
- `Spielstand übersprungen: in der neuen App wurde schon gespielt` = dort gibt es schon
  Aktionen, die bleiben unberührt.
- `nicht übernommen (kein Konto)` = Ordner auf dem Pi ohne Konto in Supabase. Es wurde nichts getan.
- `Hinweis:` = etwas wurde bewusst ausgelassen (zu große Datei, ungültiger Dateiname).
- `FEHLER` = etwas ging schief. Der Befehl endet dann mit einer Fehlermeldung.
  Einfach nochmal `--los` ausführen, er macht dort weiter.
- Unten steht eine Tabelle. Zahlen heißen "neu + schon da".

## 4. Gut zu wissen

- Beliebig oft wiederholbar. Beim zweiten Lauf steht: "Es war nichts Neues zu übertragen".
- Die Daten auf dem Pi werden nur gelesen, nie verändert oder gelöscht.
- Danach soll jeder Nutzer die neue App einmal öffnen und prüfen, ob Spielstand,
  Mannschaften und Archive da sind. (Der Browser hält eine eigene Kopie; die App führt beides zusammen.)
