// Datos deportivos gratis (ESPN + Wikipedia), sin créditos de cuotas:
//   ?op=partido&ruta=soccer/mex.1&id=401...   ficha del partido (eventos, estadísticas, alineaciones)
//   ?op=tabla&ruta=soccer/mex.1               tabla de posiciones (+ goleadores en fútbol)
//   ?op=equipo&ruta=soccer/mex.1&id=227       página del equipo (próximos, últimos, posición, noticias)
//   ?op=estadios&ruta=...&id=...              foto del estadio del club + galería de estadios famosos

const BASE = "https://site.api.espn.com/apis/site/v2/sports/";
const RUTAS = new Set(["football/nfl", "basketball/nba", "baseball/mlb", "soccer/mex.1", "soccer/eng.1", "soccer/esp.1", "soccer/ita.1",
  "soccer/ger.1", "soccer/fra.1", "soccer/uefa.champions", "soccer/uefa.europa", "soccer/tur.1", "soccer/por.1", "soccer/ned.1",
  "soccer/usa.1", "soccer/bra.1", "soccer/arg.1", "soccer/mex.2", "soccer/uefa.europa.conf"]);

async function json(url, ms = 7000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "bitacora-apuestas/1.0 (github.com/Mcpadrino/bot-apuestas)" } });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}
const logoDe = (t) => t?.logo || t?.logos?.[0]?.href || null;

// ---------------------------------------------------------------- ficha del partido
async function partido(ruta, id) {
  const s = await json(`${BASE}${ruta}/summary?event=${encodeURIComponent(id)}`);
  if (!s) return null;
  const comp = s.header?.competitions?.[0] || {};
  const st = comp.status?.type || {};
  const equipos = (comp.competitors || []).map((c) => ({ id: c.team?.id, lado: c.homeAway, nombre: c.team?.displayName, corto: c.team?.abbreviation,
    logo: logoDe(c.team) || c.team?.logos?.[0]?.href, marcador: c.score ?? null, ganador: !!c.winner, color: c.team?.color ? "#" + c.team.color : null }));
  const futbol = ruta.startsWith("soccer");
  // eventos: goles, tarjetas y cambios (fútbol) o anotaciones (NFL/NBA/MLB)
  const tipos = /goal|card|substitution|penalty|own-goal/i;
  const eventos = futbol
    ? (s.keyEvents || []).filter((e) => tipos.test(e.type?.type || "") || e.scoringPlay).map((e) => ({
        min: e.clock?.displayValue || "", tipo: e.type?.type || "", texto: e.type?.text || "", detalle: e.text || "",
        equipo: e.team?.id || null, gol: !!e.scoringPlay,
        jugador: e.participants?.[0]?.athlete?.displayName || null }))
    : (s.scoringPlays || []).map((e) => ({ min: `${e.period?.number ? (ruta.includes("nfl") ? "Q" : ruta.includes("mlb") ? "E" : "Q") + e.period.number : ""} ${e.clock?.displayValue || ""}`.trim(),
        tipo: e.type?.abbreviation || "", texto: e.type?.text || "", detalle: e.text || "", equipo: e.team?.id || null, gol: true,
        marcador: `${e.awayScore ?? ""}-${e.homeScore ?? ""}` }));
  // estadísticas de cada equipo (las mismas para los dos)
  const bt = s.boxscore?.teams || [];
  const nombres = { possessionPct: "Posesión %", totalShots: "Tiros", shotsOnTarget: "Tiros a puerta", wonCorners: "Córners", foulsCommitted: "Faltas",
    yellowCards: "Amarillas", redCards: "Rojas", offsides: "Fuera de lugar", saves: "Atajadas", accuratePasses: "Pases buenos", passPct: "Precisión de pase",
    firstDowns: "Primeros downs", totalYards: "Yardas totales", netPassingYards: "Yardas por pase", rushingYards: "Yardas por tierra", turnovers: "Pérdidas",
    possessionTime: "Posesión", thirdDownEff: "3ra oportunidad", fieldGoalsMade: "Tiros de campo", fieldGoalPct: "% de campo", threePointFieldGoalPct: "% de triples",
    totalRebounds: "Rebotes", assists: "Asistencias", steals: "Robos", blocks: "Bloqueos", hits: "Hits", errors: "Errores", runs: "Carreras" };
  const stats = [];
  if (bt.length === 2) {
    const mapa = (t) => Object.fromEntries((t.statistics || []).map((x) => [x.name, x.displayValue]));
    const [a, b] = bt.map(mapa), lados = bt.map((t) => t.team?.id);
    for (const [k, n] of Object.entries(nombres)) if (a[k] != null && b[k] != null) stats.push({ nombre: n, valores: { [lados[0]]: a[k], [lados[1]]: b[k] } });
  }
  // alineaciones (fútbol)
  const alineaciones = (s.rosters || []).map((r) => ({
    equipo: r.team?.id, nombre: r.team?.displayName, formacion: r.formation || "",
    titulares: (r.roster || []).filter((p) => p.starter).map((p) => ({ n: p.athlete?.displayName, num: p.jersey, pos: p.position?.abbreviation })),
    suplentes: (r.roster || []).filter((p) => !p.starter && p.subbedIn).map((p) => ({ n: p.athlete?.displayName, num: p.jersey })),
  })).filter((r) => r.titulares.length);
  // líderes (NFL/NBA/MLB)
  const lideres = (s.leaders || []).map((l) => ({ equipo: l.team?.id, cats: (l.leaders || []).slice(0, 3).map((c) => ({
    cat: c.displayName, jugador: c.leaders?.[0]?.athlete?.displayName, valor: c.leaders?.[0]?.displayValue })) }));
  return {
    estado: st.state, detalle: st.shortDetail || st.detail || "", terminado: !!st.completed, equipos, eventos, stats, alineaciones, lideres,
    estadio: s.gameInfo?.venue?.fullName || "", ciudad: s.gameInfo?.venue?.address?.city || "",
  };
}

