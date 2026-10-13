-- ============================================================
-- RescueCity – Datenbank einrichten
-- Komplett im Supabase SQL-Editor ausführen (SQL Editor > New query > Run).
-- Das Skript kann gefahrlos erneut ausgeführt werden; eigene Änderungen
-- an den Tabellen "regeln" und "fragen" bleiben dabei erhalten.
-- Der Server rechnet Geld, Punkte, Einsätze und Quiz selbst aus (Schutz gegen Schummeln).
-- ============================================================

-- ---------- Spielerprofile (öffentlicher Benutzername) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9ÄÖÜäöüß_.-]{3,20}$')
);

-- Benutzernamen eindeutig, ohne Rücksicht auf Groß-/Kleinschreibung
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "Profile sind öffentlich lesbar" on public.profiles;
create policy "Profile sind öffentlich lesbar" on public.profiles
  for select using (true);

drop policy if exists "Eigenes Profil ändern" on public.profiles;
create policy "Eigenes Profil ändern" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Profil automatisch bei der Registrierung anlegen (Benutzername aus den Anmeldedaten)
create or replace function public.neuer_spieler()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end;
$$;

drop trigger if exists bei_registrierung on auth.users;
create trigger bei_registrierung
  after insert on auth.users
  for each row execute function public.neuer_spieler();

-- Prüfen, ob ein Benutzername noch frei ist (auch ohne Anmeldung aufrufbar)
create or replace function public.username_frei(name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(name));
$$;

grant execute on function public.username_frei(text) to anon, authenticated;

-- ============================================================
-- Spiel auf dem Server
-- ============================================================

-- Der alte Spielstand (vom Browser geschrieben) wird nicht mehr gebraucht
drop function if exists public.bestenliste(int);
drop table if exists public.savegames;

-- ---------- Spielregeln (Preise, Belohnungen, Zeiten) ----------
-- Zum Ändern: Table Editor > regeln > Spalte "daten" bearbeiten.
create table if not exists public.regeln (
  id int primary key default 1 check (id = 1),
  daten jsonb not null
);
insert into public.regeln (id, daten) values (1, '{"startGeld":5000,"zeitFaktor":1,"ersteWacheKostenlos":true,"wacheBaukosten":2000,"wachenLevel":[{"level":1,"stellplaetze":2,"upgradeKosten":3000},{"level":2,"stellplaetze":4,"upgradeKosten":7500},{"level":3,"stellplaetze":6,"upgradeKosten":15000},{"level":4,"stellplaetze":8,"upgradeKosten":30000},{"level":5,"stellplaetze":10,"upgradeKosten":null}],"einsatzDauern":[{"key":"15m","minuten":15,"proMinute":10,"xpProMinute":2},{"key":"30m","minuten":30,"proMinute":8,"xpProMinute":1.6},{"key":"1h","minuten":60,"proMinute":6,"xpProMinute":1.2},{"key":"4h","minuten":240,"proMinute":4,"xpProMinute":0.8},{"key":"8h","minuten":480,"proMinute":3,"xpProMinute":0.6},{"key":"12h","minuten":720,"proMinute":2.5,"xpProMinute":0.5}],"fahrzeuge":[{"typ":"KTW","preis":1500,"abWacheLevel":1,"faktor":0.8},{"typ":"RTW","preis":3000,"abWacheLevel":1,"faktor":1},{"typ":"NEF","preis":6000,"abWacheLevel":3,"faktor":1.4},{"typ":"ITW","preis":12000,"abWacheLevel":5,"faktor":1.8}],"quiz":{"fragenProRunde":10,"geldProRichtig":50,"xpProRichtig":25,"sperreStunden":24}}'::jsonb)
on conflict (id) do nothing;
-- Tägliche Belohnung: Eintrag 1 = Tag 1 der Serie ... Eintrag 7 = Tag 7, danach beginnt die Woche von vorn
update public.regeln
   set daten = daten || '{"taeglich":{"geld":[250,350,500,650,800,1000,2000],"xp":[10,15,20,25,30,40,100]}}'::jsonb
 where id = 1 and not (daten ? 'taeglich');
-- Transport ins Krankenhaus: Wahrscheinlichkeit je Fahrzeugtyp (0 bis 1) und Aufschlag auf Geld und Punkte
update public.regeln
   set daten = daten || '{"transport":{"chance":{"KTW":1,"RTW":0.7,"NEF":0,"ITW":1},"bonus":0.2}}'::jsonb
 where id = 1 and not (daten ? 'transport');
