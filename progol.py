"""⚽ Progol a prueba: lee la quiniela oficial de la semana y le pone probabilidad a cada partido.

La Lotería Nacional publica el boleto como imagen; aquí se lee con OCR (tesseract), se buscan los partidos en ESPN
(que trae momios gratis de casi todas las ligas) y, si no hay, en Polymarket o en el promedio histórico del Progol.
Así se ve qué tan difícil es de verdad atinarle a las 14 y, cuando terminan, cómo nos fue.

Corre en GitHub Actions (progol.yml). Necesita: tesseract-ocr + tesseract-ocr-spa, pytesseract, pillow, requests.
    python progol.py            # lee, calcula y guarda
    python progol.py --prueba   # solo muestra
"""
import csv
import datetime as dt
import io
import os
import re
import sys

import requests
from PIL import Image, ImageOps

import espn

try:
    import pytesseract
except ImportError:          # pragma: no cover
    pytesseract = None

BOT_URL = os.getenv("BOT_URL") or "https://bot-apuestas-telegram.vercel.app"
TOKEN = os.getenv("TELEGRAM_TOKEN", "")
LN = "https://www.loterianacional.gob.mx"
IMG_QUINIELA = LN + "/Documentos/juegos/Concursosysorteos/progol_quiniela/QuinielaProgol.jpg"
IMG_PORCENTAJES = LN + "/Documentos/juegos/Concursosysorteos/progol_momios/porce.jpg"
CSV_PROGOL = LN + "/Home/Historicos?ARHP=UAByAG8AZwBvAGwA"
CSV_REVANCHA = LN + "/Home/Historicos?ARHP=UAByAG8AZwBvAGwALQBSAGUAdgBhAG4AYwBoAGEA"
UA = {"user-agent": "Mozilla/5.0 (bitacora-apuestas)"}
PRUEBA = "--prueba" in sys.argv

# Ligas de ESPN donde suelen estar los partidos del Progol
LIGAS = ["fifa.friendly", "fifa.worldq.uefa", "fifa.worldq.concacaf", "fifa.worldq.conmebol", "fifa.worldq.afc", "fifa.worldq.caf",
         "uefa.nations", "concacaf.nations.league", "concacaf.gold", "conmebol.america", "fifa.world",
         "mex.1", "mex.2", "usa.1", "eng.1", "eng.2", "esp.1", "esp.2", "ita.1", "ita.2", "ger.1", "ger.2", "fra.1", "fra.2",
         "por.1", "ned.1", "bel.1", "sco.1", "tur.1", "bra.1", "bra.2", "arg.1", "col.1", "chi.1", "uru.1", "par.1", "ecu.1", "per.1",
         "jpn.1", "kor.1", "chn.1", "ksa.1", "aus.1", "uefa.champions", "uefa.europa", "uefa.europa.conf",
         "conmebol.libertadores", "conmebol.sudamericana", "concacaf.champions"]
