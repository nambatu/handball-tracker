# Aufgabenliste

Gepflegt von Julian und vom taeglichen Bau-Agenten. Stand 13.11.2026.

**Regeln fuer den Agenten:** jeden Tag genau EINE Aufgabe, die oberste offene
`[ ]` ohne Markierung `(Julian)`. Vor dem Start auf `[~]` setzen, nach dem
Testen auf `[x]` mit Datum und Branch. Was groesser ist als eine Sitzung,
wird zuerst in Teilaufgaben zerlegt (das ist dann die Aufgabe des Tages).
Eigene Ideen kommen unter "Ideen (ungeprueft)", nie direkt nach oben.

Legende: `[ ]` offen · `[~]` in Arbeit · `[x]` erledigt · `(Julian)` braucht
Julian (Zugang, Entscheidung, Geraet) · Groesse S/M/L.

## 1. Nebenansichten vereinheitlichen (Julian: "haesslich und ueberladen")

Gemeinsamer Aufbau fuer alle: Vollbild-Ansicht, Kopfzeile mit Zurueck, Titel
und hoechstens einer Aktion; Karten und Bausteine aus `style.css` Abschnitt
20/21; keine Inline-Styles, keine Emojis, keine `confirm/prompt/alert`.
Jede Ansicht bekommt Pruefungen im Layouttest (alle zehn Groessen).

- [ ] 1.1 Baukasten: gemeinsame Vollbild-Ansicht + Bestaetigungsblatt als
      wiederverwendbare Funktion (`ui.js`), Verlauf als erste Ansicht darauf
      umgestellt. (M)
- [ ] 1.2 Kader / Spielerverwaltung: Spieler anlegen/bearbeiten in einem
      Blatt, Mannschaft speichern/laden ohne Farbknoepfe, Avatar-Upload. (M)
- [ ] 1.3 Archiv: Liste als Karten (Name, Datum, Ergebnis), Umbenennen und
      Loeschen ueber Blaetter statt `prompt/confirm`. (S)
- [ ] 1.4 Statistik: auf dem Handy lesbar (keine breite Tabelle; Karten je
      Spieler oder Tabelle mit fester erster Spalte). (M)
- [ ] 1.5 Spielbericht: Bildschirm-Ansicht vereinheitlichen, Druckansicht
      unveraendert lassen. (M)
- [ ] 1.6 Ticker-Einstellungen: nur "an/aus, Gruppe, welche Ereignisse";
      Vorlagen und Regeln je Spieler hinter "Erweitert". (M)
- [ ] 1.7 Letzte `confirm/prompt/alert` entfernen (`app.js` Abmelden mit
      ungesicherten Daten, Rest in `ui.js`/`stats.js`). (S)

## 2. Spiel und Feld

- [ ] 2.1 Auszeiten mit ins Archiv und in den Spielbericht (heute mit dem
      Spiel geloescht). (S)
- [ ] 2.2 Aufraeumen: `UI.vergissUhrWahl` und der veraltete Aufruf in
      `start.js`; Kommentare zum alten "ohne Uhr"-Ablauf. (S)
- [ ] 2.3 Rueckmeldung beim Erfassen: kurze Vibration (`navigator.vibrate`,
      abschaltbar) und kurzes Aufleuchten des Spielers. (S)
- [ ] 2.4 Torwart-Wechsel waehrend des Spiels in einem Tipp (heute nur per
      Ziehen); Hinweis, wenn kein Torwart auf dem Feld steht. (S)
- [ ] 2.5 Offline-Start nach den Umbauten automatisch pruefen: Seite laden,
      Netz aus, neu laden, Spiel muss erscheinen (Playwright, im Layouttest). (S)

## 3. Betrieb und Sicherheit

- [ ] 3.1 Vertragstests legen eigene Wegwerfkonten an und loeschen sie
      danach; danach Testkonten test_a, test_b, Probe-Konto, Import-Probe
      entfernen. (M) (Julian: einmal SQL im Dashboard bestaetigen)
