#!/usr/bin/env python3
"""
Bot de señales de value betting: fútbol, NFL, MLB y NBA.

Idea: las líneas de Pinnacle (casa "sharp") sin margen son la mejor estimación
de la probabilidad real. Si Caliente / Draftea pagan MÁS que esa cuota justa
(+ un margen de seguridad), hay valor. El bot NO apuesta solo: te avisa y tú
apuestas a mano.

Comandos:
  python bot_apuestas.py escanear --deporte nba            (o futbol, nfl, mlb, todos)
  python bot_apuestas.py revisar --cuota +170 --justa 2.58
  python bot_apuestas.py registrar --partido "Lakers @ Celtics" --seleccion Lakers --casa Caliente --cuota +170 --justa 2.58
  python bot_apuestas.py liquidar --id 3 --resultado gana
  python bot_apuestas.py resumen
"""
import argparse
import csv
import datetime as dt
import json
import os
import sys
from collections import Counter
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    import requests
except ImportError:
    requests = None

# ---------------------------------------------------------------- configuración
API_URL = "https://api.the-odds-api.com/v4/sports/{sport}/odds"
ZONA = ZoneInfo(os.getenv("ZONA_HORARIA", "America/Mexico_City"))
CASA_SHARP = "pinnacle"
REGISTRO = Path(os.getenv("REGISTRO", "apuestas.csv"))
ESTADO = Path(os.getenv("ESTADO", "estado_lineas.json"))

# ===== EDITA AQUÍ =====
ODDS_API_KEY = os.getenv("ODDS_API_KEY", "PEGA_TU_CLAVE_AQUI")  # the-odds-api.com
BANCA = float(os.getenv("BANCA", 200))             # tu banca en MXN
EDGE_MIN = float(os.getenv("EDGE_MIN", 0.03))      # ventaja mínima: 3 %
CUOTA_MIN = float(os.getenv("CUOTA_MIN", 1.25))    # ignora favoritos extremos
CUOTA_MAX = float(os.getenv("CUOTA_MAX", 4.0))     # ignora no favoritos (sesgo longshot + varianza)
FRACCION_KELLY = float(os.getenv("KELLY_FRAC", 0.25))   # Kelly fraccional
TOPE_APUESTA = float(os.getenv("TOPE_APUESTA", 0.025))  # máximo por apuesta: 2.5 % de la banca
APUESTA_MIN = float(os.getenv("APUESTA_MIN", 2))        # mínimo que acepta tu casa (MXN)
APUESTA_FIJA = float(os.getenv("APUESTA_FIJA", 0))      # >0 = monto fijo en lugar de Kelly
METODO_DEVIG = os.getenv("METODO_DEVIG", "power")       # power (recomendado) o multiplicativo
LIBROS = os.getenv("LIBROS", "pinnacle")                # 1 crédito API por mercado y liga
MOVIMIENTO = float(os.getenv("MOVIMIENTO", 0.02))       # avisa si la prob. se movió ≥ 2 pts
# ======================

LIGAS_TOP = [
    "soccer_mexico_ligamx",
    "soccer_epl",
    "soccer_spain_la_liga",
    "soccer_italy_serie_a",
    "soccer_germany_bundesliga",
    "soccer_france_ligue_one",
]
DEPORTES = {
    "futbol": LIGAS_TOP + ["soccer_uefa_champs_league", "soccer_uefa_europa_league"],
    "nfl": ["americanfootball_nfl"],
    "mlb": ["baseball_mlb"],
    "nba": ["basketball_nba"],
}
DEPORTES["todos"] = [s for lista in DEPORTES.values() for s in lista]

# ===== CALENDARIO para --deporte auto (0 = lunes ... 6 = domingo) =====
# Solo se buscan y se muestran los partidos de cada liga en estos días.
CALENDARIO = {
    "americanfootball_nfl": {0, 3, 6},          # lunes, jueves, domingo
    "soccer_uefa_champs_league": {1, 2},        # martes, miércoles
    "soccer_uefa_europa_league": {3},           # jueves
    **{liga: {4, 5, 6} for liga in LIGAS_TOP},  # viernes, sábado, domingo
    "basketball_nba": {0, 1, 2, 3},             # lunes a jueves
    "baseball_mlb": {0, 1, 2, 3},               # lunes a jueves (abril–octubre)
}
# ======================================================================