# Nombres del boleto (español, abreviados) → como los escribe ESPN
NOMBRES = {
    "japon": "japan", "brasil": "brazil", "panama": "panama", "curazao": "curacao", "irl norte": "northern ireland",
    "irlanda norte": "northern ireland", "irlanda": "ireland", "ucrania": "ukraine", "chipre": "cyprus", "montenegro": "montenegro",
    "belgica": "belgium", "italia": "italy", "espana": "spain", "inglaterra": "england", "islas feroe": "faroe islands",
    "moldavia": "moldova", "alemania": "germany", "paises bajo": "netherlands", "paises bajos": "netherlands", "holanda": "netherlands",
    "mexico": "mexico", "jamaica": "jamaica", "georgia": "georgia", "hungria": "hungary", "noruega": "norway", "gales": "wales",
    "suecia": "sweden", "bosnia y h": "bosnia and herzegovina", "letonia": "latvia", "armenia": "armenia", "croacia": "croatia",
    "chequia": "czechia", "rep checa": "czechia", "francia": "france", "escocia": "scotland", "suiza": "switzerland", "austria": "austria",
    "polonia": "poland", "dinamarca": "denmark", "finlandia": "finland", "islandia": "iceland", "grecia": "greece", "turquia": "turkey",
    "rumania": "romania", "serbia": "serbia", "eslovaquia": "slovakia", "eslovenia": "slovenia", "albania": "albania", "kosovo": "kosovo",
    "estonia": "estonia", "lituania": "lithuania", "bulgaria": "bulgaria", "luxemburgo": "luxembourg", "malta": "malta", "andorra": "andorra",
    "estados unidos": "united states", "eua": "united states", "canada": "canada", "costa rica": "costa rica", "honduras": "honduras",
    "el salvador": "el salvador", "guatemala": "guatemala", "haiti": "haiti", "trinidad": "trinidad and tobago", "argentina": "argentina",
    "uruguay": "uruguay", "colombia": "colombia", "chile": "chile", "peru": "peru", "ecuador": "ecuador", "paraguay": "paraguay",
    "venezuela": "venezuela", "bolivia": "bolivia", "marruecos": "morocco", "egipto": "egypt", "nigeria": "nigeria", "senegal": "senegal",
    "corea sur": "south korea", "corea del sur": "south korea", "arabia saudita": "saudi arabia", "australia": "australia",
    "ny r bulls": "new york red bulls", "at mineiro": "atletico-mg", "atl mineiro": "atletico-mg", "novorizont": "novorizontino",
    "cerezo osak": "cerezo osaka", "yokohama m": "yokohama f. marinos", "queretaro": "queretaro", "s laguna": "santos",
    "c azul": "cruz azul", "atl madrid": "atletico madrid", "man united": "manchester united", "napoles": "napoli", "los angeles": "los angeles fc",
    "la galaxy": "la galaxy", "racing sant": "racing santander", "ath bilbao": "athletic club", "bolonia": "bologna", "vasco da ga": "vasco da gama",
}


def get(url, **kw):
    try:
        r = requests.get(url, headers=UA, timeout=40, **kw)
        return r if r.ok else None
    except requests.RequestException:
        return None


# ---------------------------------------------------------------- OCR del boleto
def _ocr(im, caja, psm=6, umbral=140):
    c = im.crop(caja)
    c = c.resize((c.width * 4, c.height * 4), Image.LANCZOS)
    c = ImageOps.autocontrast(c).point(lambda v: 255 if v > umbral else 0)
    return pytesseract.image_to_string(c, lang="spa", config=f"--psm {psm}")


def _nombres(txt):
    out = []
    for l in txt.splitlines():
        l = l.strip(" |[]{}—-_=:;,'\"").strip()
        if re.fullmatch(r"[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ0-9 .&'-]{2,}", l) and not re.search(r"QUINIELA|REVANCH|LOCAL|VISITA|EMPATE|SENCILLA|PROGOL|CONCURSO", l):
            out.append(re.sub(r"\s+", " ", l))
    return out


def leer_quiniela():
    r = get(IMG_QUINIELA)
    if not r or not pytesseract:
        return None
    im = Image.open(io.BytesIO(r.content)).convert("L")
    W, H = im.size
    cab = _ocr(im, (0, int(H * .12), W, int(H * .24)), psm=6, umbral=120)
    con = re.search(r"CONCURSO\s*(\d{3,5})", _ocr(im, (int(W * .1), int(H * .125), int(W * .9), int(H * .175)), psm=7, umbral=100) + " " + cab)
    def bloque(y0, y1, cuantos):           # Progol (14) y Revancha (7) se leen por separado
        lo = _nombres(_ocr(im, (int(W * .245), int(H * y0), int(W * .465), int(H * y1))))
        vi = _nombres(_ocr(im, (int(W * .54), int(H * y0), int(W * .772), int(H * y1))))
        return [{"n": i + 1, "local": lo[i].title(), "visita": vi[i].title()} for i in range(min(len(lo), len(vi), cuantos))]
    partidos, revancha = bloque(.278, .632, 14), bloque(.765, .94, 7)
    texto = re.sub(r"\s+", " ", cab).strip()
    return {"concurso": int(con.group(1)) if con else None, "texto": texto, "partidos": partidos, "revancha": revancha}


