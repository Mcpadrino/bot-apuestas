"""
Respaldo mensual: le manda a cada usuario por Telegram un Excel con TODAS sus apuestas.
Corre el día 1 de cada mes (GitHub Actions). No gasta créditos de cuotas.

python respaldo.py           -> manda los respaldos
python respaldo.py --prueba  -> solo genera los archivos en la carpeta respaldos/
"""
import datetime as dt
import io
import os
import sys
from pathlib import Path

import requests
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

BOT_URL = os.getenv("BOT_URL", "https://bot-apuestas-telegram.vercel.app")
TOKEN = "".join(os.getenv("TELEGRAM_TOKEN", "").split())
PRUEBA = "--prueba" in sys.argv
MX = dt.timezone(dt.timedelta(hours=-6))
VERDE, ROJO, GRIS = "D7F5E6", "FBDADA", "EEEEEE"


def ganancia(a):
    m, c = float(a["monto"]), float(a["cuota"])
    return {"gana": m * (c - 1), "pierde": -m}.get(a["resultado"], 0.0)


def excel(nombre, apuestas):
    wb = Workbook()
    ws = wb.active
    ws.title = "Apuestas"
    cab = ["#", "Fecha", "Cartera", "Partido", "Selección", "Casa", "Momio", "Prob. bot", "Monto", "Resultado",
           "Ganancia", "Marcador", "Liga"]
    ws.append(cab)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="0F5132")
        c.alignment = Alignment(horizontal="center")
    for a in apuestas:
        fecha = dt.datetime.fromisoformat(a["creada"].replace("Z", "+00:00")).astimezone(MX).replace(tzinfo=None)
        ws.append([a["id"], fecha, "Bot" if a.get("cartera") != "libre" else "Normal", a.get("partido") or "",
                   a.get("seleccion") or "", a.get("casa") or "", float(a["cuota"]),
                   float(a["prob"]) if a.get("prob") is not None else None, float(a["monto"]),
                   {"gana": "Ganó", "pierde": "Perdió", "nula": "Nula"}.get(a["resultado"], "Pendiente"),
                   round(ganancia(a), 2), a.get("marcador") or "", a.get("liga") or ""])
        fila = ws.max_row
        color = {"gana": VERDE, "pierde": ROJO}.get(a["resultado"], GRIS)
        for c in ws[fila]:
            c.fill = PatternFill("solid", fgColor=color)
        ws.cell(fila, 2).number_format = "dd/mm/yyyy hh:mm"
        ws.cell(fila, 7).number_format = "0.00"
        ws.cell(fila, 8).number_format = "0.0%"
        ws.cell(fila, 9).number_format = '"$"#,##0.00'
        ws.cell(fila, 11).number_format = '"$"#,##0.00;[Red]-"$"#,##0.00'
    anchos = [6, 16, 9, 30, 26, 11, 8, 10, 10, 11, 11, 26, 14]
    for i, w in enumerate(anchos, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(cab))}{max(ws.max_row, 1)}"

    # Hoja de resumen con fórmulas (se recalculan si editas la hoja de apuestas)
    r = wb.create_sheet("Resumen")
    n = max(ws.max_row, 2)
    filas = [
        ("Respaldo de", nombre),
        ("Generado", dt.datetime.now(MX).strftime("%d/%m/%Y %H:%M")),
        ("Apuestas", f"=COUNTA(Apuestas!A2:A{n})"),
        ("Ganadas", f'=COUNTIF(Apuestas!J2:J{n},"Ganó")'),
        ("Perdidas", f'=COUNTIF(Apuestas!J2:J{n},"Perdió")'),
        ("Pendientes", f'=COUNTIF(Apuestas!J2:J{n},"Pendiente")'),
        ("Total apostado (cerradas)", f'=SUMIFS(Apuestas!I2:I{n},Apuestas!J2:J{n},"<>Pendiente")'),
        ("Ganancia neta", f"=SUM(Apuestas!K2:K{n})"),
        ("Neto bot", f'=SUMIF(Apuestas!C2:C{n},"Bot",Apuestas!K2:K{n})'),
        ("Neto normal", f'=SUMIF(Apuestas!C2:C{n},"Normal",Apuestas!K2:K{n})'),
        ("Rendimiento", "=IFERROR(B8/B7,0)"),
    ]
    for f in filas:
        r.append(f)
    for i in range(1, len(filas) + 1):
        r.cell(i, 1).font = Font(bold=True)
    for i in (7, 8, 9, 10):
        r.cell(i, 2).number_format = '"$"#,##0.00;[Red]-"$"#,##0.00'
    r.cell(11, 2).number_format = "0.0%"
    r.column_dimensions["A"].width = 26
    r.column_dimensions["B"].width = 22
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def main():
    if not TOKEN:
        sys.exit("Falta TELEGRAM_TOKEN")
    r = requests.post(f"{BOT_URL}/api/telegram", params={"mas": "1"}, headers={"x-bot-token": TOKEN},
                      json={"accion": "respaldo", "datos": {}}, timeout=30)
    r.raise_for_status()
    mes = (dt.datetime.now(MX).replace(day=1) - dt.timedelta(days=1)).strftime("%Y-%m")
    for u in r.json():
        if not u["apuestas"]:
            continue
        datos = excel(u["nombre"], u["apuestas"])
        archivo = f"apuestas-{mes}.xlsx"
        if PRUEBA:
            Path("respaldos").mkdir(exist_ok=True)
            Path("respaldos", f"{u['nombre']}-{archivo}").write_bytes(datos)
            print("generado", u["nombre"], len(u["apuestas"]), "apuestas")
            continue
        res = requests.post(f"https://api.telegram.org/bot{TOKEN}/sendDocument",
                            data={"chat_id": u["chat_id"], "caption": f"🗂 Respaldo de tus apuestas (hasta {mes}). "
                                                                       "Guárdalo por si acaso."},
                            files={"document": (archivo, datos)}, timeout=30)
        print(u["nombre"], "ok" if res.ok else res.text[:200])


if __name__ == "__main__":
    main()
