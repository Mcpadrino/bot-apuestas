// 🎱 Históricos oficiales de Melate, Revancha, Revanchita y Melate Retro (Lotería Nacional).
// Se bajan del archivo público y se guardan en caché unas horas, así siempre trae el último sorteo sin que nadie lo actualice.
//   GET /api/melate?juego=melate|revancha|revanchita|retro
// Respuesta: { juego, nombre, n, desde, sorteos: [[concurso, "AAAA-MM-DD", n1..n6, adicional, bolsa], ...] } (del más viejo al más nuevo)
// Solo se mandan los sorteos con el formato actual (Melate y Revancha cambiaron de 39/44/47/51 a 56 números en 2007).

import { notif, notificar } from "../lib/push.js";

const JUEGOS = {
  melate: { nombre: "Melate", arhp: "TQBlAGwAYQB0AGUA" },
  revancha: { nombre: "Revancha", arhp: "UgBlAHYAYQBuAGMAaABhAA==" },
  revanchita: { nombre: "Revanchita", arhp: "UgBlAHYAYQBuAGMAaABpAHQAYQA=" },
  retro: { nombre: "Melate Retro", arhp: "TQBlAGwAYQB0AGUALQBSAGUAdAByAG8A" },
};

async function bajar(arhp) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(`https://www.loterianacional.gob.mx/Home/Historicos?ARHP=${arhp}`,
      { headers: { "user-agent": "Mozilla/5.0 (bitacora-apuestas)" }, signal: ctl.signal });
    if (!r.ok) return null;
    const txt = await r.text();
    return /^\s*NPRODUCTO/i.test(txt) ? txt : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

function leer(csv) {
  const lineas = csv.trim().split(/\r?\n/), cab = lineas[0].split(",").map((x) => x.trim().toUpperCase());
  const iNum = cab.map((c, i) => (/^[RF]\d$/.test(c) ? i : -1)).filter((i) => i >= 0);
  const iCon = cab.indexOf("CONCURSO"), iFec = cab.indexOf("FECHA"), iBol = cab.indexOf("BOLSA");
  const filas = [];
  for (const l of lineas.slice(1)) {
    const c = l.split(",");
    const nums = iNum.slice(0, 6).map((i) => Number(c[i]));
    if (nums.length < 6 || nums.some((x) => !(x > 0))) continue;
    const [d, m, a] = String(c[iFec] || "").split("/");
    filas.push([Number(c[iCon]), `${a}-${m}-${d}`, ...nums.sort((x, y) => x - y),
      iNum.length > 6 ? Number(c[iNum[6]]) || 0 : 0, Number(c[iBol]) || 0]);
  }
  filas.sort((x, y) => x[0] - y[0]);
  // formato actual: el rango de números de los últimos 300 sorteos; empieza donde aparece por primera vez un número de ese rango alto
  const ult = filas.slice(-300), n = Math.max(...ult.map((f) => Math.max(...f.slice(2, 8))));
  const ini = filas.findIndex((f) => Math.max(...f.slice(2, 8)) >= n - 4);
  return { n, sorteos: filas.slice(Math.max(0, ini)) };
}

