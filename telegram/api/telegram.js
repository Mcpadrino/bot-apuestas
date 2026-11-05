// Bot de Telegram para registrar apuestas al instante (webhook en Vercel + Supabase).
//
// Variables de entorno: TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, WEBHOOK_SECRET,
// SUPABASE_URL, SUPABASE_KEY (publishable/anon), BOT_CLAVE (clave de la función bot en la BD).

const env = (k) => (process.env[k] || "").replace(/\s/g, "");
const TG = () => `https://api.telegram.org/bot${env("TELEGRAM_TOKEN")}`;

async function tg(method, body) {
  const r = await fetch(`${TG()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function db(accion, datos = {}) {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/bot`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: env("SUPABASE_KEY"),
      authorization: `Bearer ${env("SUPABASE_KEY")}`,
    },
    body: JSON.stringify({ p_clave: env("BOT_CLAVE"), p_accion: accion, p_datos: datos }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || "error de base de datos");
  return j;
}

// ---------------------------------------------------------------- utilidades
const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(Number(n)).toFixed(2);
const signed = (n) => (n > 0 ? "+" : "") + money(n);
const amer = (d) => (d >= 2 ? "+" + Math.round((d - 1) * 100) : "-" + Math.round(100 / (d - 1)));
const CASAS = { caliente: "Caliente", draftea: "Draftea", codere: "Codere", bet365: "Bet365" };
const TECLADO = {
  keyboard: [[{ text: "💰 Saldo" }, { text: "📋 Pendientes" }], [{ text: "❓ Ayuda" }]],
  resize_keyboard: true,
  is_persistent: true,
};

function botones(id) {
  return {
    inline_keyboard: [[
      { text: "✅ Ganó", callback_data: `c:${id}:gana` },
      { text: "❌ Perdió", callback_data: `c:${id}:pierde` },
      { text: "➖ Nula", callback_data: `c:${id}:nula` },
    ], [{ text: "🗑 Borrar", callback_data: `b:${id}` }]],
  };
}

function aDecimal(t) {
  const n = parseFloat(t);
  if (!isFinite(n)) return null;
  if (/^[+-]\d{3,}$/.test(t)) return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
  if (/^\d+\.\d+$/.test(t) && n > 1) return n;
  return null;
}

// "Jaguars ganador -150 $5 62% caliente"  (el orden no importa)
// Reglas para no confundir la línea (39.5, 2.5) con la cuota o el monto:
// cuota = la primera americana (+150/-200); si no hay, el ÚLTIMO decimal.
// monto = el que lleva $; si no hay, el ÚLTIMO entero suelto.
function parsearApuesta(texto) {
  const toks = texto.trim().split(/\s+/);
  const low = toks.map((t) => t.toLowerCase().replace(/,/g, "."));
  const usado = new Set();
  let casa = "", prob = null, cuota = null, monto = null;
  const tomar = (i) => { usado.add(i); return low[i]; };
  low.forEach((t, i) => { if (CASAS[t]) { casa = CASAS[t]; usado.add(i); } });
  let i = low.findIndex((t, k) => !usado.has(k) && /^\d+(\.\d+)?%$/.test(t));
  if (i >= 0) prob = parseFloat(tomar(i)) / 100;
  i = low.findIndex((t, k) => !usado.has(k) && /^[+-]\d{3,}$/.test(t));
  if (i < 0) i = low.findLastIndex((t, k) => !usado.has(k) && /^\d+\.\d+$/.test(t) && parseFloat(t) > 1);
  if (i >= 0) cuota = aDecimal(tomar(i));
  i = low.findIndex((t, k) => !usado.has(k) && /^\$\d+(\.\d+)?$/.test(t));
  if (i >= 0) monto = parseFloat(tomar(i).slice(1));
  else {
    i = low.findLastIndex((t, k) => !usado.has(k) && /^\d+$/.test(t));
    if (i >= 0) monto = parseFloat(tomar(i));
  }
  const seleccion = toks.filter((_, k) => !usado.has(k)).join(" ");
  return { seleccion, cuota, monto, prob, casa };
}

const AYUDA = [
  "🧾 *Cómo registrar una apuesta*",
  "Escribe la selección, la cuota, el monto y (opcional) el % del bot y la casa:",
  "`Jaguars -150 $5 62% caliente`",
  "`Más de 39 +105 $2 51% draftea`",
  "",
  "La cuota puede ser americana (+150, -200) o decimal (2.50).",
  "",
  "Al terminar el partido toca ✅ Ganó / ❌ Perdió en el mensaje de la apuesta,",
  "o escribe `gano 3`, `perdio 3`, `nula 3`, `borrar 3`.",
  "",
  "💰 *Saldo* — tu banca, récord y ganancia",
  "📋 *Pendientes* — apuestas sin resultado",
  "`inicial 300` — cambia la banca inicial",
].join("\n");

