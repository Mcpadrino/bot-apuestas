"""Polymarket: una segunda opinión del mercado, gratis y sin clave.

Polymarket es un mercado de predicción: la gente compra "Sí/No" de cada resultado y el precio
(0 a 1) funciona como probabilidad. Lo usamos solo para COMPARAR (no se apuesta ahí):
  - en el duelo del Gurú: 🔮 Gurú vs 📌 Pinnacle vs 🟣 Polymarket
  - en las señales: si Pinnacle y Polymarket coinciden, la probabilidad es más confiable

API pública: https://gamma-api.polymarket.com (sin clave, no gasta créditos de The Odds API).
Solo se guardan precios de ANTES del partido (en vivo cambian y ya no sirven para comparar).
"""
import datetime as dt
import json

import espn

try:
    import requests
except ImportError:          # pragma: no cover
    requests = None

GAMMA = "https://gamma-api.polymarket.com"
# ruta de ESPN -> código de liga en Polymarket (/sports)
CODIGOS = {
    "soccer/mex.1": "mex", "soccer/eng.1": "epl", "soccer/esp.1": "lal", "soccer/ita.1": "sea",
    "soccer/ger.1": "bun", "soccer/fra.1": "fl1", "soccer/uefa.champions": "ucl", "soccer/uefa.europa": "uel",
    "football/nfl": "nfl", "basketball/nba": "nba", "baseball/mlb": "mlb",
}
# clave de The Odds API -> ruta de ESPN (para las señales)
ODDS_A_RUTA = dict(espn.LIGAS)
VOL_MIN = 1000          # mercados con menos de $1,000 negociados son demasiado delgados para creerles

_series = None
_juegos = {}


def _get(ruta, **params):
    if requests is None:
        return None
    try:
        r = requests.get(GAMMA + ruta, params=params, timeout=20, headers={"user-agent": "bitacora-apuestas"})
        return r.json() if r.ok else None
    except (requests.RequestException, ValueError):
        return None


def _serie(ruta):
    global _series
    if _series is None:
        _series = {}
        for s in _get("/sports") or []:
            if s.get("sport") and s.get("series"):
                _series[s["sport"]] = str(s["series"])
    return _series.get(CODIGOS.get(ruta, ""))


def _fecha(txt):
    try:
        return dt.datetime.fromisoformat(str(txt).replace("Z", "+00:00").replace(" ", "T"))
    except ValueError:
        return None


def _lista(x):
    if isinstance(x, list):
        return x
    try:
        return json.loads(x or "[]")
    except ValueError:
        return []


def _precio(m):
    """Probabilidad del 'primer' resultado: punto medio entre compra y venta si el libro está apretado."""
    bid, ask = m.get("bestBid"), m.get("bestAsk")
    if bid is not None and ask is not None and 0 <= ask - bid <= 0.05:
        return (float(bid) + float(ask)) / 2
    pr = _lista(m.get("outcomePrices"))
    return float(pr[0]) if pr else None


def juegos(ruta):
    """Partidos próximos de una liga: [{inicio, equipos: {nombre: prob}, empate, vol}] (prob. sin margen)."""
    if ruta in _juegos:
        return _juegos[ruta]
    salida = []
    serie = _serie(ruta)
    ahora = dt.datetime.now(dt.timezone.utc)
    desde = (ahora - dt.timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    eventos = _get("/events", series_id=serie, closed="false", limit=500, start_date_min=desde,
                   order="startDate", ascending="true") if serie else None
    for e in eventos or []:
        ms = [m for m in e.get("markets") or [] if m.get("sportsMarketType") == "moneyline" and not m.get("closed")]
        if not ms:
            continue
        inicio = _fecha(ms[0].get("gameStartTime") or e.get("startDate"))
        if not inicio or inicio <= ahora:           # ya empezó: el precio en vivo no sirve para comparar
            continue
        equipos, empate, vol = {}, None, 0.0
        try:
            for m in ms:
                vol += float(m.get("volume") or 0)
                p = _precio(m)
                if p is None:
                    raise ValueError
                sal = _lista(m.get("outcomes"))
                if sal[:2] == ["Yes", "No"]:              # fútbol: un mercado Sí/No por resultado
                    titulo = m.get("groupItemTitle") or ""
                    if titulo.lower().startswith("draw") or "draw" in (m.get("question") or "").lower():
                        empate = p
                    else:
                        equipos[titulo] = p
                elif len(sal) == 2:                       # NBA/NFL/MLB: "Equipo A" vs "Equipo B"
                    equipos[sal[0]], equipos[sal[1]] = p, 1 - p
        except (ValueError, TypeError, IndexError):
            continue
        if len(equipos) != 2 or vol < VOL_MIN:
            continue
        total = sum(equipos.values()) + (empate or 0)
        if total <= 0.5:
            continue
        # quitamos el pequeño "margen" (los precios suman un poco más o menos de 1)
        salida.append({"inicio": inicio, "equipos": {k: v / total for k, v in equipos.items()},
                       "empate": None if empate is None else empate / total, "vol": round(vol)})
    _juegos[ruta] = salida
    return salida


def _mejor(nombres, equipos):
    """(nombre en Polymarket, parecido) del equipo que mejor coincide con alguno de los nombres."""
    mejor, pts = None, 0.0
    for eq in equipos:
        p = max((espn.parecido(n, eq) for n in nombres if n), default=0.0)
        if p > pts:
            mejor, pts = eq, p
    return mejor, pts


def para_partido(ruta, local, visita, inicio):
    """{"L","E","V","vol"} de Polymarket para un partido, o None.
    local/visita: lista de nombres posibles de cada equipo; inicio: datetime con zona."""
    if ruta not in CODIGOS or inicio is None:
        return None
    for j in juegos(ruta):
        if abs((j["inicio"] - inicio).total_seconds()) > 3 * 3600:
            continue
        el, pl = _mejor(local, j["equipos"])
        ev, pv = _mejor(visita, j["equipos"])
        # los dos nombres se parecen, o uno se parece mucho y el otro es "el que queda" (p. ej. Pumas = Universidad Nacional)
        if el == ev or not el or not ev:
            otros = list(j["equipos"])
            if pl >= 0.85 and el:
                ev = [x for x in otros if x != el][0]
                pv = 0.85
            elif pv >= 0.85 and ev:
                el = [x for x in otros if x != ev][0]
                pl = 0.85
            else:
                continue
        if min(pl, pv) < 0.6 and max(pl, pv) < 0.85:
            continue
        out = {"L": round(j["equipos"][el], 4), "V": round(j["equipos"][ev], 4), "vol": j["vol"]}
        if j["empate"] is not None:
            out["E"] = round(j["empate"], 4)
        return out
    return None


def para_seleccion(deporte_odds, local, visita, inicio_iso, seleccion):
    """Probabilidad de Polymarket de una selección de ganador (señales del escáner), o None."""
    ruta = ODDS_A_RUTA.get(deporte_odds)
    m = para_partido(ruta, [local], [visita], _fecha(inicio_iso))
    if not m:
        return None
    if espn.normalizar(seleccion).strip() in ("draw", "empate"):
        return m.get("E")
    if espn.parecido(seleccion, local) >= espn.parecido(seleccion, visita):
        return m["L"]
    return m["V"]


if __name__ == "__main__":       # prueba rápida: python3 polymarket.py
    for r in CODIGOS:
        js = juegos(r)
        print(r, len(js), "partidos")
        for j in js[:3]:
            print("   ", j["inicio"], j["equipos"], "empate", j["empate"], "vol", j["vol"])
