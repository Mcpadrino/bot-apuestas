// Busca el logo del equipo (y de la liga) que menciona una apuesta, usando la fuente pública de ESPN.
// Gratis y sin clave. Si ESPN no responde, devuelve null y la apuesta se guarda igual, sin logo.

const LIGAS = {
  "football/nfl": "NFL", "basketball/nba": "NBA", "baseball/mlb": "MLB",
  "soccer/mex.1": "Liga MX", "soccer/eng.1": "Premier", "soccer/esp.1": "LaLiga", "soccer/ita.1": "Serie A",
  "soccer/ger.1": "Bundesliga", "soccer/fra.1": "Ligue 1", "soccer/uefa.champions": "Champions",
  "soccer/uefa.europa": "Europa League",
};
// Ligas extra que solo se usan para encontrar escudos (no salen en Hoy ni en noticias)
const EXTRA = {
  "soccer/tur.1": "Süper Lig", "soccer/por.1": "Liga Portugal", "soccer/ned.1": "Eredivisie", "soccer/usa.1": "MLS",
  "soccer/bra.1": "Brasileirão", "soccer/arg.1": "Liga Argentina", "soccer/mex.2": "Liga Expansión",
  "soccer/uefa.europa.conf": "Conference League",
};
const TODAS = { ...LIGAS, ...EXTRA };
export const PRINCIPALES = Object.keys(LIGAS);
const RUTAS = Object.keys(TODAS);
const BASE = "https://site.api.espn.com/apis/site/v2/sports/";
const VACIAS = new Set(["fc", "cf", "club", "de", "the", "afc", "sc", "ac", "cd", "ud", "sd", "ca", "cp", "fk", "sk",
  "ssc", "as", "us", "rc", "rcd", "vfb", "vfl", "tsg", "sv", "bv", "y", "and", "del", "la", "el", "los", "las",
  "ganador", "gana", "mas", "menos", "parlay", "libre", "empate", "linea"]);

const cache = new Map();   // ruta -> {t, equipos, ligaLogo}
const DOCE_HORAS = 12 * 3600 * 1000;

const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ");
const palabras = (t) => norm(t).split(/\s+/).filter((w) => w && !VACIAS.has(w));

async function json(url, ms = 2500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "bitacora-apuestas" } });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

async function liga(ruta) {
  const c = cache.get(ruta);
  if (c && Date.now() - c.t < DOCE_HORAS) return c;
  const [eq, sb] = await Promise.all([json(`${BASE}${ruta}/teams?limit=200`), json(`${BASE}${ruta}/scoreboard`)]);
  const equipos = (eq?.sports?.[0]?.leagues?.[0]?.teams || []).map(({ team: t }) => ({
    id: String(t.id || ""), nombre: t.displayName || t.shortDisplayName || "",
    abrev: (t.abbreviation || "").toLowerCase(),
    logo: t.logos?.[0]?.href || null,
    color: t.color ? `#${t.color}` : null, color2: t.alternateColor ? `#${t.alternateColor}` : null,
    claves: [t.displayName, t.shortDisplayName, t.name, t.location, t.nickname].filter(Boolean),
  }));
  const valor = { t: Date.now(), equipos, ligaLogo: sb?.leagues?.[0]?.logos?.[0]?.href || null };
  if (equipos.length) cache.set(ruta, valor);
  return valor;
}

// Parecido entre dos palabras (0..1) tolerando errores de dedo: letras cambiadas, de más o de menos.
function parecido(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 0;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return 1 - d[m][n] / Math.max(m, n);
}