async function resumen() {
  const r = await db("resumen");
  const actual = Number(r.banca_inicial) + Number(r.ganancia);
  const roi = r.apostado > 0 ? (r.ganancia / r.apostado * 100).toFixed(1) + "%" : "—";
  let nota;
  if (!r.cerradas) nota = "Aún no hay apuestas cerradas.";
  else if (r.cerradas < 200) nota = `${r.cerradas}/200 cerradas: todavía es pronto para juzgar el método.`;
  else if (r.ganancia >= r.esperada * 0.5) nota = "La ganancia real sigue a la esperada: el método funciona.";
  else nota = "La ganancia real va muy debajo de la esperada: revisa cuotas y límites de las casas.";
  return [
    "💰 *Tu banca*",
    `Actual: *${money(actual)}*  (inicial ${money(r.banca_inicial)})`,
    `En juego: ${money(r.en_juego)} en ${r.pendientes} apuesta(s)`,
    `Disponible: ${money(actual - r.en_juego)}`,
    "",
    `Récord: ${r.ganadas}–${r.perdidas}  ·  ROI ${roi}`,
    `Ganancia real: ${signed(r.ganancia)}`,
    `Ganancia esperada: ${signed(r.esperada)}`,
    "",
    `_${nota}_`,
  ].join("\n");
}

function lineaApuesta(a) {
  const c = Number(a.cuota), m = Number(a.monto);
  return `#${a.id} *${String(a.seleccion).replace(/[_*\x60[\]]/g, "")}* · ${amer(c)} (${c.toFixed(2)}) · ${money(m)}` +
    (a.casa ? ` · ${a.casa}` : "") + (a.prob ? ` · ${(a.prob * 100).toFixed(1)}%` : "");
}

const ETIQUETA = { gana: "✅ Ganó", pierde: "❌ Perdió", nula: "➖ Nula", pendiente: "⏳ Pendiente" };

async function cerrar(id, resultado) {
  const a = await db("cerrar", { id, resultado });
  if (!a || !a.id) return { texto: `No encontré la apuesta #${id}.` };
  const c = Number(a.cuota), m = Number(a.monto);
  const g = resultado === "gana" ? m * (c - 1) : resultado === "pierde" ? -m : 0;
  return { texto: `${lineaApuesta(a)}\n${ETIQUETA[resultado]} ${resultado === "pendiente" ? "" : signed(g)}`.trim(), a };
}

