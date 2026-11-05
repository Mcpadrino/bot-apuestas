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
const LIBRE = new Set(["libre", "aparte", "personal", "fuera"]);
const CASAS = { caliente: "Caliente", draftea: "Draftea", codere: "Codere", bet365: "Bet365" };
const WEB_URL = env("WEB_URL") || "https://bot-apuestas-telegram.vercel.app";
const TECLADO = {
  keyboard: [[{ text: "💰 Saldo" }, { text: "📋 Pendientes" }], [{ text: "🌐 Mi página" }, { text: "❓ Ayuda" }]],
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
  let cartera = "bot";
  low.forEach((t, i) => {
    if (CASAS[t]) { casa = CASAS[t]; usado.add(i); }
    else if (LIBRE.has(t)) { cartera = "libre"; usado.add(i); }
    else if (t === "parlay" || t === "parley" || t === "combinada") cartera = "libre";   // se queda en el texto
  });
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
  return { seleccion, cuota, monto, prob, casa, cartera };
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
  "🌐 *Mi página* — la dirección de tu bitácora web",
  "`cuenta usuario contraseña` — crea o cambia tu acceso a la página",
  "",
  "🎲 *Apuestas fuera de la banca* (parlays, corazonadas):",
  "agrega la palabra *libre* o *parlay* y van a una cuenta aparte que no toca la banca del bot:",
  "`libre Chivas gana +200 $50`",
  "`parlay América+Jaguars +450 $20 caliente`",
].join("\n");

const AYUDA_ADMIN = [
  "",
  "👥 *Amigos* (solo tú puedes):",
  "`agregar 123456789 Pepe` — da acceso (el número te lo manda tu amigo)",
  "`quitar 123456789` — quita el acceso",
  "`usuarios` — lista quién tiene acceso",
].join("\n");

async function resumen(dbu) {
  const r = await dbu("resumen");
  const b = r.bot, l = r.libre;
  const actual = Number(r.banca_inicial) + Number(b.ganancia);
  const roi = b.apostado > 0 ? (b.ganancia / b.apostado * 100).toFixed(1) + "%" : "—";
  let nota;
  if (!b.cerradas) nota = "Aún no hay apuestas del bot cerradas.";
  else if (b.cerradas < 200) nota = `${b.cerradas}/200 cerradas: todavía es pronto para juzgar el método.`;
  else if (b.ganancia >= b.esperada * 0.5) nota = "La ganancia real sigue a la esperada: el método funciona.";
  else nota = "La ganancia real va muy debajo de la esperada: revisa cuotas y límites de las casas.";
  const lineas = [
    "🤖 *Banca del bot*",
    `Actual: *${money(actual)}*  (inicial ${money(r.banca_inicial)})`,
    `En juego: ${money(b.en_juego)} en ${b.pendientes} apuesta(s)`,
    `Disponible: ${money(actual - b.en_juego)}`,
    `Récord: ${b.ganadas}–${b.perdidas}  ·  ROI ${roi}`,
    `Ganancia real: ${signed(b.ganancia)}  ·  esperada: ${signed(b.esperada)}`,
    `_${nota}_`,
  ];
  if (l.cerradas || l.pendientes) {
    const roiL = l.apostado > 0 ? (l.ganancia / l.apostado * 100).toFixed(1) + "%" : "—";
    lineas.push("", "🎲 *Apuestas libres* (fuera de la banca)",
      `Apostado: ${money(l.apostado)}  ·  resultado: *${signed(l.ganancia)}*`,
      `Récord: ${l.ganadas}–${l.perdidas}  ·  ROI ${roiL}`,
      `En juego: ${money(l.en_juego)} en ${l.pendientes} apuesta(s)`);
  }
  const total = Number(b.ganancia) + Number(l.ganancia);
  lineas.push("", `📊 *Total ganado/perdido:* ${signed(total)}`,
    `Dinero en juego ahora: ${money(Number(b.en_juego) + Number(l.en_juego))}`);
  return lineas.join("\n");
}

function lineaApuesta(a) {
  const c = Number(a.cuota), m = Number(a.monto);
  return `${a.cartera === "libre" ? "🎲 " : ""}#${a.id} *${String(a.seleccion).replace(/[_*\x60[\]]/g, "")}* · ${amer(c)} (${c.toFixed(2)}) · ${money(m)}` +
    (a.casa ? ` · ${a.casa}` : "") + (a.prob ? ` · ${(a.prob * 100).toFixed(1)}%` : "");
}

const ETIQUETA = { gana: "✅ Ganó", pierde: "❌ Perdió", nula: "➖ Nula", pendiente: "⏳ Pendiente" };

