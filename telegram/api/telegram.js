// Bot de Telegram para registrar apuestas al instante (webhook en Vercel + Supabase).
//
// Variables de entorno: TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, WEBHOOK_SECRET,
// SUPABASE_URL, SUPABASE_KEY (publishable/anon), BOT_CLAVE (clave de la función bot en la BD).

import { buscarLogo, sugerencias, equipoPorClave } from "../lib/espn.js";
import { torneo, amer, momioDoble, setFormato, jugar, admin, opinion, avisarOpinion, avisarAutor, botonesOpinion, ESTADO_OP, TIPO_OP } from "../lib/mas.js";
import { mas, avisarRespuesta, textoSenales, botonesSenales, sacarMomio, casaDe, buscarSenal, veredicto, conv, guru } from "../lib/mas.js";
import { notificar, cuerpoSenales, mandarResumenes } from "../lib/push.js";

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
const LIBRE = new Set(["libre", "aparte", "personal", "fuera"]);
const CASAS = { caliente: "Caliente", draftea: "Draftea", codere: "Codere", bet365: "Bet365" };
const WEB_URL = env("WEB_URL") || "https://bot-apuestas-telegram.vercel.app";
const TECLADO = {
  keyboard: [[{ text: "🎯 Señales" }, { text: "💰 Saldo" }, { text: "📋 Pendientes" }], [{ text: "🌐 Mi página" }, { text: "📘 Guía" }, { text: "📝 Opinar" }, { text: "❓ Ayuda" }]],
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

const TERMINOS_URL = WEB_URL + "/terminos.html";
const TERMINOS_CORTO = "⚖️ *Importante:* los porcentajes son de modelos predictivos y pueden fallar; no hay ganancias garantizadas. " +
  "Cada quien decide y es responsable de lo que apuesta. Solo mayores de 18. Términos completos: " + TERMINOS_URL;

const AYUDA = [
  "🧾 *Cómo registrar una apuesta*",
  "Escribe la selección, la cuota, el monto y (opcional) el % del bot y la casa:",
  "`Jaguars -150 $5 62% caliente`",
  "`Más de 39 +105 $5 51% draftea`",
  "",
  "La cuota puede ser americana (+150, -200) o decimal (2.50).",
  "",
  "Al terminar el partido toca ✅ Ganó / ❌ Perdió en el mensaje de la apuesta,",
  "o escribe `gano 3`, `perdio 3`, `nula 3`, `borrar 3`.",
  "",
  "🔎 *¿Conviene?* Escribe lo que te ofrece el casino con un signo de interrogación:",
  "`Ravens -250?` o `checa más 2.5 1.90 draftea` → te digo si está barata, justa o cara.",
  "",
  "💸 `retiro 50` — sacaste $50 a tu tarjeta (baja la banca del bot)",
  "➕ `deposito 50` — metiste $50 más (sube la banca del bot)",
  "🎲 `retiro normal 50` / `deposito normal 50` — lo mismo para tus apuestas normales",
  "",
  "💰 *Saldo* — tu banca, récord y ganancia",
  "📋 *Pendientes* — apuestas sin resultado",
  "`inicial 300` — cambia la banca inicial",
  "`limite 300` — tope semanal para apuestas normales (opcional; `limite off` lo quita)",
  "🌐 *Mi página* — la dirección de tu bitácora web",
  "📘 *Guía* — te mando el folleto y la guía en PDF",
  "📚 `partidos chivas` — marcadores pasados de un equipo y si acertaron el Gurú y Pinnacle",
  "⚖️ `terminos` — términos, responsabilidad y privacidad",
  "🔢 `momio decimal` / `momio americano` — cómo quieres ver los momios",
  "📝 `idea ...` · `error ...` · `opinion ... 5` — mándame ideas, fallas o tu calificación",
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
  "`opiniones` — ideas y fallas pendientes · `responder 12 texto` — contestarle a alguien",
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
  return `${a.cartera === "libre" ? "🎲 " : ""}#${a.id} *${String(a.seleccion).replace(/[_*\x60[\]]/g, "")}* · ${momioDoble(c)} · ${money(m)}` +
    (a.casa ? ` · ${a.casa}` : "") + (a.prob ? ` · ${(a.prob * 100).toFixed(1)}%` : "");
}

const ETIQUETA = { gana: "✅ Ganó", pierde: "❌ Perdió", nula: "➖ Nula", pendiente: "⏳ Pendiente" };

async function cerrar(dbu, id, resultado) {
  const a = await dbu("cerrar", { id, resultado });
  if (!a || !a.id) return { texto: `No encontré la apuesta #${id}.` };
  const c = Number(a.cuota), m = Number(a.monto);
  const g = resultado === "gana" ? m * (c - 1) : resultado === "pierde" ? -m : 0;
  // tu mascota reacciona: festeja si ganaste (y se lleva la ganancia a su cartera virtual), se pone triste si perdiste
  const mascota = resultado === "gana" ? `\n🐾 ¡Tu mascota festeja! 🎉 +${money(g)} a su cartera virtual.`
    : resultado === "pierde" ? "\n🐾 Tu mascota se puso triste… pero ya se le pasará." : "";
  return { texto: `${lineaApuesta(a)}\n${ETIQUETA[resultado]} ${resultado === "pendiente" ? "" : signed(g)}${mascota}`.trim(), a };
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

  if (["guia", "manual", "folleto", "instrucciones", "📘"].includes(cmd) || texto.includes("Guía")) {
    const base = WEB_URL + "/docs/";
    const docs = [
      ["folleto.pdf", "📄 *Folleto*: qué es el bot y todo lo que incluye. Compártelo con quien le interese."],
      ["guia-usuario.pdf", "📘 *Guía del usuario*: todo paso a paso, explicado desde cero aunque nunca hayas apostado."],
    ];
    if (esDueno) docs.push(["manual-completo.pdf", "🛠 *Manual completo* (con la parte de administrador)."]);
    for (const [f, cap] of docs) {
      const r = await tg("sendDocument", { chat_id: chat, document: base + f + "?v=4", caption: cap, parse_mode: "Markdown" });
      if (!r.ok) await enviar(`${cap}\n${base}${f}`);
    }
    return;
  }

  if (cmd === "momio" || cmd === "momios") {
    const f = (args[0] || "").toLowerCase().startsWith("dec") ? "decimal" : (args[0] || "").toLowerCase().startsWith("ame") ? "americano" : null;
    if (!f) return enviar("¿Cómo quieres ver los momios?\n`momio americano` → +150 / -200\n`momio decimal` → 2.50 / 1.50\n\nTambién lo cambias en la página: menú > Mi diseño.");
    await admin("momio_set", { usuario: chat, momio: f }); setFormato(f);
    return enviar(`✅ Listo, te muestro los momios en *${f}* (ej. ${amer(2.5)} y ${amer(1.5)}). Puedes escribirlos como quieras, yo entiendo los dos.`);
  }
  if (cmd === "partidos" || cmd === "pasados" || cmd === "archivo") {
    const q = args.join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 .&'-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!q) return enviar("Escribe el equipo, por ejemplo `partidos chivas` o `partidos real madrid`. Te muestro sus últimos partidos con lo que dijo el Gurú y Pinnacle.\n\nEn la página (menú > 🗄️ Partidos pasados) puedes filtrar y descargarlos en Excel.");
    const r = await guru("buscar", { q, n: 8 });
    if (!r.total) return enviar(`No encontré partidos de *${q}*. Prueba con otro nombre (como sale en ESPN).`);
    const NOM = (x, k) => ({ L: x.local, E: "Empate", V: x.visita })[k];
    const tope = (o) => Object.entries(o).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1])[0][0];
    const lin = r.filas.map((x) => {
      const f = new Date(x.fecha).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" });
      let t = `*${x.local} ${Number(x.goles_local)}–${Number(x.goles_visita)} ${x.visita}* (${f}, ${x.liga})`;
      if (x.dl != null) { const k = tope({ L: +x.dl, E: x.de == null ? null : +x.de, V: +x.dv }); t += `\n   🔮 Gurú: ${NOM(x, k)} ${k === x.res ? "✅" : "❌"}`; }
      if (x.pm && x.pm.L != null) {
        const k = tope({ L: +x.pm.L, E: x.pm.E == null ? null : +x.pm.E, V: +x.pm.V }), mo = x.pm.momios && x.pm.momios[k];
        t += `\n   📌 Pinnacle: ${NOM(x, k)}${mo ? ` (${amer(mo)})` : ""} ${k === x.res ? "✅" : "❌"}`;
      }
      return t;
    });
    const s = r.resumen || {};
    return enviar(`📚 *Últimos partidos de "${q}"* (${r.total} guardados)\n\n${lin.join("\n\n")}` +
      (s.con_guru || s.con_pinn ? `\n\nEn total: 🔮 Gurú ${s.guru}/${s.con_guru} · 📌 Pinnacle ${s.pinn}/${s.con_pinn}` : ""));
  }
  if (["terminos", "condiciones", "privacidad", "aviso"].includes(cmd))
    return enviar("⚖️ *Términos y condiciones (resumen)*\n\n• Es una herramienta de información y estadística, no una casa de apuestas ni asesoría financiera. No recibe ni mueve dinero real.\n" +
      "• Los porcentajes y señales salen de modelos predictivos: pueden fallar y no garantizan ganancias.\n• Tú decides y eres responsable de lo que apuestas; el creador no responde por pérdidas.\n" +
      "• Solo mayores de 18. Usa casas con permiso en México.\n• La cartera, la tienda y los juegos son dinero virtual sin valor real.\n• Tus datos solo se usan para que funcione el bot y no se comparten.\n\n" +
      "Completos: " + TERMINOS_URL + "\n\n🆘 Si apostar te está afectando: Línea de la Vida 800 911 2000 (gratis, 24 h).", { disable_web_page_preview: true });

  // 📝 Opiniones: idea / error / opinión + texto
  const TIPOS = { idea: "idea", sugerencia: "idea", mejora: "idea", error: "error", falla: "error", bug: "error", opinion: "opinion", opinar: "opinion", comentario: "opinion" };
  if (TIPOS[cmd] || texto.includes("Opinar")) {
    const cuerpo = texto.includes("Opinar") ? "" : args.join(" ").trim();
    if (cuerpo.length < 3)
      return enviar("📝 *Ayúdame a mejorar el bot*\nEscribe una de estas palabras y luego tu comentario:\n\n" +
        "`idea` — algo que te gustaría que tuviera\n`error` — algo que no funciona bien\n`opinion` — lo que piensas (puedes calificar con 1 a 5 estrellas al final, ej. `opinion me encanta 5`)\n\n" +
        "Ejemplo: `idea que avise cuando juega mi equipo`\n\nTambién en la página: menú > Opiniones, donde ves las de todos y en qué van.");
    let estrellas = null, t = cuerpo;
    const m = cuerpo.match(/\s([1-5])\s*(?:estrellas?|★)?$/i);
    if (TIPOS[cmd] === "opinion" && m) { estrellas = Number(m[1]); t = cuerpo.slice(0, m.index).trim(); }
    const o = await opinion("crear", { usuario: chat, tipo: TIPOS[cmd], texto: t, estrellas });
    if (!esDueno) await avisarOpinion(o);
    return enviar(`🙌 ¡Gracias! Guardé tu ${TIPO_OP[o.tipo].slice(2).toLowerCase()} (#${o.id}). Te aviso cuando la revise o la haga.`);
  }
  if (esDueno && cmd === "responder" && /^\d+$/.test(args[0] || "") && args.length > 1) {
    const o = await opinion("estado", { id: Number(args[0]), respuesta: args.slice(1).join(" ").slice(0, 600),
      estado: "vista" });
    await avisarAutor(o, "respuesta");
    return enviar(`✅ Le respondí a la #${o.id}.`);
  }
  if (esDueno && ["opiniones", "ideas"].includes(cmd)) {
    const l = (await opinion("lista", { usuario: chat })).filter((o) => !["hecha", "no"].includes(o.estado)).slice(0, 15);
    if (!l.length) return enviar("No hay opiniones pendientes. 🎉");
    for (const o of l.slice(0, 8))
      await enviar(`${TIPO_OP[o.tipo]} *#${o.id}* · ${ESTADO_OP[o.estado]}${o.votos ? ` · 👍 ${o.votos}` : ""}\nDe ${o.nombre}: ${o.texto.replace(/[_*\x60[\]]/g, "")}`,
        { reply_markup: botonesOpinion(o.id) });
    return l.length > 8 ? enviar(`…y ${l.length - 8} más en la página (menú > Opiniones).`) : null;
  }

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

  if (["saldo", "banca", "balance", "resumen", "💰"].includes(cmd) || texto.includes("Saldo")) {
    const lim = await textoLimite(chat).catch(() => ({ texto: "" }));
    return enviar(await resumen(dbu) + (lim.texto ? "\n\n" + lim.texto : ""), { reply_markup: TECLADO });
  }

  // Vuelve a mandar las señales del último escaneo (lee la base de datos: no gasta créditos de cuotas)
  if (["senales", "señales", "senal", "señal", "momios", "alertas", "🎯"].includes(cmd) || texto.includes("Señales")) {
    const [lineas, r] = await Promise.all([mas("lineas2", {}), dbu("resumen")]);
    const banca = Number(r.banca_inicial) + Number(r.bot.ganancia);
    const partes = textoSenales(lineas, banca);
    if (!partes.length) return enviar("No hay señales vigentes ahora. El bot escanea a las 7:00 y a las 18:00 (si hay partidos de tu calendario).", { reply_markup: TECLADO });
    for (const t of partes) await enviar(t);
    const bt = botonesSenales(lineas);
    if (bt.length) await enviar("👇 ¿Apostaste alguna? Toca el partido y te pregunto el momio.", { reply_markup: { inline_keyboard: bt } });
    return;
  }

  // Retiros y depósitos: en la banca del bot (cambian los montos sugeridos) o en apuestas normales (`retiro normal 50`)
  if (["retiro", "retire", "retirar", "saque", "deposito", "deposite", "depositar", "meti"].includes(cmd)) {
    const libre = args.some((a) => /^(libre|normal|normales|parlay|aparte)$/i.test(a));
    const resto = args.filter((a) => !/^(libre|normal|normales|parlay|aparte|bot)$/i.test(a));
    const i = resto.findIndex((a) => Number(a.replace(/[$,]/g, "")) > 0);
    const monto = i >= 0 ? Number(resto[i].replace(/[$,]/g, "")) : 0;
    if (!(monto > 0)) return enviar("Escribe el monto, por ejemplo: `retiro 50` (banca del bot) o `retiro normal 50` (apuestas normales).");
    const tipo = /^(dep|meti)/.test(cmd) ? "deposito" : "retiro";
    const nota = resto.filter((_, j) => j !== i).join(" ").slice(0, 80);
    if (tipo === "retiro" && !libre) {
      const r0 = await dbu("resumen");
      const disponible = Number(r0.banca_inicial) + Number(r0.bot.ganancia) - Number(r0.bot.en_juego);
      if (monto > disponible + 0.001) return enviar(`No puedes retirar ${money(monto)}: tienes ${money(disponible)} disponibles en la banca del bot.`);
    }
    await mas("mov_crear", { usuario: String(chat), tipo, monto, nota, cartera: libre ? "libre" : "bot" });
    const r = await dbu("resumen");
    if (libre) {
      const mv = await mas("movimientos", { usuario: String(chat) });
      const saldo = Number(mv.libre.depositado) - Number(mv.libre.retirado) + Number(r.libre.ganancia);
      return enviar(`${tipo === "retiro" ? "💸 Retiro" : "➕ Depósito"} de *${money(monto)}* en apuestas normales guardado.\n` +
        `🎲 Saldo normal: *${money(saldo)}* (depositado ${money(mv.libre.depositado)} · retirado ${money(mv.libre.retirado)} · ganancia ${signed(Number(r.libre.ganancia))})`,
        { reply_markup: TECLADO });
    }
    const actual = Number(r.banca_inicial) + Number(r.bot.ganancia);
    return enviar(`${tipo === "retiro" ? "💸 Retiro" : "➕ Depósito"} de *${money(monto)}* guardado.\n🤖 Banca del bot ahora: *${money(actual)}*\n` +
      `_Los montos sugeridos de las próximas señales ya usan esta banca._`, { reply_markup: TECLADO });
  }


  // ¿Conviene? "Ravens -250?" o "checa más 2.5 1.90 draftea"
  const pregunta = /\?\s*$/.test(limpio);
  if (["checa", "checar", "conviene", "vale", "checame"].includes(cmd) || (pregunta && sacarMomio(limpio)[0])) {
    const consulta = ["checa", "checar", "conviene", "vale", "checame"].includes(cmd) ? args.join(" ") : limpio;
    const [cuota, resto] = sacarMomio(consulta.replace(/\?/g, " "));
    if (!cuota) return enviar("Dime el momio que te ofrecen, por ejemplo: `Ravens -250?` o `checa América +120 caliente`.");
    const ops = buscarSenal(await mas("lineas2", {}), resto);
    if (!ops.length) return enviar("No encontré esa apuesta entre las señales vigentes del bot. Revisa el nombre (o 🎯 Señales para ver la lista).\n_Solo puedo calificar lo que el bot analizó con Pinnacle._");
    if (ops.length > 1 && ops[0].pts - ops[1].pts < 0.3 && ops[0].seleccion !== ops[1].seleccion)
      return enviar("¿Cuál de estas?\n" + ops.map((o) => `• ${o.seleccion} (${o.partido})`).join("\n") + "\n\nEscríbela más completa, por ejemplo `checa " + ops[0].seleccion + " " + (cuota >= 2 ? "+" + Math.round((cuota - 1) * 100) : "-" + Math.round(100 / (cuota - 1))) + "`");
    const o = ops[0], v = veredicto(o.prob, Number(o.minima), cuota), casa = casaDe(consulta);
    if (casa) await conv("cotizar", { usuario: String(chat), evento: o.evento, mercado: o.mercado, seleccion: o.seleccion, casa, cuota: Math.round(cuota * 1000) / 1000 }).catch(() => {});
    return enviar([`*${v.titulo}*`, "", `*${o.seleccion}* · ${o.partido}`, `Te ofrecen: *${amer(cuota)}*${casa ? " en " + casa : ""}`,
      `Probabilidad real (Pinnacle): *${(o.prob * 100).toFixed(1)}%* · efectividad ${v.efectividad}`, "", v.detalle, `_${v.necesitas}_`,
      casa ? "\n📝 Lo guardé en ¿Conviene? para tus amigos y el análisis." : ""].join("\n"));
  }

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

  if (cmd === "limite") {
    const off = /^(off|no|quitar|sin|0)$/i.test(args[0] || "");
    const v = parseFloat(String(args[0] || "").replace("$", ""));
    if (!off && !(v > 0))
      return enviar("Pon un tope semanal para tus apuestas normales (parlays y por tu cuenta):\n`limite 300`  ·  para quitarlo: `limite off`\n\nCuenta lo que pierdes en la semana (de lunes a domingo) más lo que tienes en juego. No te bloquea: solo te avisa.");
    await rpcExtras("limite", { usuario: chat, valor: off ? null : v });
    return enviar(off ? "✅ Quité tu límite semanal." : `✅ Listo: te aviso cuando tus apuestas normales lleguen a ${money(v)} en la semana (al 80 % y al pasarte).`);
  }

  if (cmd === "inicial" && parseFloat(args[0]) > 0) {
    await dbu("banca", { valor: parseFloat(args[0]) });
    return enviar(`Banca inicial: ${money(parseFloat(args[0]))}\n\n` + await resumen(dbu));
  }

  // ¿Está contestando a un "Lo aposté"? (le pedimos momio y monto)
  const pendiente = await rpcSenal("espera", { usuario: chat });
  if (pendiente) {
    if (["cancelar", "no", "salir"].includes(cmd)) {
      await rpcSenal("fin", { usuario: chat });
      return enviar("Ok, no registré nada.");
    }
    const r = parseearSeguro(limpio);
    if (r.cuota && r.monto && r.seleccion) await rpcSenal("fin", { usuario: chat });   // escribió otra apuesta completa
    else if (r.cuota && r.monto) {
      await rpcSenal("fin", { usuario: chat });
      const nombreMercado = { h2h: "Ganador", totals: "Total", spreads: "Hándicap" }[pendiente.mercado] || "";
      const sel = pendiente.mercado === "h2h" ? pendiente.seleccion : `${pendiente.seleccion} (${nombreMercado})`;
      return registrarYConfirmar(chat, dbu, enviar, {
        seleccion: sel, partido: pendiente.partido, cuota: r.cuota, monto: r.monto,
        prob: pendiente.prob ? Number(pendiente.prob) : null, casa: r.casa || "Caliente", cartera: "bot",
        minima: pendiente.minima ? Number(pendiente.minima) : null,
      });
    }
    else return enviar(`Para *${pendiente.seleccion}* escribe el momio que tomaste y el monto, por ejemplo \`-380 5\`.\nSi fue en Draftea: \`-380 5 draftea\`. Escribe *cancelar* para salir.`);
  }

  // Cualquier otro texto: intentar registrarlo como apuesta
  const cuerpo = ["apuesta", "a", "registrar"].includes(cmd) ? args.join(" ") : limpio;
  const ap = parseearSeguro(cuerpo);
  if (!ap.cuota || !ap.monto || !ap.seleccion)
    return enviar("No entendí la apuesta. Ejemplo:\n`Jaguars -150 $5 62% caliente`\n\nEscribe *ayuda* para ver todo.");
  if (ap.prob !== null && !(ap.prob > 0 && ap.prob < 1))
    return enviar("El % debe estar entre 0 y 100.");

  return registrarYConfirmar(chat, dbu, enviar, ap);
}

