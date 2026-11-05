"""
🔮 Gurú: pronósticos con modelos open source (no gasta créditos de cuotas).

- Fútbol: modelo Dixon-Coles (librería penaltyblog) con decaimiento en el tiempo: los partidos recientes pesan más.
  Calcula ataque y defensa de cada equipo con ~18 meses de resultados de ESPN.
  Liga MX se ajusta sola; las ligas europeas + Champions + Europa League se ajustan juntas (así se comparan entre ligas).
- NFL / NBA / MLB: rating Elo (método de FiveThirtyEight, con margen de victoria y ventaja de local).

Cada pronóstico se compara con la probabilidad de Pinnacle que guardó el escáner (si el partido salió en las señales),
y cuando termina el partido se guarda el resultado para medir quién acierta más: el Gurú o Pinnacle.

python pronosticos.py           -> calcula, guarda y califica
python pronosticos.py --prueba  -> solo imprime
"""
import datetime as dt
import math
import os
import sys
from collections import defaultdict

import requests

import espn

BOT_URL = os.getenv("BOT_URL", "https://bot-apuestas-telegram.vercel.app")
TOKEN = "".join(os.getenv("TELEGRAM_TOKEN", "").split())
PRUEBA = "--prueba" in sys.argv
AHORA = dt.datetime.now(dt.timezone.utc)

NOMBRES = {
    "soccer/mex.1": "Liga MX", "soccer/eng.1": "Premier", "soccer/esp.1": "LaLiga", "soccer/ita.1": "Serie A",
    "soccer/ger.1": "Bundesliga", "soccer/fra.1": "Ligue 1", "soccer/uefa.champions": "Champions",
    "soccer/uefa.europa": "Europa League", "football/nfl": "NFL", "basketball/nba": "NBA", "baseball/mlb": "MLB",
}
GRUPOS_FUTBOL = {
    "mex": ["soccer/mex.1"],
    "europa": ["soccer/eng.1", "soccer/esp.1", "soccer/ita.1", "soccer/ger.1", "soccer/fra.1",
               "soccer/uefa.champions", "soccer/uefa.europa"],
}
# Elo: K, ventaja de local (puntos Elo), puntos de Elo por punto de diferencia en el marcador
ELO = {"football/nfl": (20, 48, 25.0, "nfl"), "basketball/nba": (20, 100, 28.0, "nba"), "baseball/mlb": (4, 24, 0, "mlb")}
# Qué clave de The Odds API corresponde a cada ruta (para cruzar con Pinnacle)
ODDS = {v: k for k, v in espn.LIGAS.items()}


def api(ruta, accion, datos=None):
    r = requests.post(f"{BOT_URL}/api/telegram", params={ruta: "1"}, headers={"x-bot-token": TOKEN},
                      json={"accion": accion, "datos": datos or {}}, timeout=40)
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------- ESPN
def _dia(ruta, fecha):
    """Partidos de ESPN de un día (ESPN ya no acepta rangos de fechas)."""
    salida = []
    j = espn._get(espn.BASE.format(ruta=f"{ruta}/scoreboard"), dates=f"{fecha:%Y%m%d}", limit=300) or {}
    for ev in j.get("events") or []:
        try:
            comp = ev["competitions"][0]
            lados = {c["homeAway"]: c for c in comp["competitors"]}
            h, v = lados["home"], lados["away"]
            st = ev.get("status", {}).get("type", {})
            salida.append({
                "id": str(ev["id"]), "ruta": ruta, "fecha": dt.datetime.fromisoformat(ev["date"].replace("Z", "+00:00")),
                "estado": st.get("state"), "terminado": bool(st.get("completed")),
                "neutral": bool(comp.get("neutralSite")),
                "local": {"id": str(h["team"]["id"]), "nombre": h["team"].get("shortDisplayName") or h["team"].get("displayName"),
                          "completo": h["team"].get("displayName", ""), "logo": h["team"].get("logo"),
                          "goles": float(h.get("score") or 0)},
                "visita": {"id": str(v["team"]["id"]), "nombre": v["team"].get("shortDisplayName") or v["team"].get("displayName"),
                           "completo": v["team"].get("displayName", ""), "logo": v["team"].get("logo"),
                           "goles": float(v.get("score") or 0)},
            })
        except (KeyError, TypeError, ValueError):
            continue
    return salida