# ===== PRESUPUESTO de créditos (--presupuesto) =====
CORRIDAS_DIA = int(os.getenv("CORRIDAS_DIA", 2))   # cuántas veces corre al día en GitHub
RESERVA = int(os.getenv("RESERVA", 15))            # créditos que nunca se gastan
# Mercados extra en orden de prioridad: se agregan mientras alcance el presupuesto.
EXTRAS = [
    ("americanfootball_nfl", "spreads"), ("americanfootball_nfl", "totals"),
    ("soccer_mexico_ligamx", "totals"), ("soccer_uefa_champs_league", "totals"),
    ("soccer_uefa_europa_league", "totals"),
    ("soccer_epl", "totals"), ("soccer_spain_la_liga", "totals"),
    ("soccer_italy_serie_a", "totals"), ("soccer_germany_bundesliga", "totals"),
    ("soccer_france_ligue_one", "totals"),
    ("basketball_nba", "totals"), ("basketball_nba", "spreads"),
    ("baseball_mlb", "totals"),
]
# ===================================================
NOMBRE_LIGA = {
    "soccer_mexico_ligamx": "Liga MX", "soccer_epl": "Premier", "soccer_spain_la_liga": "LaLiga",
    "soccer_uefa_champs_league": "Champions", "americanfootball_nfl": "NFL",
    "soccer_italy_serie_a": "Serie A", "soccer_germany_bundesliga": "Bundesliga",
    "soccer_france_ligue_one": "Ligue 1", "soccer_uefa_europa_league": "Europa League",
    "baseball_mlb": "MLB", "basketball_nba": "NBA",
}
DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
NOMBRE_MERCADO = {"h2h": "Ganador", "spreads": "Hándicap", "totals": "Total"}
CAMPOS = ["id", "fecha", "partido", "seleccion", "casa", "cuota", "monto",
          "cuota_justa", "resultado", "ganancia"]


# ---------------------------------------------------------------- datos
def obtener_momios(sport, mercados, demo=None):
    """Descarga momios de The Odds API (o de un JSON local en modo demo)."""
    if demo:
        with open(demo, encoding="utf-8") as f:
            return [e for e in json.load(f) if e["sport_key"] == sport]

    if requests is None:
        sys.exit("Falta 'requests': pip install requests")
    clave = "".join(ODDS_API_KEY.split())     # quita espacios o saltos de línea pegados
    if not clave or clave == "PEGA_TU_CLAVE_AQUI":
        sys.exit("Falta tu clave: ábrela gratis en the-odds-api.com y pégala en ODDS_API_KEY "
                 "al inicio de bot_apuestas.py")

    r = requests.get(
        API_URL.format(sport=sport),
        params={"apiKey": clave, "bookmakers": LIBROS, "markets": ",".join(mercados),
                "oddsFormat": "decimal"},
        timeout=20,
    )
    if r.status_code in (404, 422):   # liga fuera de temporada o sin datos
        return []
    if r.status_code == 401:
        sys.exit("Clave de the-odds-api inválida (401). Revisa el secret ODDS_API_KEY: "
                 "deben ser 32 letras/números, sin espacios.")
    if r.status_code == 429 or (r.status_code == 401 and "quota" in r.text.lower()):
        sys.exit("Se acabaron los créditos del mes en the-odds-api.")
    if not r.ok:                       # nunca imprimir la URL: lleva tu clave
        sys.exit(f"Error {r.status_code} de the-odds-api: {r.text[:200]}")
    restantes = r.headers.get("x-requests-remaining")
    if restantes:
        print(f"[créditos API restantes: {restantes}]", file=sys.stderr)
    return r.json()


