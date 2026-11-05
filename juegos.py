"""
Revisor de los "juegos" (corre cada hora junto con resultados.py; no gasta créditos de cuotas):
  - Quiniela: guarda el resultado (L/E/V) de cada partido que ya terminó.
  - Retos 1 vs 1: decide quién ganó y les avisa a los dos por Telegram.
  - Modo práctica: cierra las apuestas de mentira con los marcadores de ESPN.
  - Equipo favorito: avisa una vez, poco antes de que empiece su partido.

python juegos.py           -> hace todo
python juegos.py --prueba  -> solo muestra lo que haría (no guarda ni manda nada)
"""
import datetime as dt
import os
import sys

import requests

import espn

BOT_URL = os.getenv("BOT_URL", "https://bot-apuestas-telegram.vercel.app")
TOKEN = "".join(os.getenv("TELEGRAM_TOKEN", "").split())
WEB_URL = os.getenv("WEB_URL", BOT_URL)
PRUEBA = "--prueba" in sys.argv
MX = dt.timezone(dt.timedelta(hours=-6))


def api(accion, datos=None):
    if PRUEBA and accion in ("quiniela_res", "reto_cerrar", "practica_pierna", "aviso", "clv_set"):
        print("   (prueba) no se guarda:", accion, datos)
        return None
    r = requests.post(f"{BOT_URL}/api/telegram", params={"mas": "1"}, headers={"x-bot-token": TOKEN},
                      json={"accion": accion, "datos": datos or {}}, timeout=25)
    r.raise_for_status()
    return r.json()


def telegram(chat, texto, foto=None):
    if PRUEBA:
        print(f"   (prueba) a {chat}: {texto[:160]!r}")
        return
    base = f"https://api.telegram.org/bot{TOKEN}"
    try:
        if foto:
            r = requests.post(f"{base}/sendPhoto", json={"chat_id": chat, "photo": foto, "caption": texto,
                                                        "parse_mode": "Markdown"}, timeout=20)
            if r.ok:
                return
        requests.post(f"{base}/sendMessage", json={"chat_id": chat, "text": texto, "parse_mode": "Markdown",
                                                   "disable_web_page_preview": True}, timeout=20)
    except requests.RequestException as e:
        print("telegram:", e)


def limpio(t):
    return str(t or "").replace("*", "").replace("_", "").replace("`", "").replace("[", "")


def fecha(iso):
    return dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))


# ---------------------------------------------------------------- ESPN por ruta (soccer/mex.1, football/nfl, ...)
def resumen(ruta, id_):
    """{terminado, local:{nombre, marcador, logo}, visita:{...}} de un partido exacto."""
    j = espn._get(espn.BASE.format(ruta=f"{ruta}/summary"), event=id_) or {}
    try:
        comp = j["header"]["competitions"][0]
    except (KeyError, IndexError, TypeError):
        return None
    lados = {}
    for c in comp.get("competitors", []):
        t = c.get("team", {})
        logos = t.get("logos") or [{}]
        lados[c.get("homeAway")] = {"nombre": t.get("shortDisplayName") or t.get("displayName", ""),
                                    "marcador": float(c.get("score") or 0), "logo": t.get("logo") or logos[0].get("href")}
    if "home" not in lados or "away" not in lados:
        return None
    return {"terminado": bool(comp.get("status", {}).get("type", {}).get("completed")),
            "local": lados["home"], "visita": lados["away"]}


def fmt(x):
    return str(int(x)) if float(x).is_integer() else str(x)


def marcador(p):
    return f"{p['visita']['nombre']} {fmt(p['visita']['marcador'])} – {fmt(p['local']['marcador'])} {p['local']['nombre']}"


# ---------------------------------------------------------------- quiniela
LOL_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"      # llave pública de lolesports.com


