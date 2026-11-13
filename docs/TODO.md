# Offene Punkte

Stand 13.11.2026. Reihenfolge = Vorschlag fuer die naechsten Sitzungen.

## Naechste Sitzung: alle Nebenansichten vereinheitlichen

Julian: "Kader, Ticker usw. sehen haesslich und ueberladen aus. Schlechte
Bedienung. Anschauen und alles vereinheitlichen."

Betroffen (alle noch im alten Look, mit Emojis und Browser-Rueckfragen):
- Kader / Spielerverwaltung (Spieler anlegen, Avatar, Team speichern/laden)
- Ticker-Einstellungen (10+ Schalter, Regeln je Spieler, Vorschau)
- Statistik, Spielbericht, Verlauf, Archiv

Vorgehen wie bei der Feldansicht:
1. Jede Ansicht durchgehen: was braucht man in der Halle wirklich, was nur
   einmal im Jahr? Selten Gebrauchtes hinter "Mehr" oder weg.
2. Ein gemeinsamer Aufbau fuer alle: Vollbild-Ansicht mit Kopfzeile
   (Zurueck, Titel, hoechstens eine Aktion), Karten, die Bausteine aus
   style.css Abschnitt 20/21. Keine Inline-Styles, keine Emojis.
3. Restliche confirm()/prompt()/alert() durch die App-eigenen Blaetter
   ersetzen (ui.js, stats.js, app.js).
4. Layouttest (test/layout/feld.layout.js) auf diese Ansichten ausweiten,
   alle zehn Bildschirmgroessen.

## Danach
- Ticker auf Supabase (Edge Function mit lib/ticker.js), dann Gateway
  (HANDOVER.md Schritte 4 und 5). Spielablauf-Marken (Anpfiff, Halbzeit,
  Abpfiff, Auszeit) als Ticker-Ereignisse nutzen.
- Auszeiten im Archiv/Spielbericht behalten (heute mit dem Spiel geloescht).
- Testkonten in Supabase entfernen (test_a, test_b, Probe-Konto,
  Import-Probe), sobald die Vertragstests eigene Wegwerfkonten anlegen.
- Datensicherung fuer Supabase (Free-Plan hat keine Backups).
- CNAME tracker.langschwerts.de beim Domain-Admin anfragen.
- Pi: nach einem echten Spiel auf Supabase ngrok und handball-tracker
  abschalten (pm2 delete ... && pm2 save).