-- Erfolge: wert = welche Zahl zählt, ziel = ab wann, geld/xp = einmalige Belohnung
update public.regeln
   set daten = daten || jsonb_build_object('erfolge', '[{"key": "erste_wache", "name": "Grundstein", "text": "Baue deine erste Rettungswache", "symbol": "🏠", "wert": "wachen", "ziel": 1, "geld": 250, "xp": 25}, {"key": "wachen_3", "name": "Rettungsdienstbereich", "text": "Besitze 3 Rettungswachen", "symbol": "🗺️", "wert": "wachen", "ziel": 3, "geld": 1500, "xp": 100}, {"key": "wachen_10", "name": "Kreisleitstelle", "text": "Besitze 10 Rettungswachen", "symbol": "🏢", "wert": "wachen", "ziel": 10, "geld": 10000, "xp": 500}, {"key": "wache_lvl3", "name": "Ausgebaut", "text": "Baue eine Wache auf Level 3 aus", "symbol": "🔧", "wert": "wacheLevel", "ziel": 3, "geld": 1500, "xp": 100}, {"key": "wache_lvl5", "name": "Lehrrettungswache", "text": "Baue eine Wache auf Level 5 aus", "symbol": "🏆", "wert": "wacheLevel", "ziel": 5, "geld": 6000, "xp": 300}, {"key": "fahrzeuge_5", "name": "Fuhrpark", "text": "Besitze 5 Fahrzeuge", "symbol": "🚑", "wert": "fahrzeuge", "ziel": 5, "geld": 1500, "xp": 100}, {"key": "fahrzeuge_20", "name": "Großer Fuhrpark", "text": "Besitze 20 Fahrzeuge", "symbol": "🚒", "wert": "fahrzeuge", "ziel": 20, "geld": 8000, "xp": 400}, {"key": "einsatz_1", "name": "Erster Einsatz", "text": "Schließe deinen ersten Einsatz ab", "symbol": "🚨", "wert": "einsaetze", "ziel": 1, "geld": 250, "xp": 25}, {"key": "einsatz_10", "name": "Eingespielt", "text": "Schließe 10 Einsätze ab", "symbol": "⏱️", "wert": "einsaetze", "ziel": 10, "geld": 750, "xp": 50}, {"key": "einsatz_100", "name": "Routinier", "text": "Schließe 100 Einsätze ab", "symbol": "🎖️", "wert": "einsaetze", "ziel": 100, "geld": 4000, "xp": 250}, {"key": "einsatz_1000", "name": "Legende der Leitstelle", "text": "Schließe 1.000 Einsätze ab", "symbol": "👑", "wert": "einsaetze", "ziel": 1000, "geld": 25000, "xp": 1500}, {"key": "transport_10", "name": "Patientenbringer", "text": "Bringe 10 Patienten ins Krankenhaus", "symbol": "🏥", "wert": "transporte", "ziel": 10, "geld": 1000, "xp": 75}, {"key": "transport_100", "name": "Klinik-Stammgast", "text": "Bringe 100 Patienten ins Krankenhaus", "symbol": "💉", "wert": "transporte", "ziel": 100, "geld": 6000, "xp": 300}, {"key": "quiz_10", "name": "Wissbegierig", "text": "Beantworte 10 Quizfragen richtig", "symbol": "📘", "wert": "quizRichtig", "ziel": 10, "geld": 500, "xp": 50}, {"key": "quiz_100", "name": "Wandelndes Lehrbuch", "text": "Beantworte 100 Quizfragen richtig", "symbol": "🎓", "wert": "quizRichtig", "ziel": 100, "geld": 4000, "xp": 250}, {"key": "quiz_folge_10", "name": "Fehlerfrei", "text": "Beantworte 10 Quizfragen in Folge richtig", "symbol": "🎯", "wert": "quizFolge", "ziel": 10, "geld": 1500, "xp": 100}, {"key": "serie_7", "name": "Eine Woche dabei", "text": "Hol dir 7 Tage am Stück die tägliche Belohnung", "symbol": "📅", "wert": "serie", "ziel": 7, "geld": 1500, "xp": 100}, {"key": "serie_30", "name": "Treue Seele", "text": "Hol dir 30 Tage am Stück die tägliche Belohnung", "symbol": "❤️", "wert": "serie", "ziel": 30, "geld": 10000, "xp": 500}, {"key": "punkte_8100", "name": "Aufsteiger", "text": "Erreiche Spieler-Level 10", "symbol": "⭐", "wert": "xp", "ziel": 8100, "geld": 3000, "xp": 0}, {"key": "punkte_57600", "name": "Ass im Rettungsdienst", "text": "Erreiche Spieler-Level 25", "symbol": "🌟", "wert": "xp", "ziel": 57600, "geld": 15000, "xp": 0}]'::jsonb)
 where id = 1 and not (daten ? 'erfolge');

-- ---------- Spielstand ----------
create table if not exists public.spieler_stand (
  user_id uuid primary key references auth.users (id) on delete cascade,
  geld bigint not null default 0,
  xp bigint not null default 0,
  einsaetze int not null default 0,
  quiz_richtig int not null default 0,
  quiz_gesamt int not null default 0,
  xp_einsaetze bigint not null default 0,
  xp_quiz bigint not null default 0
);
alter table public.spieler_stand add column if not exists bonus_tag date;              -- letzter Tag mit abgeholter Belohnung
alter table public.spieler_stand add column if not exists bonus_serie int not null default 0; -- Tage am Stück
-- Zähler für Erfolge
alter table public.spieler_stand add column if not exists bonus_serie_max int not null default 0;
alter table public.spieler_stand add column if not exists transporte int not null default 0;
alter table public.spieler_stand add column if not exists quiz_folge int not null default 0;
alter table public.spieler_stand add column if not exists quiz_folge_max int not null default 0;
update public.spieler_stand set bonus_serie_max = bonus_serie where bonus_serie_max < bonus_serie;

-- Freigeschaltete Erfolge
create table if not exists public.erfolge_erreicht (
  user_id uuid not null references auth.users (id) on delete cascade,
  erfolg text not null,
  zeitpunkt timestamptz not null default now(),
  primary key (user_id, erfolg)
);
alter table public.erfolge_erreicht enable row level security;

create table if not exists public.wachen (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  lat double precision not null check (lat between -85 and 85),
  lng double precision not null check (lng between -180 and 180),
  level int not null default 1,
  erstellt timestamptz not null default clock_timestamp()
);
create index if not exists wachen_user on public.wachen (user_id);

create table if not exists public.fahrzeuge (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wache_id uuid not null references public.wachen (id) on delete cascade,
  typ text not null,
  nr int not null,
  name text check (name is null or char_length(name) between 1 and 30),
  e_dauer text,
  e_start timestamptz,
  e_ende timestamptz,
  e_stichwort text,
  e_ziel jsonb,
  e_route jsonb,
  e_geld int,
  e_xp int,
  erstellt timestamptz not null default clock_timestamp()
);
create index if not exists fahrzeuge_user on public.fahrzeuge (user_id);
-- Transport ins Krankenhaus (e_kh = Krankenhaus, Routen nur fürs Aussehen)
alter table public.fahrzeuge add column if not exists e_kh jsonb;
alter table public.fahrzeuge add column if not exists e_route_kh jsonb;
alter table public.fahrzeuge add column if not exists e_route_heim jsonb;
create index if not exists fahrzeuge_wache on public.fahrzeuge (wache_id);

-- ---------- Quiz ----------
-- Neue Fragen: Table Editor > fragen > Insert row.
-- antworten = Liste mit genau 4 Texten, richtig = Nummer der richtigen Antwort (0 bis 3)
create table if not exists public.fragen (
  id bigserial primary key,
  frage text not null,
  antworten jsonb not null check (jsonb_typeof(antworten) = 'array' and jsonb_array_length(antworten) = 4),
  richtig int not null check (richtig between 0 and 3),
  kategorie text,
  aktiv boolean not null default true
);

create table if not exists public.quiz_offen (
  user_id uuid not null references auth.users (id) on delete cascade,
  frage_id bigint not null references public.fragen (id) on delete cascade,
  ausgegeben timestamptz not null default now(),
  primary key (user_id, frage_id)
);

create table if not exists public.quiz_beantwortet (
  user_id uuid not null references auth.users (id) on delete cascade,
  frage_id bigint not null references public.fragen (id) on delete cascade,
  zeitpunkt timestamptz not null default now(),
  richtig boolean not null
);
create index if not exists quiz_beantwortet_idx on public.quiz_beantwortet (user_id, frage_id, zeitpunkt);

