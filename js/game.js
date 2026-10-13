// ============================================================
// RescueCity – Spiellogik
// ============================================================

const SPEICHER_KEY = "rescuecity_v1";

// ---------- Hilfsfunktionen ----------
const $ = (sel) => document.querySelector(sel);
const zahl = (n) => Math.round(n).toLocaleString("de-DE");
const id = () => Math.random().toString(36).slice(2, 10);
const zufall = (arr) => arr[Math.floor(Math.random() * arr.length)];
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function dauerText(ms) {
  if (ms <= 0) return "fertig";
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sek = s % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(sek).padStart(2, "0")} s`;
  return `${sek} s`;
}

const fahrzeugTyp = (typ) => CONFIG.fahrzeuge.find((f) => f.typ === typ);
const dauerInfo = (key) => CONFIG.einsatzDauern.find((d) => d.key === key);
const wacheLevelInfo = (lv) => CONFIG.wache.level[lv - 1];

// ---------- Speichern / Laden ----------
let speicher = { aktiv: null, profile: {} };

function laden() {
  try {
    const roh = localStorage.getItem(SPEICHER_KEY);
    if (roh) speicher = JSON.parse(roh);
  } catch (e) {
    console.warn("Spielstand konnte nicht geladen werden", e);
  }
  if (!speicher.profile) speicher.profile = {};
}

function speichern() {
  if (Online.aktiv) return; // online speichert der Server
  try {
    localStorage.setItem(SPEICHER_KEY, JSON.stringify(speicher));
  } catch (e) {
    console.warn("Spielstand konnte nicht gespeichert werden", e);
  }
}

const spieler = () => speicher.profile[speicher.aktiv];

// ---------- Online: der Server rechnet, der Browser zeigt an ----------
const zeitJetzt = () => Date.now() + (Online.aktiv ? Online.zeitVersatz() : 0);

function serverStandUebernehmen(antwort) {
  const alt = spieler();
  const lvAlt = alt ? levelAusXp(alt.xp) : null;
  speicher = { aktiv: antwort.stand.id, profile: { [antwort.stand.id]: antwort.stand } };
  (antwort.fertig || []).forEach((f) =>
    toast(`✅ ${esc(f.name)} (${esc(f.wache)}) ist zurück auf der Wache (Status 2): +💶 ${zahl(f.geld)} · +⭐ ${zahl(f.xp)}`)
  );
  const lvNeu = levelAusXp(antwort.stand.xp);
  if (lvAlt && lvNeu > lvAlt) toast(`🎉 Level ${lvNeu} erreicht!`);
  allesNeuZeichnen();
}

async function serverAktion(name, parameter) {
  try {
    const antwort = await Online.aktion(name, parameter);
    serverStandUebernehmen(antwort);
    return antwort;
  } catch (e) {
    toast(`⚠️ ${esc(e.message)}`);
    allesNeuZeichnen();
    return null;
  }
}

function leererSpielstand(name) {
  return {
    id: id(),
    name: name.trim().slice(0, 24) || "Spieler",
    geld: CONFIG.startGeld,
    xp: 0,
    stationen: [],
    stats: { einsaetze: 0, quizRichtig: 0, quizGesamt: 0, xpEinsaetze: 0, xpQuiz: 0 },
    erstellt: Date.now(),
  };
}

function neuesProfil(name) {
  const p = leererSpielstand(name);
  speicher.profile[p.id] = p;
  speicher.aktiv = p.id;
  speichern();
  return p;
}

// ---------- Spieler-Level ----------
function levelAusXp(xp) {
  return Math.floor(Math.sqrt(xp / CONFIG.spielerLevelBasis)) + 1;
}
function xpFuerLevel(lv) {
  return CONFIG.spielerLevelBasis * (lv - 1) * (lv - 1);
}

function punkteGeben(geld, xp, quelle) {
  const p = spieler();
  const levelVorher = levelAusXp(p.xp);
  p.geld += geld;
  p.xp += xp;
  if (quelle === "einsatz") p.stats.xpEinsaetze += xp;
  if (quelle === "quiz") p.stats.xpQuiz += xp;
  const levelNachher = levelAusXp(p.xp);
  if (levelNachher > levelVorher) toast(`🎉 Level ${levelNachher} erreicht!`);
}

// ---------- Kopfzeile ----------
function kopfAktualisieren() {
  const p = spieler();
  if (!p) return;
  $("#spielerName").textContent = p.name;
  $("#geld").textContent = zahl(p.geld);
  $("#punkte").textContent = zahl(p.xp);
  const lv = levelAusXp(p.xp);
  const von = xpFuerLevel(lv);
  const bis = xpFuerLevel(lv + 1);
  $("#spielerLevel").textContent = `Lv ${lv}`;
  $("#levelBalken").style.width = `${((p.xp - von) / (bis - von)) * 100}%`;
  $("#spielerLevel").parentElement.title = `${zahl(p.xp - von)} / ${zahl(bis - von)} Punkte bis Level ${lv + 1}`;
  bonusKnopfAktualisieren();
}

// ---------- Tägliche Belohnung ----------
// Ein Tag zählt nach deutscher Zeit. Online entscheidet der Server, hier wird nur angezeigt.
const heuteBerlin = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(zeitJetzt()));
function tagDavor(tag) {
  const d = new Date(tag + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Liefert { verfuegbar, serie }: serie = Tage am Stück, die bisher abgeholt wurden (0 = Serie gerissen)
function bonusLage(p) {
  const heute = heuteBerlin();
  let letzter, serie;
  if (Online.aktiv) {
    const b = p.bonus || {};
    letzter = b.abgeholt ? b.heute : b.serie > 0 ? tagDavor(b.heute) : null;
    serie = b.serie || 0;
  } else {
    const b = p.bonusLokal || {};
    letzter = b.tag;
    serie = b.serie || 0;
  }
  const abgeholt = letzter === heute;
  const laeuft = abgeholt || letzter === tagDavor(heute);
  return { verfuegbar: !abgeholt, serie: laeuft ? serie : 0 };
}

// Online erst, wenn die Datenbank die Belohnung kennt (setup.sql ausgeführt)
const bonusAktiv = (p) => !!(p && CONFIG.taeglich && (!Online.aktiv || p.bonus));

function bonusFuerTag(tagNr) {
  const t = CONFIG.taeglich;
  const i = (tagNr - 1) % t.geld.length;
  return { geld: t.geld[i], xp: t.xp[i] };
}

function bonusKnopfAktualisieren() {
  const p = spieler();
  const knopf = $("#bonusKnopf");
  if (!bonusAktiv(p)) return knopf.classList.add("versteckt");
  const lage = bonusLage(p);
  knopf.classList.remove("versteckt");
  knopf.classList.toggle("bereit", lage.verfuegbar);
  knopf.title = lage.verfuegbar ? "Tägliche Belohnung abholen!" : `Tägliche Belohnung: ${lage.serie} Tage am Stück`;
}

function bonusDialog(gerade) {
  const lage = bonusLage(spieler());
  const tagNr = lage.verfuegbar ? lage.serie + 1 : lage.serie; // der Tag, um den es heute geht
  const wochenStart = Math.floor((tagNr - 1) / CONFIG.taeglich.geld.length) * CONFIG.taeglich.geld.length;
  const kaestchen = CONFIG.taeglich.geld
    .map((_, i) => {
      const d = wochenStart + i + 1;
      const b = bonusFuerTag(d);
      const art = d < tagNr || (d === tagNr && !lage.verfuegbar) ? "erledigt" : d === tagNr ? "heute" : "";
      return `<div class="bonus-tag ${art}">
        <div class="klein">Tag ${d}</div>
        <div class="bonus-symbol">${art === "erledigt" ? "✅" : i === CONFIG.taeglich.geld.length - 1 ? "🏆" : "🎁"}</div>
        <div>💶 ${zahl(b.geld)}</div><div class="klein">⭐ ${zahl(b.xp)}</div>
      </div>`;
    })
    .join("");
  const text = lage.verfuegbar
    ? lage.serie
      ? `Du bist seit <b>${lage.serie} ${lage.serie === 1 ? "Tag" : "Tagen"}</b> am Stück dabei. Hol dir die Belohnung für Tag ${tagNr}!`
      : "Komm jeden Tag vorbei, dann steigt die Belohnung. Lässt du einen Tag aus, beginnt die Serie wieder bei Tag 1."
    : gerade
      ? `🎉 <b>+💶 ${zahl(gerade.geld)} · +⭐ ${zahl(gerade.xp)}</b> gutgeschrieben. Morgen gibt es die Belohnung für Tag ${tagNr + 1}.`
      : `Heute schon abgeholt. Morgen gibt es die Belohnung für Tag ${tagNr + 1}, wenn du wiederkommst.`;
  dialogZeigen(`
    <h2>🎁 Tägliche Belohnung</h2>
    <p>${text}</p>
    <div class="bonus-tage">${kaestchen}</div>
    <div class="knoepfe">
      <button class="btn" id="bonusZu">${lage.verfuegbar ? "Später" : "Schließen"}</button>
      ${lage.verfuegbar ? '<button class="btn primaer" id="bonusLos">Abholen</button>' : ""}
    </div>`);
  $("#bonusZu").onclick = dialogSchliessen;
  if (lage.verfuegbar) $("#bonusLos").onclick = bonusAbholen;
}

async function bonusAbholen() {
  $("#bonusLos").disabled = true;
  let b;
  if (Online.aktiv) {
    const antwort = await serverAktion("taegliche_belohnung");
    if (!antwort) return dialogSchliessen();
    b = antwort.belohnung;
  } else {
    const p = spieler();
    const lage = bonusLage(p);
    if (!lage.verfuegbar) return dialogSchliessen();
    b = { ...bonusFuerTag(lage.serie + 1), serie: lage.serie + 1 };
    punkteGeben(b.geld, b.xp, "bonus");
    p.bonusLokal = { tag: heuteBerlin(), serie: b.serie };
    speichern();
    allesNeuZeichnen();
  }
  toast(`🎁 Tägliche Belohnung (Tag ${b.serie}): +💶 ${zahl(b.geld)} · +⭐ ${zahl(b.xp)}`);
  bonusDialog(b);
}

// ---------- Toasts ----------
function toast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = text;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// ---------- Dialog ----------
function dialogZeigen(html) {
  $("#dialog").innerHTML = html;
  $("#dialogHg").classList.remove("versteckt");
  const input = $("#dialog input");
  if (input) input.focus();
}
function dialogSchliessen() {
  $("#dialogHg").classList.add("versteckt");
}

function profilDialog(pflicht) {
  const liste = Object.values(speicher.profile)
    .map((p) => `<button class="btn" data-profil="${p.id}">${esc(p.name)} · Lv ${levelAusXp(p.xp)} · ⭐ ${zahl(p.xp)}</button>`)
    .join("");
  dialogZeigen(`
    <h2>Willkommen bei RescueCity</h2>
    ${liste ? `<p class="klein">Mit vorhandenem Spieler weiterspielen:</p><div class="profil-liste">${liste}</div>` : ""}
    <p class="klein">Oder neuen Spieler anlegen:</p>
    <input id="neuerName" placeholder="Dein Name" maxlength="24">
    <div class="knoepfe">
      ${pflicht ? "" : '<button class="btn" id="dlgAbbrechen">Abbrechen</button>'}
      <button class="btn primaer" id="dlgNeu">Neuen Spieler starten</button>
    </div>`);
  const neu = () => {
    const name = $("#neuerName").value.trim();
    if (!name) return $("#neuerName").focus();
    neuesProfil(name);
    dialogSchliessen();
    allesNeuZeichnen();
    toast(`Willkommen, ${esc(spieler().name)}! Baue deine erste Rettungswache – sie ist kostenlos.`);
  };
  $("#dlgNeu").onclick = neu;
  $("#neuerName").onkeydown = (e) => {
    if (e.key === "Enter") neu();
  };
  if (!pflicht) $("#dlgAbbrechen").onclick = dialogSchliessen;
  document.querySelectorAll("[data-profil]").forEach((b) => {
    b.onclick = () => {
      speicher.aktiv = b.dataset.profil;
      speichern();
      dialogSchliessen();
      allesNeuZeichnen();
    };
  });
}

// ============================================================
// LEITSTELLE: Karte, Wachen, Fahrzeuge, Einsätze
// ============================================================
let karte;
let marker = {};
let bauModus = false;
let gewaehlteWache = null;

function karteStarten() {
  karte = L.map("karte").setView(CONFIG.karte.start, CONFIG.karte.zoom);
  const k = CONFIG.karte;
  const mitKey = k.mapTilerKey && k.mapTilerKey.trim();
  L.tileLayer(mitKey ? k.mapTilerUrl.replace("{key}", mitKey) : k.osmUrl, {
    attribution: mitKey ? k.mapTilerAttribution : k.osmAttribution,
    maxZoom: 19,
  }).addTo(karte);

  karte.on("click", (e) => {
    if (bauModus) wacheBauenDialog(e.latlng);
  });
  karte.on("moveend", krankenhaeuserZeichnen);
  krankenhaeuserZeichnen();

  $("#bauModusBtn").onclick = () => setBauModus(!bauModus);
  $("#bauAbbrechen").onclick = (e) => {
    e.preventDefault();
    setBauModus(false);
  };
}

// ---------- Krankenhäuser ----------
// KRANKENHAEUSER kommt aus js/krankenhaeuser.js: [[lat, lng, "Name"], ...] (Daten © OpenStreetMap-Mitwirkende)
const krankenhausListe = typeof KRANKENHAEUSER !== "undefined" ? KRANKENHAEUSER : [];
let krankenhausEbene = null;
const krankenhausIcon = L.divIcon({ className: "", html: '<div class="kh-marker">H</div>', iconSize: [18, 18], iconAnchor: [9, 9] });

function krankenhaeuserZeichnen() {
  if (!krankenhausEbene) krankenhausEbene = L.layerGroup().addTo(karte);
  krankenhausEbene.clearLayers();
  if (karte.getZoom() < CONFIG.karte.krankenhausAbZoom) return;
  const sicht = karte.getBounds().pad(0.2);
  krankenhausListe.forEach(([lat, lng, name]) => {
    if (!sicht.contains([lat, lng])) return;
    L.marker([lat, lng], { icon: krankenhausIcon, zIndexOffset: -200, keyboard: false })
      .bindTooltip(`🏥 ${esc(name)}`, { direction: "top", offset: [0, -8] })
      .addTo(krankenhausEbene);
  });
}

// Entfernung in km (für kurze und mittlere Strecken genau genug)
function kmZwischen(a, b) {
  const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) * Math.PI) / 360);
  const y = b.lat - a.lat;
  return Math.sqrt(x * x + y * y) * 111.2;
}

// Krankenhaus für einen Transport: so weit vom Einsatzort, wie das Fahrzeug in der Transportzeit fährt,
// und so weit von der Wache, wie es für die Rückfahrt passt
function krankenhausWaehlen(w, ziel, minuten) {
  if (!krankenhausListe.length) return null;
  const p = CONFIG.einsatzPhasenTransport;
  const kmProPhase = (anteil) => ((minuten * anteil) / 60) * CONFIG.fahrgeschwindigkeitKmh / CONFIG.routing.umwegFaktor;
  const hin = kmProPhase(p.transport);
  const zurueck = kmProPhase(p.rueckfahrt);
  let bestes = null;
  let besteWertung = Infinity;
  for (const [lat, lng, name] of krankenhausListe) {
    const kh = { lat, lng };
    const wertung = Math.abs(kmZwischen(ziel, kh) - hin) / hin + Math.abs(kmZwischen(kh, w) - zurueck) / zurueck;
    if (wertung < besteWertung) {
      besteWertung = wertung;
      bestes = { name, lat, lng };
    }
  }
  return bestes;
}

const transportChance = (typ) => (CONFIG.transport && CONFIG.transport.chance[typ]) || 0;

// Straßenrouten Einsatzort -> Krankenhaus -> Wache holen (null = Luftlinie)
async function transportRouten(w, e) {
  const holen = (a, b) => routeHolen(a, b).catch(() => null);
  const [routeKh, routeHeim] = await Promise.all([holen(e.ziel, e.kh), holen(e.kh, w)]);
  return { routeKh, routeHeim };
}

function setBauModus(an) {
  bauModus = an;
  $(".karte-wrap").classList.toggle("baumodus", an);
  $("#bauHinweis").classList.toggle("versteckt", !an);
  $("#bauModusBtn").textContent = an ? "Bau-Modus aktiv" : "＋ Wache bauen";
}

function wachenKosten() {
  const p = spieler();
  return CONFIG.wache.ersteWacheKostenlos && p.stationen.length === 0 ? 0 : CONFIG.wache.baukosten;
}

function wacheBauenDialog(latlng) {
  const kosten = wachenKosten();
  const p = spieler();
  const vorschlag = `Rettungswache ${p.stationen.length + 1}`;
  dialogZeigen(`
    <h2>Neue Rettungswache</h2>
    <p class="klein">Kosten: <b>${kosten === 0 ? "kostenlos" : "💶 " + zahl(kosten)}</b> · Level 1 mit ${wacheLevelInfo(1).stellplaetze} Stellplätzen</p>
    <input id="wachenName" value="${esc(vorschlag)}" maxlength="40">
    <div class="knoepfe">
      <button class="btn" id="dlgAbbrechen">Abbrechen</button>
      <button class="btn primaer" id="dlgBauen" ${p.geld < kosten ? "disabled" : ""}>Bauen</button>
    </div>
    ${p.geld < kosten ? '<p class="klein" style="color:var(--fehler)">Nicht genug Geld.</p>' : ""}`);
  $("#dlgAbbrechen").onclick = dialogSchliessen;
  const bauen = async () => {
    if (p.geld < kosten) return;
    if (Online.aktiv) {
      const name = $("#wachenName").value.trim().slice(0, 40) || vorschlag;
      dialogSchliessen();
      setBauModus(false);
      const a = await serverAktion("wache_bauen", { p_name: name, p_lat: latlng.lat, p_lng: latlng.lng });
      if (!a) return;
      const neu = a.stand.stationen[a.stand.stationen.length - 1];
      gewaehlteWache = neu.id;
      karte.setView([neu.lat, neu.lng], Math.max(karte.getZoom(), 12));
      allesNeuZeichnen();
      toast(`🏠 ${esc(neu.name)} wurde gebaut.`);
      return;
    }
    const w = {
      id: id(),
      name: $("#wachenName").value.trim().slice(0, 40) || vorschlag,
      lat: latlng.lat,
      lng: latlng.lng,
      level: 1,
      fahrzeuge: [],
    };
    p.geld -= kosten;
    p.stationen.push(w);
    speichern();
    dialogSchliessen();
    setBauModus(false);
    gewaehlteWache = w.id;
    karte.setView([w.lat, w.lng], Math.max(karte.getZoom(), 12));
    allesNeuZeichnen();
    toast(`🏠 ${esc(w.name)} wurde gebaut.`);
  };
  $("#dlgBauen").onclick = bauen;
  $("#wachenName").onkeydown = (e) => {
    if (e.key === "Enter") bauen();
  };
}

function markerZeichnen() {
  Object.values(marker).forEach((m) => m.remove());
  marker = {};
  const p = spieler();
  if (!p) return;
  p.stationen.forEach((w) => {
    const icon = L.divIcon({
      className: "",
      html: `<div class="wache-marker ${w.id === gewaehlteWache ? "aktiv" : ""}" title="${esc(w.name)}">L${w.level}</div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    });
    const m = L.marker([w.lat, w.lng], { icon }).addTo(karte);
    m.bindTooltip(esc(w.name), { direction: "top", offset: [0, -20] });
    m.on("click", () => {
      if (bauModus) return;
      gewaehlteWache = w.id;
      allesNeuZeichnen();
    });
    marker[w.id] = m;
  });
}

