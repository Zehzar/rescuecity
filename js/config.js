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

  // Spieler-Level: Punkte, die für Level n insgesamt nötig sind = basis * (n-1)^2
  spielerLevelBasis: 100,
};
