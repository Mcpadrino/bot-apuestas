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

DEPORTES = {
    "futbol": [
        "soccer_mexico_ligamx",
        "soccer_epl",
        "soccer_spain_la_liga",
        "soccer_uefa_champs_league",
    ],
    "nfl": ["americanfootball_nfl"],
    "mlb": ["baseball_mlb"],
    "nba": ["basketball_nba"],
}
DEPORTES["todos"] = [s for lista in DEPORTES.values() for s in lista]
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
def telegram(texto):
    token = "".join(os.getenv("TELEGRAM_TOKEN", "").split())
    chat = "".join(os.getenv("TELEGRAM_CHAT_ID", "").split())
    if not (token and chat and requests):
        return
    try:
        for i in range(0, len(texto), 4000):          # límite de Telegram por mensaje
            requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                          data={"chat_id": chat, "text": texto[i:i + 4000]}, timeout=10)
    except requests.RequestException as e:
        print(f"No se pudo enviar a Telegram: {type(e).__name__}", file=sys.stderr)


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

    for sport in DEPORTES[args.deporte]:
        for ev in obtener_momios(sport, args.mercados, args.demo):
            inicio = dt.datetime.fromisoformat(ev["commence_time"].replace("Z", "+00:00"))
            if not args.demo and not (ahora < inicio <= limite):
                continue
            partido = f"{ev['home_team']} vs {ev['away_team']}" if sport.startswith("soccer") \
                else f"{ev['away_team']} @ {ev['home_team']}"
            local = inicio.astimezone(ZONA)
            hora = f"{DIAS[local.weekday()]} {local:%d %H:%M}"

            for mk in args.mercados:
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
                    }
                    tabla.append(fila)
                    if sel in mejores:
                        cuota, casa = mejores[sel]
                        ev_pct = p * cuota - 1
                        if ev_pct >= EDGE_MIN:
                            valor.append({**fila, "cuota": cuota, "casa": casa,
                                          "ev": ev_pct, "monto": monto_sugerido(p, cuota)})

    if not args.demo:
        ESTADO.write_text(json.dumps(nuevo_estado), encoding="utf-8")

    if not tabla:
        print("No hay partidos con líneas disponibles en ese rango de horas.")
        return

    print(f"\n=== CUOTAS MÍNIMAS para Caliente / Draftea "
          f"(ventaja ≥ {EDGE_MIN:.0%}, cuotas {CUOTA_MIN}–{CUOTA_MAX}) — {args.deporte.upper()} ===")
    print("Si tu casa paga IGUAL O MÁS que 'mínima', apuesta el monto indicado.")
    print("⚡ = la línea de Pinnacle se movió desde el escaneo anterior: revisa primero esas.\n")
    actual, msg = None, [f"🎯 Cuotas mínimas {args.deporte.upper()} (banca ${BANCA:,.0f})"]
    for f in sorted(tabla, key=lambda x: (x["hora"], x["partido"])):
        if f["partido"] != actual:
            actual = f["partido"]
            print(f"{f['hora']}  {actual}   [{f['fuente']}]")
            msg.append(f"\n🕐 {f['hora']}  {actual}")
        rayo = "⚡" if abs(f["mov"]) >= MOVIMIENTO else " "
        print(f" {rayo} {f['mercado']:<9} {f['seleccion']:<28} prob {f['prob']:5.1%}  "
              f"justa {f['justa']:5.2f}  mínima {f['minima']:5.2f} ({a_americano(f['minima'])})"
              f"  → ${f['monto']:,.0f}")
        msg.append(f"{rayo.strip()}{f['seleccion']} ({f['mercado']}): mín {a_americano(f['minima'])}"
                   f" / {f['minima']:.2f} → ${f['monto']:,.0f}")
    if args.telegram:
        telegram("\n".join(msg))

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
    e.add_argument("--deporte", choices=DEPORTES, required=True)
    e.add_argument("--mercados", nargs="+", default=["h2h"], choices=list(NOMBRE_MERCADO),
                   help="h2h (ganador), spreads (hándicap), totals (altas/bajas)")
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