function wacheUpgrade(w) {
  const p = spieler();
  const info = wacheLevelInfo(w.level);
  if (!info.upgradeKosten || p.geld < info.upgradeKosten) return;
  if (Online.aktiv) {
    serverAktion("wache_ausbauen", { p_wache: w.id }).then((a) => a && toast(`⬆️ ${esc(w.name)} ist jetzt Level ${w.level + 1}.`));
    return;
  }
  p.geld -= info.upgradeKosten;
  w.level++;
  speichern();
  toast(`⬆️ ${esc(w.name)} ist jetzt Level ${w.level}.`);
  allesNeuZeichnen();
}

function fahrzeugKaufen(w, typ) {
  const p = spieler();
  const t = fahrzeugTyp(typ);
  if (p.geld < t.preis || w.fahrzeuge.length >= wacheLevelInfo(w.level).stellplaetze || w.level < t.abWacheLevel) return;
  if (Online.aktiv) {
    serverAktion("fahrzeug_kaufen", { p_wache: w.id, p_typ: typ }).then((a) => a && toast(`🚑 Neuer ${t.typ} für ${esc(w.name)} gekauft.`));
    return;
  }
  p.geld -= t.preis;
  const nr = w.fahrzeuge.filter((f) => f.typ === typ).length + 1;
  w.fahrzeuge.push({ id: id(), typ, nr, einsatz: null });
  speichern();
  toast(`🚑 Neuer ${t.typ} für ${esc(w.name)} gekauft.`);
  allesNeuZeichnen();
}