async function registrarYConfirmar(chat, dbu, enviar, ap) {
  const a = await dbu("registrar", ap);
  let opciones = [];
  try {                                   // logo del equipo y de la liga (ESPN); si falla, se guarda sin logo
    const texto = `${ap.seleccion} ${ap.partido || ""}`;
    const l = await buscarLogo(texto);
    if (l) await rpcResultados("logo", { id: a.id, ...l });
    else if (!/\b(parlay|parley|combinada|empate)\b|m[aá]s de|menos de/i.test(texto)) opciones = await sugerencias(texto);
  } catch (e) { console.error("logo", e); }

  const gan = ap.monto * (ap.cuota - 1);
  let extra = `\nSi gana cobras ${money(ap.monto * ap.cuota)} (${signed(gan)})`;
  if (ap.minima && ap.cuota < ap.minima)
    extra += `\n⚠️ Tomaste ${amer(ap.cuota)} y el mínimo era ${amer(ap.minima)}: esta apuesta no tiene valor.`;
  if (ap.cartera === "libre") {
    extra += "\n🎲 Va a tus apuestas libres: no toca la banca del bot.";
    try {
      const lim = await textoLimite(chat);
      if (lim.nivel === 2) extra += `\n\n⛔ *Te pasaste de tu límite semanal.*\n${lim.texto}\nTómate un respiro; el lunes se reinicia.`;
      else if (lim.nivel === 1) extra += `\n\n⚠️ Estás cerca de tu límite semanal.\n${lim.texto}`;
    } catch (e) { console.error("limite", e); }
  }
  else if (ap.prob) {
    const ev = ap.prob * ap.cuota - 1;
    extra += `\nValor: ${ev >= 0 ? "+" : ""}${(ev * 100).toFixed(1)}%` + (ev < 0.03 ? " ⚠️ por debajo del mínimo del bot" : " 👍");
  }
  await enviar(`✅ Guardada\n${lineaApuesta(a)}${extra}\n\nCuando termine, toca el resultado:`, { reply_markup: botones(a.id) });
  if (opciones.length) {
    // No estamos seguros del club: preguntamos con los más parecidos
    const ops = opciones, seleccion = ap.seleccion;
    await tg("sendMessage", { chat_id: chat, parse_mode: "Markdown",
      text: `🤔 No reconocí bien el equipo de *${String(seleccion).replace(/[_*\x60[\]]/g, "")}*. ¿Es alguno de estos? (para ponerle su escudo)`,
      reply_markup: { inline_keyboard: [
        ...ops.map((o) => [{ text: `${o.nombre} · ${o.liga}`.slice(0, 60), callback_data: `l:${a.id}:${o.k}` }]),
        [{ text: "Ninguno", callback_data: `l:${a.id}:0` }]] } });
  }
}