def estado_api():
    """Créditos restantes y ligas activas. Esta llamada es gratis en the-odds-api."""
    clave = "".join(ODDS_API_KEY.split())
    r = requests.get("https://api.the-odds-api.com/v4/sports",
                     params={"apiKey": clave}, timeout=20)
    if r.status_code == 401:
        sys.exit("Clave de the-odds-api inválida (401). Revisa el secret ODDS_API_KEY.")
    if not r.ok:
        sys.exit(f"Error {r.status_code} de the-odds-api: {r.text[:200]}")
    restantes = int(float(r.headers.get("x-requests-remaining", 0)))
    activas = {d["key"] for d in r.json() if d.get("active")}
    return restantes, activas


def ligas_con_partidos(ligas, ahora, limite, usar_calendario):
    """Revisa GRATIS (endpoint /events) qué ligas tienen partidos en la ventana y,
    con --deporte auto, en un día de su calendario. Solo esas gastan créditos."""
    clave = "".join(ODDS_API_KEY.split())
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    con_partidos = []
    for lg in ligas:
        r = requests.get(f"https://api.the-odds-api.com/v4/sports/{lg}/events",
                         params={"apiKey": clave,
                                 "commenceTimeFrom": ahora.strftime(fmt),
                                 "commenceTimeTo": limite.strftime(fmt)}, timeout=20)
        if not r.ok:
            continue
        for ev in r.json():
            inicio = dt.datetime.fromisoformat(ev["commence_time"].replace("Z", "+00:00"))
            if not usar_calendario or inicio.astimezone(ZONA).weekday() in CALENDARIO[lg]:
                con_partidos.append(lg)
                break
    return con_partidos