function einsatzBelohnung(typ, dauerKey, transport = false) {
  const t = fahrzeugTyp(typ);
  const d = dauerInfo(dauerKey);
  const faktor = t.faktor * (transport && CONFIG.transport ? 1 + CONFIG.transport.bonus : 1);
  return {
    geld: Math.round(d.minuten * d.proMinute * faktor),
    xp: Math.round(d.minuten * d.xpProMinute * faktor),
  };
}

async function einsatzStarten(fahrzeug, dauerKey) {
  const d = dauerInfo(dauerKey);
  const w = wacheVon(fahrzeug);
  const { ziel, route } = await zielMitRoute(w, d.minuten);
  if (fahrzeug.einsatz) return; // zwischenzeitlich schon losgeschickt
  const stichwort = zufall(CONFIG.stichworte[fahrzeug.typ] || ["Einsatz"]);
  // Mögliches Krankenhaus; ob wirklich transportiert wird, entscheidet online der Server
  const kh = transportChance(fahrzeug.typ) > 0 ? krankenhausWaehlen(w, ziel, d.minuten) : null;
  if (Online.aktiv) {
    const parameter = { p_fahrzeug: fahrzeug.id, p_dauer: dauerKey, p_stichwort: stichwort, p_ziel: ziel, p_route: route };
    if (CONFIG.transport) parameter.p_kh = kh;
    const antwort = await serverAktion("einsatz_starten", parameter);
    const neu = antwort && spieler().stationen.flatMap((s) => s.fahrzeuge).find((x) => x.id === fahrzeug.id);
    if (neu && neu.einsatz && neu.einsatz.kh) {
      const r = await transportRouten(w, neu.einsatz);
      if (r.routeKh || r.routeHeim)
        serverAktion("einsatz_routen", { p_fahrzeug: fahrzeug.id, p_route_kh: r.routeKh, p_route_heim: r.routeHeim });
    }
    return;
  }
  const transport = !!kh && Math.random() < transportChance(fahrzeug.typ);
  const b = einsatzBelohnung(fahrzeug.typ, dauerKey, transport);
  const start = Date.now();
  fahrzeug.einsatz = {
    stichwort,
    ziel,
    route,
    kh: transport ? kh : null,
    routeKh: null,
    routeHeim: null,
    dauerKey,
    start,
    ende: start + (d.minuten * 60000) / CONFIG.zeitFaktor,
    geld: b.geld,
    xp: b.xp,
  };
  if (transport) Object.assign(fahrzeug.einsatz, await transportRouten(w, fahrzeug.einsatz));
  speichern();
  allesNeuZeichnen();
}

