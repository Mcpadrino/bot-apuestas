"""
Excel diario para el dueño: Gurú (modelos propios) contra Pinnacle (el mercado).
Lo manda por Telegram cada mañana después de calificar los partidos de ayer. No gasta créditos de cuotas.

python guru_excel.py                     -> genera y manda el Excel al dueño
python guru_excel.py --prueba            -> solo genera guru-vs-pinnacle.xlsx (no manda nada)
python guru_excel.py --archivo datos.json --prueba   -> usa un JSON local en lugar de la API (pruebas)
"""
import datetime as dt
import io
import json
import math
import os
import sys
from collections import defaultdict
from pathlib import Path

import requests
from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

BOT_URL = os.getenv("BOT_URL", "https://bot-apuestas-telegram.vercel.app")
TOKEN = "".join(os.getenv("TELEGRAM_TOKEN", "").split())
DUENO = "".join(os.getenv("TELEGRAM_CHAT_ID", "").split())
PRUEBA = "--prueba" in sys.argv
MX = dt.timezone(dt.timedelta(hours=-6))

VERDE, VERDE_O, ROJO, GRIS, AMBAR, AZUL = "D7F5E6", "0F5132", "FBDADA", "F2F2F2", "FFF1CC", "DCE8FB"
BORDE = Border(bottom=Side(style="thin", color="D5DDD8"))
CAB_FONT, CAB_FILL = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor=VERDE_O)
NOMBRE_RES = {"L": "Local", "E": "Empate", "V": "Visita"}


# ---------------------------------------------------------------- datos
def leer():
    if "--archivo" in sys.argv:
        return json.loads(Path(sys.argv[sys.argv.index("--archivo") + 1]).read_text(encoding="utf-8"))
    r = requests.post(f"{BOT_URL}/api/telegram", params={"guru": "1"}, headers={"x-bot-token": TOKEN},
                      json={"accion": "excel", "datos": {}}, timeout=40)
    r.raise_for_status()
    return r.json()


def hora_mx(iso):
    return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(MX).replace(tzinfo=None)


def grupo(f):
    """Nombre del modelo para las tablas."""
    if f["modelo"] == "xG":
        return "Gurú xG · futbol"
    if f["modelo"] == "Dixon-Coles":
        return "Gurú Dixon-Coles · futbol"
    return f"Gurú Elo · {f['deporte'].upper()}"


def probs(f):
    g = {"L": float(f["p_local"] or 0), "E": float(f["p_empate"] or 0), "V": float(f["p_visita"] or 0)}
    m = f.get("mercado") or {}
    p = None
    if isinstance(m, dict) and "L" in m and "V" in m:
        p = {"L": float(m.get("L") or 0), "E": float(m.get("E") or 0), "V": float(m.get("V") or 0)}
    return g, p


def favorito(p):
    return max(p, key=p.get)


def analizar(f):
    """Agrega a cada partido calificado: quién acertó, quién estuvo más cerca, log-loss y Brier."""
    g, p = probs(f)
    f["g"], f["p"] = g, p
    f["fecha"] = hora_mx(f["inicio"])
    f["fav_g"] = favorito(g)
    f["fav_p"] = favorito(p) if p else None
    f["diff"] = (max(abs(g[k] - p[k]) for k in g) if p else None)
    if not f.get("res"):
        return f
    r = f["res"]
    f["ok_g"] = f["fav_g"] == r
    f["pg"] = g[r]
    f["ll_g"] = -math.log(max(g[r], 0.001))
    f["br_g"] = sum((g[k] - (1 if k == r else 0)) ** 2 for k in g)
    if p:
        f["ok_p"] = f["fav_p"] == r
        f["pp"] = p[r]
        f["ll_p"] = -math.log(max(p[r], 0.001))
        f["br_p"] = sum((p[k] - (1 if k == r else 0)) ** 2 for k in p)
        f["cerca"] = "Gurú" if g[r] > p[r] + 0.005 else "Pinnacle" if p[r] > g[r] + 0.005 else "Empate"
    return f


