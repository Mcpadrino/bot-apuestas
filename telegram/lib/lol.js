// 🐉 LoL (lógica compartida): calendario y resultados del Mundial (API pública de LoL Esports), quién está en vivo y un Elo sencillo
// con los resultados de Worlds y las ligas grandes. No gasta créditos de cuotas.

const KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z";          // llave pública que usa la página lolesports.com
const BASE = "https://esports-api.lolesports.com/persisted/gw/";
const WORLDS = "98767975604431411";
// Para el Elo: Worlds, MSI, First Stand, LCK, LPL, LEC, LCS, LTA Sur, LCP, CBLOL
const LIGAS_ELO = [WORLDS, "98767991325878492", "113464388705111224", "98767991310872058", "98767991314006698",
  "98767991302996019", "98767991299243165", "113475181634818701", "113476371197627891", "98767991332355509"];

async function get(path, ms = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(BASE + path, { headers: { "x-api-key": KEY }, signal: ctl.signal });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}
const https = (u) => (u ? String(u).replace(/^http:\/\//, "https://") : null);

let cache = { t: 0, datos: null };

async function eloHistorico() {
  // varias páginas hacia atrás de las ligas grandes (cada página trae ~80 series)
  const eventos = [];
  let pag = await get(`getSchedule?hl=es-MX&leagueId=${LIGAS_ELO.join(",")}`);
  for (let i = 0; i < 6 && pag; i++) {
    const s = pag.data?.schedule;
    eventos.push(...(s?.events || []));
    if (!s?.pages?.older) break;
    pag = await get(`getSchedule?hl=es-MX&leagueId=${LIGAS_ELO.join(",")}&pageToken=${encodeURIComponent(s.pages.older)}`);
  }
  const vistos = new Set();
  const jugados = eventos.filter((e) => e.state === "completed" && e.match?.teams?.length === 2 && !vistos.has(e.match.id) && vistos.add(e.match.id))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const r = new Map(), elo = (c) => r.get(c) ?? 1500;
  for (const e of jugados) {
    const [a, b] = e.match.teams;
    if (!a.code || !b.code || a.code === "TBD" || b.code === "TBD") continue;
    const esp = 1 / (1 + 10 ** ((elo(b.code) - elo(a.code)) / 400));
    const real = a.result?.outcome === "win" ? 1 : b.result?.outcome === "win" ? 0 : null;
    if (real === null) continue;
    const k = e.league?.slug === "worlds" || e.league?.slug === "msi" ? 40 : 28;      // los internacionales pesan más
    r.set(a.code, elo(a.code) + k * (real - esp));
    r.set(b.code, elo(b.code) - k * (real - esp));
  }
  return { r, n: jugados.length };
}

export async function datosLol() {
  if (!cache.datos || Date.now() - cache.t > 60000) {
    const [sch, live, hist] = await Promise.all([get(`getSchedule?hl=es-MX&leagueId=${WORLDS}`), get("getLive?hl=es-MX"), eloHistorico()]);
    const desde = Date.now() - 45 * 864e5;
    const eventos = (sch?.data?.schedule?.events || []).filter((e) => e.type === "match" && Date.parse(e.startTime) > desde).map((e) => {
      const [a, b] = e.match?.teams || [];
      const lado = (t) => t && { nombre: t.name, code: t.code, logo: https(t.image), gana: t.result?.outcome === "win",
                                   juegos: t.result?.gameWins ?? null, record: t.record ? `${t.record.wins}-${t.record.losses}` : "" };
      let prob = null;
      if (a && b && a.code !== "TBD" && b.code !== "TBD" && hist.r.has(a.code) && hist.r.has(b.code))
        prob = 1 / (1 + 10 ** ((hist.r.get(b.code) - hist.r.get(a.code)) / 400));
      return { id: e.match?.id, inicio: e.startTime, estado: e.state, fase: e.blockName || "", bo: e.match?.strategy?.count || 1,
               a: lado(a), b: lado(b), prob_a: prob == null ? null : Math.round(prob * 1000) / 1000,
               elo_a: a && hist.r.has(a.code) ? Math.round(hist.r.get(a.code)) : null, elo_b: b && hist.r.has(b.code) ? Math.round(hist.r.get(b.code)) : null };
    });
    const enVivo = (live?.data?.schedule?.events || []).map((e) => ({
      liga: e.league?.name, id: e.match?.id, equipos: (e.match?.teams || []).map((t) => ({ code: t.code, logo: https(t.image), juegos: t.result?.gameWins ?? 0 })),
      streams: (e.streams || []).filter((s) => ["youtube", "twitch"].includes(s.provider))
        .map((s) => ({ provider: s.provider, parametro: s.parameter, idioma: s.locale || "", nombre: s.mediaLocale?.englishName || s.locale || "" })),
    }));
    cache = { t: Date.now(), datos: { eventos, enVivo, series_elo: hist.n } };
  }
  return cache.datos;
}