// ---------- Routing über OpenRouteService ----------
let routingHinweisGezeigt = false;

// Fragt die Straßenroute von a nach b ab. Ergebnis: [[lat, lng], ...] oder null
async function routeHolen(a, b) {
  if (Online.aktiv && CONFIG.routing.ueberServer) {
    // Online fragt die Supabase-Funktion "route" OpenRouteService, der Key bleibt auf dem Server
    const daten = await Online.funktion("route", { start: a, ende: b, profil: CONFIG.routing.profil });
    const punkte = daten.features[0].geometry.coordinates.map(([lng, lat]) => [+lat.toFixed(5), +lng.toFixed(5)]);
    return punkteAusduennen(punkte, CONFIG.routing.maxPunkte);
  }
  const key = (CONFIG.routing.orsKey || "").trim();
  if (!key) return null;
  const url =
    `https://api.openrouteservice.org/v2/directions/${CONFIG.routing.profil}` +
    `?api_key=${encodeURIComponent(key)}&start=${a.lng},${a.lat}&end=${b.lng},${b.lat}`;
  const antwort = await fetch(url);
  if (!antwort.ok) {
    const fehler = new Error(`Routing-Fehler ${antwort.status}`);
    fehler.status = antwort.status;
    throw fehler;
  }
  const daten = await antwort.json();
  const punkte = daten.features[0].geometry.coordinates.map(([lng, lat]) => [+lat.toFixed(5), +lng.toFixed(5)]);
  return punkteAusduennen(punkte, CONFIG.routing.maxPunkte);
}

function punkteAusduennen(punkte, max) {
  if (punkte.length <= max) return punkte;
  const schritt = (punkte.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => punkte[Math.round(i * schritt)]);
}

// Sucht einen Einsatzort, zu dem es eine Straßenroute gibt
async function zielMitRoute(w, minuten) {
  const umweg = CONFIG.routing.umwegFaktor;
  for (let versuch = 0; versuch < 4; versuch++) {
    const ziel = zufallsZiel(w, minuten, umweg);
    try {
      const route = await routeHolen(w, ziel);
      if (!route) break; // kein Key eingetragen
      const ende = route[route.length - 1];
      return { ziel: { lat: ende[0], lng: ende[1] }, route };
    } catch (e) {
      // 404 = keine Straße in der Nähe (z. B. Meer, Wald) -> neuer Versuch
      if (e.status === 404) continue;
      toast(`⚠️ Route konnte nicht berechnet werden (${esc(e.message)}). Das Fahrzeug fährt Luftlinie.`);
      break;
    }
  }
  if (!(CONFIG.routing.orsKey || "").trim() && !(Online.aktiv && CONFIG.routing.ueberServer) && !routingHinweisGezeigt) {
    routingHinweisGezeigt = true;
    toast("🛣️ Für Fahrten auf Straßen einen OpenRouteService-Key in js/config.js eintragen.");
  }
  return { ziel: zufallsZiel(w, minuten), route: null };
}

// ---------- Fahrt-Animation ----------
const wacheVon = (f) => spieler().stationen.find((w) => w.fahrzeuge.includes(f));

// Zufälliger Einsatzort: so weit weg, wie das Fahrzeug in der Anfahrtszeit fährt
function zufallsZiel(w, minuten, umweg = 1) {
  const anfahrtStunden = (minuten * CONFIG.einsatzPhasen.anfahrt) / 60;
  const km = (anfahrtStunden * CONFIG.fahrgeschwindigkeitKmh * (0.9 + Math.random() * 0.2)) / umweg;
  const winkel = Math.random() * 2 * Math.PI;
  return {
    lat: w.lat + (km / 111) * Math.cos(winkel),
    lng: w.lng + (km / (111 * Math.cos((w.lat * Math.PI) / 180))) * Math.sin(winkel),
  };
}

const STATUS = {
  1: { text: "Status 1 · Rückfahrt, frei über Funk", farbe: "#2e7d32" },
  2: { text: "Status 2 · Auf der Wache", farbe: "#607d8b" },
  3: { text: "Status 3 · Anfahrt zum Einsatzort", farbe: "#e53935" },
  4: { text: "Status 4 · Am Einsatzort", farbe: "#fb8c00" },
  7: { text: "Status 7 · Patient aufgenommen, Transport ins Krankenhaus", farbe: "#8e24aa" },
  8: { text: "Status 8 · Am Krankenhaus", farbe: "#5d4037" },
};

// Punkt auf der Strecke a -> b (Luftlinie) bei Anteil x
const aufLinie = (a, b, x) => ({ lat: a.lat + (b.lat - a.lat) * x, lng: a.lng + (b.lng - a.lng) * x });

