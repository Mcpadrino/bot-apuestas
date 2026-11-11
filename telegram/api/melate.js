// 🎱 Históricos oficiales de Melate, Revancha, Revanchita y Melate Retro (Lotería Nacional).
// Se bajan del archivo público y se guardan en caché unas horas, así siempre trae el último sorteo sin que nadie lo actualice.
//   GET /api/melate?juego=melate|revancha|revanchita|retro
// Respuesta: { juego, nombre, n, desde, sorteos: [[concurso, "AAAA-MM-DD", n1..n6, adicional, bolsa], ...] } (del más viejo al más nuevo)
// Solo se mandan los sorteos con el formato actual (Melate y Revancha cambiaron de 39/44/47/51 a 56 números en 2007).

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

export default async function handler(req, res) {
  const juego = String((req.query || {}).juego || "melate").toLowerCase();
  const j = JUEGOS[juego];
  if (!j) return res.status(400).json({ error: "Juego no disponible" });
  const csv = await bajar(j.arhp);
  if (!csv) return res.status(502).json({ error: "La Lotería Nacional no contestó. Intenta en un rato." });
  const { n, sorteos } = leer(csv);
  res.setHeader("cache-control", "s-maxage=10800, stale-while-revalidate=86400");
  return res.status(200).json({ juego, nombre: j.nombre, n, desde: sorteos[0] ? { concurso: sorteos[0][0], fecha: sorteos[0][1] } : null, sorteos });
}
