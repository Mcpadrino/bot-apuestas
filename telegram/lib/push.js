// 🔔 Notificaciones al celular (Web Push) y avisos por Telegram según lo que cada quien eligió en "Mis avisos".
// Cada usuario decide, tipo por tipo, si lo quiere en el celular, en Telegram, en los dos o en ninguno.
import webpush from "web-push";

const env = (k) => (process.env[k] || "").replace(/\s/g, "");
export const VAPID_PUBLICA = "BN60Fgfd2yY5_hR8bAF9UUKadFas40Xn7rtt0AD_Jzn_uoCY5ZWqu3iTSDlfUYd4dYotqXCE1iGtX9A3WQkAXkU";
const WEB = env("WEB_URL") || "https://bot-apuestas-telegram.vercel.app";

// Tipos de aviso y si vienen prendidos de fábrica en cada canal
export const TIPOS = {
  senales: { cel: true, tg: true },
  resultados: { cel: true, tg: true },
  movimientos: { cel: false, tg: true },
  comunidad: { cel: true, tg: true },
  historias: { cel: true, tg: false },
  retos: { cel: true, tg: true },
  melate: { cel: true, tg: false },
  progol: { cel: true, tg: false },
  quiniela: { cel: false, tg: false },
  resumen: { cel: true, tg: false },
};

