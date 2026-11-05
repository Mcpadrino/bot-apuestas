"""
Logos y marcadores desde la fuente pública de ESPN (gratis, sin clave, no gasta créditos).

No es una API oficial para desarrolladores: si ESPN la cambia, estas funciones devuelven
listas vacías y el resto del bot sigue funcionando igual, solo que sin logos ni propuestas.
"""
import difflib
import re
import sys
import unicodedata

try:
    import requests
except ImportError:
    requests = None

BASE = "https://site.api.espn.com/apis/site/v2/sports/{ruta}"

# clave de The Odds API -> ruta de ESPN
LIGAS = {
    "americanfootball_nfl": "football/nfl",
    "basketball_nba": "basketball/nba",
    "baseball_mlb": "baseball/mlb",
    "soccer_mexico_ligamx": "soccer/mex.1",
    "soccer_epl": "soccer/eng.1",
    "soccer_spain_la_liga": "soccer/esp.1",
    "soccer_italy_serie_a": "soccer/ita.1",
    "soccer_germany_bundesliga": "soccer/ger.1",
    "soccer_france_ligue_one": "soccer/fra.1",
    "soccer_uefa_champs_league": "soccer/uefa.champions",
    "soccer_uefa_europa_league": "soccer/uefa.europa",
}

VACIAS = {"fc", "cf", "club", "de", "the", "afc", "sc", "ac", "cd", "ud", "sd", "ca", "cp", "fk", "sk", "ssc",
          "as", "us", "rc", "rcd", "vfb", "vfl", "tsg", "sv", "bv", "1", "04", "05", "1899", "1846", "y", "and",
          "del", "la", "el", "los", "las"}