def planear_mercados(ligas, restantes):
    """Reparte los créditos que quedan entre los días que faltan del mes."""
    hoy = dt.datetime.now(ZONA).date()
    fin_mes = (hoy.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    dias = (fin_mes - hoy).days                       # incluye hoy
    por_corrida = max(restantes - RESERVA, 0) / (dias * CORRIDAS_DIA)
    plan = {lg: ["h2h"] for lg in ligas}
    costo = len(plan)
    for lg, mk in EXTRAS:
        if lg in plan and costo + 1 <= por_corrida:
            plan[lg].append(mk)
            costo += 1
    if costo > por_corrida and restantes - RESERVA < costo:
        plan = {}                                      # sin créditos: no gastar la reserva
    return plan, por_corrida, costo


def etiqueta(outcome, mercado):
    nombre = outcome["name"]
    if mercado == "totals":
        nombre = {"Over": "Más de", "Under": "Menos de"}.get(nombre, nombre)
        return f"{nombre} {outcome['point']:g}"
    if mercado == "spreads":
        return f"{nombre} {outcome['point']:+g}"
    return "Empate" if nombre == "Draw" else nombre


def mercado_de(casa, clave):
    return next((m for m in casa.get("markets", []) if m["key"] == clave), None)


# ---------------------------------------------------------------- matemáticas
def sin_margen(cuotas, metodo=None):
    """Quita el margen de la casa.

    multiplicativo: reparte el margen proporcionalmente. Sobreestima a los no
                    favoritos (sesgo favorito-longshot).
    power (default): busca k tal que sum((1/cuota)^k) = 1. Le quita más margen
                    a las cuotas altas, que es donde las casas lo esconden.
    """
    metodo = metodo or METODO_DEVIG
    inversas = [1 / c for c in cuotas]
    if metodo == "multiplicativo" or sum(inversas) <= 1:
        total = sum(inversas)
        return [i / total for i in inversas]
    bajo, alto = 1.0, 10.0
    for _ in range(100):                      # bisección
        k = (bajo + alto) / 2
        if sum(i ** k for i in inversas) > 1:
            bajo = k
        else:
            alto = k
    ps = [i ** k for i in inversas]
    total = sum(ps)
    return [p / total for p in ps]


def probabilidades_justas(evento, mercado):
    """Probabilidad real estimada por selección. Prioriza Pinnacle; si no está,
    usa el consenso sin margen de 3+ casas con la misma línea."""
    for casa in evento["bookmakers"]:
        if casa["key"] == CASA_SHARP:
            m = mercado_de(casa, mercado)
            if m:
                ps = sin_margen([o["price"] for o in m["outcomes"]])
                return {etiqueta(o, mercado): p for o, p in zip(m["outcomes"], ps)}, "Pinnacle"

    por_casa = []
    for casa in evento["bookmakers"]:
        m = mercado_de(casa, mercado)
        if m:
            ps = sin_margen([o["price"] for o in m["outcomes"]])
            por_casa.append({etiqueta(o, mercado): p for o, p in zip(m["outcomes"], ps)})
    if not por_casa:
        return None
    linea_comun, n = Counter(frozenset(d) for d in por_casa).most_common(1)[0]
    if n < 3:
        return None
    grupo = [d for d in por_casa if frozenset(d) == linea_comun]
    promedio = {k: sum(d[k] for d in grupo) / n for k in linea_comun}
    return promedio, f"consenso de {n} casas"


def mejores_cuotas(evento, mercado):
    """Mejor cuota disponible por selección en las casas del feed (sin Pinnacle)."""
    mejores = {}
    for casa in evento["bookmakers"]:
        if casa["key"] == CASA_SHARP:
            continue
        m = mercado_de(casa, mercado)
        if not m:
            continue
        for o in m["outcomes"]:
            k = etiqueta(o, mercado)
            if k not in mejores or o["price"] > mejores[k][0]:
                mejores[k] = (o["price"], casa["title"])
    return mejores


def kelly(p, cuota):
    return max((p * cuota - 1) / (cuota - 1), 0.0)


def a_decimal(texto):
    """Acepta cuota decimal (2.50) o americana como la muestra Caliente (+150, -200)."""
    t = str(texto).strip().replace(" ", "")
    n = float(t)
    if t[0] in "+-" and abs(n) >= 100:
        return 1 + n / 100 if n > 0 else 1 + 100 / abs(n)
    if n <= 1:
        raise argparse.ArgumentTypeError(f"cuota inválida: {texto}")
    return n


def a_americano(d):
    return f"+{round((d - 1) * 100)}" if d >= 2 else f"-{round(100 / (d - 1))}"


def monto_sugerido(p, cuota):
    """Kelly fraccional: apuesta más cuando la ventaja es mayor y la cuota más baja.
    Con una cuota de 4.0 apuesta mucho menos que con 1.80 para la misma ventaja."""
    if p * cuota - 1 <= 0:
        return 0
    if APUESTA_FIJA > 0:
        return round(APUESTA_FIJA, 2)
    monto = min(kelly(p, cuota) * FRACCION_KELLY, TOPE_APUESTA) * BANCA
    return float(max(round(monto), APUESTA_MIN))


# ---------------------------------------------------------------- alertas
DUENO = "".join(os.getenv("TELEGRAM_CHAT_ID", "").split())
BOT_URL = os.getenv("BOT_URL", "https://bot-apuestas-telegram.vercel.app")


def usuarios_alertas():
    """Quién recibe las alertas y con qué banca (la actual de cada uno, según su bitácora).
    Si el bot de Telegram no responde, solo el dueño con BANCA."""
    token = "".join(os.getenv("TELEGRAM_TOKEN", "").split())
    if requests and token:
        try:
            r = requests.get(f"{BOT_URL}/api/telegram", params={"usuarios": "1"},
                             headers={"x-bot-token": token}, timeout=15)
            if r.ok and isinstance(r.json(), list) and r.json():
                return [(str(u["chat_id"]), float(u["banca_actual"]), u.get("nombre", "")) for u in r.json()]
        except (requests.RequestException, ValueError, KeyError, TypeError):
            pass
        print("No se pudo leer la lista de usuarios; envío solo al dueño.", file=sys.stderr)
    return [(DUENO, BANCA, "")]


def telegram(texto, chat=None):
    token = "".join(os.getenv("TELEGRAM_TOKEN", "").split())
    chat = chat or DUENO
    if not (token and chat and requests):
        return
    try:
        for i in range(0, len(texto), 4000):          # límite de Telegram por mensaje
            requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                          data={"chat_id": chat, "text": texto[i:i + 4000]}, timeout=10)
    except requests.RequestException as e:
        print(f"No se pudo enviar a Telegram: {type(e).__name__}", file=sys.stderr)