insert into public.fragen (frage, antworten, richtig, kategorie)
select f.frage, f.antworten, f.richtig, f.kategorie
from jsonb_to_recordset('[{"frage":"Welche Notrufnummer gilt EU-weit für Rettungsdienst und Feuerwehr?","antworten":["110","112","116 117","19222"],"richtig":1,"kategorie":"Grundlagen"},{"frage":"Wofür steht die Abkürzung RTW?","antworten":["Rettungstransportwagen","Rettungswagen","Regionaler Transportwagen","Rettungstechnischer Wagen"],"richtig":1,"kategorie":"Fahrzeuge"},{"frage":"Welches Verhältnis von Herzdruckmassage zu Beatmung gilt bei der Reanimation Erwachsener?","antworten":["15:2","30:2","5:1","30:1"],"richtig":1,"kategorie":"Reanimation"},{"frage":"Mit welcher Frequenz sollen Thoraxkompressionen bei Erwachsenen erfolgen?","antworten":["60–80 pro Minute","80–100 pro Minute","100–120 pro Minute","120–140 pro Minute"],"richtig":2,"kategorie":"Reanimation"},{"frage":"Wie tief soll der Brustkorb bei Erwachsenen während der Herzdruckmassage eingedrückt werden?","antworten":["2–3 cm","3–4 cm","5–6 cm","8–10 cm"],"richtig":2,"kategorie":"Reanimation"},{"frage":"Welchen Höchstwert kann die Glasgow Coma Scale (GCS) erreichen?","antworten":["10","12","15","20"],"richtig":2,"kategorie":"Diagnostik"},{"frage":"Wofür steht das „A“ im ABCDE-Schema?","antworten":["Airway (Atemweg)","Atmung","Allgemeinzustand","Anamnese"],"richtig":0,"kategorie":"Diagnostik"},{"frage":"Wofür steht der FAST-Test?","antworten":["Herzinfarkt","Schlaganfall","Unterzuckerung","Lungenembolie"],"richtig":1,"kategorie":"Notfälle"},{"frage":"Welche Atemfrequenz ist bei einem gesunden Erwachsenen in Ruhe normal?","antworten":["4–8 pro Minute","12–20 pro Minute","25–35 pro Minute","40–50 pro Minute"],"richtig":1,"kategorie":"Vitalwerte"},{"frage":"In welche Lage bringt man eine bewusstlose Person mit normaler Atmung?","antworten":["Schocklage","Oberkörperhochlagerung","Stabile Seitenlage","Flache Rückenlage"],"richtig":2,"kategorie":"Erste Hilfe"},{"frage":"Wofür steht die Abkürzung NEF?","antworten":["Notfall-Einsatzfahrzeug","Notarzteinsatzfahrzeug","Notarzt-Erstversorgungsfahrzeug","Nächstes Einsatzfahrzeug"],"richtig":1,"kategorie":"Fahrzeuge"},{"frage":"Welche Telefonnummer hat der ärztliche Bereitschaftsdienst in Deutschland?","antworten":["112","110","116 117","115"],"richtig":2,"kategorie":"Grundlagen"}]'::jsonb) as f(frage text, antworten jsonb, richtig int, kategorie text)
where not exists (select 1 from public.fragen);

-- Kategorien für die NotSan-Ausbildung in NRW: alte Beispielfragen einsortieren (nur wenn noch unverändert)
update public.fragen set kategorie = case kategorie
    when 'Grundlagen' then 'Einsatztaktik & Kommunikation'
    when 'Fahrzeuge' then 'Einsatztaktik & Kommunikation'
    when 'Vitalwerte' then 'Physiologie'
    else 'Notfallmedizin' end
 where kategorie in ('Grundlagen', 'Fahrzeuge', 'Reanimation', 'Diagnostik', 'Notfälle', 'Vitalwerte', 'Erste Hilfe');