def lol_resultados():
    """{id_de_serie: ganador 'L' (primer equipo) / 'V' (segundo)} de las series terminadas del Mundial."""
    try:
        r = requests.get("https://esports-api.lolesports.com/persisted/gw/getSchedule", headers={"x-api-key": LOL_KEY},
                         params={"hl": "es-MX", "leagueId": "98767975604431411"}, timeout=20)
        eventos = r.json()["data"]["schedule"]["events"]
    except (requests.RequestException, ValueError, KeyError):
        return {}
    salida = {}
    for e in eventos:
        t = (e.get("match") or {}).get("teams") or []
        if e.get("state") == "completed" and len(t) == 2:
            res = "L" if (t[0].get("result") or {}).get("outcome") == "win" else "V"
            salida[str(e["match"]["id"])] = (res, f"{t[0]['code']} {t[0]['result']['gameWins']} – {t[1]['result']['gameWins']} {t[1]['code']}")
    return salida


def quiniela():
    lol = None
    for q in api("quiniela_pendientes") or []:
        if q["evento"].startswith("lol:"):
            if lol is None:
                lol = lol_resultados()
            r = lol.get(q["evento"][4:])
            if r:
                print("pick'em LoL", q["evento"], r)
                api("quiniela_res", {"evento": q["evento"], "res": r[0], "marcador": r[1]})
            continue
        ruta, _, id_ = q["evento"].rpartition(":")
        p = resumen(ruta, id_)
        if not p or not p["terminado"]:
            continue
        l, v = p["local"]["marcador"], p["visita"]["marcador"]
        res = "L" if l > v else "V" if v > l else "E"
        print("quiniela", q["evento"], res, marcador(p))
        api("quiniela_res", {"evento": q["evento"], "res": res, "marcador": marcador(p)})


# ---------------------------------------------------------------- retos
def retos():
    for r in api("retos_abiertos") or []:
        p = resumen(r["liga"], r["evento"])
        if not p or not p["terminado"]:
            continue
        l, v = p["local"]["marcador"], p["visita"]["marcador"]
        gano_lado = "local" if l > v else "visita" if v > l else None
        ganador = "empate" if gano_lado is None else (r["retador"] if gano_lado == r["lado"] else r["rival"])
        print("reto", r["id"], ganador, marcador(p))
        c = api("reto_cerrar", {"id": r["id"], "ganador": ganador, "marcador": marcador(p)}) or {**r, "ganador": ganador}
        nombres = {r["retador"]: c.get("retador_nombre") or "Tu amigo", r["rival"]: c.get("rival_nombre") or "Tu amigo"}
        for yo, otro in ((r["retador"], r["rival"]), (r["rival"], r["retador"])):
            if ganador == "empate":
                txt = f"🤝 *Reto empatado* con {limpio(nombres[otro])}\n🏁 {limpio(marcador(p))}"
            elif ganador == yo:
                txt = f"🏆 *¡Ganaste el reto!* contra {limpio(nombres[otro])}\n🏁 {limpio(marcador(p))}"
                if r.get("premio"):
                    txt += f"\n🎁 Te toca cobrar: {limpio(r['premio'])}"
            else:
                txt = f"😬 *Perdiste el reto* contra {limpio(nombres[otro])}\n🏁 {limpio(marcador(p))}"
                if r.get("premio"):
                    txt += f"\n🎁 Te toca pagar: {limpio(r['premio'])}"
            telegram(yo, txt + f"\n{WEB_URL}/#retos")


# ---------------------------------------------------------------- modo práctica
_cache_dia = {}


def partidos_de(deporte, inicio):
    """Partidos de ESPN cerca de la hora de inicio (se revisa el día en UTC y en hora de México)."""
    salida = []
    for d in {inicio.strftime("%Y%m%d"), inicio.astimezone(MX).strftime("%Y%m%d")}:
        k = (deporte, d)
        if k not in _cache_dia:
            _cache_dia[k] = espn.marcadores(deporte, d)
        salida += _cache_dia[k]
    return salida