async function rpcExtras(accion, datos) {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/extras`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: env("SUPABASE_KEY"), authorization: `Bearer ${env("SUPABASE_KEY")}` },
    body: JSON.stringify({ p_clave: env("BOT_CLAVE"), p_accion: accion, p_datos: datos }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || "error de base de datos");
  return j;
}

// Texto del límite semanal (o "" si no hay límite)
async function textoLimite(chat, extraMonto = 0) {
  const e = await rpcExtras("estado_limite", { usuario: chat });
  if (!e || !e.limite) return { texto: "", nivel: 0 };
  const perdido = Math.max(0, -Number(e.neto)), riesgo = perdido + Number(e.en_juego) + extraMonto, lim = Number(e.limite);
  const nivel = riesgo >= lim ? 2 : riesgo >= lim * 0.8 ? 1 : 0;
  return { nivel, texto: `🛑 Límite semanal (normales): ${money(riesgo)} de ${money(lim)} entre perdido y en juego` };
}

async function rpcSenal(accion, datos) {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/senal`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: env("SUPABASE_KEY"), authorization: `Bearer ${env("SUPABASE_KEY")}` },
    body: JSON.stringify({ p_clave: env("BOT_CLAVE"), p_accion: accion, p_datos: datos }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || "error de base de datos");
  return j;
}