EMOJI = {"soccer": "⚽", "americanfootball": "🏈", "basketball": "🏀", "baseball": "⚾"}
UNIDAD = {"soccer": "goles", "americanfootball": "pts", "basketball": "pts", "baseball": "carreras"}
TITULO_MERCADO = {"h2h": "🏆 Ganador", "totals": "📊 Total", "spreads": "↔️ Hándicap"}


def mensaje_telegram(tabla):
    """Un bloque por partido, agrupado por mercado. ⭐ = lo más probable del mercado."""
    msg = [f"🎯 SEÑALES · banca ${BANCA:,.0f}",
           "⭐ = lo más probable · % = probabilidad real",
           "Apuesta solo si tu casa paga IGUAL o MEJOR.",
           "En total y hándicap, la línea tiene que ser la misma."]
    partidos = {}
    for f in sorted(tabla, key=lambda x: (x["inicio"], x["partido"])):
        partidos.setdefault((f["hora"], f["partido"], f["deporte"]), {}) \
                .setdefault(f["mk"], []).append(f)
    for (hora, partido, deporte), mercados in partidos.items():
        tipo = deporte.split("_")[0]
        liga = NOMBRE_LIGA.get(deporte, deporte)
        msg += ["", "━━━━━━━━━━━━━━",
                f"{EMOJI.get(tipo, '🎯')} {liga} · {hora}", partido]
        for mk in ("h2h", "totals", "spreads"):
            filas = mercados.get(mk)
            if not filas:
                continue
            msg.append("")
            msg.append(TITULO_MERCADO[mk])
            mejor = max(filas, key=lambda x: x["prob"])
            for f in sorted(filas, key=lambda x: -x["prob"]):
                marca = "⭐" if f is mejor and len(filas) > 1 else "▫️"
                rayo = " ⚡" if abs(f["mov"]) >= MOVIMIENTO else ""
                sel = f["seleccion"]
                if mk == "totals":
                    sel += f" {UNIDAD.get(tipo, '')}"
                msg.append(f"{marca} {sel} · {f['prob']:.1%}{rayo}")
                msg.append(f"      paga {a_americano(f['minima'])} o mejor → ${f['monto']:,.0f}")
    return msg