export async function notif(accion, datos = {}) {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/notif`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: env("SUPABASE_KEY"), authorization: `Bearer ${env("SUPABASE_KEY")}` },
    body: JSON.stringify({ p_clave: env("BOT_CLAVE"), p_accion: accion, p_datos: datos }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || "error de base de datos");
  return j;
}

let listo = false;
async function preparar() {
  if (listo) return;
  const privada = env("VAPID_PRIVATE") || (await notif("vapid"));
  webpush.setVapidDetails(WEB, env("VAPID_PUBLIC") || VAPID_PUBLICA, privada);
  listo = true;
}

export function quiere(avisos, tipo, canal) {
  const n = ((avisos || {}).notif || {})[tipo];
  if (n && typeof n[canal] === "boolean") return n[canal];
  if (tipo === "movimientos" && canal === "tg") return (avisos || {}).movimientos !== false;
  return !!(TIPOS[tipo] || {})[canal];
}

export function horaMx(d = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", hour: "numeric", hourCycle: "h23" }).format(d));
}

export function enSilencio(avisos) {
  const s = (avisos || {}).silencio;
  if (!s || s.de == null || s.a == null) return false;
  const h = horaMx(), de = Number(s.de), a = Number(s.a);
  return de < a ? h >= de && h < a : h >= de || h < a;
}

// ✨ Cómo se ve cada tipo: ícono propio, botones de acción y vibración
const ACCIONES = {
  senales: [["Ver señales", "/#bot"], ["Gurú", "/#guru"]],
  resultados: [["Confirmar", "/#bot"]],
  movimientos: [["Ver líneas", "/#lineas"]],
  comunidad: [["Abrir", "/#comunidad"]],
  historias: [["Ver historia", "/#inicio"]],
  retos: [["Responder", "/#retos"]],
  melate: [["Ver teorías", "/#melate"]],
  progol: [["Ver boletos", "/#progol"]],
  quiniela: [["Armar mi boleto", "/#progol"]],
  resumen: [["Mi banca", "/#bot"], ["Quinielas", "/#progol"]],
};
const VIBRA = { resultados: [90, 50, 90], senales: [40, 30, 40, 30, 140], retos: [120, 60, 120], resumen: [60] };
export const tarjeta = (d) => d ? `${WEB}/api/tarjeta?d=${Buffer.from(JSON.stringify(d)).toString("base64url")}` : undefined;

// Manda un aviso a quien lo quiere: se guarda en su 🔔 bandeja de la app y, según lo que eligió, llega al celular y/o a Telegram.
//   tipo: uno de TIPOS · titulo/cuerpo/url/img · usuarios: lista (o null = todos) · excepto: usuario que no lo recibe
//   para(usuario, avisos) → {titulo, cuerpo, url, img, texto} para personalizarlo (o null para no mandarle)
//   telegram: true → también por Telegram (solo los tipos que no manda ya otra parte del bot)
//   bandeja: false → no se guarda (pruebas)
export async function notificar({ tipo, titulo, cuerpo, url = "/", tag, usuarios = null, excepto = null, para = null, telegram = false,
  ignorarSilencio = false, forzar = false, img = null, bandeja = true, acc = null }) {
  let enviados = 0, porTg = 0;
  const base = (u, avisos) => {
    if (excepto && String(u) === String(excepto)) return null;
    const p = para ? para(u, avisos) : { titulo, cuerpo, url, img, acc };
    return p && p.titulo ? { url, tag: tag || tipo, ...p } : null;
  };
  try {
    // 1) a quién le toca y qué mensaje (una sola vez por persona)
    const gente = await notif("gente", { usuarios });
    const msgs = new Map();
    for (const g of gente) {
      const u = String(g.usuario), quiereAlgo = forzar || quiere(g.avisos, tipo, "cel") || quiere(g.avisos, tipo, "tg");
      if (!quiereAlgo) continue;
      const m = base(u, g.avisos);
      if (m) msgs.set(u, { ...m, avisos: g.avisos });
    }
    if (!msgs.size) return { enviados, porTg };
    // 2) a la bandeja de cada quien (aunque esté en horas de silencio: la ve al abrir la app)
    let ids = {};
    if (bandeja) {
      ids = await notif("bandeja_guardar", { filas: [...msgs].map(([u, m]) => ({ usuario: u, tipo, titulo: m.titulo, cuerpo: m.texto || m.cuerpo, url: m.url, img: m.img || null })) })
        .catch((e) => { console.error("bandeja", e); return {}; });
    }
    const conId = (u, url) => {
      const id = ids[u];
      if (!id) return url || "/";
      const [ruta, hash] = String(url || "/").split("#");
      return `${ruta}${ruta.includes("?") ? "&" : "?"}aviso=${id}${hash ? "#" + hash : ""}`;
    };
    // 3) al celular
    await preparar();
    const subs = await notif("destinos", { usuarios: [...msgs.keys()] });
    await Promise.all(subs.map(async (s) => {
      const m = msgs.get(String(s.usuario));
      if (!m || !(forzar || quiere(s.avisos, tipo, "cel")) || (!ignorarSilencio && enSilencio(s.avisos))) return;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ t: m.titulo, b: m.cuerpo, u: conId(s.usuario, m.url), tag: m.tag, tipo, img: tarjeta(m.img), ic: `/iconos/${TIPOS[tipo] ? tipo : "app"}.png`,
            acc: (m.acc || ACCIONES[tipo] || []).map(([t, u]) => ({ t, u: conId(s.usuario, u) })), vib: VIBRA[tipo] || [60], ts: Date.now(), id: ids[s.usuario] || null }),
          { TTL: 6 * 3600, urgency: ["resultados", "retos"].includes(tipo) ? "high" : "normal" });
        enviados++;
        notif("enviado", { endpoint: s.endpoint }).catch(() => {});
      } catch (e) {
        const gone = e && (e.statusCode === 404 || e.statusCode === 410);
        await notif("fallo", { endpoint: s.endpoint, gone }).catch(() => {});
        if (!gone) console.error("push", e && e.statusCode, e && e.body);
      }
    }));
    // 4) por Telegram
    if (telegram && env("TELEGRAM_TOKEN")) {
      await Promise.all([...msgs].filter(([u, m]) => /^-?\d+$/.test(u) && quiere(m.avisos, tipo, "tg") && (ignorarSilencio || !enSilencio(m.avisos))).map(async ([u, m]) => {
        const enlace = m.url && m.url.startsWith("/") ? WEB + m.url : m.url;
        await fetch(`https://api.telegram.org/bot${env("TELEGRAM_TOKEN")}/sendMessage`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: u, disable_web_page_preview: true, text: `${m.titulo}\n${m.texto || m.cuerpo}${enlace ? `\n${enlace}` : ""}` }),
        }).catch(() => {});
        porTg++;
      }));
    }
  } catch (e) { console.error("notificar", e); }
  return { enviados, porTg };
}

// ---------------------------------------------------------------- señales (desde el escaneo de Python)
export function cuerpoSenales(senales, avisos) {
  const a = avisos || {}, ligas = a.ligas, pmin = Number(a.prob_min || 0);
  const suyas = senales.filter((s) => (!ligas || !ligas.length || ligas.includes(s.grupo)) && s.prob >= pmin);
  if (!suyas.length) return null;
  const estrellas = suyas.filter((s) => s.estrella).sort((x, y) => y.prob - x.prob);
  const top = (estrellas.length ? estrellas : suyas).slice(0, 2).map((s) => `⭐ ${s.texto} (${Math.round(s.prob * 100)}%)`);
  const partidos = new Set(suyas.map((s) => s.partido)).size;
  const t = (estrellas.length ? estrellas : suyas)[0];
  return { titulo: `🎯 ${partidos} partido${partidos === 1 ? "" : "s"} con señal`, cuerpo: top.join("\n") + (partidos > 2 ? `\n…y ${partidos - 2} más` : ""), url: "/#bot",
    img: { k: "senal", n: partidos, sel: t.sel || t.texto.split(" · ")[0], p: t.det || t.partido, prob: t.prob, min: t.min, poly: t.poly } };
}