async function cerrar(dbu, id, resultado) {
  const a = await dbu("cerrar", { id, resultado });
  if (!a || !a.id) return { texto: `No encontré la apuesta #${id}.` };
  const c = Number(a.cuota), m = Number(a.monto);
  const g = resultado === "gana" ? m * (c - 1) : resultado === "pierde" ? -m : 0;
  return { texto: `${lineaApuesta(a)}\n${ETIQUETA[resultado]} ${resultado === "pendiente" ? "" : signed(g)}`.trim(), a };
}

// ---------------------------------------------------------------- mensajes
async function rpcWeb(accion, datos) {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/web`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: env("SUPABASE_KEY"), authorization: `Bearer ${env("SUPABASE_KEY")}` },
    body: JSON.stringify({ p_clave: env("BOT_CLAVE"), p_accion: accion, p_datos: datos }),
  });
  return r.json();
}

async function atenderTexto(chat, texto, esDueno, msgId) {
  const dbu = (accion, datos = {}) => db(accion, { ...datos, usuario: chat });
  const limpio = texto.trim().replace(/^\//, "").replace(/@\w+/, "");
  const [cmd0, ...args] = limpio.split(/\s+/);
  const cmd = (cmd0 || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const enviar = (t, extra = {}) => tg("sendMessage", { chat_id: chat, text: t, parse_mode: "Markdown", ...extra });

  if (["start", "ayuda", "help", "❓"].includes(cmd) || texto.includes("Ayuda"))
    return enviar(AYUDA + (esDueno ? AYUDA_ADMIN : ""), { reply_markup: TECLADO });

  if (esDueno && cmd === "agregar" && /^-?\d+$/.test(args[0] || "")) {
    const nombre = args.slice(1).join(" ") || "Amigo";
    await db("agregar", { usuario: args[0], nombre });
    const r = await tg("sendMessage", { chat_id: args[0], parse_mode: "Markdown", reply_markup: TECLADO,
      text: `👋 Hola ${nombre}, ya tienes acceso.\nTu banca inicial es $200 (cámbiala con \`inicial 500\`).\nPara ver tu bitácora en el navegador crea tu acceso con \`cuenta tuusuario tucontraseña\`.\n\n` + AYUDA });
    return enviar(r.ok ? `✅ ${nombre} (${args[0]}) ya tiene acceso. Le mandé las instrucciones.`
                       : `✅ ${nombre} tiene acceso, pero no pude escribirle: que le dé *Iniciar* al bot primero.`);
  }
  if (esDueno && cmd === "quitar" && /^-?\d+$/.test(args[0] || "")) {
    if (args[0] === env("TELEGRAM_CHAT_ID")) return enviar("No puedes quitarte a ti mismo.");
    const u = await db("quitar", { usuario: args[0] });
    return enviar(u ? `🚫 ${u.nombre || args[0]} ya no tiene acceso. Sus apuestas siguen guardadas.` : "Ese usuario no existe.");
  }
  if (esDueno && cmd === "usuarios") {
    const us = await db("usuarios");
    return enviar("👥 *Con acceso*\n" + us.map((u) => `• ${u.nombre || "—"} (${u.chat_id}) · banca ${money(u.banca_actual)}`).join("\n"));
  }

  if (cmd === "cuenta") {
    if (msgId) await tg("deleteMessage", { chat_id: chat, message_id: msgId });   // no dejar la contraseña en el chat
    if (args.length < 2)
      return enviar("Escribe: `cuenta tuusuario tucontraseña`\n(usuario de 3 a 20 letras o números; contraseña de 6 o más)");
    const r = await rpcWeb("cuenta", { usuario: chat, nombre_web: args[0], pass: args.slice(1).join(" ") });
    if (!r || r.error) return enviar("⚠️ " + ((r && r.error) || "No se pudo guardar."));
    return enviar(`✅ Listo. Entra a ${WEB_URL} con:\nUsuario: *${r.usuario_web}*\nContraseña: la que escribiste.\n\n🔒 Borré tu mensaje para que la contraseña no quede en el chat. Si la olvidas, vuelve a escribir \`cuenta\` con una nueva.`,
      { disable_web_page_preview: true });
  }

  if (["web", "pagina", "🌐"].includes(cmd) || texto.includes("Mi página"))
    return enviar(`🌐 Tu bitácora: ${WEB_URL}\n\nEntra con tu usuario y contraseña. Si aún no tienes, créalos aquí escribiendo:\n\`cuenta tuusuario tucontraseña\``,
      { disable_web_page_preview: true });

  if (["saldo", "banca", "balance", "resumen", "💰"].includes(cmd) || texto.includes("Saldo"))
    return enviar(await resumen(dbu), { reply_markup: TECLADO });

  if (["pendientes", "abiertas", "📋"].includes(cmd) || texto.includes("Pendientes")) {
    const lista = await dbu("pendientes");
    if (!lista.length) return enviar("No tienes apuestas pendientes. 👌");
    await enviar(`📋 *${lista.length} pendiente(s)* — toca el resultado de cada una:`);
    for (const a of lista) await enviar(lineaApuesta(a), { reply_markup: botones(a.id) });
    return;
  }

  const RES = { gano: "gana", gana: "gana", g: "gana", perdio: "pierde", pierde: "pierde", p: "pierde",
                nula: "nula", n: "nula", reabrir: "pendiente" };
  if (RES[cmd] && /^\d+$/.test(args[0] || ""))
    return enviar((await cerrar(dbu, Number(args[0]), RES[cmd])).texto);

  if (cmd === "borrar" && /^\d+$/.test(args[0] || "")) {
    const a = await dbu("borrar", { id: Number(args[0]) });
    return enviar(a && a.id ? `🗑 Borré la apuesta #${a.id} (${a.seleccion}).` : `No encontré la apuesta #${args[0]}.`);
  }

  if (cmd === "inicial" && parseFloat(args[0]) > 0) {
    await dbu("banca", { valor: parseFloat(args[0]) });
    return enviar(`Banca inicial: ${money(parseFloat(args[0]))}\n\n` + await resumen(dbu));
  }

  // Cualquier otro texto: intentar registrarlo como apuesta
  const cuerpo = ["apuesta", "a", "registrar"].includes(cmd) ? args.join(" ") : limpio;
  const ap = parseearSeguro(cuerpo);
  if (!ap.cuota || !ap.monto || !ap.seleccion)
    return enviar("No entendí la apuesta. Ejemplo:\n`Jaguars -150 $5 62% caliente`\n\nEscribe *ayuda* para ver todo.");
  if (ap.prob !== null && !(ap.prob > 0 && ap.prob < 1))
    return enviar("El % debe estar entre 0 y 100.");

  const a = await dbu("registrar", ap);
  const gan = ap.monto * (ap.cuota - 1);
  let extra = `\nSi gana cobras ${money(ap.monto * ap.cuota)} (${signed(gan)})`;
  if (ap.cartera === "libre") extra += "\n🎲 Va a tus apuestas libres: no toca la banca del bot.";
  else if (ap.prob) {
    const ev = ap.prob * ap.cuota - 1;
    extra += `\nValor: ${ev >= 0 ? "+" : ""}${(ev * 100).toFixed(1)}%` + (ev < 0.03 ? " ⚠️ por debajo del mínimo del bot" : " 👍");
  }
  return enviar(`✅ Guardada\n${lineaApuesta(a)}${extra}\n\nCuando termine, toca el resultado:`, { reply_markup: botones(a.id) });
}