def resumen(filas):
    """Métricas de un conjunto de partidos calificados con Pinnacle."""
    n = len(filas)
    if not n:
        return None
    s = {
        "n": n,
        "ag": sum(f["ok_g"] for f in filas), "ap": sum(f["ok_p"] for f in filas),
        "cg": sum(f["cerca"] == "Gurú" for f in filas), "cp": sum(f["cerca"] == "Pinnacle" for f in filas),
        "llg": sum(f["ll_g"] for f in filas) / n, "llp": sum(f["ll_p"] for f in filas) / n,
        "brg": sum(f["br_g"] for f in filas) / n, "brp": sum(f["br_p"] for f in filas) / n,
    }
    s["pag"], s["pap"] = s["ag"] / n, s["ap"] / n
    if n < 30:
        s["veredicto"] = "Pocos partidos todavía"
    elif s["llg"] < s["llp"] - 0.01:
        s["veredicto"] = "Gurú mejor que Pinnacle"
    elif s["llg"] > s["llp"] + 0.01:
        s["veredicto"] = "Pinnacle mejor"
    else:
        s["veredicto"] = "Prácticamente iguales"
    return s


# ---------------------------------------------------------------- formato
def cabecera(ws, fila, textos, anchos=None):
    for i, t in enumerate(textos, 1):
        c = ws.cell(fila, i, t)
        c.font, c.fill = CAB_FONT, CAB_FILL
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[fila].height = 32
    if anchos:
        for i, w in enumerate(anchos, 1):
            ws.column_dimensions[get_column_letter(i)].width = w


def titulo(ws, texto, sub=None):
    ws["A1"] = texto
    ws["A1"].font = Font(bold=True, size=15, color=VERDE_O)
    if sub:
        ws["A2"] = sub
        ws["A2"].font = Font(italic=True, color="5D6E65")


def pinta(ws, fila, color, desde=1, hasta=None):
    for c in ws[fila][desde - 1:hasta]:
        c.fill = PatternFill("solid", fgColor=color)


PCT, DEC = "0.0%", "0.000"