// Liefert Status und aktuelle Position eines Fahrzeugs
function fahrzeugLage(f, w) {
  const e = f.einsatz;
  if (!e) return { status: 2, lat: w.lat, lng: w.lng };
  if (!e.ziel) e.ziel = zufallsZiel(w, dauerInfo(e.dauerKey).minuten); // ältere Spielstände
  const t = Math.min(1, Math.max(0, (zeitJetzt() - e.start) / (e.ende - e.start)));
  const zwischen = (a) => (e.route ? aufRoute(f.id + ":hin", e.route, a) : aufLinie(w, e.ziel, a));
  if (e.kh) {
    // Mit Transport: Wache -> Einsatzort -> Krankenhaus -> Wache
    const p = CONFIG.einsatzPhasenTransport;
    const g1 = p.anfahrt, g2 = g1 + p.vorOrt, g3 = g2 + p.transport, g4 = g3 + p.amKrankenhaus;
    if (t < g1) return { status: 3, ...zwischen(t / g1) };
    if (t < g2) return { status: 4, ...e.ziel };
    if (t < g3) {
      const x = (t - g2) / p.transport;
      return { status: 7, ...(e.routeKh ? aufRoute(f.id + ":kh", e.routeKh, x) : aufLinie(e.ziel, e.kh, x)) };
    }
    if (t < g4) return { status: 8, lat: e.kh.lat, lng: e.kh.lng };
    const x = (t - g4) / (1 - g4);
    return { status: 1, ...(e.routeHeim ? aufRoute(f.id + ":heim", e.routeHeim, x) : aufLinie(e.kh, w, x)) };
  }
  const { anfahrt, vorOrt } = CONFIG.einsatzPhasen;
  if (t < anfahrt) return { status: 3, ...zwischen(t / anfahrt) };
  if (t < anfahrt + vorOrt) return { status: 4, ...e.ziel };
  return { status: 1, ...zwischen(1 - (t - anfahrt - vorOrt) / (1 - anfahrt - vorOrt)) };
}

// Position auf einer Route bei Anteil a (0 = Anfang, 1 = Ende), nach gefahrener Strecke
const routenLaengen = {};
function aufRoute(schluessel, route, a) {
  let c = routenLaengen[schluessel];
  if (!c || c.route !== route) {
    const summe = [0];
    for (let i = 1; i < route.length; i++) summe.push(summe[i - 1] + L.latLng(route[i - 1]).distanceTo(route[i]));
    c = routenLaengen[schluessel] = { route, summe };
  }
  const ziel = a * c.summe[c.summe.length - 1];
  let i = 1;
  while (i < route.length - 1 && c.summe[i] < ziel) i++;
  const abschnitt = c.summe[i] - c.summe[i - 1] || 1;
  const x = Math.min(1, Math.max(0, (ziel - c.summe[i - 1]) / abschnitt));
  return { lat: route[i - 1][0] + (route[i][0] - route[i - 1][0]) * x, lng: route[i - 1][1] + (route[i][1] - route[i - 1][1]) * x };
}

let fahrzeugMarker = {}; // id -> { auto, linien, kennung, status }

// Einsatzort, Krankenhaus und Strecken eines Einsatzes als eine Kartenebene
function einsatzLinien(e, w, t) {
  const strecke = (punkte, a, b, stil = {}) =>
    punkte
      ? L.polyline(punkte, { color: t.farbe, weight: 4, opacity: 0.55, ...stil })
      : L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: t.farbe, weight: 2, opacity: 0.5, dashArray: "6 6", ...stil });
  const ebene = L.layerGroup([
    L.marker([e.ziel.lat, e.ziel.lng], {
      icon: L.divIcon({ className: "", html: '<div class="einsatz-marker">🚨</div>', iconSize: [30, 30], iconAnchor: [15, 15] }),
      zIndexOffset: -100,
    }).bindTooltip(`${esc(e.stichwort)}`, { direction: "top", offset: [0, -14] }),
    strecke(e.route, w, e.ziel),
  ]);
  if (e.kh) {
    ebene.addLayer(strecke(e.routeKh, e.ziel, e.kh, { dashArray: "10 6" }));
    ebene.addLayer(strecke(e.routeHeim, e.kh, w, { opacity: 0.3 }));
    ebene.addLayer(
      L.marker([e.kh.lat, e.kh.lng], {
        icon: L.divIcon({ className: "", html: '<div class="kh-marker ziel">H</div>', iconSize: [24, 24], iconAnchor: [12, 12] }),
        zIndexOffset: 400,
      }).bindTooltip(`🏥 ${esc(e.kh.name)}`, { direction: "top", offset: [0, -12] })
    );
  }
  return ebene.addTo(karte);
}

function fahrzeugeAufKarte() {
  const p = spieler();
  const aktiv = new Set();
  if (p) {
    p.stationen.forEach((w) =>
      w.fahrzeuge.forEach((f) => {
        const e = f.einsatz;
        if (!e) return;
        aktiv.add(f.id);
        const lage = fahrzeugLage(f, w);
        const t = fahrzeugTyp(f.typ);
        let m = fahrzeugMarker[f.id];
        if (!m) {
          const auto = L.marker([lage.lat, lage.lng], { icon: L.divIcon({ className: "", html: "", iconSize: [52, 22], iconAnchor: [26, 11] }), zIndexOffset: 500 })
            .bindTooltip(`${esc(fahrzeugName(f))} · ${esc(w.name)}`, { direction: "top", offset: [0, -10] })
            .on("click", () => {
              gewaehlteWache = w.id;
              allesNeuZeichnen();
            })
            .addTo(karte);
          m = fahrzeugMarker[f.id] = { auto, linien: null, kennung: null, status: null };
        }
        // Neu zeichnen, wenn ein neuer Einsatz läuft oder Straßenrouten nachgekommen sind
        const kennung = [e.start, !!e.route, !!e.kh, !!e.routeKh, !!e.routeHeim].join();
        if (m.kennung !== kennung) {
          if (m.linien) m.linien.remove();
          m.linien = einsatzLinien(e, w, t);
          m.kennung = kennung;
        }
        m.auto.setLatLng([lage.lat, lage.lng]);
        if (m.status !== lage.status) {
          m.status = lage.status;
          m.auto.setIcon(
            L.divIcon({
              className: "",
              html: `<div class="fahrzeug-marker" style="background:${t.farbe}">${t.typ}<span style="background:${STATUS[lage.status].farbe}">${lage.status}</span></div>`,
              iconSize: [52, 22],
              iconAnchor: [26, 11],
            })
          );
        }
      })
    );
  }
  Object.keys(fahrzeugMarker).forEach((fid) => {
    if (aktiv.has(fid)) return;
    const m = fahrzeugMarker[fid];
    m.auto.remove();
    if (m.linien) m.linien.remove();
    delete fahrzeugMarker[fid];
  });
}

// Prüft, ob Einsätze fertig sind, und schreibt die Belohnung gut
let letzteAbrechnung = 0;

function einsaetzePruefen() {
  const p = spieler();
  if (!p) return false;
  if (Online.aktiv) {
    // Fertige Einsätze schreibt der Server gut; höchstens alle 5 Sekunden nachfragen
    const faellig = p.stationen.some((w) => w.fahrzeuge.some((f) => f.einsatz && f.einsatz.ende <= zeitJetzt()));
    if (faellig && Date.now() - letzteAbrechnung > 5000) {
      letzteAbrechnung = Date.now();
      serverAktion("spiel_laden", {});
    }
    return false;
  }
  let geaendert = false;
  const jetzt = Date.now();
  p.stationen.forEach((w) =>
    w.fahrzeuge.forEach((f) => {
      if (f.einsatz && f.einsatz.ende <= jetzt) {
        punkteGeben(f.einsatz.geld, f.einsatz.xp, "einsatz");
        p.stats.einsaetze++;
        toast(`✅ ${esc(fahrzeugName(f))} (${esc(w.name)}) ist zurück auf der Wache (Status 2): +💶 ${zahl(f.einsatz.geld)} · +⭐ ${zahl(f.einsatz.xp)}`);
        f.einsatz = null;
        geaendert = true;
      }
    })
  );
  if (geaendert) speichern();
  return geaendert;
}

