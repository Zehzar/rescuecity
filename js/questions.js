// ============================================================
// RescueCity – Quizfragen
// Neue Frage hinzufügen: einfach einen Block kopieren und anpassen.
//   frage:     der Fragetext
//   antworten: genau 4 Antwortmöglichkeiten
//   richtig:   Nummer der richtigen Antwort (0 = erste, 1 = zweite, 2 = dritte, 3 = vierte)
//   kategorie: frei wählbar, wird im Quiz angezeigt
// Die Reihenfolge der Antworten wird im Spiel automatisch gemischt.
// Die folgenden Fragen sind Beispiele – ersetze oder ergänze sie nach Belieben.
// ============================================================

const FRAGEN = [
  {
    frage: "Welche Notrufnummer gilt EU-weit für Rettungsdienst und Feuerwehr?",
    antworten: ["110", "112", "116 117", "19222"],
    richtig: 1,
    kategorie: "Einsatztaktik & Kommunikation",
  },
  {
    frage: "Wofür steht die Abkürzung RTW?",
    antworten: ["Rettungstransportwagen", "Rettungswagen", "Regionaler Transportwagen", "Rettungstechnischer Wagen"],
    richtig: 1,
    kategorie: "Einsatztaktik & Kommunikation",
  },
  {
    frage: "Welches Verhältnis von Herzdruckmassage zu Beatmung gilt bei der Reanimation Erwachsener?",
    antworten: ["15:2", "30:2", "5:1", "30:1"],
    richtig: 1,
    kategorie: "Notfallmedizin",
  },
  {
    frage: "Mit welcher Frequenz sollen Thoraxkompressionen bei Erwachsenen erfolgen?",
    antworten: ["60–80 pro Minute", "80–100 pro Minute", "100–120 pro Minute", "120–140 pro Minute"],
    richtig: 2,
    kategorie: "Notfallmedizin",
  },
  {
    frage: "Wie tief soll der Brustkorb bei Erwachsenen während der Herzdruckmassage eingedrückt werden?",
    antworten: ["2–3 cm", "3–4 cm", "5–6 cm", "8–10 cm"],
    richtig: 2,
    kategorie: "Notfallmedizin",
  },
  {
    frage: "Welchen Höchstwert kann die Glasgow Coma Scale (GCS) erreichen?",
    antworten: ["10", "12", "15", "20"],
    richtig: 2,
    kategorie: "Notfallmedizin",
  },
  {
    frage: "Wofür steht das „A“ im ABCDE-Schema?",
    antworten: ["Airway (Atemweg)", "Atmung", "Allgemeinzustand", "Anamnese"],
    richtig: 0,
    kategorie: "Notfallmedizin",
  },
  {
    frage: "Wofür steht der FAST-Test?",
    antworten: ["Herzinfarkt", "Schlaganfall", "Unterzuckerung", "Lungenembolie"],
    richtig: 1,
    kategorie: "Notfallmedizin",
  },
  {
    frage: "Welche Atemfrequenz ist bei einem gesunden Erwachsenen in Ruhe normal?",
    antworten: ["4–8 pro Minute", "12–20 pro Minute", "25–35 pro Minute", "40–50 pro Minute"],
    richtig: 1,
    kategorie: "Physiologie",
  },
  {
    frage: "In welche Lage bringt man eine bewusstlose Person mit normaler Atmung?",
    antworten: ["Schocklage", "Oberkörperhochlagerung", "Stabile Seitenlage", "Flache Rückenlage"],
    richtig: 2,
    kategorie: "Notfallmedizin",
  },
  {
    frage: "Wofür steht die Abkürzung NEF?",
    antworten: ["Notfall-Einsatzfahrzeug", "Notarzteinsatzfahrzeug", "Notarzt-Erstversorgungsfahrzeug", "Nächstes Einsatzfahrzeug"],
    richtig: 1,
    kategorie: "Einsatztaktik & Kommunikation",
  },
  {
    frage: "Welche Telefonnummer hat der ärztliche Bereitschaftsdienst in Deutschland?",
    antworten: ["112", "110", "116 117", "115"],
    richtig: 2,
    kategorie: "Einsatztaktik & Kommunikation",
  },
];