# ---------------------------------------------------------------- hojas
def hoja_resumen(wb, cal, cal_p, ayer, proximos):
    ws = wb.active
    ws.title = "Resumen"
    hoy = dt.datetime.now(MX)
    titulo(ws, "Gurú vs Pinnacle · reporte diario",
           f"Generado {hoy:%d/%m/%Y %H:%M} (hora centro de México) · últimos 200 partidos calificados con línea de Pinnacle")

    # --- tabla por modelo
    fila = 4
    ws.cell(fila, 1, "¿Quién acierta más? (últimos 200 por modelo)").font = Font(bold=True, size=12)
    fila += 1
    cab = ["Modelo", "Partidos", "Aciertos Gurú", "% Gurú", "Aciertos Pinnacle", "% Pinnacle", "Gurú más cerca",
           "Pinnacle más cerca", "Log-loss Gurú", "Log-loss Pinnacle", "Brier Gurú", "Brier Pinnacle", "Veredicto"]
    cabecera(ws, fila, cab, [36, 12, 12, 9, 13, 10, 12, 13, 12, 13, 11, 12, 26])
    inicio_tabla = fila + 1
    grupos = defaultdict(list)
    for f in sorted(cal_p, key=lambda x: x["fecha"], reverse=True):
        if len(grupos[grupo(f)]) < 200:
            grupos[grupo(f)].append(f)
    todos = [f for g in grupos.values() for f in g]
    for nombre, lista in sorted(grupos.items()) + [("TOTAL", todos)]:
        s = resumen(lista)
        if not s:
            continue
        fila += 1
        valores = [nombre, s["n"], s["ag"], s["pag"], s["ap"], s["pap"], s["cg"], s["cp"],
                   s["llg"], s["llp"], s["brg"], s["brp"], s["veredicto"]]
        for i, v in enumerate(valores, 1):
            ws.cell(fila, i, v).border = BORDE
        for col in (4, 6):
            ws.cell(fila, col).number_format = PCT
        for col in (9, 10, 11, 12):
            ws.cell(fila, col).number_format = DEC
        color = VERDE if "Gurú mejor" in s["veredicto"] else ROJO if "Pinnacle mejor" in s["veredicto"] else GRIS
        ws.cell(fila, 13).fill = PatternFill("solid", fgColor=color)
        if nombre == "TOTAL":
            for c in ws[fila]:
                c.font = Font(bold=True)
    fin_tabla = fila
    if fin_tabla < inicio_tabla:
        ws.cell(inicio_tabla, 1, "Todavía no hay partidos calificados con línea de Pinnacle. "
                                 "En cuanto terminen los primeros, aparecen aquí.").font = Font(italic=True)
        fin_tabla = inicio_tabla

    # --- ayer
    fila = fin_tabla + 3
    ws.cell(fila, 1, "Ayer (últimas 24 horas)").font = Font(bold=True, size=12)
    s_ayer = resumen([f for f in ayer if f["p"]])
    sin_p = [f for f in ayer if not f["p"]]
    lineas = [
        ("Partidos calificados", len(ayer)),
        ("Con línea de Pinnacle", s_ayer["n"] if s_ayer else 0),
        ("Aciertos Gurú (con Pinnacle)", f"{s_ayer['ag']} de {s_ayer['n']}" if s_ayer else "—"),
        ("Aciertos Pinnacle", f"{s_ayer['ap']} de {s_ayer['n']}" if s_ayer else "—"),
        ("Gurú más cerca / Pinnacle más cerca", f"{s_ayer['cg']} / {s_ayer['cp']}" if s_ayer else "—"),
        ("Aciertos Gurú sin línea de Pinnacle", f"{sum(f['ok_g'] for f in sin_p)} de {len(sin_p)}" if sin_p else "—"),
    ]
    for k, v in lineas:
        fila += 1
        ws.cell(fila, 1, k)
        ws.cell(fila, 2, v).font = Font(bold=True)

    # --- hoy y mañana
    fila += 2
    ws.cell(fila, 1, "Lo que viene").font = Font(bold=True, size=12)
    difieren = [f for f in proximos if f["diff"] is not None and f["diff"] >= 0.04]
    for k, v in [("Pronósticos para hoy y mañana", len(proximos)),
                 ("Con línea de Pinnacle", sum(1 for f in proximos if f["p"])),
                 ("Donde el Gurú difiere 4 pts o más", len(difieren))]:
        fila += 1
        ws.cell(fila, 1, k)
        ws.cell(fila, 2, v).font = Font(bold=True)

    # --- gráfica de % de aciertos por modelo
    if fin_tabla > inicio_tabla:
        ch = BarChart()
        ch.type, ch.title, ch.y_axis.title = "col", "% de aciertos (favorito)", "%"
        ch.y_axis.number_format = "0%"
        datos = Reference(ws, min_col=4, max_col=4, min_row=inicio_tabla - 1, max_row=fin_tabla)
        datos2 = Reference(ws, min_col=6, max_col=6, min_row=inicio_tabla - 1, max_row=fin_tabla)
        cats = Reference(ws, min_col=1, min_row=inicio_tabla, max_row=fin_tabla)
        ch.add_data(datos, titles_from_data=True)
        ch.add_data(datos2, titles_from_data=True)
        ch.set_categories(cats)
        ch.height, ch.width = 8, 18
        ws.add_chart(ch, f"D{fin_tabla + 3}")
    ws.freeze_panes = "A4"