// ---------------------------------------------------------------- tabla de posiciones (+ goleadores)
async function tabla(ruta) {
  const [s, st] = await Promise.all([json(`https://site.api.espn.com/apis/v2/sports/${ruta}/standings`),
    ruta.startsWith("soccer") ? json(`${BASE}${ruta}/statistics`) : null]);
  const grupos = [];
  const recorrer = (n) => {
    if (n?.standings?.entries?.length) grupos.push({ nombre: n.name || "", filas: n.standings.entries.map((e) => {
      const v = Object.fromEntries((e.stats || []).map((x) => [x.name, x.displayValue]));
      return { id: e.team?.id, nombre: e.team?.displayName, corto: e.team?.abbreviation, logo: logoDe(e.team) || e.team?.logos?.[0]?.href,
        pos: Number(v.rank || v.playoffSeed || 0) || null, pj: v.gamesPlayed, g: v.wins, e: v.ties, p: v.losses, dif: v.pointDifferential || v.differential,
        pts: v.points, pct: v.winPercent, racha: v.streak, nota: e.note?.description || null, color: e.note?.color ? "#" + e.note.color : null };
    }).sort((a, b) => (a.pos || 99) - (b.pos || 99)) });
    (n?.children || []).forEach(recorrer);
  };
  recorrer(s);
  // goleadores / líderes de la liga
  const lideres = [];
  for (const cat of st?.stats || []) {
    const nom = cat.displayName || cat.name;
    if (!/goal|assist/i.test(cat.name || "")) continue;
    lideres.push({ cat: /assist/i.test(cat.name) ? "Asistencias" : "Goleadores", jugadores: (cat.leaders || []).slice(0, 10).map((l) => ({
      n: l.athlete?.displayName, equipo: l.athlete?.team?.displayName || l.team?.displayName || "",
      logo: l.athlete?.team?.logos?.[0]?.href || logoDe(l.team) || null, valor: l.displayValue || l.value })) , nom });
  }
  return { grupos, lideres };
}

// ---------------------------------------------------------------- página del equipo
async function equipo(ruta, id) {
  const [pas, prox, info, notas, tab] = await Promise.all([
    json(`${BASE}${ruta}/teams/${id}/schedule`), json(`${BASE}${ruta}/teams/${id}/schedule?fixture=true`),
    json(`${BASE}${ruta}/teams/${id}`), json(`${BASE}${ruta}/news?team=${id}&lang=es&region=mx&limit=6`), tabla(ruta)]);
  const partidoCorto = (e) => {
    const c = e.competitions?.[0] || {}, yo = (c.competitors || []).find((x) => String(x.id) === String(id)) || {};
    const rival = (c.competitors || []).find((x) => String(x.id) !== String(id)) || {};
    const sc = (x) => (typeof x.score === "object" ? x.score?.displayValue : x.score) ?? null;
    const st = c.status?.type || e.status?.type || {};
    let res = null;
    if (st.completed) { const a = Number(sc(yo)), b = Number(sc(rival)); res = a > b ? "G" : a < b ? "P" : "E"; }
    return { id: e.id, fecha: e.date, local: yo.homeAway === "home", rival: rival.team?.displayName, logo: rival.team?.logos?.[0]?.href || logoDe(rival.team),
             mio: sc(yo), suyo: sc(rival), res, estadio: c.venue?.fullName || "" };
  };
  const ultimos = (pas?.events || []).map(partidoCorto).filter((p) => p.res).slice(-6).reverse();
  const proximos = (prox?.events || []).map(partidoCorto).slice(0, 4);
  let posicion = null;
  for (const g of tab.grupos) { const f = g.filas.find((x) => String(x.id) === String(id)); if (f) { posicion = { ...f, grupo: g.nombre, total: g.filas.length }; break; } }
  const t = info?.team || {};
  return { nombre: t.displayName, logo: logoDe(t) || t.logos?.[0]?.href, color: t.color ? "#" + t.color : null, record: t.record?.items?.[0]?.summary || "",
           ultimos, proximos, posicion,
           noticias: (notas?.articles || []).slice(0, 5).map((a) => ({ titulo: a.headline, link: a.links?.web?.href, imagen: a.images?.[0]?.url || null, fecha: a.published })) };
}

