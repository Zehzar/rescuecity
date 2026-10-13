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
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', coalesce(f.name, f.typ || ' ' || f.nr), 'wache', w.name, 'geld', f.e_geld, 'xp', f.e_xp)), '[]'::jsonb),
         coalesce(sum(f.e_geld), 0), coalesce(sum(f.e_xp), 0), count(*)
    into fertig, g, x, n
  from public.fahrzeuge f join public.wachen w on w.id = f.wache_id
  where f.user_id = uid and f.e_ende <= now();

  if n > 0 then
    update public.fahrzeuge
       set e_dauer = null, e_start = null, e_ende = null, e_stichwort = null,
           e_ziel = null, e_route = null, e_geld = null, e_xp = null
     where user_id = uid and e_ende <= now();
    update public.spieler_stand
       set geld = geld + g, xp = xp + x, einsaetze = einsaetze + n, xp_einsaetze = xp_einsaetze + x
     where user_id = uid;
  end if;
  return fertig;
end;
$$;

create or replace function public.rc_ms(t timestamptz)
returns bigint language sql immutable as $$
  select (extract(epoch from t) * 1000)::bigint;
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
    'stationen', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'name', w.name, 'lat', w.lat, 'lng', w.lng, 'level', w.level,
        'fahrzeuge', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', f.id, 'typ', f.typ, 'nr', f.nr, 'name', f.name,
            'einsatz', case when f.e_ende is null then null else jsonb_build_object(
              'stichwort', f.e_stichwort, 'dauerKey', f.e_dauer,
              'start', public.rc_ms(f.e_start), 'ende', public.rc_ms(f.e_ende),
              'ziel', f.e_ziel, 'route', f.e_route, 'geld', f.e_geld, 'xp', f.e_xp) end)
            order by f.erstellt)
          from public.fahrzeuge f where f.wache_id = w.id), '[]'::jsonb))
        order by w.erstellt)
      from public.wachen w where w.user_id = uid), '[]'::jsonb))
  from public.spieler_stand s
  left join public.profiles p on p.id = s.user_id
  where s.user_id = uid;
$$;

create or replace function public.rc_antwort(uid uuid, fertig jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('stand', public.rc_stand(uid), 'fertig', fertig, 'serverZeit', public.rc_ms(clock_timestamp()));
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

-- Ziel und Route kommen vom Browser (nur fürs Aussehen), Dauer und Belohnung rechnet der Server
create or replace function public.einsatz_starten(p_fahrzeug uuid, p_dauer text, p_stichwort text, p_ziel jsonb, p_route jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r jsonb := public.rc_regeln();
  fertig jsonb;
  f public.fahrzeuge;
  d jsonb;
  t jsonb;
  minuten numeric;
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
  update public.fahrzeuge set
    e_dauer = p_dauer,
    e_start = now(),
    e_ende = now() + make_interval(secs => minuten * 60 / greatest(coalesce((r ->> 'zeitFaktor')::numeric, 1), 1)),
    e_stichwort = left(coalesce(p_stichwort, 'Einsatz'), 60),
    e_ziel = case when jsonb_typeof(p_ziel) = 'object' then p_ziel end,
    e_route = case when jsonb_typeof(p_route) = 'array' and jsonb_array_length(p_route) <= 1000 then p_route end,
    e_geld = round(minuten * (d ->> 'proMinute')::numeric * (t ->> 'faktor')::numeric),
    e_xp = round(minuten * (d ->> 'xpProMinute')::numeric * (t ->> 'faktor')::numeric)
  where id = f.id;
  return public.rc_antwort(uid, fertig);
end;
$$;

-- Quizrunde: Fragen ohne Lösung. Jede Frage gibt nur einmal pro Sperrzeit Punkte.
create or replace function public.quiz_runde()
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
    where f.aktiv and not exists (
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
  where f.aktiv and exists (select 1 from public.quiz_beantwortet b
                            where b.user_id = uid and b.frage_id = f.id and b.zeitpunkt > now() - sperre);
  select min(b.zeitpunkt) + sperre into frei_ab from public.quiz_beantwortet b
  where b.user_id = uid and b.zeitpunkt > now() - sperre;

  return jsonb_build_object('fragen', fragen, 'gesperrt', gesperrt,
                            'freiAb', case when frei_ab is null then null else public.rc_ms(frei_ab) end);
end;
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
    xp_quiz = xp_quiz + case when ist_richtig then (q ->> 'xpProRichtig')::bigint else 0 end
  where user_id = uid;
  return jsonb_build_object('richtig', ist_richtig, 'korrekt', korrekt, 'stand', public.rc_stand(uid));
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
revoke execute on function public.rc_regeln(), public.rc_sperren(uuid), public.rc_abrechnen(uuid),
  public.rc_stand(uuid), public.rc_antwort(uuid, jsonb) from public, anon, authenticated;

revoke execute on function public.spiel_laden(), public.wache_bauen(text, double precision, double precision),
  public.wache_ausbauen(uuid), public.fahrzeug_kaufen(uuid, text), public.fahrzeug_umbenennen(uuid, text),
  public.einsatz_starten(uuid, text, text, jsonb, jsonb), public.quiz_runde(), public.quiz_antwort(bigint, int)
  from public, anon;
grant execute on function public.spiel_laden(), public.wache_bauen(text, double precision, double precision),
  public.wache_ausbauen(uuid), public.fahrzeug_kaufen(uuid, text), public.fahrzeug_umbenennen(uuid, text),
  public.einsatz_starten(uuid, text, text, jsonb, jsonb), public.quiz_runde(), public.quiz_antwort(bigint, int)
  to authenticated;
grant execute on function public.regeln_laden(), public.bestenliste(int) to anon, authenticated;