def hoja_partidos(wb, nombre, filas, titulo_txt, sub):
    ws = wb.create_sheet(nombre)
    titulo(ws, titulo_txt, sub)
    cab = ["Fecha", "Liga", "Modelo", "Local", "Visita", "Marcador", "Resultado",
           "Gurú L", "Gurú E", "Gurú V", "Pinn. L", "Pinn. E", "Pinn. V",
           "Favorito Gurú", "Favorito Pinn.", "¿Acertó Gurú?", "¿Acertó Pinn.?",
           "Prob. Gurú al resultado", "Prob. Pinn. al resultado", "Más cerca", "Log-loss Gurú", "Log-loss Pinn."]
    cabecera(ws, 4, cab, [15, 14, 18, 20, 20, 22, 10, 8, 8, 8, 8, 8, 8, 12, 12, 11, 11, 12, 12, 11, 11, 11])
    for f in filas:
        g, p = f["g"], f["p"] or {}
        fila = [f["fecha"], f["liga"], f["modelo"], f["local"], f["visita"], f.get("marcador") or "",
                NOMBRE_RES.get(f["res"], ""), g["L"], g["E"] if f["deporte"] == "futbol" else None, g["V"],
                p.get("L"), p.get("E") if p and f["deporte"] == "futbol" else None, p.get("V"),
                NOMBRE_RES[f["fav_g"]], NOMBRE_RES.get(f["fav_p"], "—"),
                "Sí" if f["ok_g"] else "No", ("Sí" if f["ok_p"] else "No") if f["p"] else "—",
                f["pg"], f.get("pp"), f.get("cerca", "Sin línea"), f["ll_g"], f.get("ll_p")]
        ws.append(fila)
        r = ws.max_row
        ws.cell(r, 1).number_format = "dd/mm/yy hh:mm"
        for col in range(8, 14):
            ws.cell(r, col).number_format = PCT
        for col in (18, 19):
            ws.cell(r, col).number_format = PCT
        for col in (21, 22):
            ws.cell(r, col).number_format = DEC
        ws.cell(r, 16).fill = PatternFill("solid", fgColor=VERDE if f["ok_g"] else ROJO)
        if f["p"]:
            ws.cell(r, 17).fill = PatternFill("solid", fgColor=VERDE if f["ok_p"] else ROJO)
        color = {"Gurú": VERDE, "Pinnacle": AZUL, "Empate": GRIS}.get(f.get("cerca"), GRIS)
        ws.cell(r, 20).fill = PatternFill("solid", fgColor=color)
        # resalta la probabilidad que cada uno le dio al resultado real
        col_res = {"L": 0, "E": 1, "V": 2}[f["res"]]
        ws.cell(r, 8 + col_res).font = Font(bold=True)
        if f["p"]:
            ws.cell(r, 11 + col_res).font = Font(bold=True)
    if not filas:
        ws.cell(5, 1, "Sin partidos calificados en este periodo.").font = Font(italic=True)
    ws.freeze_panes = "D5"
    ws.auto_filter.ref = f"A4:{get_column_letter(len(cab))}{max(ws.max_row, 5)}"
    return ws


def hoja_ligas(wb, cal):
    ws = wb.create_sheet("Por liga")
    titulo(ws, "Por liga y modelo", "Todos los partidos calificados de los últimos 90 días")
    cab = ["Liga", "Modelo", "Partidos", "Aciertos Gurú", "% Gurú", "Con Pinnacle", "Aciertos Pinn.", "% Pinn.",
           "Gurú más cerca", "Pinn. más cerca", "Log-loss Gurú", "Log-loss Pinn.", "Ventaja Gurú (log-loss)"]
    cabecera(ws, 4, cab, [18, 18, 10, 12, 9, 12, 12, 9, 12, 12, 12, 12, 16])
    por = defaultdict(list)
    for f in cal:
        por[(f["liga"], f["modelo"])].append(f)
    for (liga, modelo), lista in sorted(por.items(), key=lambda x: -len(x[1])):
        con_p = [f for f in lista if f["p"]]
        s = resumen(con_p)
        ag = sum(f["ok_g"] for f in lista)
        fila = [liga, modelo, len(lista), ag, ag / len(lista), len(con_p),
                s["ap"] if s else None, s["pap"] if s else None, s["cg"] if s else None, s["cp"] if s else None,
                s["llg"] if s else None, s["llp"] if s else None, (s["llp"] - s["llg"]) if s else None]
        ws.append(fila)
        r = ws.max_row
        for col in (5, 8):
            ws.cell(r, col).number_format = PCT
        for col in (11, 12, 13):
            ws.cell(r, col).number_format = DEC
    ultima = max(ws.max_row, 5)
    ws.conditional_formatting.add(f"M5:M{ultima}", CellIsRule(operator="greaterThan", formula=["0.01"],
                                                               fill=PatternFill("solid", fgColor=VERDE)))
    ws.conditional_formatting.add(f"M5:M{ultima}", CellIsRule(operator="lessThan", formula=["-0.01"],
                                                               fill=PatternFill("solid", fgColor=ROJO)))
    ws.freeze_panes = "C5"