function parseearSeguro(t) { try { return parsearApuesta(t); } catch { return {}; } }

async function atenderBoton(q) {
  const chat = q.message.chat.id, msgId = q.message.message_id;
  const dbu = (accion, datos = {}) => db(accion, { ...datos, usuario: String(chat) });
  const [tipo, id, res] = q.data.split(":");
  if (tipo === "c") {
    const { texto } = await cerrar(dbu, Number(id), res);
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
    const a = await dbu("borrar", { id: Number(id) });
    await tg("editMessageText", { chat_id: chat, message_id: msgId,
      text: a && a.id ? `🗑 Apuesta #${id} borrada.` : `La apuesta #${id} ya no existe.` });
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Borrada" });
  } else if (tipo === "k") {
    const lista = await dbu("pendientes");
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
    // Para las alertas de GitHub: lista de usuarios con su banca (requiere el token del bot)
    if (req.query.usuarios !== undefined) {
      if ((req.headers["x-bot-token"] || "").replace(/\s/g, "") !== env("TELEGRAM_TOKEN"))
        return res.status(401).json({ error: "no" });
      return res.status(200).json(await db("usuarios"));
    }
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
  if (!chatId) return res.status(200).send("ok");
  const esDueno = chatId === env("TELEGRAM_CHAT_ID");

  try {
    if (!esDueno && !(await db("usuario", { usuario: chatId }))) {
      if (u.message?.text)
        await tg("sendMessage", { chat_id: chatId, parse_mode: "Markdown",
          text: `Este bot es privado. Pásale este número a quien te invitó para que te dé acceso:\n\n\`${chatId}\`` });
      return res.status(200).send("ok");
    }
    if (u.callback_query) await atenderBoton(u.callback_query);
    else if (u.message?.text) await atenderTexto(chatId, u.message.text, esDueno, u.message.message_id);
  } catch (e) {
    console.error(e);
    await tg("sendMessage", { chat_id: chatId, text: `⚠️ No se pudo completar: ${e.message}` });
  }
  return res.status(200).send("ok");
}
