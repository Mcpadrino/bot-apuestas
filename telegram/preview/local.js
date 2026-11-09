/* Included ONLY by scripts/build-preview.mjs. The production HTML never loads this file. */
(() => {
  const key = 'bitacora-preview-v1';
  const stadium = { tipo: 'galeria', foto: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=1600&q=80', nombre: 'Estadio ilustrativo', credito: 'Unsplash · foto de ejemplo' };
  const teams = [
    { id: '227', nombre: 'América', color: '#f5ce42', color2: '#17264c' },
    { id: '219', nombre: 'Guadalajara', color: '#c52635', color2: '#ffffff' },
    { id: '218', nombre: 'Cruz Azul', color: '#1558b0', color2: '#ffffff' },
    { id: '233', nombre: 'Tigres', color: '#f2bc24', color2: '#204d91' }
  ].map(t => ({ ...t, k: `soccer/mex.1:${t.id}`, ruta: 'soccer/mex.1', liga: 'Liga MX · ejemplo', intensidad: 'poco', logo: `https://a.espncdn.com/i/teamlogos/soccer/500/${t.id}.png` }));
  const initial = {
    team: teams[0], theme: { preset: 'propio', modo: 'oscuro', fondo: stadium, fuerza: 55, letra: 'normal', esquinas: 'redondas', favs: ['inicio', 'juegos', 'diseno'] },
    pet: { saldo: 120, ganado_apuestas: 0, premios_hoy: 0, horas_sin_comer: 2,
      mascota: { nombre: 'Momio', especie: 'perro', especie_elegida: true, items: [], puestos: [] },
      catalogo: { comida: { e: '🍗', n: 'Comida', p: 5, tipo: 'comida' } } }, scores: {}
  };
  let state = structuredClone(initial);
  try { const saved = JSON.parse(localStorage.getItem(key)); if (saved) state = { ...state, ...saved }; } catch (_) {}
  const save = () => { try { localStorage.setItem(key, JSON.stringify(state)); } catch (_) {} };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const unavailable = () => json({ error: 'Esta acción necesita datos reales. En esta vista previa no se envía ni se guarda nada en una cuenta.' }, 503);
  const date = new Date(Date.now() + 86400000).toISOString();
  const match = () => ({ id: 'preview-match', ruta: 'soccer/mex.1', liga: 'Liga MX · ejemplo', estado: 'pre', inicio: date, detalle: 'Partido ilustrativo',
    local: { nombre: state.team?.nombre || 'América', logo: state.team?.logo || teams[0].logo }, visita: { nombre: 'Guadalajara', logo: teams[1].logo } });
  function web(op, d = {}) {
    switch (op) {
      case 'todas': return json({ nombre: 'Visitante', banca: 200, limite: 0, apuestas: [] });
      case 'movimientos': return json({ neto: 0, libre: { depositado: 0, retirado: 0 }, lista: [] });
      case 'perfil': return json({ nombre: 'Visitante', equipo_fav: state.team, tema: state.theme });
      case 'yo': return json({ nombre: 'Visitante', dueno: false, momio: 'americano' });
      case 'tema': state.theme = d.tema; save(); return json({ ok: true });
      case 'fav': state.team = teams.find(t => t.k === d.k) || null; save(); return json({ equipo_fav: state.team });
      case 'sugerir': return json(teams.filter(t => t.nombre.toLowerCase().includes((d.texto || '').toLowerCase())));
      case 'ligas_juego': return json([{ ruta: 'soccer/mex.1', nombre: 'Liga MX · ejemplo' }]);
      case 'equipos_quiz': return json(teams);
      case 'senales': case 'feed': return json([]);
      case 'uso': case 'momio_set': return json({ ok: true });
      case 'jugar': {
        const p = state.pet;
        if (d.accion === 'logros') return json({ tengo: {}, nuevos: [], premios: {} });
        if (d.accion === 'ranking') return json({ mascotas: [], juegos: Object.entries(state.scores).map(([juego, mejor]) => ({ juego, mejor, nombre: 'Visitante', yo: true })) });
        if (d.accion === 'general') return json([]);
        if (d.accion === 'premio') {
          const points = Math.max(0, Math.min(10, Number(d.puntos) || 0));
          const won = Math.min(60 - p.premios_hoy, points);
          p.saldo += won; p.premios_hoy += won;
          state.scores[d.juego] = Math.max(state.scores[d.juego] || 0, points); save();
          return json({ ganaste: won, saldo: p.saldo, tope: p.premios_hoy >= 60 });
        }
        if (d.accion === 'nombre') p.mascota.nombre = String(d.nombre || 'Momio').slice(0, 40);
        else if (d.accion === 'comprar' && d.item === 'comida' && p.saldo >= 5) { p.saldo -= 5; p.horas_sin_comer = 0; }
        else if (d.accion !== 'estado') return unavailable();
        save(); return json(p);
      }
      default: return unavailable();
    }
  }
  // Fail closed: never forward any fetch, including unknown mutations, to the network.
  window.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.origin !== location.origin) return unavailable();
    if (url.pathname === '/api/web') {
      let body;
      try { body = JSON.parse(init.body || (input instanceof Request ? await input.text() : '{}')); } catch (_) { return unavailable(); }
      return web(body.op, body.datos);
    }
    if (url.pathname === '/api/hoy') return json({ partidos: [match()] });
    if (url.pathname === '/api/lol') return json({ eventos: [], enVivo: [] });
    if (url.pathname === '/api/deportes') {
      if (url.searchParams.get('op') === 'estadios') return json({ galeria: [stadium], club: stadium });
      if (url.searchParams.get('op') === 'equipo') return json({ ...state.team, proximos: [{ id: 'preview-match', rival: 'Guadalajara', logo: teams[1].logo, local: true, fecha: date, estadio: 'Partido de ejemplo' }], ultimos: [], noticias: [] });
      if (url.searchParams.get('op') === 'partido') return json({ ...match(), noticias: [], estadisticas: [], eventos: [] });
    }
    return unavailable();
  };
})();
