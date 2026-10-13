// ============================================================
// RescueCity – Spielkonfiguration
// Hier kannst du alle Zahlen anpassen, ohne den Spielcode zu ändern.
// ============================================================

const CONFIG = {
  // Startguthaben für neue Spieler
  startGeld: 5000,

  // Zeitfaktor zum Testen: 1 = echte Zeit, 60 = eine Stunde dauert eine Minute
  zeitFaktor: 1,

  // Kartenstart (Mitte von Deutschland)
  karte: {
    start: [51.1657, 10.4515],
    zoom: 6,
    // Optional: kostenloser API-Key von https://www.maptiler.com (Account > API keys).
    // Ist ein Key eingetragen, nutzt das Spiel MapTiler, sonst die normale OpenStreetMap-Karte.
    mapTilerKey: "OXtuwZ4pgnPLSmR4bCly",
    mapTilerUrl: "https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key={key}",
    mapTilerAttribution:
      '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    osmUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    // Krankenhäuser (aus js/krankenhaeuser.js) erscheinen ab dieser Zoomstufe auf der Karte
    krankenhausAbZoom: 10,
    osmAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
  },

  // Einsatzdauern: je kürzer, desto mehr Geld pro Minute.
  // proMinute = Geld pro Minute, xpProMinute = Punkte für die Bestenliste pro Minute
  einsatzDauern: [
    { key: "15m", name: "15 Minuten", minuten: 15,  proMinute: 10,  xpProMinute: 2.0 },
    { key: "30m", name: "30 Minuten", minuten: 30,  proMinute: 8,   xpProMinute: 1.6 },
    { key: "1h",  name: "1 Stunde",   minuten: 60,  proMinute: 6,   xpProMinute: 1.2 },
    { key: "4h",  name: "4 Stunden",  minuten: 240, proMinute: 4,   xpProMinute: 0.8 },
    { key: "8h",  name: "8 Stunden",  minuten: 480, proMinute: 3,   xpProMinute: 0.6 },
    { key: "12h", name: "12 Stunden", minuten: 720, proMinute: 2.5, xpProMinute: 0.5 },
  ],

  // Ablauf eines Einsatzes (Anteile der Gesamtdauer, zusammen 1.0)
  // Status 3 = Anfahrt, Status 4 = am Einsatzort, Status 1 = Rückfahrt, danach Status 2 auf der Wache
  einsatzPhasen: { anfahrt: 0.4, vorOrt: 0.2, rueckfahrt: 0.4 },

  // Ablauf mit Transport ins Krankenhaus: Status 3, 4, dann Status 7 = Transport, Status 8 = am Krankenhaus, Status 1
  einsatzPhasenTransport: { anfahrt: 0.4, vorOrt: 0.1, transport: 0.2, amKrankenhaus: 0.05, rueckfahrt: 0.25 },

  // Wie oft ein Fahrzeugtyp den Patienten ins Krankenhaus bringt (0 bis 1) und Aufschlag auf Geld und Punkte.
  // Online gelten die Werte aus der Supabase-Tabelle regeln.
  transport: {
    chance: { KTW: 1, RTW: 0.7, NEF: 0, ITW: 1 },
    bonus: 0.2,
  },

  // Durchschnittsgeschwindigkeit der Fahrzeuge in km/h.
  // Der Einsatzort liegt so weit weg, wie das Fahrzeug in der Anfahrtszeit fährt
  // (zufällige Richtung, ±10 %). Beispiel bei 60 km/h: 15 min → ca. 6 km, 12 h → ca. 290 km.
  fahrgeschwindigkeitKmh: 60,

  // Straßen-Routing über OpenRouteService (https://openrouteservice.org, kostenloser Key).
  // Ohne Key fahren die Fahrzeuge Luftlinie.
  routing: {
    orsKey: "",
    // Online (mit Supabase) fragt das Spiel die Server-Funktion "route", dort liegt der Key geheim.
    // orsKey wird dann nicht gebraucht und sollte leer bleiben, weil diese Datei öffentlich ist.
    ueberServer: true,
    profil: "driving-car",
    // Straßen sind länger als die Luftlinie. Der Einsatzort wird um diesen Faktor näher gesetzt,
    // damit die Fahrstrecke trotzdem ungefähr zur Anfahrtszeit passt.
    umwegFaktor: 1.3,
    // Lange Routen werden auf so viele Punkte reduziert, damit der Spielstand klein bleibt
    maxPunkte: 400,
  },

  // Online-Konten über Supabase. Beide Werte dürfen öffentlich im Browser stehen.
  // Leer lassen = Spiel läuft wie bisher nur lokal auf diesem Gerät.
  online: {
    supabaseUrl: "https://ckikxxioyjkodwgveowz.supabase.co",
    supabaseKey: "sb_publishable_IxhTAHuOVAMbS5ZcrNRyMw_1Y0tgCV7",
  },

  // Rettungswache
  wache: {
    baukosten: 2000,
    ersteWacheKostenlos: true,
    // Index = Level - 1
    level: [
      { level: 1, stellplaetze: 2,  upgradeKosten: 3000 },
      { level: 2, stellplaetze: 4,  upgradeKosten: 7500 },
      { level: 3, stellplaetze: 6,  upgradeKosten: 15000 },
      { level: 4, stellplaetze: 8,  upgradeKosten: 30000 },
      { level: 5, stellplaetze: 10, upgradeKosten: null }, // Maximallevel
    ],
  },

  // Fahrzeugtypen. abWacheLevel = ab welchem Wachen-Level kaufbar.
  // faktor = Multiplikator auf Geld und Punkte eines Einsatzes
  fahrzeuge: [
    { typ: "KTW", name: "Krankentransportwagen",     preis: 1500,  abWacheLevel: 1, faktor: 0.8, farbe: "#2b7bd6" },
    { typ: "RTW", name: "Rettungswagen",             preis: 3000,  abWacheLevel: 1, faktor: 1.0, farbe: "#d62b2b" },
    { typ: "NEF", name: "Notarzteinsatzfahrzeug",    preis: 6000,  abWacheLevel: 3, faktor: 1.4, farbe: "#e08a00" },
    { typ: "ITW", name: "Intensivtransportwagen",    preis: 12000, abWacheLevel: 5, faktor: 1.8, farbe: "#7a2bd6" },
  ],

  // Einsatzstichworte (nur zur Anzeige)
  stichworte: {
    KTW: ["Krankentransport", "Dialysefahrt", "Verlegung", "Entlassung nach Hause", "Reha-Transport"],
    RTW: ["Verkehrsunfall", "Atemnot", "Sturz", "Bewusstlose Person", "Brustschmerz", "Allergische Reaktion"],
    NEF: ["Reanimation", "Polytrauma", "Schlaganfall", "Herzinfarkt", "Kindernotfall"],
    ITW: ["Intensivverlegung", "Beatmeter Patient", "ECMO-Transport", "Verlegung Uniklinik"],
  },

  // Quiz
  quiz: {
    fragenProRunde: 10,
    geldProRichtig: 50,
    xpProRichtig: 25,
  },

  // Tägliche Belohnung fürs Einloggen. Eintrag 1 = Tag 1 der Serie, Eintrag 7 = Tag 7,
  // danach beginnt die Woche von vorn. Wer einen Tag auslässt, startet wieder bei Tag 1.
  taeglich: {
    geld: [250, 350, 500, 650, 800, 1000, 2000],
    xp: [10, 15, 20, 25, 30, 40, 100],
  },

  // Erfolge: wert = welche Zahl zählt, ziel = ab wann freigeschaltet, geld/xp = einmalige Belohnung.
  // Online gelten die Werte aus der Supabase-Tabelle regeln (Eintrag "erfolge").
  erfolge: [
    {key: "erste_wache", name: "Grundstein", text: "Baue deine erste Rettungswache", symbol: "🏠", wert: "wachen", ziel: 1, geld: 250, xp: 25},
    {key: "wachen_3", name: "Rettungsdienstbereich", text: "Besitze 3 Rettungswachen", symbol: "🗺️", wert: "wachen", ziel: 3, geld: 1500, xp: 100},
    {key: "wachen_10", name: "Kreisleitstelle", text: "Besitze 10 Rettungswachen", symbol: "🏢", wert: "wachen", ziel: 10, geld: 10000, xp: 500},
    {key: "wache_lvl3", name: "Ausgebaut", text: "Baue eine Wache auf Level 3 aus", symbol: "🔧", wert: "wacheLevel", ziel: 3, geld: 1500, xp: 100},
    {key: "wache_lvl5", name: "Lehrrettungswache", text: "Baue eine Wache auf Level 5 aus", symbol: "🏆", wert: "wacheLevel", ziel: 5, geld: 6000, xp: 300},
    {key: "fahrzeuge_5", name: "Fuhrpark", text: "Besitze 5 Fahrzeuge", symbol: "🚑", wert: "fahrzeuge", ziel: 5, geld: 1500, xp: 100},
    {key: "fahrzeuge_20", name: "Großer Fuhrpark", text: "Besitze 20 Fahrzeuge", symbol: "🚒", wert: "fahrzeuge", ziel: 20, geld: 8000, xp: 400},
    {key: "einsatz_1", name: "Erster Einsatz", text: "Schließe deinen ersten Einsatz ab", symbol: "🚨", wert: "einsaetze", ziel: 1, geld: 250, xp: 25},
    {key: "einsatz_10", name: "Eingespielt", text: "Schließe 10 Einsätze ab", symbol: "⏱️", wert: "einsaetze", ziel: 10, geld: 750, xp: 50},
    {key: "einsatz_100", name: "Routinier", text: "Schließe 100 Einsätze ab", symbol: "🎖️", wert: "einsaetze", ziel: 100, geld: 4000, xp: 250},
    {key: "einsatz_1000", name: "Legende der Leitstelle", text: "Schließe 1.000 Einsätze ab", symbol: "👑", wert: "einsaetze", ziel: 1000, geld: 25000, xp: 1500},
    {key: "transport_10", name: "Patientenbringer", text: "Bringe 10 Patienten ins Krankenhaus", symbol: "🏥", wert: "transporte", ziel: 10, geld: 1000, xp: 75},
    {key: "transport_100", name: "Klinik-Stammgast", text: "Bringe 100 Patienten ins Krankenhaus", symbol: "💉", wert: "transporte", ziel: 100, geld: 6000, xp: 300},
    {key: "quiz_10", name: "Wissbegierig", text: "Beantworte 10 Quizfragen richtig", symbol: "📘", wert: "quizRichtig", ziel: 10, geld: 500, xp: 50},
    {key: "quiz_100", name: "Wandelndes Lehrbuch", text: "Beantworte 100 Quizfragen richtig", symbol: "🎓", wert: "quizRichtig", ziel: 100, geld: 4000, xp: 250},
    {key: "quiz_folge_10", name: "Fehlerfrei", text: "Beantworte 10 Quizfragen in Folge richtig", symbol: "🎯", wert: "quizFolge", ziel: 10, geld: 1500, xp: 100},
    {key: "serie_7", name: "Eine Woche dabei", text: "Hol dir 7 Tage am Stück die tägliche Belohnung", symbol: "📅", wert: "serie", ziel: 7, geld: 1500, xp: 100},
    {key: "serie_30", name: "Treue Seele", text: "Hol dir 30 Tage am Stück die tägliche Belohnung", symbol: "❤️", wert: "serie", ziel: 30, geld: 10000, xp: 500},
    {key: "punkte_8100", name: "Aufsteiger", text: "Erreiche Spieler-Level 10", symbol: "⭐", wert: "xp", ziel: 8100, geld: 3000, xp: 0},
    {key: "punkte_57600", name: "Ass im Rettungsdienst", text: "Erreiche Spieler-Level 25", symbol: "🌟", wert: "xp", ziel: 57600, geld: 15000, xp: 0},
  ],

  // Spieler-Level: Punkte, die für Level n insgesamt nötig sind = basis * (n-1)^2
  spielerLevelBasis: 100,
};
