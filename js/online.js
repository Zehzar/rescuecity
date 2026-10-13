// ============================================================
// RescueCity – Online-Konten (Supabase)
// Anmeldung, Registrierung mit Benutzername, Spielstand und Bestenliste online.
// Ist in config.js keine Supabase-Adresse eingetragen, läuft das Spiel wie bisher lokal.
// ============================================================

const Online = (() => {
  const cfg = CONFIG.online || {};
  // Kommt der Spieler über den Link "Passwort zurücksetzen"? (vor dem Start des Clients prüfen)
  const istPasswortLink = /type=recovery/.test(location.hash + location.search);
  const aktiv = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase);
  const sb = aktiv ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;

  let nutzer = null; // { id, email, username }

  const BENUTZERNAME = /^[A-Za-z0-9ÄÖÜäöüß_.-]{3,20}$/;
  // Nach dem Klick auf den Link in der E-Mail kommt der Spieler hierhin zurück
  // (als Datei geöffnet gibt es keine Web-Adresse, dann über START.bat / localhost)
  const rueckkehrUrl = () => (location.protocol === "file:" ? "http://localhost:8080/" : location.origin + location.pathname);

  function fehlerText(e) {
    const m = (e && (e.message || e.error_description || String(e))) || "Unbekannter Fehler";
    if (/Invalid login credentials/i.test(m)) return "E-Mail oder Passwort ist falsch.";
    if (/Email not confirmed/i.test(m)) return "Bitte bestätige zuerst deine E-Mail-Adresse über den Link in der Mail.";
    if (/already registered|already been registered/i.test(m)) return "Mit dieser E-Mail-Adresse gibt es schon ein Konto.";
    if (/Database error saving new user/i.test(m)) return "Der Benutzername ist leider schon vergeben.";
    if (/Password should be at least/i.test(m)) return "Das Passwort muss mindestens 8 Zeichen lang sein.";
    if (/rate limit|too many/i.test(m)) return "Zu viele Versuche. Bitte warte ein paar Minuten.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "Keine Verbindung zum Server. Bist du online?";
    return m;
  }

  // ---------- Anmelde-Dialog ----------
  function anmeldeDialog(modus = "anmelden", hinweis = "") {
    return new Promise((fertig) => {
      const zeige = (m, h = "") => {
        modus = m;
        const felder = {
          anmelden: `
            <input id="olEmail" type="email" placeholder="E-Mail-Adresse" autocomplete="email">
            <input id="olPass" type="password" placeholder="Passwort" autocomplete="current-password">`,
          registrieren: `
            <input id="olName" placeholder="Benutzername (3–20 Zeichen)" maxlength="20" autocomplete="username">
            <input id="olEmail" type="email" placeholder="E-Mail-Adresse" autocomplete="email">
            <input id="olPass" type="password" placeholder="Passwort (mind. 8 Zeichen)" autocomplete="new-password">`,
          vergessen: `
            <input id="olEmail" type="email" placeholder="E-Mail-Adresse" autocomplete="email">`,
        }[m];
        const knopf = { anmelden: "Anmelden", registrieren: "Konto erstellen", vergessen: "Link zum Zurücksetzen senden" }[m];
        dialogZeigen(`
          <h2>🚑 RescueCity</h2>
          <div class="ol-tabs">
            <button class="ol-tab ${m === "anmelden" ? "aktiv" : ""}" data-modus="anmelden">Anmelden</button>
            <button class="ol-tab ${m === "registrieren" ? "aktiv" : ""}" data-modus="registrieren">Registrieren</button>
          </div>
          ${h ? `<div class="ol-hinweis">${h}</div>` : ""}
          ${felder}
          <div class="ol-fehler" id="olFehler"></div>
          <div class="knoepfe"><button class="btn primaer" id="olLos">${knopf}</button></div>
          <p class="klein" style="margin-top:14px">
            ${m === "anmelden" ? '<a href="#" data-modus="vergessen">Passwort vergessen?</a>' : '<a href="#" data-modus="anmelden">Zurück zur Anmeldung</a>'}
          </p>
          ${m === "registrieren" ? '<p class="klein">Mit der Registrierung erscheint dein Benutzername in der Bestenliste. Infos in der <a href="datenschutz.html" target="_blank">Datenschutzerklärung</a>.</p>' : ""}
          <p class="klein"><a href="impressum.html" target="_blank">Impressum</a> · <a href="datenschutz.html" target="_blank">Datenschutz</a></p>`);
        document.querySelectorAll("[data-modus]").forEach((el) => {
          el.onclick = (e) => {
            e.preventDefault();
            zeige(el.dataset.modus);
          };
        });
        $("#dialog").querySelectorAll("input").forEach((i) => {
          i.onkeydown = (e) => {
            if (e.key === "Enter") los();
          };
        });
        $("#olLos").onclick = los;
      };

      const fehler = (t) => ($("#olFehler").textContent = t);

      async function los() {
        const knopf = $("#olLos");
        const email = ($("#olEmail")?.value || "").trim();
        const pass = $("#olPass")?.value || "";
        if (!email) return fehler("Bitte gib deine E-Mail-Adresse ein.");
        knopf.disabled = true;
        fehler("");
        try {
          if (modus === "anmelden") {
            const { error } = await sb.auth.signInWithPassword({ email, password: pass });
            if (error) throw error;
            dialogSchliessen();
            fertig();
          } else if (modus === "registrieren") {
            const name = $("#olName").value.trim();
            if (!BENUTZERNAME.test(name))
              throw new Error("Der Benutzername muss 3–20 Zeichen lang sein (Buchstaben, Zahlen, _ . -).");
            if (pass.length < 8) throw new Error("Das Passwort muss mindestens 8 Zeichen lang sein.");
            const frei = await sb.rpc("username_frei", { name });
            if (frei.error) throw frei.error;
            if (!frei.data) throw new Error("Der Benutzername ist leider schon vergeben.");
            const { data, error } = await sb.auth.signUp({
              email,
              password: pass,
              options: { data: { username: name, display_name: name }, emailRedirectTo: rueckkehrUrl() },
            });
            if (error) throw error;
            if (data.session) {
              dialogSchliessen();
              fertig();
            } else {
              zeige("anmelden", `📧 Fast geschafft! Wir haben dir eine E-Mail an <b>${esc(email)}</b> geschickt. Klicke auf den Link darin und melde dich danach hier an.`);
            }
          } else {
            const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: rueckkehrUrl() });
            if (error) throw error;
            zeige("anmelden", `📧 Falls es ein Konto mit <b>${esc(email)}</b> gibt, ist ein Link zum Zurücksetzen unterwegs.`);
          }
        } catch (e) {
          fehler(fehlerText(e));
          if ($("#olLos")) $("#olLos").disabled = false;
        }
      }

      zeige(modus, hinweis);
    });
  }

  function neuesPasswortDialog() {
    dialogZeigen(`
      <h2>Neues Passwort</h2>
      <input id="olNeu" type="password" placeholder="Neues Passwort (mind. 8 Zeichen)" autocomplete="new-password">
      <div class="ol-fehler" id="olFehler"></div>
      <div class="knoepfe"><button class="btn primaer" id="olLos">Speichern</button></div>`);
    $("#olLos").onclick = async () => {
      const pw = $("#olNeu").value;
      if (pw.length < 8) return ($("#olFehler").textContent = "Mindestens 8 Zeichen.");
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) return ($("#olFehler").textContent = fehlerText(error));
      dialogSchliessen();
      toast("🔑 Dein Passwort wurde geändert.");
    };
  }

  // ---------- Server-Aufrufe ----------
  let zeitVersatz = 0; // Unterschied zwischen Server- und Geräteuhr in ms

  async function rpc(name, parameter = {}) {
    const { data, error } = await sb.rpc(name, parameter);
    if (error) throw new Error(fehlerText(error));
    if (data && data.serverZeit) zeitVersatz = data.serverZeit - Date.now();
    return data;
  }

  // Supabase Edge Function aufrufen (z. B. "route"). Fehler tragen den HTTP-Status in e.status.
  async function funktion(name, body) {
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      const status = error.context && error.context.status;
      const e = new Error(status ? `Server-Funktion ${name}: Fehler ${status}` : fehlerText(error));
      e.status = status;
      throw e;
    }
    return data;
  }

  // Spielregeln vom Server übernehmen (Preise, Belohnungen, Zeiten)
  function regelnAnwenden(r) {
    if (!r) return;
    CONFIG.startGeld = r.startGeld;
    CONFIG.zeitFaktor = r.zeitFaktor || 1;
    CONFIG.wache.baukosten = r.wacheBaukosten;
    CONFIG.wache.ersteWacheKostenlos = r.ersteWacheKostenlos;
    CONFIG.wache.level = r.wachenLevel;
    CONFIG.einsatzDauern = r.einsatzDauern.map((d) => ({ name: d.key, ...(CONFIG.einsatzDauern.find((x) => x.key === d.key) || {}), ...d }));
    CONFIG.fahrzeuge = r.fahrzeuge.map((f) => ({ name: f.typ, farbe: "#555", ...(CONFIG.fahrzeuge.find((x) => x.typ === f.typ) || {}), ...f }));
    Object.assign(CONFIG.quiz, r.quiz);
  }

  // ---------- Start ----------
  async function start() {
    let passwortDialogOffen = false;
    const passwortNeu = () => {
      if (passwortDialogOffen) return;
      passwortDialogOffen = true;
      setTimeout(neuesPasswortDialog, 300);
    };
    sb.auth.onAuthStateChange((ereignis) => {
      if (ereignis === "PASSWORD_RECOVERY") passwortNeu();
    });

    for (;;) {
      let { data } = await sb.auth.getSession();
      if (!data.session) {
        await anmeldeDialog();
        ({ data } = await sb.auth.getSession());
      }
      if (!data.session) continue;
      nutzer = { id: data.session.user.id, email: data.session.user.email };
      try {
        regelnAnwenden(await rpc("regeln_laden"));
        const antwort = await rpc("spiel_laden");
        nutzer.username = antwort.stand.name;
        if (istPasswortLink) passwortNeu();
        return antwort;
      } catch (e) {
        await anmeldeDialog("anmelden", `⚠️ ${esc(fehlerText(e))}`);
      }
    }
  }

  async function abmelden() {
    await sb.auth.signOut();
    location.reload();
  }

  function kontoDialog() {
    dialogZeigen(`
      <h2>Dein Konto</h2>
      <p><b>${esc(nutzer.username)}</b><br><span class="klein">${esc(nutzer.email)}</span></p>
      <p class="klein">Dein Spielstand liegt auf dem Server. Du kannst auf jedem Gerät weiterspielen.</p>
      <div class="knoepfe">
        <button class="btn" id="olZu">Schließen</button>
        <button class="btn" id="olPw">Passwort ändern</button>
        <button class="btn primaer" id="olAb">Abmelden</button>
      </div>`);
    $("#olZu").onclick = dialogSchliessen;
    $("#olPw").onclick = neuesPasswortDialog;
    $("#olAb").onclick = abmelden;
  }

  async function bestenliste() {
    const { data, error } = await sb.rpc("bestenliste", { anzahl: 100 });
    if (error) throw error;
    return data.map((z) => ({ name: z.username, xp: z.xp, einsaetze: z.einsaetze, quizRichtig: z.quiz_richtig, ich: z.username === nutzer.username }));
  }

  return { aktiv, start, rpc, funktion, aktion: rpc, kontoDialog, bestenliste, zeitVersatz: () => zeitVersatz };
})();
