// Busca el logo del equipo (y de la liga) que menciona una apuesta, usando la fuente pública de ESPN.
// Gratis y sin clave. Si ESPN no responde, devuelve null y la apuesta se guarda igual, sin logo.

const LIGAS = {
  "football/nfl": "NFL", "basketball/nba": "NBA", "baseball/mlb": "MLB",
  "soccer/mex.1": "Liga MX", "soccer/eng.1": "Premier", "soccer/esp.1": "LaLiga", "soccer/ita.1": "Serie A",
  "soccer/ger.1": "Bundesliga", "soccer/fra.1": "Ligue 1", "soccer/uefa.champions": "Champions",
  "soccer/uefa.europa": "Europa League",
};
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
    abrev: (t.abbreviation || "").toLowerCase(),
    logo: t.logos?.[0]?.href || null,
    claves: [t.displayName, t.shortDisplayName, t.name, t.location, t.nickname].filter(Boolean),
  }));
  const valor = { t: Date.now(), equipos, ligaLogo: sb?.leagues?.[0]?.logos?.[0]?.href || null };
  if (equipos.length) cache.set(ruta, valor);
  return valor;
}

// 0..1: qué tan seguro es que el texto menciona a este equipo
function menciona(toks, e) {
  let mejor = 0;
  if (e.abrev.length >= 3 && toks.has(e.abrev)) mejor = 0.85;
  for (const k of e.claves) {
    const pk = palabras(k).filter((w) => w.length >= 3);
    if (!pk.length) continue;
    if (pk.every((w) => toks.has(w))) mejor = Math.max(mejor, pk.length > 1 ? 1 : 0.9);
    else if (pk.some((w) => w.length >= 5 && toks.has(w))) mejor = Math.max(mejor, 0.8);
  }
  return mejor;
}

export async function buscarLogo(texto) {
  const toks = new Set(palabras(texto));
  if (!toks.size) return null;
  const ligas = await Promise.all(Object.keys(LIGAS).map(async (ruta) => ({ ruta, ...(await liga(ruta)) })));
  let mejor = null, puntos = 0, empate = false;
  for (const l of ligas) {
    for (const e of l.equipos) {
      const p = menciona(toks, e);
      if (p > puntos) { mejor = { logo: e.logo, liga: LIGAS[l.ruta], liga_logo: l.ligaLogo }; puntos = p; empate = false; }
      else if (p === puntos && p > 0 && mejor && mejor.logo !== e.logo) empate = true;
    }
  }
  // Si dos equipos empatan (p. ej. "Atlético") mejor no adivinar
  return puntos >= 0.8 && !empate && mejor?.logo ? mejor : null;
}