// ---------------------------------------------------------------- 📒 registro "¿Cómo nos fue?"
// Antes de cada sorteo se guarda la combinación que arma cada teoría (sin apostar nada). Cuando sale el resultado
// oficial se califica. Así se ve, sorteo tras sorteo y sin trampa, si alguna teoría le gana al azar.
const env = (k) => process.env[k] || "";
async function rpc(accion, datos) {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/melate`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: env("SUPABASE_KEY"), authorization: `Bearer ${env("SUPABASE_KEY")}` },
    body: JSON.stringify({ p_clave: env("BOT_CLAVE"), p_accion: accion, p_datos: datos }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || "error de base de datos");
  return j;
}
function rng(sem) { let a = sem >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function azar(n, r) { const s = new Set(); while (s.size < 6) s.add(1 + Math.floor(r() * n)); return [...s].sort((a, b) => a - b); }
const top = (n, val, menor = false) => Array.from({ length: n }, (_, i) => i + 1)
  .sort((a, b) => (menor ? val(a) - val(b) : val(b) - val(a)) || (a - b)).slice(0, 6).sort((a, b) => a - b);
// las mismas teorías que la app (index.html → mlCombo)
function teorias(sorteos, n, concurso) {
  const f = new Array(n + 1).fill(0), ult = new Array(n + 1).fill(-1), rec = new Array(n + 1).fill(0), S = sorteos.length;
  sorteos.forEach((d, i) => { for (let k = 2; k < 8; k++) { f[d[k]]++; ult[d[k]] = i; if (i >= S - 50) rec[d[k]]++; } });
  const rt = rng(7), sumas = []; for (let i = 0; i < 20000; i++) sumas.push(azar(n, rt).reduce((a, b) => a + b, 0));
  sumas.sort((a, b) => a - b); const s1 = sumas[5000], s3 = sumas[15000];
  const ok = (c) => { const pa = c.filter((x) => x % 2 === 0).length, ba = c.filter((x) => x <= n / 2).length, su = c.reduce((a, b) => a + b, 0), co = c.filter((x, i) => i && x - c[i - 1] === 1).length;
    return pa >= 2 && pa <= 4 && ba >= 2 && ba <= 4 && su >= s1 && su <= s3 && co <= 1; };
  const rp = rng(concurso * 31 + 5), ra = rng(concurso * 31 + 9);
  let patron = null; for (let i = 0; i < 400 && !patron; i++) { const c = azar(n, rp); if (ok(c)) patron = c; }
  return {
    calientes: top(n, (x) => f[x]), recientes: top(n, (x) => rec[x] * 1000 + f[x]), frios: top(n, (x) => f[x], true),
    atrasados: top(n, (x) => S - ult[x]), patron: patron || azar(n, rp), azar: azar(n, ra),
  };
}
const NOM_T = { calientes: "calientes", recientes: "tendencia", frios: "fríos", atrasados: "atrasados", patron: "patrón", azar: "al azar" };
async function registrar(juego, nuevos = []) {
  const csv = await bajar(JUEGOS[juego].arhp);
  if (!csv) return false;
  const { n, sorteos } = leer(csv), ultimo = sorteos[sorteos.length - 1];
  // 🔔 ¿salió un sorteo nuevo desde la última revisión? (la primera vez solo se anota, no se avisa)
  try {
    const clave = "melate-" + juego, visto = await notif("marca_get", { clave });
    if (visto !== null && Number(visto) < ultimo[0]) {
      const t = teorias(sorteos.slice(0, -1), n, ultimo[0]), salio = new Set(ultimo.slice(2, 8));
      const mejor = Object.entries(t).map(([k, c]) => [k, c.filter((x) => salio.has(x)).length]).sort((a, b) => b[1] - a[1])[0];
      nuevos.push({ juego, concurso: ultimo[0], nums: ultimo.slice(2, 8), adic: ultimo[8], mejor });
    }
    if (visto === null || Number(visto) < ultimo[0]) await notif("marca_set", { clave, valor: ultimo[0] });
  } catch (e) { console.error("marca melate", e); }
  // 1) calificar con los últimos resultados oficiales
  await rpc("calificar", { sorteos: sorteos.slice(-12).map((d) => ({ juego, concurso: d[0], fecha: d[1], nums: d.slice(2, 8), adicional: d[8] || 0 })) });
  // 2) guardar lo que dice cada teoría para el próximo sorteo
  const sig = ultimo[0] + 1, t = teorias(sorteos, n, sig);
  await rpc("guardar", { filas: Object.entries(t).map(([teoria, combo]) => ({ juego, concurso: sig, teoria, combo })) });
  return true;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const juego = String(q.juego || "melate").toLowerCase();
  if (q.op === "progol") {
    try { res.setHeader("cache-control", "s-maxage=300, stale-while-revalidate=1800"); return res.status(200).json(await rpc("progol_ver", {})); }
    catch (e) { console.error(e); return res.status(500).json({ error: "No se pudo leer el Progol." }); }
  }
  if (q.op === "registro") {
    try {
      const lista = juego === "todos" ? Object.keys(JUEGOS) : JUEGOS[juego] ? [juego] : [];
      if (!lista.length) return res.status(400).json({ error: "Juego no disponible" });
      const nuevos = [];
      await Promise.all(lista.map((jg) => registrar(jg, nuevos).catch((e) => console.error("registro", jg, e))));
      if (nuevos.length) {
        nuevos.sort((a, b) => Object.keys(JUEGOS).indexOf(a.juego) - Object.keys(JUEGOS).indexOf(b.juego));
        const nombres = nuevos.map((x) => JUEGOS[x.juego].nombre);
        const mj = nuevos.find((x) => x.juego === "melate" || x.juego === "retro") || nuevos[0];
        await notificar({ tipo: "melate", telegram: true, tag: "melate", url: "/#melate",
          img: { k: "melate", j: nuevos.slice(0, 3).map((x) => ({ n: `${JUEGOS[x.juego].nombre}${x === nuevos[0] ? " " + x.concurso : ""}`, nums: x.nums, a: x.adic || null })),
            t: `Mejor teoría en ${JUEGOS[mj.juego].nombre}: ${mj.mejor[1]} de 6 (${NOM_T[mj.mejor[0]] || mj.mejor[0]}). Al azar se esperan 0.6.` },
          titulo: `🎱 Ya salió ${nombres.length > 1 ? nombres.slice(0, -1).join(", ") + " y " + nombres.slice(-1) : nombres[0]}`,
          cuerpo: nuevos.map((x) => `${JUEGOS[x.juego].nombre} ${x.concurso}: ${x.nums.join(" · ")}${x.adic ? ` (+${x.adic})` : ""} · mejor teoría: ${x.mejor[1]} de 6 (${NOM_T[x.mejor[0]] || x.mejor[0]})`).join("\n") });
      }
      if (juego === "todos") return res.status(200).json({ ok: true });
      res.setHeader("cache-control", "no-store");
      return res.status(200).json(await rpc("ver", { juego }));
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "No se pudo leer el registro." });
    }
  }
  const j = JUEGOS[juego];
  if (!j) return res.status(400).json({ error: "Juego no disponible" });
  const csv = await bajar(j.arhp);
  if (!csv) return res.status(502).json({ error: "La Lotería Nacional no contestó. Intenta en un rato." });
  const { n, sorteos } = leer(csv);
  res.setHeader("cache-control", "s-maxage=10800, stale-while-revalidate=86400");
  return res.status(200).json({ juego, nombre: j.nombre, n, desde: sorteos[0] ? { concurso: sorteos[0][0], fecha: sorteos[0][1] } : null, sorteos });
}