-- Startfragen je Kategorie (jede Frage nur einmal, eigene Änderungen bleiben erhalten)
insert into public.fragen (frage, antworten, richtig, kategorie)
select f.frage, f.antworten, f.richtig, f.kategorie
from jsonb_to_recordset('[{"frage": "Wo entsteht beim gesunden Herzen normalerweise die elektrische Erregung?", "antworten": ["AV-Knoten", "Sinusknoten", "His-Bündel", "Purkinje-Fasern"], "richtig": 1, "kategorie": "Physiologie"}, {"frage": "In welchem Bereich liegt der normale pH-Wert des arteriellen Blutes?", "antworten": ["6,85–6,95", "7,05–7,15", "7,35–7,45", "7,65–7,75"], "richtig": 2, "kategorie": "Physiologie"}, {"frage": "Wie berechnet sich das Herzzeitvolumen?", "antworten": ["Schlagvolumen × Herzfrequenz", "Blutdruck × Herzfrequenz", "Schlagvolumen ÷ Herzfrequenz", "Atemfrequenz × Atemzugvolumen"], "richtig": 0, "kategorie": "Physiologie"}, {"frage": "Wie viele Halswirbel hat der Mensch?", "antworten": ["5", "7", "12", "5 bis 6, je nach Körpergröße"], "richtig": 1, "kategorie": "Physiologie"}, {"frage": "Wo findet der Gasaustausch in der Lunge statt?", "antworten": ["In der Trachea", "In den Bronchien", "In den Alveolen", "Im Rippenfell (Pleura)"], "richtig": 2, "kategorie": "Physiologie"}, {"frage": "Was ist die Ursache eines hypovolämischen Schocks?", "antworten": ["Versagen der Pumpfunktion des Herzens", "Zu wenig zirkulierendes Blutvolumen", "Allergische Reaktion mit Gefäßweitstellung", "Verlegung der Atemwege"], "richtig": 1, "kategorie": "Pathophysiologie"}, {"frage": "Was liegt beim Diabetes mellitus Typ 1 zugrunde?", "antworten": ["Absoluter Insulinmangel durch Zerstörung der Betazellen", "Insulinresistenz durch Übergewicht", "Zu hohe Insulinproduktion", "Mangel an Glukagon"], "richtig": 0, "kategorie": "Pathophysiologie"}, {"frage": "Was passiert bei einem ischämischen Schlaganfall?", "antworten": ["Ein Blutgefäß im Gehirn reißt", "Ein hirnversorgendes Gefäß wird verschlossen", "Der Hirndruck sinkt stark ab", "Die Hirnhäute entzünden sich"], "richtig": 1, "kategorie": "Pathophysiologie"}, {"frage": "Wie entsteht ein kardiales Lungenödem?", "antworten": ["Durch Rückstau von Blut bei Linksherzschwäche", "Durch Rückstau von Blut bei Rechtsherzschwäche", "Durch eine Infektion der Bronchien", "Durch zu niedrigen Blutdruck im Lungenkreislauf"], "richtig": 0, "kategorie": "Pathophysiologie"}, {"frage": "Wofür steht das „S“ im SAMPLER-Schema?", "antworten": ["Schmerzen", "Symptome", "Sauerstoffsättigung", "Schockindex"], "richtig": 1, "kategorie": "Notfallmedizin"}, {"frage": "Ab welchem Blutzuckerwert spricht man beim Erwachsenen im Rettungsdienst üblicherweise von einer Hypoglykämie?", "antworten": ["unter 60 mg/dl", "unter 120 mg/dl", "unter 150 mg/dl", "unter 200 mg/dl"], "richtig": 0, "kategorie": "Notfallmedizin"}, {"frage": "Welcher Rhythmus ist bei der Reanimation defibrillierbar?", "antworten": ["Asystolie", "Pulslose elektrische Aktivität (PEA)", "Kammerflimmern", "Sinusbradykardie"], "richtig": 2, "kategorie": "Notfallmedizin"}, {"frage": "Wofür steht das kleine „c“ im <c>ABCDE-Schema?", "antworten": ["Circulation (Kreislauf)", "Critical bleeding (kritische Blutung)", "C-Wirbelsäule", "Coma (Bewusstsein)"], "richtig": 1, "kategorie": "Traumatologie"}, {"frage": "Wann wird ein Tourniquet angelegt?", "antworten": ["Bei jeder Schnittwunde", "Bei lebensbedrohlicher Blutung an einer Extremität", "Bei einem Knochenbruch ohne Blutung", "Bei Nasenbluten"], "richtig": 1, "kategorie": "Traumatologie"}, {"frage": "Wie viel Prozent der Körperoberfläche entspricht nach der Neunerregel ein ganzer Arm beim Erwachsenen?", "antworten": ["1 %", "9 %", "18 %", "27 %"], "richtig": 1, "kategorie": "Traumatologie"}, {"frage": "Welches Medikament ist das Gegenmittel bei einer Opioid-Überdosierung?", "antworten": ["Naloxon", "Flumazenil", "Atropin", "Adrenalin"], "richtig": 0, "kategorie": "Pharmakologie"}, {"frage": "Wie viel Adrenalin wird bei der Reanimation Erwachsener nach ERC-Leitlinie pro Gabe verabreicht?", "antworten": ["0,1 mg", "0,5 mg", "1 mg", "5 mg"], "richtig": 2, "kategorie": "Pharmakologie"}, {"frage": "Was bedeutet der Applikationsweg „i.o.“?", "antworten": ["Intraoral (in den Mund)", "Intraossär (in den Knochen)", "Intraokulär (ins Auge)", "Intraoperativ"], "richtig": 1, "kategorie": "Pharmakologie"}, {"frage": "Was beschreibt die Halbwertszeit eines Medikaments?", "antworten": ["Die Zeit bis zum Wirkungseintritt", "Die Zeit, bis die Hälfte des Wirkstoffs abgebaut bzw. ausgeschieden ist", "Die halbe Haltbarkeit der Packung", "Die Dauer, bis die Hälfte der Patienten reagiert"], "richtig": 1, "kategorie": "Pharmakologie"}, {"frage": "Welches Gesetz regelt den Rettungsdienst in Nordrhein-Westfalen?", "antworten": ["Das Rettungsgesetz NRW (RettG NRW)", "Das Feuerwehrgesetz NRW", "Das Infektionsschutzgesetz", "Das Sozialgesetzbuch XI"], "richtig": 0, "kategorie": "Recht"}, {"frage": "Wie lange dauert die Ausbildung zur Notfallsanitäterin oder zum Notfallsanitäter in Vollzeit?", "antworten": ["1 Jahr", "2 Jahre", "3 Jahre", "4 Jahre"], "richtig": 2, "kategorie": "Recht"}, {"frage": "Was regelt § 2a des Notfallsanitätergesetzes?", "antworten": ["Die Dauer der Ausbildung", "Die eigenverantwortliche Durchführung heilkundlicher Maßnahmen bis zum Eintreffen des Notarztes", "Die Vergütung während der Ausbildung", "Die Pflicht zur Fortbildung"], "richtig": 1, "kategorie": "Recht"}, {"frage": "In welchem Paragraphen des Strafgesetzbuchs ist die Schweigepflicht geregelt?", "antworten": ["§ 203 StGB", "§ 223 StGB", "§ 323c StGB", "§ 34 StGB"], "richtig": 0, "kategorie": "Recht"}, {"frage": "Was regelt § 323c StGB?", "antworten": ["Körperverletzung", "Unterlassene Hilfeleistung", "Rechtfertigenden Notstand", "Fahrlässige Tötung"], "richtig": 1, "kategorie": "Recht"}, {"frage": "Wofür stehen die vier Buchstaben im PDCA-Zyklus?", "antworten": ["Plan – Do – Check – Act", "Prüfen – Dokumentieren – Controllen – Abschließen", "Plan – Decide – Control – Analyse", "Prepare – Deliver – Count – Adjust"], "richtig": 0, "kategorie": "Qualitätsmanagement"}, {"frage": "Was ist ein CIRS?", "antworten": ["Ein Funkrufname", "Ein anonymes Berichtssystem für kritische Ereignisse und Beinahe-Fehler", "Ein Gerät zur Kreislaufüberwachung", "Ein Abrechnungssystem für Einsätze"], "richtig": 1, "kategorie": "Qualitätsmanagement"}, {"frage": "Wofür steht die Norm DIN EN ISO 9001?", "antworten": ["Hygienestandards in Kliniken", "Anforderungen an Qualitätsmanagementsysteme", "Sicherheit von Rettungswagen", "Datenschutz im Gesundheitswesen"], "richtig": 1, "kategorie": "Qualitätsmanagement"}, {"frage": "Wie heißen in NRW die Vorgaben der Ärztlichen Leitungen Rettungsdienst für Maßnahmen von Notfallsanitätern?", "antworten": ["SAA und BPR (Standardarbeitsanweisungen und Behandlungspfade)", "ICD und OPS", "SOP und GCS", "DRG und PEPP"], "richtig": 0, "kategorie": "Qualitätsmanagement"}, {"frage": "Wie lange muss die hygienische Händedesinfektion mindestens einwirken (bei den meisten Mitteln)?", "antworten": ["5 Sekunden", "10 Sekunden", "30 Sekunden", "5 Minuten"], "richtig": 2, "kategorie": "Hygiene"}, {"frage": "Wie viele Momente der Händehygiene nennt die WHO?", "antworten": ["3", "5", "7", "10"], "richtig": 1, "kategorie": "Hygiene"}, {"frage": "Wofür steht die Abkürzung MRSA?", "antworten": ["Methicillin-resistenter Staphylococcus aureus", "Multiresistente Streptokokken-Art", "Mehrfach resistente Salmonellen", "Medizinisch relevanter Sporenbildner"], "richtig": 0, "kategorie": "Hygiene"}, {"frage": "Was bedeutet Status 5 im Funkmeldesystem (FMS)?", "antworten": ["Einsatz übernommen", "Sprechwunsch", "Am Einsatzort", "Nicht einsatzbereit"], "richtig": 1, "kategorie": "Einsatztaktik & Kommunikation"}, {"frage": "Was bedeutet die Sichtungskategorie Rot (SK I) beim MANV?", "antworten": ["Leicht verletzt, später behandeln", "Akute vitale Bedrohung, sofortige Behandlung", "Ohne Überlebenschance", "Unverletzt"], "richtig": 1, "kategorie": "Einsatztaktik & Kommunikation"}, {"frage": "Wofür steht die Abkürzung PSNV?", "antworten": ["Persönliche Schutz- und Notfallversorgung", "Psychosoziale Notfallversorgung", "Patientenschonende Notfall-Verlegung", "Präklinische Schmerz- und Narkoseversorgung"], "richtig": 1, "kategorie": "Einsatztaktik & Kommunikation"}, {"frage": "Welche Verordnung regelt das Betreiben und Anwenden von Medizinprodukten, z. B. die Einweisung in Geräte?", "antworten": ["MPBetreibV (Medizinprodukte-Betreiberverordnung)", "StVO", "BtMVV", "ArbZG"], "richtig": 0, "kategorie": "Medizinprodukte"}]'::jsonb) as f(frage text, antworten jsonb, richtig int, kategorie text)
where not exists (select 1 from public.fragen x where x.frage = f.frage);

