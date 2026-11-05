# Bot de señales de apuestas — guía

## Qué hace
1. Descarga las cuotas de Pinnacle (la casa más precisa del mercado) para
   Liga MX, Premier, LaLiga, Champions, NFL, NBA y MLB.
2. Les quita el margen con el **método power**, que corrige el sesgo de las
   cuotas altas, y obtiene la probabilidad real de cada resultado.
3. Te manda a **Telegram**, 3 veces al día (7:00, 12:00 y 18:00), la **cuota mínima** que debes
   encontrar en Caliente o Draftea y **cuánto apostar** (Kelly fraccional).
4. Marca con ⚡ las líneas que se movieron desde el escaneo anterior: ahí es
   más probable que Caliente se haya quedado atrás.

No apuesta solo: tú comparas y apuestas a mano.

---

## Instalación en GitHub + Telegram (gratis, sin computadora prendida)

### 1. Clave de cuotas
Crea cuenta en **the-odds-api.com** (plan gratis: 500 créditos/mes, sin tarjeta).
Copia tu clave.

### 2. Bot de Telegram
1. En Telegram busca **@BotFather** → `/newbot` → ponle nombre.
   Te da un **token** (algo como `123456:ABC-xyz`).
2. Abre tu bot nuevo y mándale cualquier mensaje ("hola").
3. En el navegador abre
   `https://api.telegram.org/botTU_TOKEN/getUpdates`
   y busca `"chat":{"id":123456789` → ese número es tu **chat id**.

### 3. GitHub
1. Crea cuenta en **github.com** y un repositorio nuevo **privado**
   (por ejemplo `bot-apuestas`).
2. Sube estos archivos: `bot_apuestas.py`, `requirements.txt`,
   `demo_momios.json`.
3. Crea el archivo `.github/workflows/alertas.yml` (botón *Add file → Create
   new file*, escribe esa ruta tal cual) y pega el contenido de `alertas.yml`.
4. Ve a *Settings → Secrets and variables → Actions → New repository secret*
   y crea tres:
   - `ODDS_API_KEY` → tu clave de the-odds-api
   - `TELEGRAM_TOKEN` → el token de BotFather
   - `TELEGRAM_CHAT_ID` → tu chat id
5. Pruébalo: pestaña *Actions → Alertas de apuestas → Run workflow*.
   En un minuto te llega el mensaje a Telegram.

Desde ahí corre solo a las **7:00, 12:00 y 18:00** (hora CDMX), según el calendario: NFL lun/jue/dom, Champions mar/mié, Liga MX + 5 grandes ligas vie/sáb/dom. También puedes
correrlo cuando quieras desde la app de GitHub en el celular.

> Nunca pegues tus claves dentro del código si el repositorio es público.
> Los *secrets* las mantienen ocultas.

---

## Cómo leer el mensaje
```
🕐 Jue 05 20:00  Los Angeles Lakers @ Boston Celtics
Boston Celtics (Ganador): mín -150 / 1.67 → $2
⚡Los Angeles Lakers (Ganador): mín +170 / 2.70 → $2
```
- Abre Caliente. Si Lakers paga **+170 o más**, apuesta **$2**.
- Si paga menos, no apuestas. La mayoría de los días casi nada califica: eso es normal.
- Revisa primero las ⚡.

## Registro (en tu computadora)
```
python bot_apuestas.py revisar --cuota +175 --justa 2.62
python bot_apuestas.py registrar --partido "Lakers @ Celtics" --seleccion Lakers --casa Caliente --cuota +175 --justa 2.62 --monto 2
python bot_apuestas.py liquidar --id 1 --resultado gana      (o pierde / nula)
python bot_apuestas.py resumen
```
Si prefieres, lleva el registro en una hoja de cálculo con las mismas columnas.

---

## Ajustes
Se cambian al inicio de `bot_apuestas.py`, o como *variables* en GitHub
(*Settings → Secrets and variables → Actions → Variables*).

| Variable | Valor | Qué hace |
|---|---|---|
| `BANCA` | 200 | tu banca en MXN; actualízala cada semana |
| `EDGE_MIN` | 0.03 | ventaja mínima para apostar (3 %) |
| `CUOTA_MIN` / `CUOTA_MAX` | 1.25 / 4.0 | descarta favoritos extremos y no favoritos |
| `KELLY_FRAC` | 0.25 | fracción de Kelly |
| `TOPE_APUESTA` | 0.025 | máximo por apuesta (2.5 % de la banca) |
| `APUESTA_MIN` | 2 | mínimo que acepta tu casa |
| `METODO_DEVIG` | power | o `multiplicativo` |
| `MOVIMIENTO` | 0.02 | cuánto debe moverse la prob. para marcar ⚡ |

## Créditos de la API
El bot reparte solo los 500 créditos del mes: cada corrida revisa cuántos
quedan y cuántos días faltan. Siempre busca el ganador (h2h); si sobra
presupuesto agrega hándicap y totales en este orden: NFL, Liga MX, Champions,
Premier, LaLiga, Serie A, Bundesliga, Ligue 1. Las ligas fuera de temporada no
gastan. Guarda 15 créditos de reserva y te avisa por Telegram si se acaban.

## Que no se apague
- Si una corrida falla, te llega un ⚠️ a Telegram con el enlace al error.
- GitHub apaga los workflows de repos públicos tras 60 días sin actividad;
  el bot hace un commit vacío cada 20 días para evitarlo.
- GitHub puede retrasar las corridas programadas unos minutos en horas pico.

## Reglas del experimento
- Banca $200, sin recargas a mitad del experimento.
- Evalúa después de unas 200 apuestas. 25 apuestas no dicen nada:
  una racha de -5 unidades es normal aun con un método ganador.
- Lo que importa en `resumen` es si tu ganancia real sigue a la esperada.