def hoja_evolucion(wb, cal_p):
    ws = wb.create_sheet("Evolución")
    titulo(ws, "Evolución día a día", "% de aciertos acumulado (partidos con línea de Pinnacle)")
    cabecera(ws, 4, ["Día", "Partidos del día", "Acum. partidos", "% Gurú acumulado", "% Pinnacle acumulado",
                     "Log-loss Gurú acum.", "Log-loss Pinn. acum."], [12, 12, 12, 16, 18, 16, 18])
    por_dia = defaultdict(list)
    for f in cal_p:
        por_dia[f["fecha"].date()].append(f)
    n = ag = ap = llg = llp = 0
    for dia in sorted(por_dia):
        lista = por_dia[dia]
        n += len(lista)
        ag += sum(f["ok_g"] for f in lista)
        ap += sum(f["ok_p"] for f in lista)
        llg += sum(f["ll_g"] for f in lista)
        llp += sum(f["ll_p"] for f in lista)
        ws.append([dia, len(lista), n, ag / n, ap / n, llg / n, llp / n])
        r = ws.max_row
        ws.cell(r, 1).number_format = "dd/mm/yy"
        ws.cell(r, 4).number_format = ws.cell(r, 5).number_format = PCT
        ws.cell(r, 6).number_format = ws.cell(r, 7).number_format = DEC
    if ws.max_row >= 6:
        ch = LineChart()
        ch.title, ch.y_axis.title = "% de aciertos acumulado", "%"
        ch.y_axis.number_format = "0%"
        ch.add_data(Reference(ws, min_col=4, max_col=5, min_row=4, max_row=ws.max_row), titles_from_data=True)
        ch.set_categories(Reference(ws, min_col=1, min_row=5, max_row=ws.max_row))
        ch.height, ch.width = 8, 20
        ws.add_chart(ch, "I4")
    else:
        ws.cell(6, 1, "La gráfica aparece cuando haya al menos 2 días con partidos calificados.").font = Font(italic=True)


def hoja_proximos(wb, proximos):
    ws = wb.create_sheet("Próximos")
    titulo(ws, "Hoy y mañana: qué dice cada uno",
           "Amarillo = el Gurú difiere 4 puntos o más de Pinnacle (vale la pena revisarlo)")
    cab = ["Fecha", "Liga", "Modelo", "Local", "Visita", "Gurú L", "Gurú E", "Gurú V", "Pinn. L", "Pinn. E",
           "Pinn. V", "Mayor diferencia", "El Gurú ve más a…", "Detalle del modelo"]
    cabecera(ws, 4, cab, [15, 14, 14, 20, 20, 8, 8, 8, 8, 8, 8, 11, 20, 46])
    for f in sorted(proximos, key=lambda x: x["fecha"]):
        g, p = f["g"], f["p"] or {}
        mas = ""
        if f["p"]:
            k = max(g, key=lambda x: g[x] - p[x])
            if g[k] - p[k] >= 0.04:
                mas = {"L": f["local"], "V": f["visita"], "E": "Empate"}[k] + f" (+{(g[k] - p[k]) * 100:.1f} pts)"
        d = f.get("datos") or {}
        if f["modelo"] in ("Dixon-Coles", "xG"):
            detalle = (f"Goles esperados {d.get('xg_local', '—')}–{d.get('xg_visita', '—')} · "
                       f"más de 2.5: {float(d.get('over25') or 0):.0%} · ambos anotan: {float(d.get('btts') or 0):.0%} · "
                       f"marcador más probable {d.get('marcador', '—')}")
        else:
            detalle = f"Elo {d.get('elo_local', '—')} vs {d.get('elo_visita', '—')} · hándicap justo {d.get('spread', '—')}"
        ws.append([f["fecha"], f["liga"], f["modelo"], f["local"], f["visita"], g["L"],
                   g["E"] if f["deporte"] == "futbol" else None, g["V"], p.get("L"),
                   p.get("E") if p and f["deporte"] == "futbol" else None, p.get("V"), f["diff"], mas, detalle])
        r = ws.max_row
        ws.cell(r, 1).number_format = "dd/mm/yy hh:mm"
        for col in range(6, 13):
            ws.cell(r, col).number_format = PCT
        if mas:
            pinta(ws, r, AMBAR)
    if not proximos:
        ws.cell(5, 1, "No hay pronósticos para hoy y mañana.").font = Font(italic=True)
    ws.freeze_panes = "D5"
    ws.auto_filter.ref = f"A4:{get_column_letter(len(cab))}{max(ws.max_row, 5)}"