def cargar_estado():
    try:
        return json.loads(ESTADO.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


# ---------------------------------------------------------------- comandos
def escanear(args):
    ahora = dt.datetime.now(dt.timezone.utc)
    limite = ahora + dt.timedelta(hours=args.horas)
    valor, tabla = [], []
    previo, nuevo_estado = cargar_estado(), {}
    conteo = {}   # liga -> [partidos en la API, en el horario, con línea Pinnacle, señales]

    if args.deporte == "auto":
        # días (en hora de México) que cubre la ventana de este escaneo
        # (un día que la ventana solo toca menos de 6 h no cuenta: ahorra créditos)
        dias, d = set(), ahora.astimezone(ZONA).date()
        while d <= limite.astimezone(ZONA).date():
            inicio_dia = dt.datetime.combine(d, dt.time(), ZONA)
            cubierto = min(limite, inicio_dia + dt.timedelta(days=1)) - max(ahora, inicio_dia)
            if cubierto >= dt.timedelta(hours=6):
                dias.add(d.weekday())
            d += dt.timedelta(days=1)
        ligas = [lg for lg, ds in CALENDARIO.items() if ds & dias]
    else:
        ligas = DEPORTES[args.deporte]

    plan, nota_creditos = {lg: list(args.mercados) for lg in ligas}, ""
    if args.presupuesto and not args.demo:
        restantes, activas = estado_api()
        ligas = [lg for lg in ligas if lg in activas]          # fuera de temporada: no gastar
        ligas = ligas_con_partidos(ligas, ahora, limite, args.deporte == "auto")
        if not ligas:
            print(f"Sin partidos del calendario en las próximas {args.horas} h. "
                  f"No se gastó ningún crédito ({restantes} restantes).")
            return
        plan, por_corrida, costo = planear_mercados(ligas, restantes)
        if not plan:
            telegram("⚠️ Se acabaron los créditos de the-odds-api de este mes.")
            sys.exit("Sin créditos suficientes este mes.")
        detalle = ", ".join(f"{NOMBRE_LIGA.get(k, k)}: {'+'.join(NOMBRE_MERCADO[m] for m in v)}"
                            for k, v in plan.items())
        print(f"Créditos: {restantes} restantes · presupuesto {por_corrida:.1f}/corrida · "
              f"esta corrida gasta ≤ {costo}\nPlan: {detalle}")
        nota_creditos = f"💳 Créditos: {restantes - costo} aprox. · {detalle}"
        ligas = list(plan)

    for sport in ligas:
        mercados = plan.get(sport, args.mercados)
        eventos = obtener_momios(sport, mercados, args.demo)
        c = conteo.setdefault(sport, [len(eventos), 0, 0, 0])
        for ev in eventos:
            inicio = dt.datetime.fromisoformat(ev["commence_time"].replace("Z", "+00:00"))
            if not args.demo and not (ahora < inicio <= limite):
                continue
            if args.deporte == "auto" and \
                    inicio.astimezone(ZONA).weekday() not in CALENDARIO[sport]:
                continue
            c[1] += 1
            if any(b["key"] == CASA_SHARP for b in ev["bookmakers"]):
                c[2] += 1
            partido = f"{ev['home_team']} vs {ev['away_team']}" if sport.startswith("soccer") \
                else f"{ev['away_team']} @ {ev['home_team']}"
            local = inicio.astimezone(ZONA)
            hora = f"{DIAS[local.weekday()]} {local:%d %H:%M}"

            for mk in mercados:
                res = probabilidades_justas(ev, mk)
                if not res:
                    continue
                probs, fuente = res
                mejores = mejores_cuotas(ev, mk)
                for sel, p in probs.items():
                    justa = 1 / p
                    minima = justa * (1 + EDGE_MIN)
                    clave = f"{ev.get('id', partido)}|{mk}|{sel}"
                    nuevo_estado[clave] = p
                    if not (CUOTA_MIN <= minima <= CUOTA_MAX):
                        continue
                    antes = previo.get(clave)
                    fila = {
                        "hora": hora, "partido": partido, "mercado": NOMBRE_MERCADO[mk],
                        "seleccion": sel, "prob": p, "justa": justa, "minima": minima,
                        "fuente": fuente, "monto": monto_sugerido(p, minima),
                        "mov": (p - antes) if antes is not None else 0.0,
                        "inicio": inicio, "deporte": sport, "mk": mk,
                    }
                    tabla.append(fila)
                    c[3] += 1
                    if sel in mejores:
                        cuota, casa = mejores[sel]
                        ev_pct = p * cuota - 1
                        if ev_pct >= EDGE_MIN:
                            valor.append({**fila, "cuota": cuota, "casa": casa,
                                          "ev": ev_pct, "monto": monto_sugerido(p, cuota)})

    resumen_ligas = " · ".join(
        f"{NOMBRE_LIGA.get(k, k)} {v[3]}" for k, v in conteo.items())
    print("\nPor liga (partidos API / en horario / con Pinnacle / señales):")
    for k, v in conteo.items():
        print(f"  {NOMBRE_LIGA.get(k, k):<12} {v[0]:>3} / {v[1]:>3} / {v[2]:>3} / {v[3]:>3}")

    if not args.demo:
        ESTADO.write_text(json.dumps(nuevo_estado), encoding="utf-8")

    if not tabla:
        print("No hay partidos con líneas disponibles en ese rango de horas.")
        if args.telegram:
            telegram(f"Sin señales en las próximas {args.horas} h.\n{resumen_ligas}\n{nota_creditos}")
        return

    print(f"\n=== CUOTAS MÍNIMAS para Caliente / Draftea "
          f"(ventaja ≥ {EDGE_MIN:.0%}, cuotas {CUOTA_MIN}–{CUOTA_MAX}) — {args.deporte.upper()} ===")
    print("Si tu casa paga IGUAL O MÁS que 'mínima', apuesta el monto indicado.")
    print("⚡ = la línea de Pinnacle se movió desde el escaneo anterior: revisa primero esas.\n")
    actual = None
    for f in sorted(tabla, key=lambda x: (x["inicio"], x["partido"])):
        if f["partido"] != actual:
            actual = f["partido"]
            print(f"{f['hora']}  {actual}   [{f['fuente']}]")
        rayo = "⚡" if abs(f["mov"]) >= MOVIMIENTO else " "
        print(f" {rayo} {f['mercado']:<9} {f['seleccion']:<28} prob {f['prob']:5.1%}  "
              f"justa {f['justa']:5.2f}  mínima {f['minima']:5.2f} ({a_americano(f['minima'])})"
              f"  → ${f['monto']:,.0f}")

    con_senal = " · ".join(f"{NOMBRE_LIGA.get(k, k)} {v[3]}" for k, v in conteo.items() if v[3])
    if args.telegram:
        global BANCA
        banca_original = BANCA
        for chat, banca, _nombre in usuarios_alertas():
            BANCA = banca                     # el monto sugerido depende de la banca de cada quien
            for f in tabla:
                f["monto"] = monto_sugerido(f["prob"], f["minima"])
            msg = mensaje_telegram(tabla)
            msg.append(f"\n📋 {con_senal}")
            if nota_creditos and chat == DUENO:
                msg.append(nota_creditos.split(" · ")[0])
            telegram("\n".join(msg), chat)
        BANCA = banca_original

    if valor:
        print("\n=== VALOR ENCONTRADO en casas del feed ===")
        lineas = []
        for v in sorted(valor, key=lambda x: -x["ev"]):
            linea = (f"{v['partido']} | {v['mercado']}: {v['seleccion']} @ {v['cuota']:.2f} "
                     f"({v['casa']}) | EV {v['ev']:+.1%} | apuesta ${v['monto']:,.2f}")
            print(linea)
            lineas.append(linea)
        if args.telegram:
            telegram("Señales de valor:\n" + "\n".join(lineas))


def revisar(args):
    p = 1 / args.justa
    ev = p * args.cuota - 1
    print(f"Probabilidad justa: {p:.1%}")
    print(f"Valor esperado:     {ev:+.1%} por peso apostado")
    if ev < EDGE_MIN:
        print(f"Veredicto: NO apostar (necesitas cuota ≥ {args.justa * (1 + EDGE_MIN):.2f}).")
    else:
        regla = (f"apuesta fija" if APUESTA_FIJA > 0 else
                 f"Kelly ×{FRACCION_KELLY}, tope {TOPE_APUESTA:.1%} de banca ${BANCA:,.0f}")
        print(f"Veredicto: APOSTAR ${monto_sugerido(p, args.cuota):,.2f} ({regla}).")


def leer_registro():
    if not REGISTRO.exists():
        return []
    with REGISTRO.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def guardar_registro(filas):
    with REGISTRO.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CAMPOS)
        w.writeheader()
        w.writerows(filas)