# ---------------------------------------------------------------- resultados oficiales e histórico
def resultados(url, cuantos):
    r = get(url)
    if not r or not r.text.lstrip().upper().startswith("NPRODUCTO"):
        return {}
    filas = list(csv.reader(io.StringIO(r.text)))
    cab = filas[0]
    idx = [i for i, c in enumerate(cab) if re.fullmatch(r"R\d+", c)][:cuantos]
    out = {}
    for f in filas[1:]:
        try:
            out[int(f[1])] = [f[i].strip().upper() for i in idx]
        except (ValueError, IndexError):
            continue
    return out


def tasas_base(res):
    """Qué tan seguido gana el local, empatan o gana la visita en el Progol (últimos 300 concursos)."""
    c = {"L": 0, "E": 0, "V": 0}
    for k in sorted(res)[-300:]:
        for x in res[k]:
            if x in c:
                c[x] += 1
    t = sum(c.values()) or 1
    return {k: round(v / t, 4) for k, v in c.items()}


# ---------------------------------------------------------------- probabilidades
def _ml(x):
    try:
        x = float(str(x).replace("+", ""))
    except (TypeError, ValueError):
        return None
    if x == 0:
        return None
    return 1 + x / 100 if x > 0 else 1 + 100 / -x


def _momios(comp):
    o = next((x for x in (comp.get("odds") or []) if x), None) or {}
    h = _ml((o.get("homeTeamOdds") or {}).get("moneyLine"))
    a = _ml((o.get("awayTeamOdds") or {}).get("moneyLine"))
    d = _ml((o.get("drawOdds") or {}).get("moneyLine"))
    ml = o.get("moneyline") or {}
    if not (h and a and d) and ml:
        g = lambda k: _ml(((ml.get(k) or {}).get("close") or (ml.get(k) or {}).get("open") or {}).get("odds"))
        h, a, d = h or g("home"), a or g("away"), d or g("draw")
    if not (h and a and d):
        return None
    s = 1 / h + 1 / a + 1 / d
    return {"L": round(1 / h / s, 4), "E": round(1 / d / s, 4), "V": round(1 / a / s, 4), "casa": (o.get("provider") or {}).get("name")}


def eventos_espn(desde, hasta):
    """Partidos de ESPN en esas fechas (ESPN no acepta rangos: se pide día por día, en paralelo)."""
    from concurrent.futures import ThreadPoolExecutor
    dias = [desde + dt.timedelta(days=i) for i in range((hasta - desde).days + 1)]
    pedidos = [(liga, d) for liga in LIGAS for d in dias]
    with ThreadPoolExecutor(12) as ex:
        resp = list(ex.map(lambda x: (x[0], espn._get(espn.BASE.format(ruta=f"soccer/{x[0]}") + "/scoreboard", dates=f"{x[1]:%Y%m%d}")), pedidos))
    evs, vistos = [], set()
    for liga, j in resp:
        for e in (j or {}).get("events", []):
            if e.get("id") in vistos:
                continue
            vistos.add(e.get("id"))
            c = (e.get("competitions") or [{}])[0]
            eq = {x.get("homeAway"): x for x in c.get("competitors", [])}
            if "home" not in eq or "away" not in eq:
                continue
            nom = lambda t: [t.get(k) for k in ("displayName", "shortDisplayName", "name", "location", "abbreviation") if t.get(k)]
            evs.append({"liga": liga, "liga_nombre": ((j.get("leagues") or [{}])[0]).get("name", liga), "inicio": e.get("date"),
                        "local": nom(eq["home"].get("team", {})), "visita": nom(eq["away"].get("team", {})),
                        "estado": (e.get("status") or {}).get("type", {}).get("state"),
                        "marcador": f"{eq['home'].get('score', '')}-{eq['away'].get('score', '')}",
                        "p": _momios(c), "id": e.get("id")})
    return evs


def _limpio(nombre):
    n = espn.normalizar(nombre).replace(".", " ")
    n = re.sub(r"\s+", " ", n).strip()
    return NOMBRES.get(n, n)


