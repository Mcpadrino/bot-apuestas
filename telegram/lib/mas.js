// Quiniela, retos 1 vs 1, modo práctica, equipo favorito y movimiento de líneas (función "mas" de la base).
const env = (k) => (process.env[k] || "").replace(/\s/g, "");
export const WEB_URL = env("WEB_URL") || "https://bot-apuestas-telegram.vercel.app";

export async function mas(accion, datos = {}) {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/mas`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: env("SUPABASE_KEY"), authorization: `Bearer ${env("SUPABASE_KEY")}` },
    body: JSON.stringify({ p_clave: env("BOT_CLAVE"), p_accion: accion, p_datos: datos }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || "error de base de datos");
  return j;
}

export async function tg(method, body) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${env("TELEGRAM_TOKEN")}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) { console.error("tg", e); return {}; }
}

const limpio = (t) => String(t || "").replace(/[_*\x60[\]]/g, "");
const hora = (iso) => new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", weekday: "short", day: "numeric",
  hour: "numeric", minute: "2-digit" });

export function textoReto(r) {
  const yo = r.lado === "local" ? r.local : r.visita, otro = r.lado === "local" ? r.visita : r.local;
  return `⚔️ *${limpio(r.retador_nombre || "Un amigo")}* te reta\n\n*${limpio(r.visita)}* vs *${limpio(r.local)}*\n🕒 ${hora(r.inicio)}\n\n` +
    `Él va con *${limpio(yo)}*; tú irías con *${limpio(otro)}*.` + (r.premio ? `\n🎁 El que pierda: ${limpio(r.premio)}` : "") +
    `\n\n_Sin dinero de por medio, solo por el orgullo._`;
}

export const botonesReto = (id) => ({ inline_keyboard: [[
  { text: "✅ Acepto", callback_data: `r:${id}:si` }, { text: "🙅 Paso", callback_data: `r:${id}:no` }]] });

// El rival respondió (desde Telegram o desde la página): avisar al que retó
export async function avisarRespuesta(r) {
  if (!r) return;
  const acepto = r.estado === "aceptado";
  await tg("sendMessage", { chat_id: r.retador, parse_mode: "Markdown", disable_web_page_preview: true,
    text: `${acepto ? "🔥" : "🙅"} *${limpio(r.rival_nombre || "Tu amigo")}* ${acepto ? "aceptó" : "no aceptó"} tu reto ` +
      `(${limpio(r.visita)} vs ${limpio(r.local)}).${acepto ? "\nTe aviso quién ganó cuando termine." : ""}\n${WEB_URL}/#retos` });
}

// ---------------------------------------------------------------- las señales del último escaneo (sin gastar créditos)
// Monto sugerido igual que el escáner: Kelly fraccional 0.25, tope 2.5 % de la banca, mínimo $2.
export function montoSugerido(p, cuota, banca) {
  if (!(p * cuota - 1 > 0)) return 0;
  const kelly = (p * cuota - 1) / (cuota - 1);
  return Math.max(Math.round(Math.min(kelly * 0.25, 0.025) * banca), 2);
}
const amer = (d) => (d >= 2 ? "+" + Math.round((d - 1) * 100) : "-" + Math.round(100 / (d - 1)));
const EMO = (d) => (/nfl/.test(d) ? "🏈" : /nba/.test(d) ? "🏀" : /mlb/.test(d) ? "⚾" : "⚽");
const TIT = { h2h: "Ganador", totals: "Total", spreads: "Hándicap" };

// Agrupa las señales vigentes por partido: [{evento, partido, deporte, inicio, mercados: {h2h: [...]}}]
export function agruparSenales(lineas, horas = 36) {
  const ahora = Date.now(), fin = ahora + horas * 3600e3;
  const ultimo = Math.max(0, ...lineas.map((l) => Date.parse((l.serie || []).slice(-1)[0]?.[0] || 0)));
  const partidos = new Map();
  for (const l of lineas) {
    const t = Date.parse(l.inicio), visto = Date.parse((l.serie || []).slice(-1)[0]?.[0] || 0);
    // solo lo del último escaneo (con 3 h de margen) y partidos que no han empezado
    if (!(t > ahora && t < fin && visto > ultimo - 3 * 3600e3 && Number(l.minima) > 1)) continue;
    const p = partidos.get(l.evento) || { evento: l.evento, partido: l.partido, deporte: l.deporte, inicio: l.inicio, mercados: {} };
    const prob = Number(l.serie.slice(-1)[0][1]);
    const s = l.serie.length > 1 ? prob - Number(l.serie[l.serie.length - 2][1]) : 0;
    (p.mercados[l.mercado] ||= []).push({ id: l.id, seleccion: l.seleccion, prob, minima: Number(l.minima), mov: s });
    partidos.set(l.evento, p);
  }
  return [...partidos.values()].sort((a, b) => a.inicio.localeCompare(b.inicio));
}