// 0..1: qué tan seguro es que el texto menciona a este equipo
function menciona(toks, e) {
  let mejor = 0;
  if (e.abrev.length >= 3 && toks.has(e.abrev)) mejor = 0.85;
  for (const k of e.claves) {
    const pk = palabras(k).filter((w) => w.length >= 3);
    if (!pk.length) continue;
    const casi = (w) => toks.has(w) || (w.length >= 5 && [...toks].some((t) => t.length >= 4 && parecido(w, t) >= 0.8));
    if (pk.every((w) => toks.has(w))) mejor = Math.max(mejor, pk.length > 1 ? 1 : 0.9);
    else if (pk.length > 1 && pk.every(casi)) mejor = Math.max(mejor, 0.95);      // "manchestr city"
    else if (pk.some((w) => w.length >= 5 && toks.has(w))) mejor = Math.max(mejor, 0.8);
    else if (pk.some((w) => w.length >= 6 && [...toks].some((t) => t.length >= 5 && parecido(w, t) >= 0.8)))
      mejor = Math.max(mejor, 0.8);                    // "fenerbache" ≈ "fenerbahce"
  }
  return mejor;
}

export async function buscarLogo(texto) {
  const toks = new Set(palabras(texto));
  if (!toks.size) return null;
  const ligas = await Promise.all(RUTAS.map(async (ruta) => ({ ruta, ...(await liga(ruta)) })));
  let mejor = null, puntos = 0, empate = false;
  for (const l of ligas) {
    for (const e of l.equipos) {
      const p = menciona(toks, e);
      if (p > puntos) { mejor = { logo: e.logo, liga: TODAS[l.ruta], liga_logo: l.ligaLogo }; puntos = p; empate = false; }
      else if (p === puntos && p > 0 && mejor && mejor.logo !== e.logo) empate = true;
    }
  }
  // Si dos equipos empatan (p. ej. "Atlético") mejor no adivinar
  return puntos >= 0.8 && !empate && mejor?.logo ? mejor : null;
}