def emparejar(p, evs):
    """El evento de ESPN que corresponde a un partido del boleto (los dos equipos tienen que parecerse)."""
    loc, vis = _limpio(p["local"]), _limpio(p["visita"])
    mejor, pts = None, 0.0
    for e in evs:
        pl = max(espn.parecido(loc, x) for x in e["local"])
        pv = max(espn.parecido(vis, x) for x in e["visita"])
        inv = max(max(espn.parecido(loc, x) for x in e["visita"]), 0) + max(max(espn.parecido(vis, x) for x in e["local"]), 0)
        s = pl + pv
        if min(pl, pv) >= .55 and s > pts:
            mejor, pts = (e, False), s
        elif inv > max(pts, 1.3) and inv / 2 >= .62:      # el boleto a veces pone de "local" al que juega de visita
            mejor, pts = (e, True), inv
    return mejor


def fechas(texto, hoy):
    m = re.search(r"JUEGOS DEL \w+ (\d{1,2})(?: DE (\w+))? AL \w+ (\d{1,2}) DE (\w+) DE (\d{4})", texto.upper())
    meses = {m_: i + 1 for i, m_ in enumerate(["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"])}
    if m:
        a, mes2 = int(m.group(5)), meses.get(m.group(4), hoy.month)
        mes1 = meses.get(m.group(2), mes2) if m.group(2) else mes2
        try:
            return dt.date(a, mes1, int(m.group(1))) - dt.timedelta(days=1), dt.date(a, mes2, int(m.group(3))) + dt.timedelta(days=1)
        except ValueError:
            pass
    return hoy, hoy + dt.timedelta(days=7)


def probabilidades(lista, evs, base):
    for p in lista:
        par = emparejar(p, evs)
        if par:
            e, al_reves = par
            p.update({"liga": e["liga_nombre"], "inicio": e["inicio"], "espn": e["id"],
                      "espn_local": e["local"][0], "espn_visita": e["visita"][0], "al_reves": al_reves})
            q = e["p"]
            if q:
                p["p"] = {"L": q["V"], "E": q["E"], "V": q["L"]} if al_reves else {k: q[k] for k in "LEV"}
                p["fuente"] = f"Momios {q.get('casa') or 'ESPN'}"
        if "p" not in p:
            p["p"], p["fuente"] = dict(base), "Promedio histórico del Progol"
    return lista


def api(accion, datos):
    r = requests.post(f"{BOT_URL}/api/telegram", params={"progol": "1"}, headers={"x-bot-token": TOKEN},
                      json={"accion": accion, "datos": datos}, timeout=40)
    r.raise_for_status()
    return r.json()


def main():
    hoy = dt.date.today()
    res_p, res_r = resultados(CSV_PROGOL, 14), resultados(CSV_REVANCHA, 7)
    base = tasas_base(res_p) if res_p else {"L": .45, "E": .27, "V": .28}
    print("Tasas históricas del Progol:", base, "· concursos con resultado:", len(res_p))
    q = leer_quiniela()
    if not q or len(q["partidos"]) < 10:
        print("⚠️ No pude leer la quiniela de la semana", q)
    else:
        if not q["concurso"] and res_p:
            q["concurso"] = max(res_p) + 1
        d1, d2 = fechas(q["texto"], hoy)
        evs = eventos_espn(d1, d2)
        print(f"Concurso {q['concurso']} · partidos ESPN del {d1} al {d2}: {len(evs)}")
        probabilidades(q["partidos"], evs, base)
        probabilidades(q["revancha"], evs, base)
        for p in q["partidos"] + q["revancha"]:
            print(f"  {p['n']:>2} {p['local']:<16} vs {p['visita']:<16} → {p.get('espn_local', '¿?'):<22} {p['p']} ({p['fuente']})")
        inicios = [p["inicio"] for p in q["partidos"] if p.get("inicio")]
        q["cierre"] = min(inicios) if inicios else f"{d1 + dt.timedelta(days=1)}T00:00:00Z"
        q["base"] = base
        if not PRUEBA:
            print(api("guardar", {"concurso": q["concurso"], "datos": q}))
    # resultados oficiales de los últimos concursos
    ult = sorted(res_p)[-8:]
    if ult and not PRUEBA:
        print(api("resultados", {"concursos": [{"concurso": k, "progol": res_p[k], "revancha": res_r.get(k)} for k in ult]}))


if __name__ == "__main__":
    main()
