# Overpass-JSON -> js/krankenhaeuser.js
import json, sys, re
d = json.load(open(sys.argv[1], encoding="utf-8"))
raus = re.compile(r"psychiatr|hospiz|tagesklinik|reha|kurklinik|tierklinik|tierarzt|forensi|suchtklinik|sucht", re.I)
liste, gesehen, weg = [], set(), 0
for e in d["elements"]:
    t = e.get("tags", {})
    lat = e.get("lat", e.get("center", {}).get("lat")); lng = e.get("lon", e.get("center", {}).get("lon"))
    name = (t.get("name") or "").strip()
    if lat is None or not name: weg += 1; continue
    if t.get("emergency") == "no" or raus.search(name) or raus.search(t.get("healthcare:speciality", "")) or t.get("disused") or t.get("abandoned"):
        weg += 1; continue
    k = (name.lower(), round(lat, 2), round(lng, 2))
    if k in gesehen: weg += 1; continue
    gesehen.add(k)
    liste.append([round(lat, 5), round(lng, 5), name[:80]])
liste.sort()
with open(sys.argv[2], "w", encoding="utf-8") as f:
    f.write("// Krankenhäuser in Deutschland, Daten © OpenStreetMap-Mitwirkende (ODbL), Stand %s\n" % d.get("osm3s", {}).get("timestamp_osm_base", "?")[:10])
    f.write("// Erzeugt aus einer Overpass-Abfrage (amenity=hospital). Format: [Breitengrad, Längengrad, Name]\n")
    f.write("const KRANKENHAEUSER = [\n")
    f.write(",\n".join(json.dumps(x, ensure_ascii=False) for x in liste))
    f.write("\n];\n")
print("behalten", len(liste), "aussortiert", weg)
