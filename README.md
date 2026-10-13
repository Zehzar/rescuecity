# RescueCity – Prototyp

## Starten
Doppelklick auf **`START.bat`**. Es öffnet sich ein kleines schwarzes Fenster und danach das Spiel im Browser unter http://localhost:8080. Das Fenster offen lassen, solange du spielst.
Der Umweg ist nötig, weil OpenStreetMap keine Kartenbilder an Seiten liefert, die direkt als Datei geöffnet werden.
Alternativ: kostenlosen API-Key bei maptiler.com holen und in `js/config.js` bei `mapTilerKey` eintragen, dann klappt auch der Doppelklick auf `index.html`.
Der Spielstand wird automatisch im Browser gespeichert.

## Was schon funktioniert
- **Leitstelle** (rot): Karte auf Basis von OpenStreetMap. Wachen per Klick bauen (erste kostenlos), bis Level 5 ausbauen, je Level mehr Stellplätze.
- **Fahrzeuge**: KTW, RTW, NEF (ab Wachen-Level 3), ITW (ab Level 5). Losschicken für 15 min, 30 min, 1 h, 4 h, 8 h oder 12 h. Kurze Einsätze bringen mehr pro Minute. Einsätze laufen weiter, wenn das Spiel geschlossen ist.
- **Wissensquiz** (blau): Runden mit 10 Fragen, je 4 Antworten, Geld und Punkte pro richtiger Antwort.
- **Bestenliste** (gold) mit Level-System: Alle Punkte aus Einsätzen und Quiz zählen. Momentan zeigt sie alle Spieler auf diesem Gerät (Spieler wechseln: Klick auf den Namen oben rechts).

## Anpassen
- `js/questions.js` – Quizfragen ergänzen (Block kopieren, Text ändern, `richtig` = Nummer der richtigen Antwort, ab 0 gezählt).
- `js/config.js` – alle Zahlen: Startgeld, Geld pro Minute je Einsatzdauer, Fahrzeugpreise, Ausbaukosten, Quiz-Belohnung.
  Zum Testen `zeitFaktor: 60` setzen, dann dauert eine Stunde nur eine Minute.

## Dateien
- `index.html` – Seite
- `css/style.css` – Aussehen
- `js/game.js` – Spiellogik
- `vendor/leaflet/` – Kartenbibliothek (Leaflet 1.9.4, BSD-Lizenz)

## Online-Konten (Supabase)
- Spieler registrieren sich mit Benutzername, E-Mail und Passwort. Spielstand und Bestenliste liegen online, also auf jedem Gerät gleich.
- Schutz gegen Schummeln: Der Server rechnet Geld, Punkte, Einsatzzeiten und Quizantworten selbst aus. Jede Quizfrage bringt nur einmal pro 24 Stunden Punkte.
- Im Online-Modus gelten die Zahlen aus der Supabase-Tabelle **regeln** (Spalte `daten`) statt aus `js/config.js`.
- Quizfragen stehen online in der Tabelle **fragen** (Table Editor → Insert row; `antworten` = Liste mit 4 Texten, `richtig` = 0 bis 3). `js/questions.js` gilt nur noch im lokalen Modus.
- Kategorien ergeben sich aus der Spalte `kategorie` der Fragen. Eine neue Kategorie entsteht einfach, indem du bei einer Frage einen neuen Namen einträgst. Das Symbol dazu steht in `js/config.js` unter `quiz.kategorieSymbole` (sonst 📚). Vorhanden: Physiologie, Pathophysiologie, Notfallmedizin, Traumatologie, Pharmakologie, Recht, Qualitätsmanagement, Hygiene, Einsatztaktik & Kommunikation, Medizinprodukte.
- Zugangsdaten stehen in `js/config.js` unter `online`. Leer lassen = Spiel läuft nur lokal.
- Datenbank einrichten oder aktualisieren: Inhalt von `supabase/setup.sql` im Supabase SQL-Editor ausführen (kann wiederholt werden).
- In Supabase unter Authentication → URL Configuration: Site URL `http://localhost:8080` (später die echte Web-Adresse).

## Tägliche Belohnung
- Einmal pro Tag (deutsche Zeit) gibt es über das 🎁 oben eine Belohnung. Jeder weitere Tag am Stück bringt mehr, Tag 7 ist der große Bonus, danach beginnt die Woche von vorn. Wer einen Tag auslässt, startet wieder bei Tag 1.
- Die Beträge stehen online in der Tabelle **regeln** unter `taeglich` (`geld` und `xp`, je 7 Zahlen), lokal in `js/config.js`.

## Krankenhäuser und Transporte
- Echte Krankenhäuser (aus Wikidata, gefiltert ohne Reha, Psychiatrie und historische Gebäude) stehen in `js/krankenhaeuser.js` und erscheinen als blaues **H** auf der Karte, sobald man hineinzoomt.
- Bei einem Transport fährt das Fahrzeug Status 3 → 4 → **7** (Patient aufgenommen, Transport) → **8** (am Krankenhaus) → 1 → 2. Die Gesamtdauer bleibt gleich, ein Transport bringt mehr Geld und Punkte.
- Wie oft welcher Fahrzeugtyp transportiert und wie groß der Aufschlag ist, steht online in der Tabelle **regeln** unter `transport` (`chance` von 0 bis 1 je Typ, `bonus` 0.2 = +20 %), lokal in `js/config.js`.
- Liste aktualisieren: `tools/krankenhaeuser-laden.html` öffnen und auf den Knopf klicken (fragt Wikidata, sonst OpenStreetMap). Die heruntergeladene Datei ersetzt `js/krankenhaeuser.js`.

## Erfolge
- 20 Erfolge (🏅 oben), z. B. erste Wache, 100 Einsätze, 10 Quizfragen in Folge richtig oder 7 Tage Serie. Jeder bringt einmalig Geld und Punkte.
- Online prüft und belohnt der Server. Die Liste steht in der Tabelle **regeln** unter `erfolge` (`wert` = welche Zahl zählt, `ziel`, `geld`, `xp`). Mögliche Werte: einsaetze, transporte, quizRichtig, quizFolge, serie, xp, wachen, wacheLevel, fahrzeuge.

## Online-Version
- Das Spiel läuft unter https://rescuecity.netlify.app. Netlify holt sich jede Änderung auf GitHub (Zweig `main`) automatisch und stellt sie nach etwa einer Minute online.
- `impressum.html` und `datenschutz.html` sind unten im Spiel und im Anmeldefenster verlinkt. Wenn neue Dienste dazukommen (z. B. ein eigener Mail-Anbieter), muss die Datenschutzerklärung ergänzt werden.