def normalizar(texto):
    t = unicodedata.normalize("NFD", str(texto or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9.+\- ]+", " ", t)


def palabras(texto):
    return [w for w in re.split(r"[\s\-]+", normalizar(texto)) if w and w not in VACIAS]


def _get(url, **params):
    if requests is None:
        return None
    try:
        r = requests.get(url, params=params, timeout=15, headers={"user-agent": "bitacora-apuestas"})
        return r.json() if r.ok else None
    except (requests.RequestException, ValueError):
        return None


# ---------------------------------------------------------------- equipos y logos
_cache_equipos = {}


def equipos(liga):
    """[{nombre, corto, abrev, logo, claves}] de una liga (clave de The Odds API)."""
    if liga in _cache_equipos:
        return _cache_equipos[liga]
    ruta = LIGAS.get(liga)
    lista = []
    j = _get(BASE.format(ruta=f"{ruta}/teams"), limit=200) if ruta else None
    try:
        for t in j["sports"][0]["leagues"][0]["teams"]:
            t = t["team"]
            logos = t.get("logos") or []
            lista.append({
                "nombre": t.get("displayName", ""), "corto": t.get("shortDisplayName", ""),
                "abrev": (t.get("abbreviation") or "").lower(),
                "logo": logos[0]["href"] if logos else None,
                "claves": {t.get("displayName", ""), t.get("shortDisplayName", ""), t.get("name", ""),
                           t.get("location", ""), t.get("nickname", "")} - {""},
            })
    except (TypeError, KeyError, IndexError):
        pass
    _cache_equipos[liga] = lista
    return lista


def parecido(a, b):
    """0..1: qué tanto se parecen dos nombres de equipo."""
    pa, pb = palabras(a), palabras(b)
    if not pa or not pb:
        return 0.0
    sa, sb = set(pa), set(pb)
    if sa <= sb or sb <= sa:
        return 0.95
    comun = len(sa & sb) / min(len(sa), len(sb))
    return max(comun * 0.9, difflib.SequenceMatcher(None, " ".join(pa), " ".join(pb)).ratio())


def buscar_equipo(nombre, liga):
    """El equipo de ESPN que mejor coincide con un nombre de The Odds API (o None)."""
    mejor, puntos = None, 0.0
    for e in equipos(liga):
        p = max(parecido(nombre, k) for k in e["claves"])
        if p > puntos:
            mejor, puntos = e, p
    return mejor if puntos >= 0.72 else None


def logo(nombre, liga):
    e = buscar_equipo(nombre, liga)
    return e["logo"] if e else None


# ---------------------------------------------------------------- marcadores
def marcadores(liga, fecha_yyyymmdd):
    """Partidos de un día: [{evento, liga, terminado, local, visita}] con nombre, abrev, logo, marcador, ganador."""
    ruta = LIGAS.get(liga)
    j = _get(BASE.format(ruta=f"{ruta}/scoreboard"), dates=fecha_yyyymmdd, limit=300) if ruta else None
    salida = []
    for ev in (j or {}).get("events", []) or []:
        try:
            comp = ev["competitions"][0]
            lados = {}
            for c in comp["competitors"]:
                t = c.get("team", {})
                lados[c.get("homeAway")] = {
                    "nombre": t.get("displayName", ""), "corto": t.get("shortDisplayName", ""),
                    "abrev": (t.get("abbreviation") or "").lower(), "logo": t.get("logo"),
                    "marcador": float(c.get("score") or 0), "ganador": bool(c.get("winner")),
                    "claves": {t.get("displayName", ""), t.get("shortDisplayName", ""), t.get("name", ""),
                               t.get("location", "")} - {""},
                }
            if "home" not in lados or "away" not in lados:
                continue
            salida.append({
                "evento": f"{liga}:{ev['id']}", "liga": liga, "inicio": ev.get("date", ""),
                "terminado": bool(ev.get("status", {}).get("type", {}).get("completed")),
                "local": lados["home"], "visita": lados["away"],
            })
        except (KeyError, IndexError, TypeError, ValueError):
            continue
    return salida


def texto_marcador(p):
    loc, vis = p["local"], p["visita"]
    def fmt(x):
        return str(int(x)) if float(x).is_integer() else str(x)
    return f"{vis['corto'] or vis['nombre']} {fmt(vis['marcador'])} – {fmt(loc['marcador'])} {loc['corto'] or loc['nombre']}"


def menciona(texto, equipo):
    """¿El texto escrito por el usuario menciona a este equipo? Devuelve 0..1."""
    toks = set(palabras(texto))
    if not toks:
        return 0.0
    if equipo["abrev"] and equipo["abrev"] in toks:
        return 0.9
    mejor = 0.0
    for k in equipo["claves"]:
        pk = [w for w in palabras(k) if len(w) >= 3]
        if not pk:
            continue
        if set(pk) <= toks:
            mejor = max(mejor, 1.0)
        elif any(w in toks for w in pk if len(w) >= 4):
            mejor = max(mejor, 0.8)
        else:
            for w in pk:
                if len(w) >= 5 and difflib.get_close_matches(w, list(toks), n=1, cutoff=0.85):
                    mejor = max(mejor, 0.7)
    return mejor


def resultado_probable(seleccion, p):
    """Para un partido terminado, ¿la selección ganó? 'gana', 'pierde', 'nula' o None si no se puede saber."""
    s = normalizar(seleccion)
    loc, vis = p["local"], p["visita"]
    total = loc["marcador"] + vis["marcador"]
    m = re.search(r"\b(mas|over|alta|altas)\b(?: de)?\s*(\d+(?:\.\d+)?)", s)
    if m:
        linea = float(m.group(2))
        return "gana" if total > linea else "nula" if total == linea else "pierde"
    m = re.search(r"\b(menos|under|baja|bajas)\b(?: de)?\s*(\d+(?:\.\d+)?)", s)
    if m:
        linea = float(m.group(2))
        return "gana" if total < linea else "nula" if total == linea else "pierde"
    if re.search(r"\b(empate|draw|x)\b", s):
        return "gana" if loc["marcador"] == vis["marcador"] else "pierde"
    ml, mv = menciona(seleccion, loc), menciona(seleccion, vis)
    if max(ml, mv) < 0.7 or ml == mv:
        return None
    yo, otro = (loc, vis) if ml > mv else (vis, loc)
    m = re.search(r"(?<![\d.])([+-]\d+(?:\.\d+)?)(?![\d.])", s)
    if m and abs(float(m.group(1))) < 60:              # hándicap (+9.5); los momios (+150) son >= 100
        dif = yo["marcador"] + float(m.group(1)) - otro["marcador"]
        return "gana" if dif > 0 else "nula" if dif == 0 else "pierde"
    if yo["marcador"] == otro["marcador"]:
        return "pierde"                                   # empate en fútbol: pierde la apuesta a ganador
    return "gana" if yo["marcador"] > otro["marcador"] else "pierde"


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "noticias":
    pass
elif __name__ == "__main__":       # prueba rápida: python espn.py basketball_nba 20261104
    liga = sys.argv[1] if len(sys.argv) > 1 else "americanfootball_nfl"
    print(len(equipos(liga)), "equipos;", (equipos(liga) or [{}])[0])
    if len(sys.argv) > 2:
        for p in marcadores(liga, sys.argv[2])[:5]:
            print(p["evento"], p["terminado"], texto_marcador(p))


def prueba_noticias():
    """python espn.py noticias  -> revisa noticias en español y figuras (solo para pruebas)."""
    import json as _j
    for ruta in ("soccer/mex.1", "football/nfl", "basketball/nba"):
        for params in ({"lang": "es", "region": "mx", "limit": 3}, {"limit": 3}):
            j = _get(BASE.format(ruta=f"{ruta}/news"), **params) or {}
            arts = j.get("articles", [])
            print(ruta, params.get("lang", "en"), len(arts), [(a.get("headline"), bool(a.get("images"))) for a in arts[:2]])
    j = _get(BASE.format(ruta="basketball/nba/scoreboard")) or {}
    ev = (j.get("events") or [{}])[0]
    comp = (ev.get("competitions") or [{}])[0]
    print("leaders:", _j.dumps(comp.get("leaders", [])[:1])[:600])
    print("records:", [c.get("records", [{}])[0].get("summary") for c in comp.get("competitors", [])])
    j = _get(BASE.format(ruta="soccer/mex.1/scoreboard"), dates=sys.argv[2] if len(sys.argv) > 2 else "") or {}
    for ev in (j.get("events") or [])[:2]:
        comp = ev["competitions"][0]
        print("details:", _j.dumps(comp.get("details", [])[:1])[:500])


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "noticias":
    prueba_noticias()
