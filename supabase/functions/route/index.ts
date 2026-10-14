// RescueCity – Routen über OpenRouteService abfragen, ohne den Key im Browser zu zeigen.
// In Supabase: Edge Functions > Deploy a new function > Via Editor, Name "route", diesen Code einfügen.
// Den Key unter Edge Functions > Secrets als ORS_KEY hinterlegen.
// Nur angemeldete Spieler dürfen die Funktion aufrufen (Supabase prüft das Anmelde-Token).

const ORS_KEY = Deno.env.get("ORS_KEY") ?? "";
const PROFILE = new Set(["driving-car"]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const istKoordinate = (p: unknown): p is { lat: number; lng: number } =>
  typeof p === "object" && p !== null &&
  Number.isFinite((p as any).lat) && Number.isFinite((p as any).lng) &&
  Math.abs((p as any).lat) <= 85 && Math.abs((p as any).lng) <= 180;

const antwort = (status: number, daten: unknown) =>
  new Response(JSON.stringify(daten), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return antwort(405, { error: "Nur POST erlaubt" });
  if (!ORS_KEY) return antwort(500, { error: "ORS_KEY fehlt in den Secrets" });

  let eingabe: any;
  try {
    eingabe = await req.json();
  } catch {
    return antwort(400, { error: "Ungültige Anfrage" });
  }
  const { start, ende } = eingabe ?? {};
  const profil = PROFILE.has(eingabe?.profil) ? eingabe.profil : "driving-car";
  if (!istKoordinate(start) || !istKoordinate(ende)) return antwort(400, { error: "Ungültige Koordinaten" });

  // POST-Variante: "radiuses" lässt ORS bis 5 km weit nach der nächsten Straße suchen,
  // sonst scheitert die Route, wenn Wache oder Einsatzort mitten im Feld oder Wald liegen.
  const ors = await fetch(`https://api.openrouteservice.org/v2/directions/${profil}/geojson`, {
    method: "POST",
    headers: { Authorization: ORS_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: [[start.lng, start.lat], [ende.lng, ende.lat]], radiuses: [5000, 5000] }),
  });
  const text = await ors.text();
  return new Response(text, { status: ors.status, headers: { ...cors, "Content-Type": "application/json" } });
});
