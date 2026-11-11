"""⚽ Progol a prueba: lee las quinielas oficiales (Progol + Revancha, Progol Media Semana y Protouch) y le pone
probabilidad a cada partido. También arma los boletos reales más probables de cada tamaño permitido (sencilla, dobles,
triples) y, cuando salen los resultados, guarda cuánto pagó cada lugar para ver cuánto habría ganado cada boleto.

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
DOC = LN + "/Documentos/juegos/Concursosysorteos/"
UA = {"user-agent": "Mozilla/5.0 (bitacora-apuestas)"}
PRUEBA = "--prueba" in sys.argv

# Ligas de ESPN donde suelen estar los partidos del Progol
LIGAS = ["fifa.friendly", "fifa.worldq.uefa", "fifa.worldq.concacaf", "fifa.worldq.conmebol", "fifa.worldq.afc", "fifa.worldq.caf",
         "uefa.nations", "concacaf.nations.league", "concacaf.gold", "conmebol.america", "fifa.world",
         "mex.1", "mex.2", "usa.1", "eng.1", "eng.2", "esp.1", "esp.2", "ita.1", "ita.2", "ger.1", "ger.2", "fra.1", "fra.2",
         "por.1", "ned.1", "bel.1", "sco.1", "tur.1", "bra.1", "bra.2", "arg.1", "col.1", "chi.1", "uru.1", "par.1", "ecu.1", "per.1",
         "jpn.1", "kor.1", "chn.1", "ksa.1", "aus.1", "uefa.champions", "uefa.wchampions", "uefa.europa", "uefa.europa.conf",
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
    import time
    for intento in range(3):              # la página de la Lotería a veces tarda o no contesta
        try:
            r = requests.get(url, headers=UA, timeout=45, **kw)
            if r.ok:
                return r
        except requests.RequestException:
            pass
        time.sleep(8 * (intento + 1))
    return None


# ---------------------------------------------------------------- reglas oficiales de cada juego
# Tabla de quinielas múltiples (loterianacional.gob.mx → Quinielas Múltiples): con T triples, cuántos dobles caben.
MAX_DOBLES = {"progol": [8, 6, 5, 3, 2, 0], "protouch": [8, 6, 5, 3, 2, 0], "revancha": [3, 3, 3], "media": [3, 3, 3]}
PRECIO = {"progol": 15, "revancha": 5, "media": 15, "protouch": 10}


def mejor_boleto(ps, triples, dobles):
    """Dónde poner T triples y D dobles para que el boleto tenga la mayor probabilidad de atinarle a todo.
    Programación dinámica exacta: en cada partido se elige sencillo (el más probable), doble (los dos más probables) o triple."""
    import math
    INF = float("-inf")
    opciones = []
    for p in ps:
        orden = sorted("LEV", key=lambda k: -p[k])
        opciones.append([(orden[0], p[orden[0]]), (orden[0] + orden[1], p[orden[0]] + p[orden[1]]), ("LEV", 1.0)])
    # f[t][d] = (log prob, marcas) usando t triples y d dobles
    f = {(0, 0): (0.0, [])}
    for op in opciones:
        g = {}
        for (t, d), (lp, m) in f.items():
            for tipo, (marca, pr) in enumerate(op):
                nt, nd = t + (tipo == 2), d + (tipo == 1)
                if nt > triples or nd > dobles:
                    continue
                v = lp + math.log(max(pr, 1e-9))
                if v > g.get((nt, nd), (INF,))[0]:
                    g[(nt, nd)] = (v, m + ["".join(sorted(marca, key="LEV".index))])
        f = g
    lp, marcas = f.get((triples, dobles), (INF, None))
    return marcas, (math.exp(lp) if marcas else 0)


def boletos(juego, ps):
    """Todos los tamaños de boleto que permite la Lotería, cada uno con sus marcas más probables."""
    out = []
    n = len(ps)
    for t, maxd in enumerate(MAX_DOBLES[juego]):
        for d in range(maxd + 1):
            if t + d > n:
                continue
            marcas, pr = mejor_boleto(ps, t, d)
            if marcas:
                comb = 2 ** d * 3 ** t
                out.append({"t": t, "d": d, "combos": comb, "costo": comb * PRECIO[juego], "marcas": marcas, "p": round(pr, 8)})
    return out


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


QUINIELAS = {   # imagen de la quiniela de la semana y dónde están los nombres (proporciones de la imagen)
    "media": {"img": DOC + "progol_media_quiniela/proxima-media.jpg", "loc": (.245, .49, .465, .85), "vis": (.55, .49, .755, .85),
              "cab": (.1, .24, .9, .4), "tit": (.2, .3), "n": 9},
    "protouch": {"img": DOC + "protouch_quiniela/Quiniela_de_la_semana.jpg", "loc": (.215, .565, .47, .975), "vis": (.55, .565, .79, .975),
                 "cab": (.1, .17, .9, .29), "tit": (.16, .23), "n": 13},
}


def _limpia_linea(l):
    l = re.sub(r"^[\s|\[\](){}!:;,'\"_—=-]+|[\s|\[\](){}!:;,'\"_—=-]+$", "", l)
    return re.sub(r"\s+", " ", l.upper())


def _titulo(im, y0, y1):
    """Número de concurso del encabezado (franja horizontal completa, sin umbral: el título es grande y oscuro)."""
    W, H = im.size
    c = im.convert("L").crop((0, int(H * y0), W, int(H * y1)))
    c = ImageOps.autocontrast(c.resize((c.width * 3, c.height * 3)))
    m = re.search(r"CONCURSO\s*(\d{3,5})", pytesseract.image_to_string(c, lang="spa", config="--psm 6"))
    return int(m.group(1)) if m else None


def leer_otra(juego):
    cfg = QUINIELAS[juego]
    r = get(cfg["img"])
    if not r or not pytesseract:
        return None
    im = Image.open(io.BytesIO(r.content)).convert("L")
    W, H = im.size
    caja = lambda b: (int(W * b[0]), int(H * b[1]), int(W * b[2]), int(H * b[3]))
    def nombres(b):
        out = []
        for l in _ocr(im, caja(b)).splitlines():
            l = _limpia_linea(l)
            if re.fullmatch(r"[A-ZÁÉÍÓÚÑÜ0-9][A-ZÁÉÍÓÚÑÜ0-9 .&'-]{1,}", l) and not re.search(r"LOCAL|VISITA|EMPATE|DIFERENCIA|SENCILLA|CONCURSO", l):
                out.append(l)
        return out
    lo, vi = nombres(cfg["loc"]), nombres(cfg["vis"])
    cab = re.sub(r"\s+", " ", re.sub(r"[^\w\s:]", " ", _ocr(im, caja(cfg["cab"]), umbral=110))).strip()
    con = _titulo(im, *cfg["tit"])
    partidos = [{"n": i + 1, "local": lo[i].title(), "visita": vi[i].title()} for i in range(min(len(lo), len(vi), cfg["n"]))]
    return {"concurso": con, "texto": cab, "partidos": partidos}


# ---------------------------------------------------------------- premios (imagen de resultados)
PREMIOS = {   # imagen de resultados del último concurso y la franja donde vienen los premios
    "progol": {"img": DOC + "progol_resultados/QG_progol-revancha.jpg", "tit": (.1, .16), "bandas": {"progol": (.15, .42, 14), "revancha": (.75, .82, 7)}},
    "media": {"img": DOC + "progol_media_resultados/QG_progol_media.jpg", "tit": (.2, .3), "bandas": {"media": (.33, .47, 9)}},
    "protouch": {"img": DOC + "protouch_resultados/resultados_Protouch.jpg", "tit": (.12, .18), "bandas": {"protouch": (.4, .6, 13)}},
}


def leer_premios(juego, ultimo=None):
    """Cuánto pagó cada lugar (por quiniela sencilla) en el último concurso. Devuelve (concurso, {bloque: [{aciertos, ganadores, premio}]})."""
    cfg = PREMIOS[juego]
    r = get(cfg["img"])
    if not r or not pytesseract:
        return None, {}
    im = Image.open(io.BytesIO(r.content)).convert("RGB")
    W, H = im.size
    con = _titulo(im, *cfg["tit"])
    out = {}
    for bloque, (y0, y1, total) in cfg["bandas"].items():
        c = im.crop((int(W * .15), int(H * y0), int(W * .87), int(H * y1)))
        c = c.resize((c.width * 3, c.height * 3), Image.LANCZOS).convert("L").point(lambda v: 0 if v < 110 else 255)
        filas, prev = [], total + 1
        for l in pytesseract.image_to_string(c, lang="spa", config="--psm 6").splitlines():
            m = re.search(r"([\d,.]+)\s+(\S+)\s+\S*\$\s*([\dIl,]+\.\d\d)", l)
            if not m:
                continue
            premio = float(m.group(3).replace("I", "1").replace("l", "1").replace(",", ""))
            ac = re.sub(r"\D", "", m.group(2).replace("T", "1").replace("n", "1").replace("I", "1"))
            ac = int(ac) if ac else 0
            # el OCR a veces lee "11" como "1": los lugares van seguidos y en orden descendente
            if filas:
                ac = prev - 1
            elif not (total - 4 <= ac <= total):
                ac = total
            gan = int(re.sub(r"\D", "", m.group(1)) or 0)
            filas.append({"aciertos": ac, "ganadores": gan, "premio": premio})
            prev = ac
        out[bloque] = filas
    # si no se alcanza a leer el número, es el último concurso con resultado oficial
    if not con:
        return None, {}     # sin número seguro no se guarda: podría ser de otro concurso
    return con, out


# ---------------------------------------------------------------- resultados oficiales e histórico
BOLSAS = {}


def resultados(url, cuantos):
    r = get(url)
    if not r or not r.text.lstrip().upper().startswith("NPRODUCTO"):
        return {}
    filas = list(csv.reader(io.StringIO(r.text)))
    cab = [c.strip().upper() for c in filas[0]]
    idx = [i for i, c in enumerate(cab) if re.fullmatch(r"R\d+", c)][:cuantos]
    ib = cab.index("BOLSA") if "BOLSA" in cab else None
    out = {}
    for f in filas[1:]:
        try:
            # Protouch usa "D" (diferencia de hasta 6 puntos); aquí se guarda como "E" para tratar igual a todos los juegos
            out[int(f[1])] = [f[i].strip().upper().replace("D", "E") for i in idx]
            if ib is not None and f[ib].strip():
                BOLSAS[(url, int(f[1]))] = float(f[ib])
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
                        "p": _momios(c), "id": e.get("id"), "neutral": bool(c.get("neutralSite"))})
    return evs


# ---------------------------------------------------------------- Protouch (NFL / colegial)
NFL = {"leones": "lions", "patriotas": "patriots", "halcones": "falcons", "jefes": "chiefs", "browns": "browns", "texanos": "texans",
       "empacadores": "packers", "vikingos": "vikings", "potros": "colts", "delfines": "dolphins", "santos": "saints", "panteras": "panthers",
       "jets": "jets", "bills": "bills", "titanes": "titans", "jaguares": "jaguars", "cardenales": "cardinals", "carneros": "rams",
       "raiders": "raiders", "halc mar": "seahawks", "halcones marinos": "seahawks", "vaqueros": "cowboys", "49s": "49ers", "49ers": "49ers",
       "bengalies": "bengals", "acereros": "steelers", "cuervos": "ravens", "cargadores": "chargers", "aguilas": "eagles", "gigantes": "giants",
       "commanders": "commanders", "broncos": "broncos", "bucaneros": "buccaneers", "osos": "bears", "pieles rojas": "commanders"}
SD_MARGEN = {"nfl": 12.0, "college-football": 14.0}   # dispersión del margen final contra la línea (puntos), ajustada para
# que la "D" salga tan seguido como en el histórico del Protouch (~40% de los partidos)


def _ncdf(x):
    import math
    return .5 * (1 + math.erf(x / math.sqrt(2)))


def _ninv(p):
    lo, hi = -6.0, 6.0
    for _ in range(60):
        m = (lo + hi) / 2
        lo, hi = (m, hi) if _ncdf(m) < p else (lo, m)
    return (lo + hi) / 2


def _lineas(comp, liga):
    """L / D / V del Protouch a partir de la línea de puntos: el margen final (local − visita) se modela como normal
    centrada en la línea. L = gana el local por 7 o más, V = la visita por 7 o más, D = diferencia de 6 o menos."""
    o = next((x for x in (comp.get("odds") or []) if x), None) or {}
    eq = {x.get("homeAway"): x for x in comp.get("competitors", [])}
    sd = SD_MARGEN.get(liga, 14)
    mu = None
    m = re.match(r"\s*(\S+)\s+(-?\d+(?:\.\d+)?)", str(o.get("details") or ""))
    if m:
        ab = m.group(1).upper()
        x = abs(float(m.group(2)))
        home = ((eq.get("home") or {}).get("team") or {}).get("abbreviation", "").upper()
        away = ((eq.get("away") or {}).get("team") or {}).get("abbreviation", "").upper()
        mu = x if ab == home else (-x if ab == away else None)
    elif str(o.get("details") or "").upper().startswith("EVEN"):
        mu = 0.0
    if mu is None:
        h, a = _ml((o.get("homeTeamOdds") or {}).get("moneyLine")), _ml((o.get("awayTeamOdds") or {}).get("moneyLine"))
        if h and a:
            mu = sd * _ninv((1 / h) / (1 / h + 1 / a))
    if mu is None:
        return None
    pl, pv = 1 - _ncdf((6.5 - mu) / sd), _ncdf((-6.5 - mu) / sd)
    return {"L": round(pl, 4), "E": round(1 - pl - pv, 4), "V": round(pv, 4), "casa": (o.get("provider") or {}).get("name"), "linea": round(mu, 1)}


def eventos_americano(desde, hasta):
    from concurrent.futures import ThreadPoolExecutor
    dias = [desde + dt.timedelta(days=i) for i in range((hasta - desde).days + 1)]
    pedidos = [(liga, d) for liga in ("nfl", "college-football") for d in dias]
    def pide(x):
        extra = {"groups": "80", "limit": "300"} if x[0] == "college-football" else {}
        return x[0], espn._get(espn.BASE.format(ruta=f"football/{x[0]}") + "/scoreboard", dates=f"{x[1]:%Y%m%d}", **extra)
    with ThreadPoolExecutor(8) as ex:
        resp = list(ex.map(pide, pedidos))
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
            nom = lambda t: [t.get(k) for k in ("name", "shortDisplayName", "displayName", "location", "abbreviation") if t.get(k)]
            evs.append({"liga": liga, "liga_nombre": "NFL" if liga == "nfl" else "Colegial (NCAA)", "inicio": e.get("date"),
                        "local": nom(eq["home"].get("team", {})), "visita": nom(eq["away"].get("team", {})),
                        "p": _lineas(c, liga), "id": e.get("id"), "neutral": bool(c.get("neutralSite"))})
    return evs


def _limpio_nfl(nombre):
    n = re.sub(r"\s+", " ", espn.normalizar(nombre).replace(".", " ")).strip()
    return NFL.get(n, n)


def probabilidades_americano(lista, evs, base):
    for p in lista:
        loc, vis = _limpio_nfl(p["local"]), _limpio_nfl(p["visita"])
        mejor, pts = None, 0.0
        for e in evs:
            pl = max(espn.parecido(loc, x) for x in e["local"]); pv = max(espn.parecido(vis, x) for x in e["visita"])
            il = max(espn.parecido(loc, x) for x in e["visita"]); iv = max(espn.parecido(vis, x) for x in e["local"])
            if min(pl, pv) >= .7 and pl + pv > pts:
                mejor, pts = (e, False), pl + pv
            elif min(il, iv) >= .75 and il + iv > pts:
                mejor, pts = (e, True), il + iv
        if mejor:
            e, al_reves = mejor
            p.update({"liga": e["liga_nombre"], "inicio": e["inicio"], "espn": e["id"], "espn_local": e["local"][2] if len(e["local"]) > 2 else e["local"][0],
                      "espn_visita": e["visita"][2] if len(e["visita"]) > 2 else e["visita"][0], "al_reves": al_reves})
            q = e["p"]
            if q:
                p["p"] = {"L": q["V"], "E": q["E"], "V": q["L"]} if al_reves else {k: q[k] for k in "LEV"}
                lin = -q["linea"] if al_reves else q["linea"]
                fav = p["local"] if lin > 0 else p["visita"]
                p["fuente"] = f"Línea {q.get('casa') or 'ESPN'} ({fav} por {abs(lin):g})" if lin else f"Línea {q.get('casa') or 'ESPN'} (parejo)"
        if "p" not in p:
            p["p"], p["fuente"] = dict(base), "Promedio histórico del Protouch"
    return lista


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
        elif min(max(espn.parecido(loc, x) for x in e["visita"]), max(espn.parecido(vis, x) for x in e["local"])) >= .7 and inv > pts:
            # el boleto a veces pone de "local" al que juega de visita
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


_elo = None
def elo_selecciones():
    """Ranking Elo de selecciones (eloratings.net): fuerza de cada país, gratis."""
    global _elo
    if _elo is None:
        _elo = {}
        w, t = get("https://www.eloratings.net/World.tsv"), get("https://www.eloratings.net/en.teams.tsv")
        if w and t:
            nombre = dict(l.split("\t")[:2] for l in t.text.splitlines() if "\t" in l)
            for l in w.text.splitlines():
                c = l.split("\t")
                if len(c) > 3 and c[3].isdigit() and c[2] in nombre:
                    _elo[espn.normalizar(nombre[c[2]])] = int(c[3])
    return _elo


def p_elo(local, visita, neutral=False):
    elo = elo_selecciones()
    if not elo:
        return None
    def buscar(n):
        n = _limpio(n); k = max(elo, key=lambda x: espn.parecido(n, x))
        return elo[k] if espn.parecido(n, k) >= .85 else None
    a, b = buscar(local), buscar(visita)
    if a is None or b is None:
        return None
    dr = a - b + (0 if neutral else 100)
    we = 1 / (10 ** (-dr / 400) + 1)
    pe = max(.12, min(.32, .32 - abs(we - .5) * .45))
    pl, pv = max(.02, we - pe / 2), max(.02, 1 - we - pe / 2)
    s_ = pl + pe + pv
    return {"L": round(pl / s_, 4), "E": round(pe / s_, 4), "V": round(pv / s_, 4)}


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
            q = p_elo(p["local"], p["visita"], neutral=bool(par and par[0].get("neutral")))
            if q:
                p["p"], p["fuente"] = q, "Ranking Elo de selecciones"
        if "p" not in p:
            p["p"], p["fuente"] = dict(base), "Promedio histórico del Progol"
    return lista


def api(accion, datos):
    r = requests.post(f"{BOT_URL}/api/telegram", params={"progol": "1"}, headers={"x-bot-token": TOKEN},
                      json={"accion": accion, "datos": datos}, timeout=40)
    r.raise_for_status()
    return r.json()


def guardar(juego, q):
    q["juego"] = juego
    if not PRUEBA:
        print(api("guardar", {"juego": juego, "concurso": q["concurso"], "datos": q}))


def mostrar(q, claves=("partidos", "revancha")):
    for k in claves:
        for p in q.get(k) or []:
            print(f"  {k[:3]} {p['n']:>2} {p['local']:<16} vs {p['visita']:<16} → {p.get('espn_local', '¿?'):<22} {p['p']} ({p['fuente']})")


def main():
    hoy = dt.date.today()
    CSV_MEDIA = LN + "/Home/Historicos?ARHP=UAByAG8AZwBvAGwALQBNAGUAZABpAGEALQBTAA=="
    CSV_PROTOUCH = LN + "/Home/Historicos?ARHP=UAByAG8AdABvAHUAYwBoAA=="
    res_p, res_r = resultados(CSV_PROGOL, 14), resultados(CSV_REVANCHA, 7)
    res_m, res_t = resultados(CSV_MEDIA, 9), resultados(CSV_PROTOUCH, 13)
    base = tasas_base(res_p) if res_p else {"L": .45, "E": .27, "V": .28}
    base_m = tasas_base(res_m) if res_m else base
    base_t = tasas_base(res_t) if res_t else {"L": .35, "E": .33, "V": .32}
    print("Tasas históricas · Progol:", base, "· Media:", base_m, "· Protouch (E = diferencia ≤ 6):", base_t)

    # ---- Progol + Revancha
    try:
        q = leer_quiniela()
        if not q or len(q["partidos"]) < 10:
            print("⚠️ No pude leer la quiniela del Progol", q)
        else:
            if not q["concurso"] and res_p:
                q["concurso"] = max(res_p) + 1
            d1, d2 = fechas(q["texto"], hoy)
            evs = eventos_espn(d1, d2)
            print(f"Progol {q['concurso']} · partidos ESPN del {d1} al {d2}: {len(evs)}")
            probabilidades(q["partidos"], evs, base)
            probabilidades(q["revancha"], evs, base)
            mostrar(q)
            inicios = [p["inicio"] for p in q["partidos"] if p.get("inicio")]
            q["cierre"] = min(inicios) if inicios else f"{d1 + dt.timedelta(days=1)}T00:00:00Z"
            q["base"] = base
            q["boletos"] = {"progol": boletos("progol", [p["p"] for p in q["partidos"]]),
                            "revancha": boletos("revancha", [p["p"] for p in q["revancha"]])}
            if not res_p or q["concurso"] not in res_p:
                guardar("progol", q)
    except Exception as e:   # un juego que falle no tumba a los demás
        print("⚠️ Progol:", repr(e))

    # ---- Media Semana y Protouch
    for juego, res, b in (("media", res_m, base_m), ("protouch", res_t, base_t)):
        try:
            q = leer_otra(juego)
            if not q or len(q["partidos"]) < QUINIELAS[juego]["n"] - 2:
                print(f"⚠️ No pude leer la quiniela de {juego}", q)
                continue
            if not q["concurso"]:
                print(f"⚠️ {juego}: no pude leer el número de concurso")
                continue
            d1, d2 = fechas(q["texto"], hoy)
            if juego == "media":
                evs = eventos_espn(d1, d2)
                probabilidades(q["partidos"], evs, b)
                for p in q["partidos"]:
                    if p["fuente"].startswith("Promedio"):
                        p["fuente"] = "Promedio histórico de Media Semana"
            else:
                evs = eventos_americano(d1, d2)
                probabilidades_americano(q["partidos"], evs, b)
            print(f"{juego} {q['concurso']} · eventos ESPN del {d1} al {d2}: {len(evs)}")
            mostrar(q, ("partidos",))
            inicios = [p["inicio"] for p in q["partidos"] if p.get("inicio")]
            q["cierre"] = min(inicios) if inicios else f"{d1 + dt.timedelta(days=1)}T00:00:00Z"
            q["base"] = b
            q["boletos"] = {juego: boletos(juego, [p["p"] for p in q["partidos"]])}
            if q["concurso"] not in res:
                guardar(juego, q)
        except Exception as e:
            print(f"⚠️ {juego}:", repr(e))

    # ---- resultados oficiales y premios del último concurso de cada juego
    premios = {}
    for juego in ("progol", "media", "protouch"):
        try:
            r_ = {"progol": res_p, "media": res_m, "protouch": res_t}[juego]
            c, pr = leer_premios(juego, max(r_) if r_ else None)
            print(f"Premios {juego} concurso {c}: {pr}")
            if c:
                premios[(juego, c)] = pr
        except Exception as e:
            print(f"⚠️ premios {juego}:", repr(e))
    filas = []
    for juego, res, url in (("progol", res_p, CSV_PROGOL), ("media", res_m, CSV_MEDIA), ("protouch", res_t, CSV_PROTOUCH)):
        for k in sorted(res)[-8:]:
            r = {juego: res[k]}
            if juego == "progol":
                r["revancha"] = res_r.get(k)
            if (url, k) in BOLSAS:
                r["bolsa"] = BOLSAS[(url, k)]
            if (juego, k) in premios:
                r["premios"] = premios[(juego, k)]
            filas.append({"juego": juego, "concurso": k, "resultados": r})
    if filas and not PRUEBA:
        print(api("resultados", {"concursos": filas}))


if __name__ == "__main__":
    main()