// Parecido entre dos textos cualesquiera (0..1), sin límite de largo
function similitud(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

// Los clubes que más se parecen a lo que escribió el usuario (para preguntarle cuál es).
export async function sugerencias(texto, maximo = 3) {
  const toks = palabras(texto).filter((t) => t.length >= 3 && !/^\d/.test(t));
  if (!toks.length) return [];
  const q = toks.join(" ");
  const ligas = await Promise.all(RUTAS.map(async (ruta, i) => ({ ruta, i, ...(await liga(ruta)) })));
  const mejores = new Map();             // logo -> candidato (un club puede estar en varias ligas)
  for (const l of ligas) {
    for (const e of l.equipos) {
      let p = 0;
      for (const k of e.claves) {
        const c = palabras(k).join(" ");
        p = Math.max(p, similitud(q, c));
        for (const w of palabras(k)) if (w.length >= 4) for (const t of toks) if (t.length >= 4) p = Math.max(p, similitud(w, t) * 0.95);
      }
      if (p >= 0.6 && e.logo && (!mejores.has(e.logo) || mejores.get(e.logo).p < p))
        mejores.set(e.logo, { p, k: `${l.i}.${e.id}`, nombre: e.nombre, logo: e.logo, liga: TODAS[l.ruta], liga_logo: l.ligaLogo,
                              color: e.color, color2: e.color2, ruta: l.ruta, id: e.id });
    }
  }
  return [...mejores.values()].sort((a, b) => b.p - a.p).slice(0, maximo).map(({ p, ...x }) => x);
}

// El club de una sugerencia ("índiceDeLiga.idDeEquipo")
export async function equipoPorClave(k) {
  const [i, id] = String(k).split(".");
  const ruta = RUTAS[Number(i)];
  if (!ruta) return null;
  const l = await liga(ruta);
  const e = l.equipos.find((x) => x.id === id);
  return e ? { k: String(k), id: e.id, ruta, nombre: e.nombre, logo: e.logo, liga: TODAS[ruta], liga_logo: l.ligaLogo,
               color: e.color, color2: e.color2 } : null;
}

// Futbolistas con 2 o más goles en un partido (de los eventos del partido)
function dobletes(comp) {
  const cuenta = new Map();
  for (const d of comp.details || []) {
    if (!d.scoringPlay || d.ownGoal || d.shootout) continue;
    const a = d.athletesInvolved?.[0];
    if (!a?.displayName) continue;
    const t = (comp.competitors || []).find((c) => c.team?.id === d.team?.id);
    const x = cuenta.get(a.displayName) || { nombre: a.displayName, goles: 0, logo: t?.team?.logo || null };
    x.goles++; cuenta.set(a.displayName, x);
  }
  return [...cuenta.values()].filter((x) => x.goles >= 2);
}

// Partidos de un día (fecha AAAAMMDD) en todas las ligas, con logos y marcador en vivo.
export async function partidosDelDia(fecha) {
  const ligas = await Promise.all(Object.entries(LIGAS).map(async ([ruta, nombre]) => {
    const j = await json(`${BASE}${ruta}/scoreboard?dates=${fecha}&limit=200`, 4000);
    const ligaLogo = j?.leagues?.[0]?.logos?.[0]?.href || null;
    return (j?.events || []).map((ev) => {
      const comp = ev.competitions?.[0] || {};
      const lado = (h) => {
        const c = (comp.competitors || []).find((x) => x.homeAway === h) || {};
        return { id: String(c.team?.id || ""), nombre: c.team?.shortDisplayName || c.team?.displayName || "", logo: c.team?.logo || null,
                 marcador: c.score ?? null, ganador: Boolean(c.winner), record: c.records?.[0]?.summary || "" };
      };
      const st = ev.status?.type || {};
      return {
        id: ev.id, ruta, liga: nombre, ligaLogo, inicio: ev.date,
        estado: st.state || "pre",                 // pre | in | post
        detalle: st.shortDetail || st.detail || "",
        local: lado("home"), visita: lado("away"),
        dobletes: dobletes(comp),
      };
    });
  }));
  return ligas.flat().sort((a, b) => (a.inicio || "").localeCompare(b.inicio || ""));
}

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

// Próximos partidos de una liga (para la quiniela): los de los siguientes `dias` días que no han empezado.
export async function proximos(ruta, dias = 8) {
  const hoy = new Date(), fin = new Date(Date.now() + dias * 864e5);
  const j = await json(`${BASE}${ruta}/scoreboard?dates=${ymd(hoy)}-${ymd(fin)}&limit=200`, 5000);
  const ligaLogo = j?.leagues?.[0]?.logos?.[0]?.href || null;
  return (j?.events || []).map((ev) => {
    const comp = ev.competitions?.[0] || {};
    const lado = (h) => {
      const c = (comp.competitors || []).find((x) => x.homeAway === h) || {};
      return { id: String(c.team?.id || ""), nombre: c.team?.shortDisplayName || c.team?.displayName || "", logo: c.team?.logo || null };
    };
    return { id: ev.id, ruta, liga: TODAS[ruta] || ruta, ligaLogo, inicio: ev.date, estado: ev.status?.type?.state || "pre",
             local: lado("home"), visita: lado("away") };
  }).filter((p) => p.estado === "pre" && Date.parse(p.inicio) > Date.now())
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
}

// Un partido exacto por su id de ESPN (para revisar retos y quiniela)
export async function partido(ruta, id) {
  const j = await json(`${BASE}${ruta}/summary?event=${encodeURIComponent(id)}`, 5000);
  const comp = j?.header?.competitions?.[0];
  if (!comp) return null;
  const lado = (h) => {
    const c = (comp.competitors || []).find((x) => x.homeAway === h) || {};
    return { nombre: c.team?.shortDisplayName || c.team?.displayName || "", marcador: Number(c.score ?? 0), ganador: Boolean(c.winner) };
  };
  return { terminado: Boolean(comp.status?.type?.completed), local: lado("home"), visita: lado("away") };
}

// Las noticias más recientes (en español) de tus ligas. Solo las de las últimas 24 h.
export async function noticias(maximo = 5) {
  const listas = await Promise.all(Object.entries(LIGAS).map(async ([ruta, nombre]) => {
    const j = await json(`${BASE}${ruta}/news?lang=es&region=mx&limit=6`, 4000);
    return (j?.articles || []).map((a) => ({
      titulo: a.headline || "", resumen: a.description || "", publicada: a.published || a.lastModified || "",
      imagen: a.images?.[0]?.url || null, link: a.links?.web?.href || a.links?.mobile?.href || null, liga: nombre,
    }));
  }));
  const hace24 = Date.now() - 24 * 3600 * 1000, vistos = new Set();
  const todas = listas.flat()
    .filter((n) => n.titulo && n.link && /^https:\/\//.test(n.link) && Date.parse(n.publicada) > hace24)
    .filter((n) => !/\b(fantasy|highlights|resumen en video)\b/i.test(n.titulo))
    .sort((a, b) => Date.parse(b.publicada) - Date.parse(a.publicada));
  // Que no salgan 5 de la misma liga: máximo 2 por liga
  const porLiga = {}, salida = [];
  for (const n of todas) {
    if (vistos.has(n.titulo) || (porLiga[n.liga] || 0) >= 2) continue;
    vistos.add(n.titulo); porLiga[n.liga] = (porLiga[n.liga] || 0) + 1; salida.push(n);
    if (salida.length >= maximo) break;
  }
  return salida;
}

// Datos curiosos sacados de los partidos de ayer: goleada, partido con más goles/puntos, dobletes, mejor récord.
export async function datosDelDia(fechaAyer) {
  const partidos = await partidosDelDia(fechaAyer);
  const terminados = partidos.filter((p) => p.estado === "post");
  const datos = [];
  const num = (x) => Number(x) || 0;
  const futbol = terminados.filter((p) => !["NFL", "NBA", "MLB"].includes(p.liga));
  const mas = futbol.sort((a, b) => (num(b.local.marcador) + num(b.visita.marcador)) - (num(a.local.marcador) + num(a.visita.marcador)))[0];
  if (mas && num(mas.local.marcador) + num(mas.visita.marcador) >= 4)
    datos.push({ icono: "🔥", texto: `Lluvia de goles en ${mas.liga}: ${mas.visita.nombre} ${mas.visita.marcador} – ${mas.local.marcador} ${mas.local.nombre}.`,
                 logo: mas.local.logo });
  const gol = terminados.map((p) => ({ p, dif: Math.abs(num(p.local.marcador) - num(p.visita.marcador)) }))
    .filter((x) => !["NBA", "MLB", "NFL"].includes(x.p.liga) && x.dif >= 3).sort((a, b) => b.dif - a.dif)[0];
  if (gol) {
    const g = num(gol.p.local.marcador) > num(gol.p.visita.marcador) ? gol.p.local : gol.p.visita;
    datos.push({ icono: "💥", texto: `Goleada: ${g.nombre} ganó por ${gol.dif} goles en ${gol.p.liga}.`, logo: g.logo });
  }
  for (const p of terminados.filter((x) => x.dobletes?.length).slice(0, 2))
    for (const d of p.dobletes) datos.push({ icono: "⚽", texto: `${d.nombre} marcó ${d.goles} goles (${p.visita.nombre} vs ${p.local.nombre}).`, logo: d.logo });
  const nba = terminados.filter((p) => p.liga === "NBA").sort((a, b) =>
    (num(b.local.marcador) + num(b.visita.marcador)) - (num(a.local.marcador) + num(a.visita.marcador)))[0];
  if (nba) datos.push({ icono: "🏀", texto: `El partido con más puntos de la NBA: ${nba.visita.nombre} ${nba.visita.marcador} – ${nba.local.marcador} ${nba.local.nombre}.`, logo: nba.local.logo });
  const recs = partidos.flatMap((p) => [p.local, p.visita].map((t) => ({ ...t, liga: p.liga })))
    .filter((t) => ["NFL", "NBA"].includes(t.liga) && /^\d+-\d+/.test(t.record || ""))
    .map((t) => { const [w, l] = t.record.split("-").map(Number); return { ...t, w, l }; })
    .filter((t) => t.w + t.l >= 5).sort((a, b) => b.w / (b.w + b.l) - a.w / (a.w + a.l))[0];
  if (recs) datos.push({ icono: "📈", texto: `${recs.nombre} va ${recs.record}: de lo mejor de la ${recs.liga}.`, logo: recs.logo });
  return datos.slice(0, 3);
}