-- Kein direkter Zugriff aus dem Browser: alles läuft über die Funktionen unten
alter table public.regeln enable row level security;
alter table public.spieler_stand enable row level security;
alter table public.wachen enable row level security;
alter table public.fahrzeuge enable row level security;
alter table public.fragen enable row level security;
alter table public.quiz_offen enable row level security;
alter table public.quiz_beantwortet enable row level security;

-- ============================================================
-- Interne Hilfsfunktionen
-- ============================================================

create or replace function public.rc_regeln()
returns jsonb language sql stable security definer set search_path = public as $$
  select daten from public.regeln where id = 1;
$$;

-- Spielerzeile sperren (verhindert doppelte Buchungen bei mehreren Tabs) und bei Bedarf anlegen
create or replace function public.rc_sperren(uid uuid)
returns public.spieler_stand language plpgsql security definer set search_path = public as $$
declare
  s public.spieler_stand;
begin
  if uid is null then
    raise exception 'Nicht angemeldet';
  end if;
  insert into public.spieler_stand (user_id, geld)
  values (uid, (public.rc_regeln() ->> 'startGeld')::bigint)
  on conflict (user_id) do nothing;
  select * into s from public.spieler_stand where user_id = uid for update;
  return s;
end;
$$;

-- Beendete Einsätze gutschreiben. Gibt die zurückgekehrten Fahrzeuge zurück.
create or replace function public.rc_abrechnen(uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  fertig jsonb;
  g bigint;
  x bigint;
  n int;
  nt int;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', coalesce(f.name, f.typ || ' ' || f.nr), 'wache', w.name, 'geld', f.e_geld, 'xp', f.e_xp)), '[]'::jsonb),
         coalesce(sum(f.e_geld), 0), coalesce(sum(f.e_xp), 0), count(*), count(f.e_kh)
    into fertig, g, x, n, nt
  from public.fahrzeuge f join public.wachen w on w.id = f.wache_id
  where f.user_id = uid and f.e_ende <= now();

  if n > 0 then
    update public.fahrzeuge
       set e_dauer = null, e_start = null, e_ende = null, e_stichwort = null,
           e_ziel = null, e_route = null, e_geld = null, e_xp = null,
           e_kh = null, e_route_kh = null, e_route_heim = null
     where user_id = uid and e_ende <= now();
    update public.spieler_stand
       set geld = geld + g, xp = xp + x, einsaetze = einsaetze + n, xp_einsaetze = xp_einsaetze + x,
           transporte = transporte + nt
     where user_id = uid;
  end if;
  return fertig;
end;
$$;

create or replace function public.rc_ms(t timestamptz)
returns bigint language sql immutable as $$
  select (extract(epoch from t) * 1000)::bigint;
$$;

-- Heutiges Datum nach deutscher Zeit (Tageswechsel um Mitternacht)
create or replace function public.rc_heute()
returns date language sql stable as $$
  select (now() at time zone 'Europe/Berlin')::date;
$$;

-- Zahlen, an denen die Erfolge gemessen werden
create or replace function public.rc_werte(uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'einsaetze', s.einsaetze, 'transporte', s.transporte, 'quizRichtig', s.quiz_richtig,
    'quizFolge', s.quiz_folge_max, 'serie', s.bonus_serie_max, 'xp', s.xp,
    'wachen', (select count(*) from public.wachen w where w.user_id = uid),
    'wacheLevel', coalesce((select max(level) from public.wachen w where w.user_id = uid), 0),
    'fahrzeuge', (select count(*) from public.fahrzeuge f where f.user_id = uid))
  from public.spieler_stand s where s.user_id = uid;
$$;

-- Neu erreichte Erfolge eintragen und einmalig belohnen. Gibt die neuen Erfolge zurück.
create or replace function public.rc_erfolge_pruefen(uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w jsonb := public.rc_werte(uid);
  e jsonb;
  neu jsonb := '[]'::jsonb;
begin
  if w is null then
    return neu;
  end if;
  for e in select x from jsonb_array_elements(coalesce(public.rc_regeln() -> 'erfolge', '[]'::jsonb)) x loop
    if coalesce((w ->> (e ->> 'wert'))::numeric, 0) >= (e ->> 'ziel')::numeric then
      insert into public.erfolge_erreicht (user_id, erfolg) values (uid, e ->> 'key') on conflict do nothing;
      if found then
        update public.spieler_stand
           set geld = geld + coalesce((e ->> 'geld')::bigint, 0), xp = xp + coalesce((e ->> 'xp')::bigint, 0)
         where user_id = uid;
        neu := neu || jsonb_build_array(e);
      end if;
    end if;
  end loop;
  return neu;
end;
$$;

-- Kompletter Spielstand in der Form, die das Spiel im Browser erwartet
create or replace function public.rc_stand(uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', uid,
    'name', p.username,
    'geld', s.geld,
    'xp', s.xp,
    'stats', jsonb_build_object(
      'einsaetze', s.einsaetze, 'quizRichtig', s.quiz_richtig, 'quizGesamt', s.quiz_gesamt,
      'xpEinsaetze', s.xp_einsaetze, 'xpQuiz', s.xp_quiz),
    'bonus', jsonb_build_object(
      'heute', public.rc_heute()::text,
      'abgeholt', coalesce(s.bonus_tag = public.rc_heute(), false),
      'serie', case when s.bonus_tag >= public.rc_heute() - 1 then s.bonus_serie else 0 end),
    'werte', public.rc_werte(uid),
    'erfolge', coalesce((select jsonb_object_agg(e.erfolg, public.rc_ms(e.zeitpunkt))
                         from public.erfolge_erreicht e where e.user_id = uid), '{}'::jsonb),
    'stationen', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'name', w.name, 'lat', w.lat, 'lng', w.lng, 'level', w.level,
        'fahrzeuge', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', f.id, 'typ', f.typ, 'nr', f.nr, 'name', f.name,
            'einsatz', case when f.e_ende is null then null else jsonb_build_object(
              'stichwort', f.e_stichwort, 'dauerKey', f.e_dauer,
              'start', public.rc_ms(f.e_start), 'ende', public.rc_ms(f.e_ende),
              'ziel', f.e_ziel, 'route', f.e_route, 'geld', f.e_geld, 'xp', f.e_xp,
              'kh', f.e_kh, 'routeKh', f.e_route_kh, 'routeHeim', f.e_route_heim) end)
            order by f.erstellt)
          from public.fahrzeuge f where f.wache_id = w.id), '[]'::jsonb))
        order by w.erstellt)
      from public.wachen w where w.user_id = uid), '[]'::jsonb))
  from public.spieler_stand s
  left join public.profiles p on p.id = s.user_id
  where s.user_id = uid;