// ---------------------------------------------------------------- estadios (foto real)
const GALERIA = ["Estadio Azteca", "Estadio BBVA", "Estadio Akron", "Estadio Universitario (UANL)", "Santiago Bernabéu Stadium", "Camp Nou",
  "Old Trafford", "Anfield", "Wembley Stadium", "Maracanã Stadium", "La Bombonera", "Allianz Arena", "San Siro", "Signal Iduna Park",
  "Parc des Princes", "SoFi Stadium", "Lambeau Field", "Arrowhead Stadium", "Madison Square Garden", "Yankee Stadium", "Wrigley Field"];
async function wiki(titulos, lang = "en") {
  const u = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=thumbnail&pithumbsize=1600&redirects=1&format=json&origin=*&titles=${encodeURIComponent(titulos.join("|"))}`;
  const j = await json(u, 8000);
  const red = {}; (j?.query?.redirects || []).concat(j?.query?.normalized || []).forEach((r) => { red[r.to] = r.from; });
  return Object.values(j?.query?.pages || {}).filter((p) => p.thumbnail?.source).map((p) => ({
    nombre: p.title, pedido: red[p.title] || p.title, foto: p.thumbnail.source,
    credito: `Foto: Wikimedia Commons · ${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}` }));
}
let cacheGaleria = null;
async function estadios(ruta, id) {
  let club = null;
  if (ruta && id) {
    if (!ruta.startsWith("soccer")) {
      const t = (await json(`${BASE}${ruta}/teams/${id}`))?.team;
      const v = t?.venue || t?.franchise?.venue;
      if (v?.images?.length) club = { nombre: v.fullName, foto: v.images[0].href, interior: v.images[1]?.href || null, credito: "Foto: ESPN" };
      else if (v?.fullName) club = (await wiki([v.fullName]))[0] || null;
    } else {
      // el estadio donde más juega de local esta temporada
      const sc = await json(`${BASE}${ruta}/teams/${id}/schedule`);
      const cuenta = {};
      (sc?.events || []).forEach((e) => { const c = e.competitions?.[0]; const yo = (c?.competitors || []).find((x) => String(x.id) === String(id));
        if (yo?.homeAway === "home" && c.venue?.fullName) cuenta[c.venue.fullName] = (cuenta[c.venue.fullName] || 0) + 1; });
      const nombre = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (nombre) club = (await wiki([nombre]))[0] || (await wiki([nombre], "es"))[0] || { nombre, foto: null };
    }
  }
  if (!cacheGaleria) {
    const g = await wiki(GALERIA);
    cacheGaleria = GALERIA.map((n) => g.find((x) => x.pedido === n || x.nombre === n)).filter(Boolean);
  }
  return { club, galeria: cacheGaleria };
}

export default async function handler(req, res) {
  const q = req.query || {};
  const ruta = String(q.ruta || ""), id = String(q.id || "").replace(/[^0-9]/g, "").slice(0, 15);
  try {
    if (ruta && !RUTAS.has(ruta)) return res.status(400).json({ error: "Liga no disponible" });
    let datos, cache = 300;
    if (q.op === "partido" && ruta && id) { datos = await partido(ruta, id); cache = 30; }
    else if (q.op === "tabla" && ruta) { datos = await tabla(ruta); cache = 1800; }
    else if (q.op === "equipo" && ruta && id) { datos = await equipo(ruta, id); cache = 900; }
    else if (q.op === "estadios") { datos = await estadios(ruta, id); cache = 86400; }
    else return res.status(400).json({ error: "Consulta inválida" });
    if (!datos) return res.status(404).json({ error: "ESPN no contestó. Intenta en un momento." });
    res.setHeader("cache-control", `s-maxage=${cache}, stale-while-revalidate=${cache * 2}`);
    return res.status(200).json(datos);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "No se pudieron leer los datos." });
  }
}