def practica():
    ahora = dt.datetime.now(dt.timezone.utc)
    avisos = {}
    for g in api("practica_pendientes") or []:
        inicio = fecha(g["inicio"])
        candidatos = []
        for p in partidos_de(g["deporte"], inicio):
            pl, pv = espn.menciona(g["partido"], p["local"]), espn.menciona(g["partido"], p["visita"])
            cerca = abs((fecha(p["inicio"]) - inicio).total_seconds()) < 6 * 3600 if p.get("inicio") else True
            if min(pl, pv) >= 0.7 and cerca:
                candidatos.append(p)
        p = candidatos[0] if len(candidatos) == 1 else None
        res = None
        if p and p["terminado"]:
            res = espn.resultado_probable(g["seleccion"], p)
        elif not p and ahora - inicio > dt.timedelta(days=2):
            res = "nula"            # no se encontró el partido: se devuelve el dinero de mentira
        if not res:
            continue
        print("práctica pierna", g["id"], g["seleccion"], res, espn.texto_marcador(p) if p else "")
        cerrada = api("practica_pierna", {"id": g["id"], "resultado": res,
                                          "marcador": espn.texto_marcador(p) if p else "sin marcador"})
        if isinstance(cerrada, dict) and cerrada.get("estado") in ("gana", "pierde", "nula"):
            avisos.setdefault(cerrada["usuario"], []).append(cerrada)
    for chat, lista in avisos.items():
        lineas = []
        for a in lista:
            icono = {"gana": "✅", "pierde": "❌", "nula": "➖"}[a["estado"]]
            g = float(a.get("ganancia") or 0)
            lineas.append(f"{icono} {'Parlay' if a['tipo'] == 'parlay' else 'Simple'} de ${float(a['monto']):.0f} → "
                          f"{'+' if g > 0 else ''}{g:.2f}")
        torneo = any(a.get("torneo") for a in lista)
        titulo = "🏆 *Torneo semanal*" if torneo else "🎮 *Modo práctica*"
        telegram(chat, f"{titulo} (dinero de mentira)\n" + "\n".join(lineas) + f"\n{WEB_URL}/#practica")


def torneo():
    """Cuando cierra la semana (y ya se calificó todo), premia el podio del torneo y les avisa a todos."""
    r = None if PRUEBA else api("torneo_premiar")
    if not isinstance(r, dict) or not r.get("tabla"):
        return
    tabla = r["tabla"]
    medallas = {1: "🥇", 2: "🥈", 3: "🥉"}
    podio = "\n".join(f"{medallas.get(t['pos'], str(t['pos']) + '.')} {limpio(t['nombre'])} · ${float(t['banca']):,.0f}"
                      + (f" (+${float(t['premio']):,.0f} para su mascota)" if t["premio"] else "") for t in tabla[:5])
    for t in tabla:
        extra = (f"\n\n🎉 ¡Quedaste {t['pos']}° y tu mascota recibe ${float(t['premio']):,.0f}!" if t["premio"]
                 else f"\n\nQuedaste {t['pos']}° de {len(tabla)}.")
        telegram(t["usuario"], f"🏆 *Resultados del torneo semanal*\n\n{podio}{extra}\n\nYa empezó el nuevo: todos con $1,000.\n{WEB_URL}/#practica")


# ---------------------------------------------------------------- equipo favorito
def favoritos():
    ahora = dt.datetime.now(dt.timezone.utc)
    vistos = {}
    for u in api("favoritos") or []:
        e = u.get("equipo") or {}
        ruta, id_ = e.get("ruta"), str(e.get("id") or "")
        if not ruta or not id_:
            continue
        if ruta not in vistos:
            eventos = []
            for d in {ahora.strftime("%Y%m%d"), ahora.astimezone(MX).strftime("%Y%m%d")}:
                j = espn._get(espn.BASE.format(ruta=f"{ruta}/scoreboard"), dates=d, limit=300) or {}
                eventos += j.get("events") or []
            vistos[ruta] = eventos
        for ev in vistos[ruta]:
            comp = (ev.get("competitions") or [{}])[0]
            equipos = {str(c.get("team", {}).get("id")): c for c in comp.get("competitors", [])}
            if id_ not in equipos or ev.get("status", {}).get("type", {}).get("state") != "pre":
                continue
            faltan = (fecha(ev["date"]) - ahora).total_seconds() / 60
            if not 0 < faltan <= 75:
                continue
            if not PRUEBA and not api("aviso", {"usuario": u["chat_id"], "clave": f"fav:{ev['id']}"}):
                continue          # ya se le avisó de este partido
            casa = next((c for c in comp["competitors"] if c.get("homeAway") == "home"), {})
            fuera = next((c for c in comp["competitors"] if c.get("homeAway") == "away"), {})
            hora = fecha(ev["date"]).astimezone(MX).strftime("%H:%M")
            txt = (f"⭐ *¡Juega tu equipo!* En {int(faltan)} min\n\n*{limpio(fuera.get('team', {}).get('shortDisplayName'))}* vs "
                   f"*{limpio(casa.get('team', {}).get('shortDisplayName'))}*\n🕒 {hora} (hora CDMX)\n"
                   f"Si el bot encuentra valor en este partido te llega en la alerta normal.\n{WEB_URL}/#hoy")
            print("favorito", u["nombre"], e.get("nombre"), int(faltan), "min")
            telegram(u["chat_id"], txt, e.get("logo"))