def eventos(ruta, desde, hasta):
    """Partidos de ESPN entre dos fechas: un día por consulta, varias a la vez."""
    from concurrent.futures import ThreadPoolExecutor
    dias = [desde + dt.timedelta(days=i) for i in range((hasta - desde).days + 1)]
    with ThreadPoolExecutor(max_workers=16) as ex:
        salida = [e for lista in ex.map(lambda d: _dia(ruta, d), dias) for e in lista]
    vistos, unicos = set(), []
    for e in sorted(salida, key=lambda x: x["fecha"]):
        if e["id"] not in vistos:
            vistos.add(e["id"])
            unicos.append(e)
    return unicos


# ---------------------------------------------------------------- Pinnacle (lo que guardó el escáner)
def mercado_pinnacle(lineas, partido):
    """Probabilidades sin margen de Pinnacle para ganador (L/E/V) si el partido salió en las señales."""
    loc, vis = partido["local"], partido["visita"]
    t0 = partido["fecha"]
    grupos = defaultdict(dict)
    for l in lineas:
        if l.get("mercado") != "h2h" or (l.get("deporte") and ODDS.get(partido["ruta"]) and l["deporte"] != ODDS[partido["ruta"]]):
            continue
        try:
            ini = dt.datetime.fromisoformat(l["inicio"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        if abs((ini - t0).total_seconds()) > 6 * 3600:
            continue
        grupos[l["evento"]][l["seleccion"]] = float(l["serie"][-1][1])
    for sels in grupos.values():
        m = {}
        for sel, p in sels.items():
            if espn.normalizar(sel).strip() in ("empate", "draw"):
                m["E"] = p
            elif max(espn.parecido(sel, loc["completo"]), espn.parecido(sel, loc["nombre"])) >= 0.72:
                m["L"] = p
            elif max(espn.parecido(sel, vis["completo"]), espn.parecido(sel, vis["nombre"])) >= 0.72:
                m["V"] = p
        futbol = partido["ruta"].startswith("soccer")
        if not futbol and "E" in m:
            continue
        claves = ["L", "E", "V"] if futbol else ["L", "V"]
        faltan = [k for k in claves if k not in m]
        if len(faltan) == 1 and len(m) >= 1:
            m[faltan[0]] = max(0.0, 1 - sum(m.values()))          # las probabilidades sin margen suman 1
            faltan = []
        if not faltan and ("L" in m or "V" in m):
            return {k: round(v, 4) for k, v in m.items()}
    return None


# ---------------------------------------------------------------- fútbol: Dixon-Coles
PROXIMOS_FUTBOL = []          # los partidos próximos que encontró futbol(), para el modelo xG
HIST_FUTBOL = defaultdict(list)   # ruta -> partidos jugados (también para el modelo xG)


def futbol(lineas):
    import penaltyblog as pb
    import pandas as pd

    filas = []
    for grupo, rutas in GRUPOS_FUTBOL.items():
        hist, prox = [], []
        for ruta in rutas:
            evs = eventos(ruta, (AHORA - dt.timedelta(days=400)).date(), (AHORA + dt.timedelta(days=8)).date())
            hist += [e for e in evs if e["terminado"]]
            prox += [e for e in evs if e["estado"] == "pre" and e["fecha"] > AHORA]
        print(f"⚽ {grupo}: {len(hist)} partidos jugados, {len(prox)} próximos")
        PROXIMOS_FUTBOL.extend(prox)
        for e in hist:
            HIST_FUTBOL[e["ruta"]].append(e)
        if len(hist) < 100 or not prox:
            continue
        df = pd.DataFrame([{"h": e["local"]["id"], "a": e["visita"]["id"], "gh": int(e["local"]["goles"]),
                            "ga": int(e["visita"]["goles"]), "d": e["fecha"].replace(tzinfo=None),
                            "n": int(e["neutral"])} for e in hist])
        # equipos con pocos partidos dan pronósticos malos: fuera
        cuenta = pd.concat([df.h, df.a]).value_counts()
        validos = set(cuenta[cuenta >= 8].index)
        df = df[df.h.isin(validos) & df.a.isin(validos)]
        pesos = pb.models.dixon_coles_weights(df.d, 0.0018, base_date=AHORA.replace(tzinfo=None))
        modelo = pb.models.DixonColesGoalModel(df.gh, df.ga, df.h, df.a, pesos, neutral_venue=df.n)
        modelo.fit()
        for e in prox:
            h, a = e["local"]["id"], e["visita"]["id"]
            if h not in validos or a not in validos:
                continue
            try:
                p = modelo.predict(h, a, neutral_venue=e["neutral"]) if e["neutral"] else modelo.predict(h, a)
            except Exception as err:            # equipo que el modelo no conoce
                print("  sin pronóstico", e["local"]["nombre"], e["visita"]["nombre"], err)
                continue
            g = p.grid
            i, j = divmod(int(max(range(g.size), key=lambda k: g.flat[k])), g.shape[1])
            filas.append(fila(e, "Dixon-Coles", float(p.home_win), float(p.draw), float(p.away_win), {
                "xg_local": round(float(p.home_goal_expectation), 2), "xg_visita": round(float(p.away_goal_expectation), 2),
                "over25": round(float(p.total_goals("over", 2.5)), 4), "btts": round(float(p.btts_yes), 4),
                "marcador": f"{i}-{j}", "p_marcador": round(float(g[i, j]), 4),
            }, lineas))
    return filas



# ---------------------------------------------------------------- 🧪 Gurú xG (experimental, aparte): xG estimado con los tiros de ESPN
def poisson_grid(lh, la, n=10):
    pf = lambda k, l: math.exp(-l) * l ** k / math.factorial(k)
    return [[pf(i, lh) * pf(j, la) for j in range(n)] for i in range(n)]


CACHE_TIROS = "cache_tiros.json"
LIGAS_XG = ["soccer/mex.1", "soccer/eng.1", "soccer/esp.1", "soccer/ita.1", "soccer/ger.1", "soccer/fra.1"]


def tiros(ruta, id_):
    """Tiros de cada equipo según ESPN: (local, visita) con totalShots, shotsOnTarget, blockedShots."""
    j = espn._get(espn.BASE.format(ruta=f"{ruta}/summary"), event=id_) or {}
    lados = {}
    try:
        comp = j["header"]["competitions"][0]
        casa = {c["team"]["id"]: c["homeAway"] for c in comp["competitors"]}
        for t in j["boxscore"]["teams"]:
            st = {x.get("name"): float(x.get("displayValue") or 0) for x in t.get("statistics") or []}
            if "totalShots" in st:
                lados[casa.get(t["team"]["id"])] = [st.get("totalShots", 0), st.get("shotsOnTarget", 0), st.get("blockedShots", 0)]
    except (KeyError, TypeError, ValueError, IndexError):
        return None
    return [lados["home"], lados["away"]] if "home" in lados and "away" in lados else None


def xg_estimado(t):
    """xG aproximado con tiros: a puerta ≈ 0.30, bloqueado ≈ 0.04, desviado ≈ 0.06 (promedios públicos de xG por tiro)."""
    total, puerta, bloq = t
    fuera = max(total - puerta - bloq, 0)
    return 0.30 * puerta + 0.04 * bloq + 0.06 * fuera


def futbol_xg(lineas):
    """Fuerza de ataque y defensa con xG estimado (no goles), ponderando lo reciente. Modelo aparte del Dixon-Coles."""
    import json as _json
    from concurrent.futures import ThreadPoolExecutor
    try:
        cache = _json.load(open(CACHE_TIROS))
    except (OSError, ValueError):
        cache = {}
    filas = []
    for ruta in LIGAS_XG:
        hist = [e for e in HIST_FUTBOL.get(ruta, []) if (AHORA - e["fecha"]).days <= 365]
        faltan = [e for e in hist if e["id"] not in cache]
        with ThreadPoolExecutor(max_workers=16) as ex:
            for e, t in zip(faltan, ex.map(lambda e: tiros(ruta, e["id"]), faltan)):
                cache[e["id"]] = t
        partidos = [{"fecha": e["fecha"], "local": e["local"]["id"], "visita": e["visita"]["id"],
                     "xg_l": xg_estimado(cache[e["id"]][0]), "xg_v": xg_estimado(cache[e["id"]][1])}
                    for e in hist if cache.get(e["id"])]
        prox = [e for e in PROXIMOS_FUTBOL if e["ruta"] == ruta]
        print(f"🧪 xG {NOMBRES[ruta]}: {len(partidos)} partidos con tiros ({len(faltan)} nuevos), {len(prox)} próximos")
        if len(partidos) < 60 or not prox:
            continue
        w = [math.exp(-0.0025 * (AHORA - p["fecha"]).days) for p in partidos]
        sw = sum(w)
        mu_h = sum(wi * p["xg_l"] for wi, p in zip(w, partidos)) / sw
        mu_a = sum(wi * p["xg_v"] for wi, p in zip(w, partidos)) / sw
        ata, dfe, peso = defaultdict(float), defaultdict(float), defaultdict(float)
        for wi, p in zip(w, partidos):
            ata[p["local"]] += wi * p["xg_l"] / mu_h
            dfe[p["local"]] += wi * p["xg_v"] / mu_a
            ata[p["visita"]] += wi * p["xg_v"] / mu_a
            dfe[p["visita"]] += wi * p["xg_l"] / mu_h
            peso[p["local"]] += wi
            peso[p["visita"]] += wi
        K = 4.0                                       # encoge hacia el promedio a los equipos con pocos partidos
        A = {t: (ata[t] + K) / (peso[t] + K) for t in peso}
        D = {t: (dfe[t] + K) / (peso[t] + K) for t in peso}
        for e in prox:
            th, ta = e["local"]["id"], e["visita"]["id"]
            if th not in peso or ta not in peso:
                continue
            lh, la = mu_h * A[th] * D[ta], mu_a * A[ta] * D[th]
            g = poisson_grid(lh, la)
            pl = sum(g[i][j] for i in range(10) for j in range(10) if i > j)
            pe = sum(g[i][i] for i in range(10))
            over = sum(g[i][j] for i in range(10) for j in range(10) if i + j > 2)
            btts = sum(g[i][j] for i in range(1, 10) for j in range(1, 10))
            i, j = max(((i, j) for i in range(10) for j in range(10)), key=lambda t: g[t[0]][t[1]])
            f = fila(e, "xG", pl, pe, 1 - pl - pe, {"xg_local": round(lh, 2), "xg_visita": round(la, 2), "over25": round(over, 4),
                                                  "btts": round(btts, 4), "marcador": f"{i}-{j}", "p_marcador": round(g[i][j], 4)}, lineas)
            f["evento"] = "xg|" + f["evento"]
            filas.append(f)
    try:
        _json.dump(cache, open(CACHE_TIROS, "w"))
    except OSError:
        pass
    return filas


# ---------------------------------------------------------------- NFL / NBA / MLB: Elo
def elo_deporte(ruta, lineas):
    k, hfa, por_punto, corto = ELO[ruta]
    evs = eventos(ruta, (AHORA - dt.timedelta(days=430)).date(), (AHORA + dt.timedelta(days=8)).date())
    hist = [e for e in evs if e["terminado"]]
    prox = [e for e in evs if e["estado"] == "pre" and e["fecha"] > AHORA]
    print(f"🏟 {corto}: {len(hist)} jugados, {len(prox)} próximos")
    if len(hist) < 50 or not prox:
        return []
    r = defaultdict(lambda: 1505.0)
    ultimo = None
    for e in hist:
        if ultimo and (e["fecha"] - ultimo).days > 60:            # nueva temporada: regresar 1/3 a la media
            for t in r:
                r[t] = r[t] * 2 / 3 + 1505 / 3
        ultimo = e["fecha"]
        h, a = e["local"]["id"], e["visita"]["id"]
        dif = r[h] + (0 if e["neutral"] else hfa) - r[a]
        esperado = 1 / (1 + 10 ** (-dif / 400))
        gh, ga = e["local"]["goles"], e["visita"]["goles"]
        real = 1.0 if gh > ga else 0.0 if gh < ga else 0.5
        mov = abs(gh - ga)
        dif_ganador = dif if gh > ga else -dif
        mult = math.log(mov + 1) * 2.2 / (dif_ganador * 0.001 + 2.2) if mov else 1.0
        cambio = k * mult * (real - esperado)
        r[h] += cambio
        r[a] -= cambio
    filas = []
    for e in prox:
        h, a = e["local"]["id"], e["visita"]["id"]
        dif = r[h] + (0 if e["neutral"] else hfa) - r[a]
        p = 1 / (1 + 10 ** (-dif / 400))
        datos = {"elo_local": round(r[h]), "elo_visita": round(r[a])}
        if por_punto:
            datos["spread"] = round(-dif / por_punto * 2) / 2          # negativo = el local es favorito
        filas.append(fila(e, "Elo", p, None, 1 - p, datos, lineas))
    return filas


def fila(e, modelo, pl, pe, pv, datos, lineas):
    m = mercado_pinnacle(lineas, e)
    return {
        "evento": f"{e['ruta']}:{e['id']}", "ruta": e["ruta"], "liga": NOMBRES.get(e["ruta"], e["ruta"]),
        "deporte": "futbol" if e["ruta"].startswith("soccer") else e["ruta"].split("/")[1],
        "inicio": e["fecha"].isoformat(), "local": e["local"]["nombre"], "visita": e["visita"]["nombre"],
        "logo_local": e["local"]["logo"], "logo_visita": e["visita"]["logo"], "modelo": modelo,
        "p_local": round(pl, 4), "p_empate": None if pe is None else round(pe, 4), "p_visita": round(pv, 4),
        "datos": datos, "mercado": m,
    }


# ---------------------------------------------------------------- calificar los que ya terminaron
def calificar():
    import juegos
    for p in api("guru", "pendientes"):
        ruta, _, id_ = p["evento"].removeprefix("xg|").rpartition(":")
        r = juegos.resumen(ruta, id_)
        if not r or not r["terminado"]:
            continue
        l, v = r["local"]["marcador"], r["visita"]["marcador"]
        res = "L" if l > v else "V" if v > l else "E"
        print("✔️", p["evento"], res, juegos.marcador(r))
        if not PRUEBA:
            api("guru", "resultado", {"evento": p["evento"], "res": res, "marcador": juegos.marcador(r)})


def main():
    if not TOKEN:
        sys.exit("Falta TELEGRAM_TOKEN")
    try:
        lineas = api("mas", "lineas2")
    except requests.RequestException as e:
        print("No se pudieron leer las líneas de Pinnacle:", e)
        lineas = []
    filas = []
    for paso, args in [(futbol, (lineas,)), (futbol_xg, (lineas,))] + [(elo_deporte, (r, lineas)) for r in ELO]:
        try:
            filas += paso(*args)
        except Exception as e:                   # un deporte que falle no detiene a los demás
            print(f"⚠️ {paso.__name__} {args[0] if len(args) > 1 else ''}: {type(e).__name__}: {e}")
    con_m = sum(1 for f in filas if f["mercado"])
    print(f"\n{len(filas)} pronósticos ({con_m} con línea de Pinnacle para comparar)")
    for f in filas[:12]:
        pe = f" E {f['p_empate']:.0%}" if f["p_empate"] is not None else ""
        print(f"  {f['liga']:<12} {f['local']} vs {f['visita']}: L {f['p_local']:.0%}{pe} V {f['p_visita']:.0%}"
              f"  {f['datos']}  mercado={f['mercado']}")
    if not PRUEBA:
        for i in range(0, len(filas), 80):
            api("guru", "guardar", {"filas": filas[i:i + 80]})
    try:
        calificar()
    except Exception as e:
        print(f"⚠️ calificar: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
