#!/usr/bin/env python3
"""
Resumen semanal por Telegram para cada usuario: ganancia, récord, mejor y peor apuesta,
y comparación con la semana anterior. Lo corre GitHub Actions cada domingo a las 21:00 (CDMX).

python resumen_semanal.py           -> envía
python resumen_semanal.py --prueba  -> solo imprime
"""
import os
import sys

import requests

BOT_URL = os.getenv("BOT_URL", "https://bot-apuestas-telegram.vercel.app")
TOKEN = "".join(os.getenv("TELEGRAM_TOKEN", "").split())


def dinero(n):
    n = float(n)
    return ("-$" if n < 0 else "$") + f"{abs(n):,.2f}"


def signo(n):
    return ("+" if float(n) > 0 else "") + dinero(n)


def limpio(t):
    return "".join(c for c in str(t) if c not in "_*`[]")


def mensaje(u):
    s = u["semana"] or {}
    neto = float(s.get("neto_bot", 0)) + float(s.get("neto_libre", 0))
    nombre = limpio((u.get("nombre") or "").strip())
    lineas = [f"📅 *Tu semana{', ' + nombre if nombre else ''}*", ""]
    if not s.get("cerradas"):
        lineas.append("Esta semana no cerraste apuestas.")
        if int(u.get("pendientes") or 0):
            lineas.append(f"Tienes {u['pendientes']} pendiente(s): márcalas en 📋 Pendientes.")
        return "\n".join(lineas)
    emoji = "🟢" if neto > 0 else "🔴" if neto < 0 else "⚪"
    lineas += [
        f"{emoji} Resultado: *{signo(neto)}*",
        f"🤖 Bot: {signo(s['neto_bot'])}  ·  🎲 Normales: {signo(s['neto_libre'])}",
        f"Récord: {s['ganadas']}–{s['perdidas']}  ·  apostado {dinero(s['apostado'])}",
    ]
    if s.get("mejor"):
        lineas.append(f"🏆 Mejor: {limpio(s['mejor']['seleccion'])} ({signo(s['mejor']['ganancia'])})")
    if s.get("peor"):
        lineas.append(f"💀 Peor: {limpio(s['peor']['seleccion'])} ({signo(s['peor']['ganancia'])})")
    ant = float(u.get("neto_anterior") or 0)
    dif = neto - ant
    if ant or dif:
        lineas.append(f"{'📈' if dif >= 0 else '📉'} Vs. semana pasada ({signo(ant)}): {signo(dif)}")
    banca = float(u.get("banca_inicial") or 0) + float(u.get("ganancia_bot_total") or 0)
    lineas += ["", f"Banca del bot: *{dinero(banca)}*"]
    if int(u.get("pendientes") or 0):
        lineas.append(f"⏳ {u['pendientes']} apuesta(s) pendiente(s).")
    return "\n".join(lineas)


def main():
    prueba = "--prueba" in sys.argv
    r = requests.get(f"{BOT_URL}/api/telegram", params={"semana": "1"}, headers={"x-bot-token": TOKEN}, timeout=20)
    r.raise_for_status()
    for u in r.json():
        texto = mensaje(u)
        print(f"--- {u.get('nombre')} ---\n{texto}\n")
        if not prueba:
            requests.post(f"https://api.telegram.org/bot{TOKEN}/sendMessage",
                          json={"chat_id": u["chat_id"], "text": texto, "parse_mode": "Markdown",
                                "disable_web_page_preview": True}, timeout=20)


if __name__ == "__main__":
    main()