def registrar(args):
    filas = leer_registro()
    nuevo = {
        "id": str(max([int(f["id"]) for f in filas], default=0) + 1),
        "fecha": dt.datetime.now(ZONA).strftime("%Y-%m-%d %H:%M"),
        "partido": args.partido, "seleccion": args.seleccion, "casa": args.casa,
        "cuota": f"{args.cuota:.2f}", "monto": f"{args.monto:.2f}",
        "cuota_justa": f"{args.justa:.2f}" if args.justa else "",
        "resultado": "pendiente", "ganancia": "",
    }
    filas.append(nuevo)
    guardar_registro(filas)
    print(f"Apuesta #{nuevo['id']} registrada.")


def liquidar(args):
    filas = leer_registro()
    for f in filas:
        if f["id"] == str(args.id):
            monto, cuota = float(f["monto"]), float(f["cuota"])
            ganancia = {"gana": monto * (cuota - 1), "pierde": -monto, "nula": 0.0}[args.resultado]
            f["resultado"], f["ganancia"] = args.resultado, f"{ganancia:.2f}"
            guardar_registro(filas)
            print(f"#{args.id} → {args.resultado} ({ganancia:+,.2f})")
            return
    sys.exit(f"No existe la apuesta #{args.id}")


def resumen(_args):
    filas = [f for f in leer_registro() if f["resultado"] != "pendiente"]
    pendientes = len(leer_registro()) - len(filas)
    if not filas:
        print(f"Sin apuestas liquidadas aún ({pendientes} pendientes).")
        return
    apostado = sum(float(f["monto"]) for f in filas)
    ganancia = sum(float(f["ganancia"]) for f in filas)
    ganadas = sum(f["resultado"] == "gana" for f in filas)
    con_justa = [f for f in filas if f["cuota_justa"]]
    esperado = sum(float(f["monto"]) * (float(f["cuota"]) / float(f["cuota_justa"]) - 1)
                   for f in con_justa)
    print(f"Apuestas liquidadas: {len(filas)}  (pendientes: {pendientes})")
    print(f"Ganadas:             {ganadas} ({ganadas / len(filas):.0%})")
    print(f"Total apostado:      ${apostado:,.2f}")
    print(f"Ganancia real:       ${ganancia:+,.2f}  (ROI {ganancia / apostado:+.1%})")
    if con_justa:
        print(f"Ganancia esperada:   ${esperado:+,.2f}  ← si la real va muy abajo por mucho "
              f"tiempo, revisa la estrategia")