const fahrzeugName = (f) => f.name || `${f.typ} ${f.nr}`;

function fahrzeugUmbenennen(f) {
  const t = fahrzeugTyp(f.typ);
  dialogZeigen(`
    <h2>Fahrzeug umbenennen</h2>
    <p class="klein">${t.typ} · ${t.name}</p>
    <input id="fahrzeugNameInput" value="${esc(fahrzeugName(f))}" maxlength="30" placeholder="${f.typ} ${f.nr}">
    <div class="knoepfe">
      <button class="btn" id="dlgAbbrechen">Abbrechen</button>
      <button class="btn primaer" id="dlgSpeichern">Speichern</button>
    </div>`);
  const input = $("#fahrzeugNameInput");
  input.select();
  const speichernName = () => {
    if (Online.aktiv) {
      dialogSchliessen();
      serverAktion("fahrzeug_umbenennen", { p_fahrzeug: f.id, p_name: input.value }).then((a) => {
        const m = fahrzeugMarker[f.id];
        const neu = a && spieler().stationen.flatMap((s) => s.fahrzeuge).find((x) => x.id === f.id);
        if (m && neu) m.auto.setTooltipContent(`${esc(fahrzeugName(neu))} · ${esc(wacheVon(neu).name)}`);
      });
      return;
    }
    f.name = input.value.trim().slice(0, 30); // leer = Standardname
    speichern();
    dialogSchliessen();
    const m = fahrzeugMarker[f.id];
    if (m) m.auto.setTooltipContent(`${esc(fahrzeugName(f))} · ${esc(wacheVon(f).name)}`);
    allesNeuZeichnen();
  };
  $("#dlgAbbrechen").onclick = dialogSchliessen;
  $("#dlgSpeichern").onclick = speichernName;
  input.onkeydown = (e) => {
    if (e.key === "Enter") speichernName();
  };
}

function fahrzeugHtml(f) {
  const t = fahrzeugTyp(f.typ);
  let inhalt;
  if (f.einsatz) {
    const d = dauerInfo(f.einsatz.dauerKey);
    inhalt = `
      <div class="fahrzeug-status">🚨 ${esc(f.einsatz.stichwort)} · ${d.name} · noch <b data-rest="${f.einsatz.ende}">…</b></div>
      <div class="fahrzeug-status"><span class="status-punkt" data-fms="${f.id}"></span></div>
      <div class="fortschritt"><div data-start="${f.einsatz.start}" data-ende="${f.einsatz.ende}"></div></div>
      ${f.einsatz.kh ? `<div class="klein" style="margin-top:4px">🏥 Transport: ${esc(f.einsatz.kh.name)}</div>` : ""}
      <div class="klein" style="margin-top:4px">Belohnung: 💶 ${zahl(f.einsatz.geld)} · ⭐ ${zahl(f.einsatz.xp)}</div>`;
  } else {
    const optionen = CONFIG.einsatzDauern
      .map((d) => {
        const b = einsatzBelohnung(f.typ, d.key);
        return `<option value="${d.key}">${d.name} → 💶 ${zahl(b.geld)} · ⭐ ${zahl(b.xp)}</option>`;
      })
      .join("");
    inhalt = `
      <div class="fahrzeug-status"><span class="status-punkt" style="--sf:${STATUS[2].farbe}">${STATUS[2].text}</span></div>
      <div class="einsatz-wahl">
        <select data-dauer="${f.id}">${optionen}</select>
        <button class="btn primaer klein" data-losschicken="${f.id}">Losschicken</button>
      </div>
      ${
        transportChance(f.typ) > 0 && krankenhausListe.length
          ? `<div class="klein" style="margin-top:4px">🏥 ${transportChance(f.typ) >= 1 ? "Immer" : `In ${Math.round(transportChance(f.typ) * 100)} % der Einsätze`} mit Transport ins Krankenhaus: +${Math.round(CONFIG.transport.bonus * 100)} %</div>`
          : ""
      }`;
  }
  return `
    <div class="fahrzeug">
      <div class="fahrzeug-kopf">
        <span class="typ-badge" style="background:${t.farbe}">${t.typ}</span>
        <div class="fahrzeug-name">
          <b>${esc(fahrzeugName(f))}</b>
          <div class="klein">${t.typ} · ${t.name}</div>
        </div>
        <button class="btn klein umbenennen" data-umbenennen="${f.id}" title="Fahrzeug umbenennen">✏️</button>
      </div>
      ${inhalt}
    </div>`;
}