// Mensajes de Telegram (en partes de < 3500 caracteres) con las señales vigentes
export function textoSenales(lineas, banca) {
  const partidos = agruparSenales(lineas);
  if (!partidos.length) return [];
  const partes = [];
  let actual = [`🎯 *SEÑALES VIGENTES* · banca $${Math.round(banca)}`, "⭐ = lo más probable · % = probabilidad real",
    "_Apuesta solo si tu casa paga IGUAL o MEJOR._"].join("\n");
  for (const p of partidos) {
    const h = new Date(p.inicio).toLocaleString("es-MX", { timeZone: "America/Mexico_City", weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    let b = `\n\n━━━━━━━━━━━━\n${EMO(p.deporte)} *${limpio(p.partido)}*\n🕒 ${h}`;
    for (const mk of ["h2h", "totals", "spreads"]) {
      const filas = p.mercados[mk];
      if (!filas) continue;
      const mejor = Math.max(...filas.map((f) => f.prob));
      b += `\n_${TIT[mk]}_`;
      for (const f of filas.sort((x, y) => y.prob - x.prob)) {
        const rayo = Math.abs(f.mov) >= 0.02 ? " ⚡" : "";
        b += `\n${f.prob === mejor && filas.length > 1 ? "⭐" : "▫️"} ${limpio(f.seleccion)} · ${(f.prob * 100).toFixed(1)}%${rayo}` +
          `\n      paga ${amer(f.minima)} o mejor → $${montoSugerido(f.prob, f.minima, banca)}`;
      }
    }
    if ((actual + b).length > 3500) { partes.push(actual); actual = b.trimStart(); } else actual += b;
  }
  partes.push(actual);
  return partes;
}

// Botones "Lo aposté" (uno por partido) para las señales vigentes
export function botonesSenales(lineas) {
  return agruparSenales(lineas).slice(0, 20).map((p) => {
    const id = Object.values(p.mercados)[0][0].id;
    return [{ text: `${EMO(p.deporte)} ${p.partido}`.slice(0, 60), callback_data: `p:${id}` }];
  });
}

// ---------------------------------------------------------------- ¿Conviene? (momios de las casas, votos y análisis)
export async function conv(accion, datos = {}) {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/conviene`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: env("SUPABASE_KEY"), authorization: `Bearer ${env("SUPABASE_KEY")}` },
    body: JSON.stringify({ p_clave: env("BOT_CLAVE"), p_accion: accion, p_datos: datos }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || "error de base de datos");
  return j;
}

// Alguien encontró un momio con valor: avisar a los demás (una sola vez por selección, casa y momio)
export async function avisarValor(usuarios, autor, d, r) {
  const pct = (r.ventaja * 100).toFixed(1);
  const texto = `💡 *${limpio(r.nombre || "Un amigo")}* vio *${limpio(d.seleccion)}* a *${amer(d.cuota)}* en ${limpio(d.casa)}\n` +
    `${limpio(r.partido)}\n✅ Conviene: ${pct}% de ventaja (mínimo del bot ${amer(Number(r.minima))})\n${WEB_URL}/#conviene`;
  await Promise.all(usuarios.filter((u) => String(u.chat_id) !== String(autor)).map(async (u) => {
    const nuevo = await mas("aviso", { usuario: String(u.chat_id), clave: `val:${d.evento}|${d.mercado}|${d.seleccion}|${d.casa}|${d.cuota}` });
    if (nuevo) await tg("sendMessage", { chat_id: u.chat_id, parse_mode: "Markdown", disable_web_page_preview: true, text: texto });
  }));
}

// ---------------------------------------------------------------- Checador: "el casino me ofrece esto, ¿conviene?"
const normal = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\b(over|alta|altas)\b/g, "mas").replace(/\b(under|baja|bajas)\b/g, "menos").replace(/\bdraw\b/g, "empate");
const IGNORAR = new Set(["de", "del", "la", "el", "los", "las", "a", "en", "vs", "@", "gana", "ganador", "me", "dan", "paga", "pagan",
  "caliente", "draftea", "conviene", "checa", "checar", "vale", "la", "pena", "si", "o", "no", "y", "fc", "cf", "club"]);
function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return 1 - d[b.length] / Math.max(a.length, b.length);
}
// Saca el momio del texto: -250, +120 o 2.10 (decimal). Devuelve [cuotaDecimal, textoSinMomio]
export function sacarMomio(texto) {
  const t = String(texto || "");
  let m = t.match(/(^|\s)([+-]\d{3,4})(?=\s|$|\?)/);
  if (m) { const n = Number(m[2]); return [n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n), t.replace(m[2], " ")]; }
  m = t.match(/(^|\s)(\d{1,2}[.,]\d{1,3})(?=\s|$|\?)/g);
  if (m) {
    // si hay varios números decimales, el momio es el último (el primero puede ser la línea: "mas 2.5 1.90")
    const ult = m[m.length - 1].trim(), n = Number(ult.replace(",", "."));
    if (n > 1 && n < 50 && !(m.length === 1 && /\b(mas|menos|over|under|alta|baja|[+-])\s*$/i.test(t.slice(0, t.lastIndexOf(ult)))))
      return [n, t.slice(0, t.lastIndexOf(ult)) + " " + t.slice(t.lastIndexOf(ult) + ult.length)];
  }
  return [null, t];
}
export function casaDe(texto) {
  const t = normal(texto);
  return /caliente/.test(t) ? "Caliente" : /draftea/.test(t) ? "Draftea" : null;
}
// Las señales vigentes que más se parecen a lo que escribió el usuario
export function buscarSenal(lineas, texto) {
  const toks = normal(texto).split(/[^a-z0-9.+-]+/).filter((w) => w && !IGNORAR.has(w));
  if (!toks.length) return [];
  const ahora = Date.now();
  const cands = [];
  for (const l of lineas) {
    if (!(Date.parse(l.inicio) > ahora && Number(l.minima) > 1)) continue;
    const sel = normal(l.seleccion), todo = sel + " " + normal(l.partido);
    const pal = todo.split(/[^a-z0-9.+-]+/).filter(Boolean);
    let pts = 0;
    for (const w of toks) {
      if (/^[+-]?\d+(\.\d+)?$/.test(w)) { if (sel.includes(w.replace(/^\+/, ""))) pts += 1.2; continue; }   // la línea (2.5, +3.5)
      let mejor = 0;
      for (const p of pal) mejor = Math.max(mejor, p === w ? 1 : p.startsWith(w) && w.length >= 3 ? 0.9 : w.length >= 4 && p.length >= 4 ? (lev(w, p) >= 0.75 ? 0.8 : 0) : 0);
      // si la palabra está en la selección (no solo en el partido) cuenta más
      if (mejor && sel.split(/\s+/).some((p) => p === w || (p.startsWith(w) && w.length >= 3) || (w.length >= 4 && lev(w, p) >= 0.75))) mejor += 0.5;
      pts += mejor;
    }
    if (pts >= 0.8) cands.push({ ...l, pts, prob: Number(l.serie[l.serie.length - 1][1]) });
  }
  cands.sort((a, b) => b.pts - a.pts || b.prob - a.prob);
  return cands.filter((c) => c.pts >= cands[0]?.pts - 0.3).slice(0, 4);
}
export function veredicto(prob, minima, cuota) {
  const justa = 1 / prob, ventaja = prob * cuota - 1;
  const efect = prob >= 0.6 ? "alta" : prob >= 0.4 ? "media" : "baja";
  let nivel, titulo, detalle;
  if (ventaja >= 0.03) {
    nivel = "barata"; titulo = "🟢 BARATA · MÉTELE";
    detalle = `Te pagan ${amer(cuota)} y lo justo es ${amer(justa)}: cobras ${(ventaja * 100).toFixed(1)}% de más.`;
  } else if (ventaja >= 0) {
    nivel = "justa"; titulo = "🟡 PRECIO JUSTO · MEJOR NO";
    detalle = `Te pagan casi lo justo (${amer(justa)}). Sin ventaja, a la larga no ganas.`;
  } else {
    nivel = "cara"; titulo = "🔴 CARA · NO LA METAS";
    detalle = (prob >= 0.6 ? `Tiene buena efectividad (${(prob * 100).toFixed(0)}%) pero te pagan de menos: ` : "Te pagan de menos: ") +
      `lo justo es ${amer(justa)} y te dan ${amer(cuota)} (${(ventaja * 100).toFixed(1)}%).`;
  }
  return { nivel, titulo, detalle, ventaja, efectividad: efect, justa, minima, necesitas: `Métele solo si te dan ${amer(minima)} o mejor.` };
}
