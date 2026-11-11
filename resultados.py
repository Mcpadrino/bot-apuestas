#!/usr/bin/env python3
"""
Revisa los marcadores de ESPN (gratis, no gasta créditos de cuotas) y, cuando termina el partido
de una apuesta pendiente, le manda al dueño de la apuesta el marcador con el logo y botones para
confirmar: ✅ Ganó / ❌ Perdió / ➖ Nula / 🚫 No es este partido. Nunca marca nada sola.

Uso:  python resultados.py            (lo corre GitHub Actions cada hora)
      python resultados.py --prueba    (no manda nada; solo muestra qué propondría)
"""
import datetime as dt
import os
import re
import sys

import requests

import anticipado
import espn

BOT_URL = os.getenv("BOT_URL") or "https://bot-apuestas-telegram.vercel.app"
TOKEN = "".join(os.getenv("TELEGRAM_TOKEN", "").split())
EMOJI = {"soccer": "⚽", "americanfootball": "🏈", "basketball": "🏀", "baseball": "⚾"}


def amer(d):
    d = float(d)
    return f"+{round((d - 1) * 100)}" if d >= 2 else f"-{round(100 / (d - 1))}"


def pendientes():
    r = requests.get(f"{BOT_URL}/api/telegram", params={"pendientes": "1"},
                     headers={"x-bot-token": TOKEN}, timeout=20)
    r.raise_for_status()
    return r.json()


def proponer(id_, evento, marcador, logo):
    r = requests.post(f"{BOT_URL}/api/telegram", params={"proponer": "1"}, headers={"x-bot-token": TOKEN},
                      json={"id": id_, "evento": evento, "marcador": marcador, "logo": logo}, timeout=20)
    return r.ok and r.json()


def es_combinada(a):
    s = espn.normalizar(a["seleccion"])
    return bool(re.search(r"\b(parlay|parley|combinada)\b", s)) or "+" in re.sub(r"[+-]\d", "", a["seleccion"])


NO_ML = re.compile(r"\b(m[aá]s de|menos de|over|under|empate|draw|ambos|btts|h[aá]ndicap|handicap|spread|total)\b", re.I)


def es_ml(a):
    """¿Apuesta sencilla a ganador del partido? (las que tienen pago anticipado en Caliente/Draftea)"""
    s = a.get("seleccion") or ""
    return not es_combinada(a) and not NO_ML.search(s) and not re.search(r"[+-]\d+(\.\d+)?\s*(pts|puntos|goles|carreras)?\s*$", s)


def mejor_partido(a, partidos):
    """El partido terminado que más se parece a lo que escribió el usuario, o None."""
    try:
        creada = dt.datetime.fromisoformat(a["creada"].replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        creada = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=3)
    mejor, puntos = None, 0.0
    for p in partidos:
        if not p["terminado"] or p["evento"] in (a.get("descartados") or []):
            continue
        try:
            inicio = dt.datetime.fromisoformat(p["inicio"].replace("Z", "+00:00"))
            if inicio < creada - dt.timedelta(hours=8):      # el partido empezó mucho antes de apostar
                continue
        except ValueError:
            pass
        texto = f"{a['seleccion']} {a.get('partido') or ''}"
        ml, mv = espn.menciona(texto, p["local"]), espn.menciona(texto, p["visita"])
        if max(ml, mv) < 0.7:
            continue
        pts = max(ml, mv) + (0.5 if min(ml, mv) >= 0.7 else 0)   # si menciona a los dos equipos, más seguro
        if pts > puntos:
            mejor, puntos = p, pts
    return mejor


AVISOS_PUSH = []     # 🔔 notificaciones al celular que se mandan juntas al final