function seitenleisteZeichnen() {
  const p = spieler();
  const el = $("#seitenleiste");
  if (!p) return (el.innerHTML = "");
  const w = p.stationen.find((s) => s.id === gewaehlteWache);

  if (!w) {
    // Übersicht
    const unterwegs = p.stationen.reduce((n, s) => n + s.fahrzeuge.filter((f) => f.einsatz).length, 0);
    const gesamt = p.stationen.reduce((n, s) => n + s.fahrzeuge.length, 0);
    el.innerHTML = `
      <h2>Leitstelle</h2>
      <p class="klein">${p.stationen.length} Wachen · ${gesamt} Fahrzeuge · ${unterwegs} im Einsatz</p>
      ${
        p.stationen.length === 0
          ? `<div class="info-box">Willkommen in deiner Leitstelle! Klicke oben auf <b>＋ Wache bauen</b> und dann auf eine Stelle auf der Karte. Deine erste Wache ist kostenlos.<br><br>
             Kaufe danach Fahrzeuge und schicke sie zu Einsätzen. <b>Kurze Einsätze</b> bringen mehr Geld pro Minute, <b>lange Einsätze</b> laufen dafür auch, wenn du nicht spielst.</div>`
          : ""
      }
      <h3>Deine Wachen</h3>
      ${
        p.stationen
          .map((s) => {
            const frei = s.fahrzeuge.filter((f) => !f.einsatz).length;
            return `<div class="wache-eintrag" data-wache="${s.id}">
              <div><b>${esc(s.name)}</b><div class="klein">Level ${s.level} · ${s.fahrzeuge.length}/${wacheLevelInfo(s.level).stellplaetze} Fahrzeuge · ${frei} frei</div></div>
              <span>›</span></div>`;
          })
          .join("") || '<p class="klein">Noch keine Wachen gebaut.</p>'
      }
      <h3>Einsatzdauern</h3>
      <table class="tabelle klein">
        <tr><th>Dauer</th><th>💶 / Min</th><th>RTW gesamt</th></tr>
        ${CONFIG.einsatzDauern.map((d) => `<tr><td>${d.name}</td><td>${d.proMinute}</td><td>${zahl(einsatzBelohnung("RTW", d.key).geld)}</td></tr>`).join("")}
      </table>`;
    el.querySelectorAll("[data-wache]").forEach((d) => {
      d.onclick = () => {
        gewaehlteWache = d.dataset.wache;
        const s = p.stationen.find((x) => x.id === gewaehlteWache);
        karte.setView([s.lat, s.lng], Math.max(karte.getZoom(), 12));
        allesNeuZeichnen();
      };
    });
    return;
  }

  // Wachen-Detail
  const info = wacheLevelInfo(w.level);
  const voll = w.fahrzeuge.length >= info.stellplaetze;
  const kaufListe = CONFIG.fahrzeuge
    .map((t) => {
      const gesperrt = w.level < t.abWacheLevel;
      const kannNicht = gesperrt || voll || p.geld < t.preis;
      return `<div class="kauf-zeile">
        <div><span class="typ-badge" style="background:${t.farbe}">${t.typ}</span> ${t.name}
          <div class="klein">${gesperrt ? `🔒 ab Wachen-Level ${t.abWacheLevel}` : `Ertrag ×${t.faktor}`}</div></div>
        <button class="btn klein" data-kaufen="${t.typ}" ${kannNicht ? "disabled" : ""}>💶 ${zahl(t.preis)}</button>
      </div>`;
    })
    .join("");

  el.innerHTML = `
    <span class="zurueck" id="zurueck">‹ Alle Wachen</span>
    <h2>${esc(w.name)}</h2>
    <p class="klein">Level ${w.level} · ${w.fahrzeuge.length}/${info.stellplaetze} Stellplätze belegt</p>
    ${
      info.upgradeKosten
        ? `<button class="btn primaer" id="upgradeBtn" ${p.geld < info.upgradeKosten ? "disabled" : ""}>
             ⬆️ Ausbauen auf Level ${w.level + 1} (${wacheLevelInfo(w.level + 1).stellplaetze} Stellplätze) · 💶 ${zahl(info.upgradeKosten)}</button>`
        : `<div class="info-box">🏆 Maximales Level erreicht.</div>`
    }
    <h3>Fahrzeuge</h3>
    ${w.fahrzeuge.map(fahrzeugHtml).join("") || '<p class="klein">Noch keine Fahrzeuge. Kaufe unten dein erstes Fahrzeug.</p>'}
    <h3>Fahrzeug kaufen ${voll ? '<span class="klein">(Wache voll)</span>' : ""}</h3>
    ${kaufListe}`;

  $("#zurueck").onclick = () => {
    gewaehlteWache = null;
    allesNeuZeichnen();
  };
  if ($("#upgradeBtn")) $("#upgradeBtn").onclick = () => wacheUpgrade(w);
  el.querySelectorAll("[data-kaufen]").forEach((b) => (b.onclick = () => fahrzeugKaufen(w, b.dataset.kaufen)));
  el.querySelectorAll("[data-umbenennen]").forEach((b) => {
    b.onclick = () => fahrzeugUmbenennen(w.fahrzeuge.find((x) => x.id === b.dataset.umbenennen));
  });
  el.querySelectorAll("[data-losschicken]").forEach((b) => {
    b.onclick = () => {
      const f = w.fahrzeuge.find((x) => x.id === b.dataset.losschicken);
      const dauer = el.querySelector(`[data-dauer="${f.id}"]`).value;
      b.disabled = true;
      b.textContent = "Route wird berechnet …";
      einsatzStarten(f, dauer);
    };
  });
  countdownsAktualisieren();
}

function countdownsAktualisieren() {
  const jetzt = zeitJetzt();
  document.querySelectorAll("[data-rest]").forEach((e) => (e.textContent = dauerText(+e.dataset.rest - jetzt)));
  document.querySelectorAll(".fortschritt > div[data-ende]").forEach((e) => {
    const s = +e.dataset.start, en = +e.dataset.ende;
    e.style.width = `${Math.min(100, ((jetzt - s) / (en - s)) * 100)}%`;
  });
  const p = spieler();
  document.querySelectorAll("[data-fms]").forEach((e) => {
    const w = p.stationen.find((s) => s.fahrzeuge.some((f) => f.id === e.dataset.fms));
    if (!w) return;
    const st = STATUS[fahrzeugLage(w.fahrzeuge.find((f) => f.id === e.dataset.fms), w).status];
    e.textContent = st.text;
    e.style.setProperty("--sf", st.farbe);
  });
}

// ============================================================
// QUIZ
// ============================================================
let quiz = null; // { fragen, index, richtig, beantwortet }

function mischen(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function quizStartseite() {
  const p = spieler();
  const s = p.stats;
  const quote = s.quizGesamt ? Math.round((s.quizRichtig / s.quizGesamt) * 100) : 0;
  $("#quizInhalt").innerHTML = `
    <h2>🧠 Wissensquiz</h2>
    <p>Beantworte Fragen mit je 4 Antwortmöglichkeiten. Jede richtige Antwort bringt
       <b>💶 ${CONFIG.quiz.geldProRichtig}</b> und <b>⭐ ${CONFIG.quiz.xpProRichtig}</b> Punkte.</p>
    <div class="statistik">
      <div><b>${zahl(s.quizRichtig)}</b>richtig beantwortet</div>
      <div><b>${quote} %</b>Trefferquote</div>
      <div><b>${zahl(s.quizGesamt)}</b>Fragen beantwortet</div>
    </div>
    <button class="btn primaer gross" id="quizStart">Runde starten (${Math.min(CONFIG.quiz.fragenProRunde, FRAGEN.length)} Fragen)</button>`;
  $("#quizStart").onclick = quizStarten;
}

async function quizStarten() {
  if (Online.aktiv) {
    let runde;
    try {
      runde = await Online.rpc("quiz_runde");
    } catch (e) {
      return toast(`⚠️ ${esc(e.message)}`);
    }
    if (!runde.fragen.length) {
      const ab = runde.freiAb ? new Date(runde.freiAb).toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
      $("#quizInhalt").innerHTML = `
        <h2>🧠 Alle Fragen beantwortet</h2>
        <p>Du hast gerade alle ${runde.gesperrt} Fragen beantwortet. Jede Frage bringt nur einmal pro ${CONFIG.quiz.sperreStunden || 24} Stunden Punkte.</p>
        ${ab ? `<p>Die nächste Frage ist wieder frei ab <b>${ab}</b>.</p>` : ""}
        <button class="btn gross" id="quizZurueck">Zur Übersicht</button>`;
      $("#quizZurueck").onclick = quizStartseite;
      return;
    }
    const fragen = runde.fragen.map((f) => {
      const reihenfolge = mischen([0, 1, 2, 3]);
      return { id: f.id, frage: f.frage, kategorie: f.kategorie || "", antworten: reihenfolge.map((i) => f.antworten[i]), reihenfolge, richtig: -1 };
    });
    quiz = { fragen, index: 0, richtig: 0 };
    return quizFrageZeigen();
  }
  const fragen = mischen(FRAGEN)
    .slice(0, CONFIG.quiz.fragenProRunde)
    .map((f) => {
      const reihenfolge = mischen([0, 1, 2, 3]);
      return {
        frage: f.frage,
        kategorie: f.kategorie || "",
        antworten: reihenfolge.map((i) => f.antworten[i]),
        richtig: reihenfolge.indexOf(f.richtig),
      };
    });
  quiz = { fragen, index: 0, richtig: 0 };
  quizFrageZeigen();
}

function quizFrageZeigen() {
  const f = quiz.fragen[quiz.index];
  $("#quizInhalt").innerHTML = `
    <div class="quiz-meta"><span>Frage ${quiz.index + 1} von ${quiz.fragen.length}</span><span>${esc(f.kategorie)}</span><span>✔ ${quiz.richtig}</span></div>
    <div class="fortschritt"><div style="width:${(quiz.index / quiz.fragen.length) * 100}%"></div></div>
    <div class="quiz-frage">${esc(f.frage)}</div>
    <div class="antworten">
      ${f.antworten.map((a, i) => `<button class="antwort" data-i="${i}">${"ABCD"[i]}) ${esc(a)}</button>`).join("")}
    </div>
    <div class="quiz-fuss"><span id="quizFeedback"></span><button class="btn primaer versteckt" id="quizWeiter">Weiter</button></div>`;
  document.querySelectorAll(".antwort").forEach((b) => (b.onclick = () => quizAntwort(+b.dataset.i)));
}

