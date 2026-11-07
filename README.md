# 🧮 Bitácora de apuestas — sin humo

**Una herramienta abierta y gratuita para apostar con matemáticas, no con corazonadas ni con tipsters.**

La mayoría de la gente que apuesta pierde, no por mala suerte, sino porque cada momio trae escondido el margen de la casa y porque nadie lleva la cuenta real. Los "gurús" venden picks "seguros" sin enseñar su historial. Este proyecto hace lo contrario:

- Te dice **cuánto vale de verdad** cada apuesta (probabilidad real de Pinnacle sin margen) y **a qué momio deja de convenir**.
- Lleva **tu cuenta real**: lo que ganas y también lo que pierdes.
- Te enseña la verdad de los **parlays**, el **"impuesto" de la casa**, si vas bien por **suerte o habilidad**, y tiene un **detector de humo** para tipsters.
- Sus modelos propios (el "Gurú") se comparan **en público** contra Pinnacle, con aciertos **y fallos**, y se recalibran solos.

No es una casa de apuestas, no mueve dinero y no vende nada. **Si te sirve, móntalo para ti y tus amigos y hazlo tuyo.**

> ⚠️ Solo mayores de 18. Las probabilidades salen de modelos y pueden fallar; nada aquí garantiza ganancias. Apuesta solo lo que puedas perder. Si sientes que el juego te está afectando: Línea de la Vida 800 911 2000 (México).

---

## Qué trae

| Parte | Qué hace |
|---|---|
| 🤖 **Escáner** (`bot_apuestas.py`) | 2 veces al día baja momios de Pinnacle (The Odds API), les quita el margen y calcula el **momio mínimo** que necesitas en tu casa (Caliente, Draftea…) para que haya valor. |
| 💬 **Bot de Telegram** (`telegram/api/telegram.js`) | Manda las señales, registra apuestas, revisa momios ("checa Ravens -250"), busca partidos pasados (`partidos chivas`), PDFs de ayuda. |
| 🌐 **Página / app** (`telegram/index.html`) | Bitácora, **🧮 La matemática** (cuenta real, impuesto, parlays, suerte, detector de humo, simulador, hábitos y límites), Gurú, líneas, marcadores en vivo, quiniela y retos entre amigos, minijuegos con mascota… Se instala en el celular como app. |
| 🔮 **Gurú** (`pronosticos.py`) | Modelos open source (Dixon-Coles, xG, Elo) que se miden contra Pinnacle. Guarda **todos los marcadores** para siempre y se **recalibra cada semana** al juntar 200 partidos. |
| ✅ **Resultados** (`resultados.py`) | Califica solas las apuestas cuando terminan los partidos (ESPN, gratis). |

**Cuesta $0**: GitHub (procesos automáticos), Vercel (página), Supabase (base de datos), Telegram, ESPN y el plan gratis de The Odds API (500 créditos/mes).

---

## Monta tu propia copia (≈ 1 hora, sin saber programar mucho)

### 0. Lo que necesitas (todo gratis)
- Cuenta de **GitHub**, **Vercel** (entra con GitHub) y **Supabase**.
- Una clave de **the-odds-api.com** (plan gratis).
- Un bot de **Telegram**: en Telegram busca **@BotFather** → `/newbot` → te da un **token**.
- Tu **chat id**: manda "hola" a tu bot y abre `https://api.telegram.org/botTU_TOKEN/getUpdates`; busca `"chat":{"id":123456789`.

### 1. Copia el proyecto
Botón **Fork** arriba a la derecha (o *Use this template*). Ahora tienes `tuusuario/bot-apuestas`.

### 2. Base de datos (Supabase)
1. Crea un proyecto nuevo.
2. Abre **SQL Editor**, pega TODO el archivo [`supabase/esquema.sql`](supabase/esquema.sql) y córrelo. Crea tablas, funciones y horarios.
3. Al final del archivo hay dos secretos que **debes cambiar** (corre esto con tus valores):
   ```sql
   update privado.secretos set valor = 'una-clave-larga-que-inventes' where nombre = 'bot';
   update privado.secretos set valor = 'tu-token-de-github' where nombre = 'github';
   ```
   El token de GitHub: *Settings → Developer settings → Fine-grained tokens*, solo tu repo, permiso **Actions: Read and write**.
4. Edita la función `privado.disparar` y cambia `Mcpadrino/bot-apuestas` por `tuusuario/bot-apuestas`.
5. En *Project Settings → API* copia la **URL** y la **publishable (anon) key**.

### 3. Página y bot (Vercel)
1. **Add New → Project** → importa tu repo. **Root Directory: `telegram`**. Framework: *Other*.
2. En *Environment Variables* pon:

   | Variable | Valor |
   |---|---|
   | `SUPABASE_URL` | la URL de tu proyecto |
   | `SUPABASE_KEY` | la publishable (anon) key |
   | `BOT_CLAVE` | la misma clave larga que pusiste en `privado.secretos` ('bot') |
   | `TELEGRAM_TOKEN` | el token de BotFather |
   | `TELEGRAM_CHAT_ID` | tu chat id (tú eres el dueño/administrador) |
   | `WEBHOOK_SECRET` | otra palabra secreta inventada |
   | `WEB_URL` | la dirección que te dé Vercel, ej. `https://mi-bitacora.vercel.app` |
3. Deploy. Luego abre una vez `https://TU-PAGINA.vercel.app/api/telegram?setup=TU_WEBHOOK_SECRET` para conectar el bot.

### 4. Procesos automáticos (GitHub)
En tu repo: *Settings → Secrets and variables → Actions*:
- **Secrets**: `ODDS_API_KEY`, `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`.
- **Variables**: `BOT_URL` = tu dirección de Vercel. (Opcional `BANCA`.)

Pruébalo en *Actions → Alertas de apuestas → Run workflow*. Los horarios los dispara Supabase solo (pg_cron), así que no tienes que dejar nada prendido.

### 5. Úsalo
Escríbele `/start` a tu bot. Para invitar a amigos sin Telegram: en la página, menú → 🛠️ Administrador → crear invitación.

---

## Personalízalo
- **Casas y mercados**: `bot_apuestas.py` (variables `LIBROS`, `EDGE_MIN`, `CUOTA_MIN/MAX`, calendario por liga).
- **Ligas del Gurú**: `pronosticos.py` (`GRUPOS_FUTBOL`, `NOMBRES`).
- **Monto mínimo de tu casa**: variable `APUESTA_MIN` (por defecto $5).
- **Textos, colores y secciones**: `telegram/index.html` (todo en un archivo).
- **PDFs de ayuda**: `telegram/docs/`.

## Reglas de oro
- **Nunca** escribas llaves, tokens ni contraseñas en el código: van en Vercel, GitHub Secrets o `privado.secretos`.
- No uses esto para vender picks ni para afiliarte con casas: rompe la idea del proyecto (y la licencia te obliga a compartir tus cambios).

## Licencia
[GNU AGPL v3](LICENSE): puedes usarlo, copiarlo, modificarlo y montarlo para quien quieras, **gratis**. Si publicas una versión modificada (aunque sea como página web), debes compartir tu código con la misma licencia y dar crédito. Así nadie puede tomarlo, cerrarlo y cobrarlo.

## Apoya el proyecto
Es y será gratis. Si te ayudó y quieres invitar un café, se agradece (ver botón **Sponsor** si está activo). Lo más valioso: **compártelo** y manda ideas o fallas en la sección 📝 Opiniones o en *Issues*.

---
Creado por **Luis y amigos**. Hecho con datos públicos de ESPN y The Odds API; no está afiliado a ninguna casa de apuestas.