# ---------------------------------------------------------------- mascota con hambre
def hambre():
    r = requests.post(f"{BOT_URL}/api/telegram", params={"jugar": "1"}, headers={"x-bot-token": TOKEN},
                      json={"accion": "hambrientos"}, timeout=20)
    r.raise_for_status()
    hoy = dt.datetime.now(dt.timezone(dt.timedelta(hours=-6))).strftime("%Y-%m-%d")
    nombres = {"gato": "gato", "perro": "perro", "lagarto": "lagarto", "tigre": "tigre", "pinguino": "pingüino", "jirafa": "jirafa"}
    for m in r.json():
        if not PRUEBA and not api("aviso", {"usuario": m["chat_id"], "clave": f"hambre:{hoy}"}):
            continue                       # máximo un aviso al día
        txt = (f"🍽️ *{limpio(m['nombre'])}*, tu {nombres.get(m['especie'], 'mascota')}, lleva {m['horas']} h sin comer."
               + (" ¡Ya se está poniendo en los huesos! 🦴" if m["horas"] >= 48 else " Si pasa de 48 h se pone en los huesos.")
               + f"\nDale unos tacos 🌮 en la tienda: {WEB_URL}/#juegos")
        telegram(m["chat_id"], txt)


# ---------------------------------------------------------------- CLV: ¿le ganaste a la línea de cierre?
def clv():
    """Compara el momio que tomaste contra la última probabilidad de Pinnacle antes del partido (último escaneo)."""
    datos = api("clv_pendientes") or {}
    cierres = datos.get("cierres") or []
    ahora = dt.datetime.now(dt.timezone.utc)
    for a in datos.get("apuestas") or []:
        creada = fecha(a["creada"])
        mejor, puntos = None, 0.0
        for c in cierres:
            inicio = fecha(c["inicio"])
            if not (creada - dt.timedelta(hours=6) <= inicio <= creada + dt.timedelta(hours=40)):
                continue
            ps = espn.parecido(a["seleccion"], c["seleccion"])
            if ps < 0.75:
                continue
            pp = espn.parecido(a.get("partido") or "", c["partido"]) if a.get("partido") else 0.5
            pts = ps + 0.5 * pp
            if pts > puntos:
                mejor, puntos = c, pts
        if mejor and fecha(mejor["inicio"]) < ahora:
            prob = float(mejor["prob"])
            print(f"CLV #{a['id']} {a['seleccion']} @ {float(a['cuota']):.2f} vs cierre {prob:.1%} → {float(a['cuota']) * prob - 1:+.1%}")
            api("clv_set", {"id": a["id"], "prob": prob})
        elif not mejor and ahora - creada > dt.timedelta(days=3):
            api("clv_set", {"id": a["id"], "prob": None})       # no salió en las señales: ya no se busca


def main():
    if not TOKEN:
        sys.exit("Falta TELEGRAM_TOKEN")
    for paso in (quiniela, retos, practica, torneo, favoritos, clv, hambre):
        try:
            paso()
        except Exception as e:           # un paso que falle no detiene a los demás
            print(f"⚠️ {paso.__name__}: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