# ---------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser(description="Bot de señales de value betting")
    sub = ap.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("escanear", help="busca cuotas justas y valor")
    e.add_argument("--deporte", choices=list(DEPORTES) + ["auto"], required=True,
                   help="auto = según el CALENDARIO de días por liga")
    e.add_argument("--mercados", nargs="+", default=["h2h"], choices=list(NOMBRE_MERCADO),
                   help="h2h (ganador), spreads (hándicap), totals (altas/bajas)")
    e.add_argument("--presupuesto", action="store_true",
                   help="elige mercados extra según los créditos que quedan en el mes")
    e.add_argument("--horas", type=int, default=36, help="solo partidos en las próximas N horas")
    e.add_argument("--demo", help="archivo JSON de prueba en lugar de la API")
    e.add_argument("--telegram", action="store_true", help="enviar el resultado a Telegram")
    e.set_defaults(func=escanear)

    r = sub.add_parser("revisar", help="¿vale la pena esta cuota de Caliente/Draftea?")
    r.add_argument("--cuota", type=a_decimal, required=True,
                   help="cuota de tu casa: decimal (2.50) o americana (+150)")
    r.add_argument("--justa", type=a_decimal, required=True, help="cuota justa que dio 'escanear'")
    r.set_defaults(func=revisar)

    g = sub.add_parser("registrar", help="anota una apuesta hecha")
    g.add_argument("--partido", required=True)
    g.add_argument("--seleccion", required=True)
    g.add_argument("--casa", required=True)
    g.add_argument("--cuota", type=a_decimal, required=True)
    g.add_argument("--monto", type=float, default=APUESTA_FIJA or None,
                   required=APUESTA_FIJA <= 0)
    g.add_argument("--justa", type=a_decimal)
    g.set_defaults(func=registrar)

    l = sub.add_parser("liquidar", help="marca el resultado de una apuesta")
    l.add_argument("--id", type=int, required=True)
    l.add_argument("--resultado", choices=["gana", "pierde", "nula"], required=True)
    l.set_defaults(func=liquidar)

    s = sub.add_parser("resumen", help="ROI y ganancia real vs esperada")
    s.set_defaults(func=resumen)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