def hoja_como_leer(wb):
    ws = wb.create_sheet("Cómo leer")
    titulo(ws, "Cómo leer este reporte")
    textos = [
        ("Gurú", "Nuestros modelos: Dixon-Coles (goles de ~13 meses) y xG (peligro por tiros) para futbol; Elo para NFL, NBA y MLB."),
        ("Pinnacle", "La probabilidad del mercado: momios de Pinnacle sin su margen. Es la referencia más difícil de superar."),
        ("Acierto", "El favorito (el resultado con mayor %) fue el que pasó."),
        ("Más cerca", "Quién le dio MÁS probabilidad al resultado que sí pasó. Es más justo que contar aciertos."),
        ("Log-loss", "Castiga estar muy seguro y equivocarse. MÁS BAJO = MEJOR. Es la métrica principal del veredicto."),
        ("Brier", "Error cuadrático de las probabilidades (0 = perfecto). MÁS BAJO = MEJOR."),
        ("Veredicto", "Con menos de 30 partidos no se concluye nada. Después: si el log-loss del Gurú es 0.01 menor que el de Pinnacle, el Gurú va mejor."),
        ("Sin línea", "Partidos donde el bot no tenía momios de Pinnacle (para ahorrar créditos solo se escanean algunas ligas). Cuentan para los aciertos del Gurú pero no para el duelo."),
        ("Para apostar", "Si después de 200 partidos el Gurú no le gana a Pinnacle, úsalo solo como segunda opinión. "
                         "Si le gana, las diferencias grandes (hoja Próximos, en amarillo) son las más interesantes."),
    ]
    for i, (k, v) in enumerate(textos, 3):
        ws.cell(i, 1, k).font = Font(bold=True)
        ws.cell(i, 2, v).alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[i].height = 32
    ws.column_dimensions["A"].width = 14
    ws.column_dimensions["B"].width = 110


def construir(datos):
    for f in datos:
        analizar(f)
    ahora = dt.datetime.now(MX).replace(tzinfo=None)
    cal = [f for f in datos if f.get("res") in ("L", "E", "V")]
    cal_p = [f for f in cal if f["p"]]
    ayer = [f for f in cal if ahora - dt.timedelta(hours=30) <= f["fecha"] <= ahora]
    proximos = [f for f in datos if not f.get("res") and f["fecha"] <= ahora + dt.timedelta(hours=48)]
    wb = Workbook()
    hoja_resumen(wb, cal, cal_p, ayer, proximos)
    hoja_partidos(wb, "Ayer", sorted(ayer, key=lambda x: x["fecha"], reverse=True),
                  "Partidos calificados en las últimas 24 horas", "Negritas = probabilidad que cada uno le dio al resultado real")
    hoja_partidos(wb, "Historial", sorted(cal, key=lambda x: x["fecha"], reverse=True),
                  "Historial completo (90 días)", "Filtra por liga, modelo o resultado con las flechas de la fila de títulos")
    hoja_ligas(wb, cal)
    hoja_evolucion(wb, cal_p)
    hoja_proximos(wb, proximos)
    hoja_como_leer(wb)
    buf = io.BytesIO()
    wb.save(buf)
    s = resumen([f for f in cal_p][-200:])
    s_ayer = resumen([f for f in ayer if f["p"]])
    return buf.getvalue(), s, s_ayer, len(ayer), len(proximos)


def main():
    if not TOKEN and "--archivo" not in sys.argv:
        sys.exit("Falta TELEGRAM_TOKEN")
    datos, s, s_ayer, n_ayer, n_prox = construir(leer())
    nombre = f"guru-vs-pinnacle-{dt.datetime.now(MX):%Y-%m-%d}.xlsx"
    if PRUEBA:
        Path(nombre).write_bytes(datos)
        print("generado", nombre, "· ayer", n_ayer, "· próximos", n_prox, "·", s)
        return
    lineas = ["📊 *Gurú vs Pinnacle* · reporte diario"]
    if s_ayer:
        lineas.append(f"Ayer: Gurú {s_ayer['ag']}/{s_ayer['n']} · Pinnacle {s_ayer['ap']}/{s_ayer['n']} aciertos")
    else:
        lineas.append(f"Ayer: {n_ayer} partidos calificados (ninguno con línea de Pinnacle)")
    if s:
        lineas.append(f"Acumulado ({s['n']}): Gurú {s['pag']:.0%} vs Pinnacle {s['pap']:.0%} · {s['veredicto']}")
    lineas.append(f"Hoy y mañana: {n_prox} pronósticos (hoja Próximos)")
    r = requests.post(f"https://api.telegram.org/bot{TOKEN}/sendDocument",
                      data={"chat_id": DUENO, "caption": "\n".join(lineas), "parse_mode": "Markdown"},
                      files={"document": (nombre, datos)}, timeout=30)
    print("enviado" if r.ok else r.text[:300])


if __name__ == "__main__":
    main()