- [ ] 3.2 Datensicherung: GitHub Action, die einmal pro Nacht alle Tabellen
      als JSON exportiert und als Artefakt (30 Tage) ablegt. (M)
      (Julian: Service-Key als Repository-Secret hinterlegen)
- [ ] 3.3 Tests in GitHub Actions bei jedem Push nach main (Layouttest +
      Vertragstests). (M) (Julian: Testkonto-Zugang als Secrets)
- [ ] 3.4 Supabase-Hinweise (Advisors) pruefen und abarbeiten, Ergebnis als
      Migration. (S)
- [ ] 3.6 Update-Test fuer den Service Worker in die Tests aufnehmen: alte
      Fassung laden, neue ausliefern, EIN Neuladen muss nur neue Dateien
      zeigen (Fehler vom 13.11.: weisser Bildschirm am Handy). (S)
- [ ] 3.5 Avatar-Bilder, die in keinem Spielstand, Team oder Archiv mehr
      vorkommen, regelmaessig loeschen (Speicherplatz Free-Plan). (S)

## 4. Ticker auf Supabase (HANDOVER.md Schritte 4 und 5)

- [ ] 4.1 Plan in Teilaufgaben: Edge Function mit `lib/ticker.js`, Tabellen
      `ticker_config`, `ticker_merk`, `ticker_outbox` mit fortlaufender `seq`,
      Ticker-Einstellungen in der App, Spielablauf-Marken (Anpfiff, Halbzeit,
      Abpfiff, Auszeit) als Ticker-Ereignisse. Nur planen, als Liste hier
      eintragen. (S)
- [ ] 4.2 Gateway (`nambatu/wa-gateway`) auf die neue Quelle umstellen,
      gespeicherte Position zuruecksetzen, Testnachricht in eine Testgruppe.
      (L) (Julian: Pi, Testgruppe)

## Nur Julian

- [ ] (Julian) Spieldaten vom Pi uebernehmen: `scripts/supabase_import.md`.
- [ ] (Julian) CNAME `tracker.langschwerts.de` → `nambatu.github.io` beim
      Domain-Admin anfragen; danach Datei `public/CNAME`.
- [ ] (Julian) Ein echtes Spiel mit der neuen App tracken, danach ngrok und
      `handball-tracker` auf dem Pi abschalten (`pm2 delete ... && pm2 save`).
- [ ] (Julian) Auf dem eigenen Handy testen: Ziehen von der Bank, Auszeit-
      Countdown bei gesperrtem Bildschirm, iPhone-Notch.

## Ideen (ungeprueft, erst nach Ruecksprache mit Julian nach oben)

- Spielbericht als Bild/PDF direkt per Teilen-Knopf (`navigator.share`) in
  WhatsApp schicken.
- Heller Modus mit hohem Kontrast fuer helle Hallen.
- Zweites Geraet als reine Anzeige (Spielstand und Uhr gross, z. B. Tablet
  auf der Bank).
- Torwart-Statistik je Wurfposition (Paraden-Quote links/rechts/7m).
- Saison-Statistik ueber alle archivierten Spiele je Spieler.
- App-Symbol und Startbildschirm an die neuen Farben anpassen.
- handball.net-Scraper ueber das Gateway (HANDOVER.md offene Entscheidung 4).

## Erledigt

- [x] 13.11. Umzug auf GitHub Pages + Supabase (Konten, Spielstand, Archive,
      Mannschaften, Avatare), Konten vom Pi uebernommen.
- [x] 13.11. Redesign: Startseite, Feldansicht als einzige Spielansicht,
      Layouttest fuer zehn Bildschirmgroessen.
- [x] 13.11. Spielablauf mit einer Haupttaste, Auszeit, 2-Minuten sperren
      Spieler und Feldplatz, Erfassen nur bei laufender Uhr.
- [x] 13.11. Passwort-Hashes aus der Git-Historie entfernt.