def enviar(a, p, propuesta, logo, nota=""):
    tipo = p["liga"].split("_")[0]
    linea = {"gana": "Parece que ✅ *ganaste*", "pierde": "Parece que ❌ *perdiste*",
             "nula": "Parece que quedó ➖ *nula*"}.get(propuesta, "¿Cómo quedó tu apuesta?")
    if nota:
        linea = f"{nota}\n{linea}"
    seleccion = re.sub(r"[_*`\[\]]", "", a["seleccion"])
    texto = (f"{EMOJI.get(tipo, '🏁')} Final: *{espn.texto_marcador(p)}*\n"
             f"Tu apuesta #{a['id']}: {seleccion} {amer(a['cuota'])} · ${float(a['monto']):.2f}\n\n"
             f"{linea}. Confírmalo:")
    botones = {"inline_keyboard": [
        [{"text": "✅ Ganó", "callback_data": f"c:{a['id']}:gana"},
         {"text": "❌ Perdió", "callback_data": f"c:{a['id']}:pierde"},
         {"text": "➖ Nula", "callback_data": f"c:{a['id']}:nula"}],
        [{"text": "🚫 No es este partido", "callback_data": f"n:{a['id']}"}]]}
    loc, vis = p["local"], p["visita"]
    fmt = lambda x: str(int(x)) if float(x).is_integer() else str(x)
    AVISOS_PUSH.append({"tipo": "resultados", "usuarios": [str(a["usuario"])], "tag": f"apuesta-{a['id']}", "url": "/#bot",
                        "img": {"k": "resultado", "r": propuesta, "m": f"{fmt(vis['marcador'])} – {fmt(loc['marcador'])}",
                                "l": {"n": vis.get("corto") or vis.get("nombre"), "logo": vis.get("logo")},
                                "v": {"n": loc.get("corto") or loc.get("nombre"), "logo": loc.get("logo")},
                                "s": f"{seleccion} · ${float(a['monto']):.0f} a {amer(a['cuota'])}"},
                        "titulo": f"🏁 Final: {espn.texto_marcador(p)}"[:80],
                        "cuerpo": {"gana": "Parece que ganaste ✅", "pierde": "Parece que perdiste ❌", "nula": "Parece que quedó nula ➖"}.get(propuesta, "¿Cómo quedó?")
                                  + f" · {seleccion} · ${float(a['monto']):.0f}. Confírmala en Telegram o en la app."})
    base = f"https://api.telegram.org/bot{TOKEN}"
    if logo:
        r = requests.post(f"{base}/sendPhoto", json={"chat_id": a["usuario"], "photo": logo, "caption": texto,
                                                     "parse_mode": "Markdown", "reply_markup": botones}, timeout=20)
        if r.ok:
            return
    requests.post(f"{base}/sendMessage", json={"chat_id": a["usuario"], "text": texto,
                                               "parse_mode": "Markdown", "reply_markup": botones}, timeout=20)


def main():
    prueba = "--prueba" in sys.argv
    if not TOKEN:
        sys.exit("Falta TELEGRAM_TOKEN")
    lista = [a for a in pendientes() if not es_combinada(a)]
    print(f"{len(lista)} apuesta(s) pendientes revisables")
    if not lista:
        return

    # Días a revisar: desde la apuesta más vieja (máx. 5 días) hasta hoy, en fechas de EE. UU. (ESPN)
    hoy = dt.datetime.now(dt.timezone.utc)
    viejas = []
    for a in lista:
        try:
            viejas.append(dt.datetime.fromisoformat(a["creada"].replace("Z", "+00:00")))
        except (ValueError, AttributeError):
            pass
    desde = max(min(viejas, default=hoy) - dt.timedelta(days=1), hoy - dt.timedelta(days=5))
    fechas = []
    d = desde.date()
    while d <= hoy.date():
        fechas.append(d.strftime("%Y%m%d")); d += dt.timedelta(days=1)

    partidos = []
    for liga in espn.LIGAS:
        for f in fechas:
            partidos += espn.marcadores(liga, f)
    terminados = [p for p in partidos if p["terminado"]]
    print(f"{len(terminados)} partidos terminados en {len(fechas)} día(s)")

    for a in lista:
        p = mejor_partido(a, terminados)
        if not p or p["evento"] == a.get("evento"):
            continue                      # sin partido o ya se le propuso este
        propuesta = espn.resultado_probable(a["seleccion"], p)
        loc, vis = p["local"], p["visita"]
        ml, mv = espn.menciona(a["seleccion"], loc), espn.menciona(a["seleccion"], vis)
        equipo = loc if ml > mv else vis if mv > ml else (loc if loc["ganador"] else vis)
        logo = equipo.get("logo")
        nota = ""
        # Pago anticipado: si su equipo llegó a ir arriba por la ventaja de la casa, se cobra como ganada
        tipo = p["liga"].split("_")[0]
        con_pa = a.get("anticipado") if a.get("anticipado") is not None else es_ml(a)
        if con_pa and propuesta != "gana" and tipo in anticipado.UMBRAL and ml != mv:
            v = espn.ventajas(p["evento"])
            if v:
                maxima = v[0] if equipo is loc else v[1]
                k = anticipado.UMBRAL[tipo]
                if maxima >= k:
                    propuesta = "gana"
                    unidad = {"soccer": "goles", "basketball": "puntos", "americanfootball": "puntos", "baseball": "carreras"}[tipo]
                    nota = f"⏩ *Pago anticipado*: tu equipo llegó a ir arriba por {maxima} {unidad} (la casa paga desde {k})."
        print(f"#{a['id']} «{a['seleccion']}» -> {espn.texto_marcador(p)} · propuesta: {propuesta} {nota}")
        if prueba:
            continue
        if proponer(a["id"], p["evento"], espn.texto_marcador(p), logo):
            enviar(a, p, propuesta, logo, nota)
    if AVISOS_PUSH:
        try:
            r = requests.post(f"{BOT_URL}/api/telegram", params={"push": "1"}, headers={"x-bot-token": TOKEN},
                              json={"envios": AVISOS_PUSH}, timeout=40)
            print(f"🔔 push: {r.json() if r.ok else r.status_code}")
        except (requests.RequestException, ValueError) as e:
            print(f"No se pudieron mandar notificaciones: {type(e).__name__}")


if __name__ == "__main__":
    main()