async function quizAntwort(i) {
  const f = quiz.fragen[quiz.index];
  const knoepfe = document.querySelectorAll(".antwort");
  knoepfe.forEach((b) => (b.disabled = true));
  if (Online.aktiv) {
    let a;
    try {
      a = await Online.rpc("quiz_antwort", { p_frage: f.id, p_antwort: f.reihenfolge[i] });
    } catch (e) {
      toast(`⚠️ ${esc(e.message)}`);
      knoepfe.forEach((b) => (b.disabled = false));
      return;
    }
    f.richtig = f.reihenfolge.indexOf(a.korrekt);
    serverStandUebernehmen({ stand: a.stand });
    return quizAuswertung(i, f, knoepfe, a.richtig);
  }
  const p = spieler();
  p.stats.quizGesamt++;
  if (i === f.richtig) {
    p.stats.quizRichtig++;
    punkteGeben(CONFIG.quiz.geldProRichtig, CONFIG.quiz.xpProRichtig, "quiz");
  }
  speichern();
  quizAuswertung(i, f, knoepfe, i === f.richtig);
}

function quizAuswertung(i, f, knoepfe, richtig) {
  knoepfe[f.richtig].classList.add("richtig");
  if (richtig) {
    quiz.richtig++;
    $("#quizFeedback").innerHTML = `<b style="color:var(--ok)">Richtig! +💶 ${CONFIG.quiz.geldProRichtig} · +⭐ ${CONFIG.quiz.xpProRichtig}</b>`;
  } else {
    knoepfe[i].classList.add("falsch");
    $("#quizFeedback").innerHTML = `<b style="color:var(--fehler)">Leider falsch.</b>`;
  }
  kopfAktualisieren();
  const weiter = $("#quizWeiter");
  weiter.classList.remove("versteckt");
  weiter.textContent = quiz.index + 1 < quiz.fragen.length ? "Weiter" : "Ergebnis";
  weiter.onclick = () => {
    quiz.index++;
    if (quiz.index < quiz.fragen.length) quizFrageZeigen();
    else quizErgebnis();
  };
}

function quizErgebnis() {
  const n = quiz.fragen.length;
  $("#quizInhalt").innerHTML = `
    <h2>Runde beendet</h2>
    <div class="statistik">
      <div><b>${quiz.richtig} / ${n}</b>richtig</div>
      <div><b>💶 ${zahl(quiz.richtig * CONFIG.quiz.geldProRichtig)}</b>verdient</div>
      <div><b>⭐ ${zahl(quiz.richtig * CONFIG.quiz.xpProRichtig)}</b>Punkte</div>
    </div>
    <div class="knoepfe" style="display:flex;gap:8px">
      <button class="btn primaer gross" id="quizNochmal">Neue Runde</button>
      <button class="btn gross" id="quizZurueck">Zur Übersicht</button>
    </div>`;
  quiz = null;
  $("#quizNochmal").onclick = quizStarten;
  $("#quizZurueck").onclick = quizStartseite;
}

// ============================================================
// BESTENLISTE
// ============================================================
async function bestenlisteZeichnen() {
  let liste;
  if (Online.aktiv) {
    $("#bestenHinweis").textContent = "Alle Punkte aus Einsätzen und Quiz zählen. Hier stehen alle Spieler von RescueCity.";
    try {
      liste = await Online.bestenliste();
    } catch (e) {
      $("#bestenTabelle").innerHTML = '<tr><td colspan="6">Die Bestenliste konnte nicht geladen werden.</td></tr>';
      return;
    }
  } else {
    liste = Object.values(speicher.profile)
      .sort((a, b) => b.xp - a.xp)
      .map((p) => ({ name: p.name, xp: p.xp, einsaetze: p.stats.einsaetze, quizRichtig: p.stats.quizRichtig, ich: p.id === speicher.aktiv }));
  }
  const zeilen = liste
    .map(
      (p, i) => `<tr class="${p.ich ? "ich" : ""}">
        <td>${i + 1}</td><td>${esc(p.name)}</td><td>${levelAusXp(p.xp)}</td>
        <td>⭐ ${zahl(p.xp)}</td><td>${zahl(p.einsaetze)}</td><td>${zahl(p.quizRichtig)}</td></tr>`
    )
    .join("");
  $("#bestenTabelle").innerHTML = zeilen || '<tr><td colspan="6">Noch keine Spieler.</td></tr>';
}

// ============================================================
// Navigation & Start
// ============================================================
function bereichZeigen(ziel) {
  document.body.dataset.bereich = ziel;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("aktiv", t.dataset.ziel === ziel));
  document.querySelectorAll(".bereich").forEach((b) => b.classList.toggle("aktiv", b.id === ziel));
  if (ziel === "leitstelle") setTimeout(() => karte.invalidateSize(), 0);
  if (ziel === "quiz" && !quiz) quizStartseite();
  if (ziel === "bestenliste") bestenlisteZeichnen();
}

function allesNeuZeichnen() {
  kopfAktualisieren();
  markerZeichnen();
  fahrzeugeAufKarte();
  seitenleisteZeichnen();
  if (document.body.dataset.bereich === "bestenliste") bestenlisteZeichnen();
  if (document.body.dataset.bereich === "quiz" && !quiz) quizStartseite();
}

async function start() {
  karteStarten();
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => bereichZeigen(t.dataset.ziel)));
  $("#bonusKnopf").onclick = () => bonusDialog();
  $("#spielerName").onclick = () => (Online.aktiv ? Online.kontoDialog() : profilDialog(false));

  if (Online.aktiv) {
    const antwort = await Online.start();
    serverStandUebernehmen(antwort);
    const stand = antwort.stand;
    if (!stand.stationen.length && !stand.xp) toast(`Willkommen, ${esc(stand.name)}! Baue deine erste Rettungswache – sie ist kostenlos.`);
  } else {
    laden();
  }

  if (location.protocol === "file:" && !(CONFIG.karte.mapTilerKey || "").trim()) {
    toast("🗺️ Die Karte lädt nur, wenn du das Spiel über <b>START.bat</b> öffnest (oder einen MapTiler-Key in js/config.js einträgst).");
  }

  if (!spieler()) {
    profilDialog(true);
  } else {
    einsaetzePruefen(); // Einsätze, die beendet wurden, während das Spiel zu war
    allesNeuZeichnen();
    if (bonusAktiv(spieler()) && bonusLage(spieler()).verfuegbar) setTimeout(bonusDialog, 800);
  }

  setInterval(() => {
    if (einsaetzePruefen()) allesNeuZeichnen();
    else countdownsAktualisieren();
    bonusKnopfAktualisieren(); // nach Mitternacht wieder anbieten
  }, 1000);
  setInterval(fahrzeugeAufKarte, 250);
}

start();