$$;

-- Antwort auf jede Aktion: prüft zuerst neue Erfolge
create or replace function public.rc_antwort(uid uuid, fertig jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  neu jsonb := public.rc_erfolge_pruefen(uid);
begin
  return jsonb_build_object('stand', public.rc_stand(uid), 'fertig', fertig, 'erfolge', neu,
                            'serverZeit', public.rc_ms(clock_timestamp()));
end;
$$;

-- ============================================================
-- Aktionen, die das Spiel aufruft
-- ============================================================

create or replace function public.regeln_laden()
returns jsonb language sql stable security definer set search_path = public as $$
  select public.rc_regeln();
$$;

create or replace function public.spiel_laden()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  fertig jsonb;
begin
  perform public.rc_sperren(uid);
  fertig := public.rc_abrechnen(uid);
  return public.rc_antwort(uid, fertig);
end;
$$;

create or replace function public.wache_bauen(p_name text, p_lat double precision, p_lng double precision)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r jsonb := public.rc_regeln();
  s public.spieler_stand;
  fertig jsonb;
  kosten bigint;
begin
  s := public.rc_sperren(uid);
  fertig := public.rc_abrechnen(uid);
  select * into s from public.spieler_stand where user_id = uid;
  if exists (select 1 from public.wachen where user_id = uid) or not (r ->> 'ersteWacheKostenlos')::boolean then
    kosten := (r ->> 'wacheBaukosten')::bigint;
  else
    kosten := 0;
  end if;
  if s.geld < kosten then
    raise exception 'Nicht genug Geld';
  end if;
  insert into public.wachen (user_id, name, lat, lng) values (uid, left(trim(p_name), 40), p_lat, p_lng);
  update public.spieler_stand set geld = geld - kosten where user_id = uid;
  return public.rc_antwort(uid, fertig);
end;
$$;

create or replace function public.wache_ausbauen(p_wache uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r jsonb := public.rc_regeln();
  s public.spieler_stand;
  fertig jsonb;
  w public.wachen;
  kosten bigint;
begin
  perform public.rc_sperren(uid);
  fertig := public.rc_abrechnen(uid);
  select * into s from public.spieler_stand where user_id = uid;
  select * into w from public.wachen where id = p_wache and user_id = uid;
  if w.id is null then
    raise exception 'Wache nicht gefunden';
  end if;
  kosten := (r -> 'wachenLevel' -> (w.level - 1) ->> 'upgradeKosten')::bigint;
  if kosten is null then
    raise exception 'Maximales Level erreicht';
  end if;
  if s.geld < kosten then
    raise exception 'Nicht genug Geld';
  end if;
  update public.wachen set level = level + 1 where id = w.id;
  update public.spieler_stand set geld = geld - kosten where user_id = uid;
  return public.rc_antwort(uid, fertig);
end;
$$;

create or replace function public.fahrzeug_kaufen(p_wache uuid, p_typ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r jsonb := public.rc_regeln();
  s public.spieler_stand;
  fertig jsonb;
  w public.wachen;
  t jsonb;
  plaetze int;
begin
  perform public.rc_sperren(uid);
  fertig := public.rc_abrechnen(uid);
  select * into s from public.spieler_stand where user_id = uid;
  select * into w from public.wachen where id = p_wache and user_id = uid;
  if w.id is null then
    raise exception 'Wache nicht gefunden';
  end if;
  select x into t from jsonb_array_elements(r -> 'fahrzeuge') x where x ->> 'typ' = p_typ;
  if t is null then
    raise exception 'Unbekannter Fahrzeugtyp';
  end if;
  if w.level < (t ->> 'abWacheLevel')::int then
    raise exception 'Wache hat dafür ein zu niedriges Level';
  end if;
  plaetze := (r -> 'wachenLevel' -> (w.level - 1) ->> 'stellplaetze')::int;
  if (select count(*) from public.fahrzeuge where wache_id = w.id) >= plaetze then
    raise exception 'Keine freien Stellplätze';
  end if;
  if s.geld < (t ->> 'preis')::bigint then
    raise exception 'Nicht genug Geld';
  end if;
  insert into public.fahrzeuge (user_id, wache_id, typ, nr)
  values (uid, w.id, p_typ,
          coalesce((select max(nr) from public.fahrzeuge f join public.wachen ww on ww.id = f.wache_id
                    where f.user_id = uid and f.typ = p_typ and ww.id = w.id), 0) + 1);
  update public.spieler_stand set geld = geld - (t ->> 'preis')::bigint where user_id = uid;
  return public.rc_antwort(uid, fertig);
end;
$$;

create or replace function public.fahrzeug_umbenennen(p_fahrzeug uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  fertig jsonb;
begin
  perform public.rc_sperren(uid);
  fertig := public.rc_abrechnen(uid);
  update public.fahrzeuge set name = nullif(left(trim(coalesce(p_name, '')), 30), '')
   where id = p_fahrzeug and user_id = uid;
  if not found then
    raise exception 'Fahrzeug nicht gefunden';
  end if;
  return public.rc_antwort(uid, fertig);
end;
$$;

-- Ziel, Route und Krankenhaus kommen vom Browser (nur fürs Aussehen).
-- Dauer, Belohnung und ob ein Transport stattfindet, entscheidet der Server.
drop function if exists public.einsatz_starten(uuid, text, text, jsonb, jsonb);
create or replace function public.einsatz_starten(p_fahrzeug uuid, p_dauer text, p_stichwort text, p_ziel jsonb, p_route jsonb, p_kh jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r jsonb := public.rc_regeln();
  fertig jsonb;
  f public.fahrzeuge;
  d jsonb;
  t jsonb;
  minuten numeric;
  transport boolean;
  faktor numeric;
begin
  perform public.rc_sperren(uid);
  fertig := public.rc_abrechnen(uid);
  select * into f from public.fahrzeuge where id = p_fahrzeug and user_id = uid;
  if f.id is null then
    raise exception 'Fahrzeug nicht gefunden';
  end if;
  if f.e_ende is not null then
    raise exception 'Fahrzeug ist schon im Einsatz';
  end if;
  select x into d from jsonb_array_elements(r -> 'einsatzDauern') x where x ->> 'key' = p_dauer;
  if d is null then
    raise exception 'Unbekannte Einsatzdauer';
  end if;
  select x into t from jsonb_array_elements(r -> 'fahrzeuge') x where x ->> 'typ' = f.typ;
  minuten := (d ->> 'minuten')::numeric;
  transport := coalesce(jsonb_typeof(p_kh) = 'object'
    and jsonb_typeof(p_kh -> 'lat') = 'number' and jsonb_typeof(p_kh -> 'lng') = 'number'
    and random() < coalesce((r -> 'transport' -> 'chance' ->> f.typ)::numeric, 0), false);
  faktor := (t ->> 'faktor')::numeric * case when transport then 1 + coalesce((r -> 'transport' ->> 'bonus')::numeric, 0) else 1 end;
  update public.fahrzeuge set
    e_dauer = p_dauer,
    e_start = now(),
    e_ende = now() + make_interval(secs => minuten * 60 / greatest(coalesce((r ->> 'zeitFaktor')::numeric, 1), 1)),
    e_stichwort = left(coalesce(p_stichwort, 'Einsatz'), 60),
    e_ziel = case when jsonb_typeof(p_ziel) = 'object' then p_ziel end,
    e_route = case when jsonb_typeof(p_route) = 'array' and jsonb_array_length(p_route) <= 1000 then p_route end,
    e_geld = round(minuten * (d ->> 'proMinute')::numeric * faktor),
    e_xp = round(minuten * (d ->> 'xpProMinute')::numeric * faktor),
    e_kh = case when transport then jsonb_build_object(
      'name', left(coalesce(p_kh ->> 'name', 'Krankenhaus'), 100),
      'lat', (p_kh ->> 'lat')::double precision, 'lng', (p_kh ->> 'lng')::double precision) end,
    e_route_kh = null,
    e_route_heim = null
  where id = f.id;
  return public.rc_antwort(uid, fertig);
end;
$$;

-- Straßenrouten für den Transport nachreichen (nur fürs Aussehen)
create or replace function public.einsatz_routen(p_fahrzeug uuid, p_route_kh jsonb, p_route_heim jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  update public.fahrzeuge set
    e_route_kh = case when jsonb_typeof(p_route_kh) = 'array' and jsonb_array_length(p_route_kh) <= 1000 then p_route_kh end,
    e_route_heim = case when jsonb_typeof(p_route_heim) = 'array' and jsonb_array_length(p_route_heim) <= 1000 then p_route_heim end
  where id = p_fahrzeug and user_id = uid and e_kh is not null and e_ende > now();
  return public.rc_antwort(uid, '[]'::jsonb);
end;
$$;

-- Quizrunde: Fragen ohne Lösung. Jede Frage gibt nur einmal pro Sperrzeit Punkte.
-- Quizrunde, optional nur aus einer Kategorie (p_kategorie = null: alle)
drop function if exists public.quiz_runde();
create or replace function public.quiz_runde(p_kategorie text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  q jsonb := public.rc_regeln() -> 'quiz';
  sperre interval := make_interval(hours => coalesce((q ->> 'sperreStunden')::int, 24));
  fragen jsonb;
  gesperrt int;
  frei_ab timestamptz;
begin
  perform public.rc_sperren(uid);
  delete from public.quiz_offen where user_id = uid;

  with auswahl as (
    select f.* from public.fragen f
    where f.aktiv and (p_kategorie is null or f.kategorie = p_kategorie) and not exists (
      select 1 from public.quiz_beantwortet b
      where b.user_id = uid and b.frage_id = f.id and b.zeitpunkt > now() - sperre)
    order by random()
    limit coalesce((q ->> 'fragenProRunde')::int, 10)
  ), neu as (
    insert into public.quiz_offen (user_id, frage_id) select uid, id from auswahl returning frage_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'frage', a.frage, 'antworten', a.antworten, 'kategorie', a.kategorie)), '[]'::jsonb)
    into fragen
  from auswahl a;

  select count(*) into gesperrt from public.fragen f
  where f.aktiv and (p_kategorie is null or f.kategorie = p_kategorie)
    and exists (select 1 from public.quiz_beantwortet b
                where b.user_id = uid and b.frage_id = f.id and b.zeitpunkt > now() - sperre);
  select min(b.zeitpunkt) + sperre into frei_ab from public.quiz_beantwortet b
  join public.fragen f on f.id = b.frage_id
  where b.user_id = uid and b.zeitpunkt > now() - sperre and (p_kategorie is null or f.kategorie = p_kategorie);

  return jsonb_build_object('fragen', fragen, 'gesperrt', gesperrt,
                            'freiAb', case when frei_ab is null then null else public.rc_ms(frei_ab) end);
end;
$$;

-- Kategorien mit Anzahl Fragen, gerade freien Fragen und der eigenen Trefferquote
create or replace function public.quiz_kategorien()
returns jsonb language sql stable security definer set search_path = public as $$
  with sperre as (
    select make_interval(hours => coalesce((public.rc_regeln() -> 'quiz' ->> 'sperreStunden')::int, 24)) as dauer
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kategorie', k.kategorie, 'fragen', k.fragen, 'frei', k.frei, 'richtig', k.richtig, 'gesamt', k.gesamt)
           order by k.kategorie), '[]'::jsonb)
  from (
    select coalesce(f.kategorie, 'Allgemein') as kategorie,
           count(*) as fragen,
           count(*) filter (where not exists (
             select 1 from public.quiz_beantwortet b, sperre
             where b.user_id = auth.uid() and b.frage_id = f.id and b.zeitpunkt > now() - sperre.dauer)) as frei,
           coalesce(sum((select count(*) from public.quiz_beantwortet b where b.user_id = auth.uid() and b.frage_id = f.id and b.richtig)), 0) as richtig,
           coalesce(sum((select count(*) from public.quiz_beantwortet b where b.user_id = auth.uid() and b.frage_id = f.id)), 0) as gesamt
    from public.fragen f
    where f.aktiv
    group by coalesce(f.kategorie, 'Allgemein')
  ) k;
$$;

create or replace function public.quiz_antwort(p_frage bigint, p_antwort int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  q jsonb := public.rc_regeln() -> 'quiz';
  korrekt int;
  ist_richtig boolean;
begin
  perform public.rc_sperren(uid);
  delete from public.quiz_offen
   where user_id = uid and frage_id = p_frage and ausgegeben > now() - interval '2 hours';
  if not found then
    raise exception 'Diese Frage gehört nicht zu deiner aktuellen Runde';
  end if;
  select richtig into korrekt from public.fragen where id = p_frage;
  ist_richtig := korrekt = p_antwort;
  insert into public.quiz_beantwortet (user_id, frage_id, richtig) values (uid, p_frage, ist_richtig);
  update public.spieler_stand set
    quiz_gesamt = quiz_gesamt + 1,
    quiz_richtig = quiz_richtig + case when ist_richtig then 1 else 0 end,
    geld = geld + case when ist_richtig then (q ->> 'geldProRichtig')::bigint else 0 end,
    xp = xp + case when ist_richtig then (q ->> 'xpProRichtig')::bigint else 0 end,
    xp_quiz = xp_quiz + case when ist_richtig then (q ->> 'xpProRichtig')::bigint else 0 end,
    quiz_folge = case when ist_richtig then quiz_folge + 1 else 0 end,
    quiz_folge_max = greatest(quiz_folge_max, case when ist_richtig then quiz_folge + 1 else 0 end)
  where user_id = uid;
  return jsonb_build_object('richtig', ist_richtig, 'korrekt', korrekt, 'erfolge', public.rc_erfolge_pruefen(uid),
                            'stand', public.rc_stand(uid));
end;
$$;

-- Tägliche Belohnung abholen (einmal pro Kalendertag, Serie reißt ab, wenn ein Tag fehlt)
create or replace function public.taegliche_belohnung()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t jsonb := public.rc_regeln() -> 'taeglich';
  s public.spieler_stand;
  heute date := public.rc_heute();
  serie int;
  i int;
  g bigint;
  x bigint;
begin
  s := public.rc_sperren(uid);
  if s.bonus_tag = heute then
    raise exception 'Die heutige Belohnung hast du schon abgeholt';
  end if;
  serie := case when s.bonus_tag = heute - 1 then s.bonus_serie + 1 else 1 end;
  i := (serie - 1) % jsonb_array_length(t -> 'geld');
  g := (t -> 'geld' ->> i)::bigint;
  x := (t -> 'xp' ->> i)::bigint;
  update public.spieler_stand
     set geld = geld + g, xp = xp + x, bonus_tag = heute, bonus_serie = serie,
         bonus_serie_max = greatest(bonus_serie_max, serie)
   where user_id = uid;
  return public.rc_antwort(uid, '[]'::jsonb)
         || jsonb_build_object('belohnung', jsonb_build_object('geld', g, 'xp', x, 'serie', serie));
end;
$$;

create or replace function public.bestenliste(anzahl int default 100)
returns table (username text, xp bigint, einsaetze bigint, quiz_richtig bigint)
language sql stable security definer set search_path = public as $$
  select p.username, s.xp, s.einsaetze::bigint, s.quiz_richtig::bigint
  from public.spieler_stand s
  join public.profiles p on p.id = s.user_id
  order by s.xp desc
  limit least(greatest(anzahl, 1), 500);
$$;

-- Neuer Spieler: Profil und Startgeld anlegen
create or replace function public.neuer_spieler()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username) values (new.id, new.raw_user_meta_data ->> 'username');
  insert into public.spieler_stand (user_id, geld)
  values (new.id, coalesce((public.rc_regeln() ->> 'startGeld')::bigint, 0))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- ---------- Rechte ----------
-- Interne Hilfsfunktionen sind von außen nicht aufrufbar
revoke execute on function public.rc_werte(uuid), public.rc_erfolge_pruefen(uuid), public.rc_heute(), public.rc_regeln(), public.rc_sperren(uuid), public.rc_abrechnen(uuid),
  public.rc_stand(uuid), public.rc_antwort(uuid, jsonb) from public, anon, authenticated;

revoke execute on function public.spiel_laden(), public.wache_bauen(text, double precision, double precision),
  public.wache_ausbauen(uuid), public.fahrzeug_kaufen(uuid, text), public.fahrzeug_umbenennen(uuid, text),
  public.einsatz_starten(uuid, text, text, jsonb, jsonb, jsonb), public.einsatz_routen(uuid, jsonb, jsonb), public.quiz_runde(text), public.quiz_kategorien(), public.quiz_antwort(bigint, int),
  public.taegliche_belohnung()
  from public, anon;
grant execute on function public.spiel_laden(), public.wache_bauen(text, double precision, double precision),
  public.wache_ausbauen(uuid), public.fahrzeug_kaufen(uuid, text), public.fahrzeug_umbenennen(uuid, text),
  public.einsatz_starten(uuid, text, text, jsonb, jsonb, jsonb), public.einsatz_routen(uuid, jsonb, jsonb), public.quiz_runde(text), public.quiz_kategorien(), public.quiz_antwort(bigint, int),
  public.taegliche_belohnung()
  to authenticated;
grant execute on function public.regeln_laden(), public.bestenliste(int) to anon, authenticated;