// ---------------------------------------------------------------- resumen diario
const dinero = (n) => (n < 0 ? "−" : "") + "$" + Math.abs(Math.round(Number(n) || 0)).toLocaleString("es-MX");
const signo = (n) => (Number(n) >= 0 ? "+" : "−") + "$" + Math.abs(Math.round(Number(n) || 0)).toLocaleString("es-MX");
const cuando = (iso) => new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", weekday: "short", hour: "numeric", minute: "2-digit" });
const NOM_JUEGO = { progol: "Progol", media: "Media Semana", protouch: "Protouch" };

export function textoResumen(r, avisos) {
  const inc = { banca: true, dia: true, semana: true, senales: true, sorteos: true, ...(((avisos || {}).resumen || {}).incluir || {}) };
  const h = horaMx();
  const saludo = h < 12 ? "☀️ Buenos días" : h < 19 ? "🌤️ Buenas tardes" : "🌙 Buenas noches";
  const l = [];
  if (inc.banca) l.push(`Banca del bot: ${dinero(r.banca_bot)}` + (r.pendientes ? ` · en juego ${dinero(r.en_juego)} (${r.pendientes} pendiente${r.pendientes === 1 ? "" : "s"})` : " · nada en juego"));
  if (inc.dia) {
    const d = h < 12 ? r.ayer : r.hoy, cual = h < 12 ? "Ayer" : "Hoy";
    l.push(d && d.n ? `${cual}: ${signo(d.g)} en ${d.n} apuesta${d.n === 1 ? "" : "s"}` : `${cual}: sin apuestas cerradas`);
  }
  if (inc.semana && r.semana) l.push(`7 días: ${signo(r.semana.g)} (${r.semana.gan || 0}-${r.semana.per || 0}) · mes ${signo((r.mes || {}).g)}`);
  if (inc.senales && r.senales_hoy) l.push(`${r.senales_hoy} partido${r.senales_hoy === 1 ? "" : "s"} con señal hoy`);
  if (inc.sorteos && r.progol && r.progol.length)
    l.push("Quinielas abiertas: " + r.progol.sort((a, b) => String(a.cierre).localeCompare(String(b.cierre))).map((p) => `${NOM_JUEGO[p.juego] || p.juego} ${p.concurso} (empieza ${cuando(p.cierre)})`).join(", "));
  const d = h < 12 ? r.ayer : r.hoy, nombre = r.nombre ? ", " + String(r.nombre).split(" ")[0] : "";
  const clave = inc.dia && d && d.n ? ` · ${h < 12 ? "ayer" : "hoy"} ${signo(d.g)}` : "";
  const corto = [];
  if (inc.banca) corto.push(`Banca ${dinero(r.banca_bot)}` + (r.pendientes ? ` · en juego ${dinero(r.en_juego)}` : ""));
  if (inc.semana && r.semana) corto.push(`7 días ${signo(r.semana.g)} (${r.semana.gan || 0}-${r.semana.per || 0})`);
  const extra = [];
  if (inc.senales && r.senales_hoy) extra.push(`${r.senales_hoy} con señal`);
  if (inc.sorteos && r.progol && r.progol.length) extra.push(`${r.progol.length} quiniela${r.progol.length === 1 ? "" : "s"} abierta${r.progol.length === 1 ? "" : "s"}`);
  const fecha = new Date().toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", weekday: "short", day: "numeric", month: "short" });
  return { titulo: `${saludo}${nombre}${clave}`, cuerpo: [corto.join(" · "), extra.join(" · ")].filter(Boolean).join("\n") || "Todo tranquilo por hoy.",
    texto: l.join("\n") || "Todo tranquilo por hoy.", url: "/",
    img: { k: "resumen", fecha, dia: inc.dia ? { etiqueta: h < 12 ? "Ayer" : "Hoy", n: (d || {}).n || 0, g: (d || {}).g || 0 } : null,
      banca: inc.banca ? r.banca_bot : null, juego: inc.banca ? r.en_juego : null, pend: r.pendientes,
      semana: inc.semana && r.semana ? { g: r.semana.g, r: `${r.semana.gan || 0}-${r.semana.per || 0}` } : null } };
}

export async function mandarResumenes(hora = horaMx(), dia = null) {
  const d = dia ?? Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", weekday: "short" }).format(new Date()).replace(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/, (x) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(x)));
  const quienes = await notif("resumen_quienes", { hora, dia: d });
  let n = 0;
  for (const q of quienes) {
    const r = await notif("resumen", { usuario: q.usuario });
    const m = textoResumen(r, q.avisos);
    const x = await notificar({ tipo: "resumen", usuarios: [q.usuario], para: () => m, url: m.url, telegram: true, ignorarSilencio: true });
    n += x.enviados + x.porTg;
  }
  return { usuarios: quienes.length, mensajes: n };
}