// ---------------------------------------------------------------- mensajes
async function atenderTexto(chat, texto) {
  const limpio = texto.trim().replace(/^\//, "").replace(/@\w+/, "");
  const [cmd0, ...args] = limpio.split(/\s+/);
  const cmd = (cmd0 || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const enviar = (t, extra = {}) => tg("sendMessage", { chat_id: chat, text: t, parse_mode: "Markdown", ...extra });

  if (["start", "ayuda", "help", "❓"].includes(cmd) || texto.includes("Ayuda"))
    return enviar(AYUDA, { reply_markup: TECLADO });

  if (["saldo", "banca", "balance", "resumen", "💰"].includes(cmd) || texto.includes("Saldo"))
    return enviar(await resumen(), { reply_markup: TECLADO });

  if (["pendientes", "abiertas", "📋"].includes(cmd) || texto.includes("Pendientes")) {
    const lista = await db("pendientes");
    if (!lista.length) return enviar("No tienes apuestas pendientes. 👌");
    await enviar(`📋 *${lista.length} pendiente(s)* — toca el resultado de cada una:`);
    for (const a of lista) await enviar(lineaApuesta(a), { reply_markup: botones(a.id) });
    return;
  }

  const RES = { gano: "gana", gana: "gana", g: "gana", perdio: "pierde", pierde: "pierde", p: "pierde",
                nula: "nula", n: "nula", reabrir: "pendiente" };
  if (RES[cmd] && /^\d+$/.test(args[0] || ""))
    return enviar((await cerrar(Number(args[0]), RES[cmd])).texto);

  if (cmd === "borrar" && /^\d+$/.test(args[0] || "")) {
    const a = await db("borrar", { id: Number(args[0]) });
    return enviar(a && a.id ? `🗑 Borré la apuesta #${a.id} (${a.seleccion}).` : `No encontré la apuesta #${args[0]}.`);
  }

  if (cmd === "inicial" && parseFloat(args[0]) > 0) {
    await db("banca", { valor: parseFloat(args[0]) });
    return enviar(`Banca inicial: ${money(parseFloat(args[0]))}\n\n` + await resumen());
  }

  // Cualquier otro texto: intentar registrarlo como apuesta
  const cuerpo = ["apuesta", "a", "registrar"].includes(cmd) ? args.join(" ") : limpio;
  const ap = parseearSeguro(cuerpo);
  if (!ap.cuota || !ap.monto || !ap.seleccion)
    return enviar("No entendí la apuesta. Ejemplo:\n`Jaguars -150 $5 62% caliente`\n\nEscribe *ayuda* para ver todo.");
  if (ap.prob !== null && !(ap.prob > 0 && ap.prob < 1))
    return enviar("El % debe estar entre 0 y 100.");

  const a = await db("registrar", ap);
  const gan = ap.monto * (ap.cuota - 1);
  let extra = `\nSi gana cobras ${money(ap.monto * ap.cuota)} (${signed(gan)})`;
  if (ap.prob) {
    const ev = ap.prob * ap.cuota - 1;
    extra += `\nValor: ${ev >= 0 ? "+" : ""}${(ev * 100).toFixed(1)}%` + (ev < 0.03 ? " ⚠️ por debajo del mínimo del bot" : " 👍");
  }
  return enviar(`✅ Guardada\n${lineaApuesta(a)}${extra}\n\nCuando termine, toca el resultado:`, { reply_markup: botones(a.id) });
}

function parseearSeguro(t) { try { return parsearApuesta(t); } catch { return {}; } }

async function atenderBoton(q) {
  const chat = q.message.chat.id, msgId = q.message.message_id;
  const [tipo, id, res] = q.data.split(":");
  if (tipo === "c") {
    const { texto } = await cerrar(Number(id), res);
    await tg("editMessageText", { chat_id: chat, message_id: msgId, text: texto, parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "↩️ Reabrir", callback_data: `c:${id}:pendiente` }]] } });
    if (res === "pendiente")
      await tg("editMessageReplyMarkup", { chat_id: chat, message_id: msgId, reply_markup: botones(id) });
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: ETIQUETA[res] });
  } else if (tipo === "b") {
    await tg("editMessageText", { chat_id: chat, message_id: msgId, text: `¿Borrar la apuesta #${id}?`,
      reply_markup: { inline_keyboard: [[
        { text: "Sí, borrar", callback_data: `x:${id}` }, { text: "Cancelar", callback_data: `k:${id}` }]] } });
    await tg("answerCallbackQuery", { callback_query_id: q.id });
  } else if (tipo === "x") {
    const a = await db("borrar", { id: Number(id) });
    await tg("editMessageText", { chat_id: chat, message_id: msgId,
      text: a && a.id ? `🗑 Apuesta #${id} borrada.` : `La apuesta #${id} ya no existe.` });
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Borrada" });
  } else if (tipo === "k") {
    const lista = await db("pendientes");
    const a = lista.find((x) => String(x.id) === id);
    await tg("editMessageText", { chat_id: chat, message_id: msgId, parse_mode: "Markdown",
      text: a ? lineaApuesta(a) : `Apuesta #${id}`, reply_markup: a ? botones(id) : undefined });
    await tg("answerCallbackQuery", { callback_query_id: q.id });
  }
}

// ---------------------------------------------------------------- entrada HTTP
export default async function handler(req, res) {
  // Registro del webhook (una sola vez): GET /api/telegram?setup=<WEBHOOK_SECRET>
  if (req.method === "GET") {
    if (req.query.setup && req.query.setup === env("WEBHOOK_SECRET")) {
      const url = `https://${req.headers.host}/api/telegram`;
      const r = await tg("setWebhook", { url, secret_token: env("WEBHOOK_SECRET"),
        allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
      await tg("setMyCommands", { commands: [
        { command: "saldo", description: "Banca, récord y ganancia" },
        { command: "pendientes", description: "Apuestas sin resultado" },
        { command: "ayuda", description: "Cómo registrar apuestas" },
      ] });
      return res.status(200).json({ ok: r.ok, url, description: r.description });
    }
    return res.status(200).send("ok");
  }

  if (req.headers["x-telegram-bot-api-secret-token"] !== env("WEBHOOK_SECRET"))
    return res.status(401).send("no");

  const u = req.body || {};
  const chatId = String(u.message?.chat?.id ?? u.callback_query?.message?.chat?.id ?? "");
  if (chatId !== env("TELEGRAM_CHAT_ID")) return res.status(200).send("ok"); // solo tú

  try {
    if (u.callback_query) await atenderBoton(u.callback_query);
    else if (u.message?.text) await atenderTexto(chatId, u.message.text);
  } catch (e) {
    console.error(e);
    await tg("sendMessage", { chat_id: chatId, text: `⚠️ No se pudo completar: ${e.message}` });
  }
  return res.status(200).send("ok");
}
