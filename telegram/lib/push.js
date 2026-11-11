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

// Manda una notificación a cada celular de los usuarios que la quieren.
//   tipo: uno de TIPOS · titulo/cuerpo/url · usuarios: lista (o null = todos) · excepto: usuario que no la recibe
//   para(usuario, avisos) → {titulo, cuerpo, url} para personalizarla (o null para no mandarle)
//   telegram: true → también por Telegram a quien lo pidió (solo para los tipos que no manda ya otra parte del bot)
export async function notificar({ tipo, titulo, cuerpo, url = "/", tag, usuarios = null, excepto = null, para = null, telegram = false, ignorarSilencio = false, forzar = false }) {
  let enviados = 0, porTg = 0;
  const armar = (u, avisos) => {
    if (excepto && String(u) === String(excepto)) return null;
    if (!ignorarSilencio && enSilencio(avisos)) return null;
    const p = para ? para(u, avisos) : { titulo, cuerpo, url };
    return p && p.titulo ? { url, tag: tag || tipo, ...p } : null;
  };
  try {
    await preparar();
    const subs = await notif("destinos", { usuarios });
    await Promise.all(subs.map(async (s) => {
      if (!forzar && !quiere(s.avisos, tipo, "cel")) return;
      const m = armar(s.usuario, s.avisos);
      if (!m) return;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ t: m.titulo, b: m.cuerpo, u: m.url, tag: m.tag, tipo }), { TTL: 6 * 3600, urgency: tipo === "resultados" ? "high" : "normal" });
        enviados++;
        notif("enviado", { endpoint: s.endpoint }).catch(() => {});
      } catch (e) {
        const gone = e && (e.statusCode === 404 || e.statusCode === 410);
        await notif("fallo", { endpoint: s.endpoint, gone }).catch(() => {});
        if (!gone) console.error("push", e && e.statusCode, e && e.body);
      }
    }));
  } catch (e) { console.error("notificar", e); }
  if (telegram && env("TELEGRAM_TOKEN")) {
    try {
      const gente = await notif("gente", { usuarios });
      await Promise.all(gente.filter((g) => /^-?\d+$/.test(String(g.usuario)) && quiere(g.avisos, tipo, "tg")).map(async (g) => {
        const m = armar(g.usuario, g.avisos);
        if (!m) return;
        const enlace = m.url && m.url.startsWith("/") ? WEB + m.url : m.url;
        await fetch(`https://api.telegram.org/bot${env("TELEGRAM_TOKEN")}/sendMessage`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: g.usuario, disable_web_page_preview: true, text: `${m.titulo}\n${m.texto || m.cuerpo}${enlace ? `\n${enlace}` : ""}` }),
        });
        porTg++;
      }));
    } catch (e) { console.error("notificar tg", e); }
  }
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
  return { titulo: `🎯 ${partidos} partido${partidos === 1 ? "" : "s"} con señal`, cuerpo: top.join("\n") + (partidos > 2 ? `\n…y ${partidos - 2} más` : ""), url: "/#bot" };
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
  return { titulo: `${saludo}${r.nombre ? ", " + String(r.nombre).split(" ")[0] : ""}`, cuerpo: l.join("\n") || "Todo tranquilo por hoy.", url: "/" };
}

export async function mandarResumenes(hora = horaMx(), dia = null) {
  const d = dia ?? Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", weekday: "short" }).format(new Date()).replace(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/, (x) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(x)));
  const quienes = await notif("resumen_quienes", { hora, dia: d });
  let n = 0;
  for (const q of quienes) {
    const r = await notif("resumen", { usuario: q.usuario });
    const m = textoResumen(r, q.avisos);
    const x = await notificar({ tipo: "resumen", usuarios: [q.usuario], titulo: m.titulo, cuerpo: m.cuerpo, url: m.url, telegram: true, ignorarSilencio: true });
    n += x.enviados + x.porTg;
  }
  return { usuarios: quienes.length, mensajes: n };
}