function parseearSeguro(t) { try { return parsearApuesta(t); } catch { return {}; } }

async function rpcResultados(accion, datos) {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/resultados`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: env("SUPABASE_KEY"), authorization: `Bearer ${env("SUPABASE_KEY")}` },
    body: JSON.stringify({ p_clave: env("BOT_CLAVE"), p_accion: accion, p_datos: datos }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || "error de base de datos");
  return j;
}

async function atenderBoton(q) {
  const chat = q.message.chat.id, msgId = q.message.message_id;
  const dbu = (accion, datos = {}) => db(accion, { ...datos, usuario: String(chat) });
  const [tipo, id, res] = q.data.split(":");
  const conFoto = Boolean(q.message.photo);
  // Los mensajes con foto (propuestas de resultado) se editan en su pie de foto
  const editar = (texto, extra = {}) => conFoto
    ? tg("editMessageCaption", { chat_id: chat, message_id: msgId, caption: texto, parse_mode: "Markdown", ...extra })
    : tg("editMessageText", { chat_id: chat, message_id: msgId, text: texto, parse_mode: "Markdown", ...extra });
  if (tipo === "c") {
    const { texto, a } = await cerrar(dbu, Number(id), res);
    const marcador = a && a.marcador && res !== "pendiente" ? `\n🏁 ${a.marcador}` : "";
    await editar(texto + marcador,
      { reply_markup: { inline_keyboard: [[{ text: "↩️ Reabrir", callback_data: `c:${id}:pendiente` }]] } });
    if (res === "pendiente")
      await tg("editMessageReplyMarkup", { chat_id: chat, message_id: msgId, reply_markup: botones(id) });
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: ETIQUETA[res] });
  } else if (tipo === "o") {
    // el dueño cambia el estado de una opinión
    if (String(chat) !== env("TELEGRAM_CHAT_ID")) { await tg("answerCallbackQuery", { callback_query_id: q.id }); return; }
    if (res === "menu") {
      await tg("editMessageReplyMarkup", { chat_id: chat, message_id: msgId, reply_markup: botonesOpinion(id) });
      await tg("answerCallbackQuery", { callback_query_id: q.id }); return;
    }
    const o = await opinion("estado", { id: Number(id), estado: res });
    await avisarAutor(o, "estado");
    await tg("editMessageReplyMarkup", { chat_id: chat, message_id: msgId, reply_markup: { inline_keyboard: [
      [{ text: `${ESTADO_OP[res]} · cambiar`, callback_data: `o:${id}:menu` }]] } });
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: `${ESTADO_OP[res]} · le avisé` });
  } else if (tipo === "a") {
    // el dueño acepta o rechaza una solicitud de acceso
    if (String(chat) !== env("TELEGRAM_CHAT_ID")) { await tg("answerCallbackQuery", { callback_query_id: q.id }); return; }
    if (res === "si") {
      const nombre = (q.message.text || "").match(/👤 ([^\n(]+)/)?.[1]?.trim() || (q.message.text || "").match(/👀 ([^\n(]+?) (?:\(|le escribió)/)?.[1]?.trim() || "Amigo";
      await db("agregar", { usuario: id, nombre: nombre.slice(0, 40) });
      await editar(`✅ Aceptaste a *${limpiar(nombre)}* (\`${id}\`).`);
      await tg("sendMessage", { chat_id: id, parse_mode: "Markdown", reply_markup: TECLADO,
        text: "🎉 *¡Ya tienes acceso al bot!*\n\nToca ❓ Ayuda para ver cómo funciona, 📘 Guía para recibir el manual, o 🌐 Mi página para crear tu usuario de la página web.\n\n" + TERMINOS_CORTO, disable_web_page_preview: true });
    } else {
      await editar(`❌ Rechazaste la solicitud de \`${id}\`.`);
    }
    await tg("answerCallbackQuery", { callback_query_id: q.id });
  } else if (tipo === "r") {
    // Respuesta a un reto 1 vs 1
    const r = await mas("reto_responder", { usuario: String(chat), id: Number(id), acepta: res === "si" });
    if (!r) {
      await editar("Ese reto ya no está disponible (lo cancelaron o el partido ya empezó).");
    } else {
      await editar(res === "si" ? "🔥 *Reto aceptado.* Te aviso quién ganó cuando termine el partido." : "👌 Rechazaste el reto.");
      await avisarRespuesta(r);
    }
    await tg("answerCallbackQuery", { callback_query_id: q.id });
  } else if (tipo === "l") {
    // Eligió el club correcto para el escudo
    if (res === "0") {
      await editar("👌 Ok, se queda sin escudo.");
    } else {
      const e = await equipoPorClave(res);
      if (e) {
        await rpcResultados("logo_forzar", { id: Number(id), usuario: String(chat), logo: e.logo, liga: e.liga, liga_logo: e.liga_logo });
        await editar(`✅ Listo: le puse el escudo de *${e.nombre}* (${e.liga}).`);
      } else await editar("No encontré ese club. Intenta de nuevo más tarde.");
    }
    await tg("answerCallbackQuery", { callback_query_id: q.id });
  } else if (tipo === "p") {
    // Eligió un partido de la alerta: mostrar sus opciones
    const h = await rpcSenal("hermanas", { id: Number(id) });
    if (!h) { await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Esa alerta ya no está disponible" }); return; }
    const NM = { h2h: "Ganador", totals: "Total", spreads: "Hándicap" };
    await tg("sendMessage", { chat_id: chat, parse_mode: "Markdown",
      text: `*${h.partido.replace(/[_*\x60[\]]/g, "")}*\n¿Qué apostaste?`,
      reply_markup: { inline_keyboard: h.opciones.map((o) => [{
        text: `${o.seleccion} · ${NM[o.mercado] || ""} · ${o.prob ? Math.round(o.prob * 100) + "%" : ""}${o.minima ? " · mín " + amer(Number(o.minima)) : ""}`.slice(0, 64),
        callback_data: `s:${o.id}` }]) } });
    await tg("answerCallbackQuery", { callback_query_id: q.id });
  } else if (tipo === "s") {
    const o = await rpcSenal("esperar", { usuario: String(chat), id: Number(id) });
    if (!o) { await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Esa opción ya no está disponible" }); return; }
    await tg("sendMessage", { chat_id: chat, parse_mode: "Markdown",
      text: `👍 *${o.seleccion.replace(/[_*\x60[\]]/g, "")}*${o.minima ? ` (mínimo ${amer(Number(o.minima))})` : ""}\n\n¿A qué momio y cuánto? Ejemplo: \`-380 5\`\nSi fue en Draftea: \`-380 5 draftea\` · *cancelar* para salir.` });
    await tg("answerCallbackQuery", { callback_query_id: q.id });
  } else if (tipo === "n") {
    await rpcResultados("descartar", { id: Number(id), usuario: String(chat) });
    await editar(`👍 Ok, no era ese partido. Marca la apuesta #${id} tú cuando termine (📋 Pendientes).`);
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Descartado" });
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

// ---------------------------------------------------------------- solicitudes de acceso
// Alguien que no tiene acceso escribe al bot: le pedimos que comparta su número y te avisamos con botones para aceptarlo.
async function pedirAcceso(u, chatId) {
  const m = u.message;
  if (!m) return;
  const quien = m.from || {};
  const nombre = [quien.first_name, quien.last_name].filter(Boolean).join(" ") || "Alguien";
  if (m.contact) {
    const tel = m.contact.phone_number ? (m.contact.phone_number.startsWith("+") ? m.contact.phone_number : "+" + m.contact.phone_number) : "sin número";
    const propio = String(m.contact.user_id || "") === String(chatId);
    await tg("sendMessage", { chat_id: env("TELEGRAM_CHAT_ID"), parse_mode: "Markdown",
      text: `🙋 *Solicitud de acceso al bot*\n\n👤 ${limpiar(nombre)}${quien.username ? ` (@${limpiar(quien.username)})` : ""}\n📱 ${limpiar(tel)}${propio ? "" : " _(número de otra persona)_"}\n🆔 \`${chatId}\`\n\n¿Le das acceso?`,
      reply_markup: { inline_keyboard: [[{ text: "✅ Aceptar", callback_data: `a:${chatId}:si` }, { text: "❌ No", callback_data: `a:${chatId}:no` }]] } });
    await tg("sendMessage", { chat_id: chatId, text: "📨 Listo, le avisé al dueño del bot. Te llega un mensaje aquí cuando te acepte.",
      reply_markup: { remove_keyboard: true } });
    return;
  }
  // primera vez (o cualquier mensaje): pedir el número con un botón
  const nuevo = await mas("aviso", { usuario: env("TELEGRAM_CHAT_ID"), clave: `solicitud:${chatId}` }).catch(() => true);
  await tg("sendMessage", { chat_id: chatId,
    text: "🔒 Este bot es privado.\n\nToca el botón de abajo 👇 para pedir acceso: le llega tu nombre y tu número al dueño para que te acepte.\n\nAl pedir acceso confirmas que eres mayor de 18 y aceptas los términos: " + TERMINOS_URL, disable_web_page_preview: true,
    reply_markup: { keyboard: [[{ text: "📱 Pedir acceso (compartir mi número)", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
  if (nuevo) await tg("sendMessage", { chat_id: env("TELEGRAM_CHAT_ID"), parse_mode: "Markdown",
    text: `👀 ${limpiar(nombre)}${quien.username ? ` (@${limpiar(quien.username)})` : ""} le escribió al bot y no tiene acceso. Ya le pedí que comparta su número.\n🆔 \`${chatId}\``,
    reply_markup: { inline_keyboard: [[{ text: "✅ Aceptar sin número", callback_data: `a:${chatId}:si` }]] } });
}
const limpiar = (t) => String(t || "").replace(/[_*\x60[\]]/g, "");

// ---------------------------------------------------------------- 🔔 avisos de Progol, Media Semana y Protouch
const NOM_Q = { progol: "Progol", media: "Media Semana", protouch: "Protouch" };
async function avisosProgol(accion, datos, antes) {
  const juegoDe = (x) => x.juego || "progol";
  if (accion === "guardar") {
    const j = datos.juego || "progol";
    if (antes.some((x) => juegoDe(x) === j && Number(x.concurso) === Number(datos.concurso))) return;
    const n = ((datos.datos || {}).partidos || []).length;
    await notificar({ tipo: "quiniela", telegram: true, tag: "quiniela-" + j,
      titulo: `🎟️ Ya está la quiniela de ${NOM_Q[j]} ${datos.concurso}`,
      cuerpo: `${n} partidos con la probabilidad de cada uno. Arma el boleto más probable del tamaño que quieras.`, url: "/#progol" });
    return;
  }
  for (const c of datos.concursos || []) {
    const j = c.juego || "progol", res = (c.resultados || {})[j];
    const fila = antes.find((x) => juegoDe(x) === j && Number(x.concurso) === Number(c.concurso));
    if (!fila || !Array.isArray(res) || !res.length || ((fila.resultados || {})[j] || []).length) continue;   // sin pronóstico guardado o ya avisado
    const P = (fila.datos || {}).partidos || [];
    const fav = P.map((p) => ["L", "E", "V"].reduce((a, k) => (p.p[k] > p.p[a] ? k : a), "L"));
    const atino = fav.filter((k, i) => res[i] === k).length;
    const letra = (k) => (j === "protouch" && k === "E" ? "D" : k);
    await notificar({ tipo: "progol", telegram: true, tag: "progol-" + j,
      img: { k: "progol", nom: `${NOM_Q[j]} ${c.concurso}`, a: atino, r: res.slice(0, P.length).map((k, i) => ({ l: letra(k), ok: fav[i] === k })),
        t: `Al azar se esperan ${(P.length / 3).toFixed(1)}. Mira cuánto habría pagado cada boleto.` },
      titulo: `⚽ Resultados de ${NOM_Q[j]} ${c.concurso}`,
      cuerpo: `El favorito atinó ${atino} de ${P.length}. Mira cuánto habría pagado cada boleto.`, url: "/#progol" });
  }
}

// ---------------------------------------------------------------- entrada HTTP
export default async function handler(req, res) {
  // Registro del webhook (una sola vez): GET /api/telegram?setup=<WEBHOOK_SECRET>
  const tokenOk = () => (req.headers["x-bot-token"] || "").replace(/\s/g, "") === env("TELEGRAM_TOKEN");
  // Para el revisor de resultados de GitHub: apuestas pendientes de todos y guardar propuestas
  if (req.query.pendientes !== undefined) {
    if (!tokenOk()) return res.status(401).json({ error: "no" });
    return res.status(200).json(await rpcResultados("pendientes", {}));
  }
  // Para el revisor de GitHub: quiniela, retos, práctica, avisos de equipo favorito y respaldo mensual
  if (req.query.mas !== undefined && req.method === "POST") {
    if (!tokenOk()) return res.status(401).json({ error: "no" });
    const b = req.body || {};
    const PERMITIDAS = ["favoritos", "aviso", "quiniela_pendientes", "quiniela_res", "retos_abiertos", "reto_cerrar",
      "practica_pendientes", "practica_pierna", "respaldo", "lineas2", "clv_pendientes", "clv_set"];
    if (b.accion === "torneo_premiar") return res.status(200).json(await torneo("premiar"));
    if (!PERMITIDAS.includes(b.accion)) return res.status(400).json({ error: "acción" });
    return res.status(200).json(await mas(b.accion, b.datos || {}));
  }
  // Para juegos.py: mascotas con hambre (aviso por Telegram)
  if (req.query.jugar !== undefined && req.method === "POST") {
    if (!tokenOk()) return res.status(401).json({ error: "no" });
    const b = req.body || {};
    if (!["hambrientos"].includes(b.accion)) return res.status(400).json({ error: "acción" });
    return res.status(200).json(await jugar(b.accion, b.datos || {}));
  }
  // Para progol.py de GitHub: boleto del Progol con probabilidades y resultados oficiales
  if (req.query.progol !== undefined && req.method === "POST") {
    if (!tokenOk()) return res.status(401).json({ error: "no" });
    const b = req.body || {}, acc = { guardar: "progol_guardar", resultados: "progol_resultados" }[b.accion];
    if (!acc) return res.status(400).json({ error: "acción" });
    const llamar = (a, d) => fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/melate`, { method: "POST",
      headers: { "content-type": "application/json", apikey: process.env.SUPABASE_KEY, authorization: `Bearer ${process.env.SUPABASE_KEY}` },
      body: JSON.stringify({ p_clave: process.env.BOT_CLAVE, p_accion: a, p_datos: d }) });
    const antes = await llamar("progol_ver", {}).then((x) => x.json()).catch(() => []);
    const r = await llamar(acc, b.datos || {});
    const out = await r.json();
    if (r.ok && Array.isArray(antes)) {
      try { await avisosProgol(b.accion, b.datos || {}, antes); } catch (e) { console.error("avisos progol", e); }
    }
    return res.status(r.ok ? 200 : 500).json(out);
  }
  // 🔔 Para los scripts de GitHub (señales, resultados, movimientos): notificaciones al celular
  if (req.query.push !== undefined && req.method === "POST") {
    if (!tokenOk()) return res.status(401).json({ error: "no" });
    const envios = ((req.body || {}).envios || []).slice(0, 200);
    let total = 0;
    for (const e of envios) {
      if (e.tipo === "senales" && Array.isArray(e.senales)) {
        const x = await notificar({ tipo: "senales", para: (u, a) => cuerpoSenales(e.senales, a) });
        total += x.enviados;
      } else if (["resultados", "movimientos"].includes(e.tipo)) {
        const x = await notificar({ tipo: e.tipo, usuarios: e.usuarios || null, titulo: String(e.titulo || "").slice(0, 80),
          cuerpo: String(e.cuerpo || "").slice(0, 300), url: e.url || "/", tag: e.tag, img: e.img && typeof e.img === "object" ? e.img : null });
        total += x.enviados;
      }
    }
    return res.status(200).json({ enviados: total });
  }
  // 🗓️ Resumen diario a la hora que cada quien eligió (lo llama Supabase cada hora)
  if (req.query.resumen_push !== undefined) {
    if ((req.headers["x-bot-clave"] || "") !== env("BOT_CLAVE")) return res.status(401).json({ error: "no" });
    return res.status(200).json(await mandarResumenes());
  }
  // Para pronosticos.py de GitHub: guardar pronósticos del Gurú y sus resultados
  if (req.query.guru !== undefined && req.method === "POST") {
    if (!tokenOk()) return res.status(401).json({ error: "no" });
    const b = req.body || {};
    if (!["guardar", "pendientes", "resultado", "excel", "archivo", "archivo_n", "calibrar_datos", "config_get", "config_set", "esquema"].includes(b.accion)) return res.status(400).json({ error: "acción" });
    return res.status(200).json(await guru(b.accion, b.datos || {}));
  }
  if (req.query.semana !== undefined) {
    if (!tokenOk()) return res.status(401).json({ error: "no" });
    return res.status(200).json(await rpcExtras("semana", {}));
  }
  if (req.query.senales !== undefined && req.method === "POST") {
    if (!tokenOk()) return res.status(401).json({ error: "no" });
    const b = req.body || {};
    return res.status(200).json(await rpcSenal("guardar", { lote: String(b.lote || ""), filas: Array.isArray(b.filas) ? b.filas.slice(0, 300) : [] }));
  }
  if (req.query.estado !== undefined && req.method === "POST") {
    if (!tokenOk()) return res.status(401).json({ error: "no" });
    const b = req.body || {};
    if (!["creditos", "escaneo", "resultados", "guru"].includes(b.clave)) return res.status(400).json({ error: "clave" });
    return res.status(200).json(await admin("estado_set", { clave: b.clave, valor: b.valor ?? null }));
  }
  if (req.query.proponer !== undefined && req.method === "POST") {
    if (!tokenOk()) return res.status(401).json({ error: "no" });
    const b = req.body || {};
    return res.status(200).json(await rpcResultados("proponer", {
      id: Number(b.id), evento: String(b.evento || ""), marcador: String(b.marcador || ""),
      logo: /^https:\/\//.test(b.logo || "") ? b.logo : null }));
  }
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
        { command: "senales", description: "Volver a ver las señales vigentes" },
        { command: "saldo", description: "Banca, récord y ganancia" },
        { command: "pendientes", description: "Apuestas sin resultado" },
        { command: "ayuda", description: "Cómo registrar apuestas" },
        { command: "guia", description: "Folleto y guía del usuario en PDF" },
        { command: "opinar", description: "Mandar una idea, error u opinión" },
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
  setFormato("americano");

  try {
    if (!esDueno && !(await db("usuario", { usuario: chatId }))) {
      await pedirAcceso(u, chatId);
      return res.status(200).send("ok");
    }
    try { setFormato((await admin("avisos_get", { usuario: chatId }))?.momio); } catch (e) { /* americano */ }
    if (u.callback_query) await atenderBoton(u.callback_query);
    else if (u.message?.text) await atenderTexto(chatId, u.message.text, esDueno, u.message.message_id);
  } catch (e) {
    console.error(e);
    await tg("sendMessage", { chat_id: chatId, text: `⚠️ No se pudo completar: ${e.message}` });
  }
  return res.status(200).send("ok");
}
