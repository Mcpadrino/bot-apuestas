// API de la página web. Cada quien entra con su usuario y contraseña (los crea desde el bot
// de Telegram) y solo puede ver y cambiar sus propias apuestas.

import { buscarLogo, sugerencias, equipoPorClave, proximos, PRINCIPALES, equiposDe, LIGAS_JUEGO } from "../lib/espn.js";
import { datosLol } from "../lib/lol.js";
import { opinion, avisarOpinion, avisarAutor, admin, setFormato, torneo } from "../lib/mas.js";
import { notif, notificar, TIPOS, VAPID_PUBLICA, textoResumen } from "../lib/push.js";
import { mas, tg, textoReto, botonesReto, avisarRespuesta, agruparSenales, conv, avisarValor, sacarMomio, buscarSenal, veredicto, guru, jugar } from "../lib/mas.js";

// Ligas para la quiniela, en orden: se usa la primera que tenga partidos en los próximos días
const QUINIELA = ["soccer/mex.1", "soccer/uefa.champions", "soccer/eng.1", "soccer/esp.1"];

const env = (k) => (process.env[k] || "").replace(/\s/g, "");

async function rpc(fn, accion, datos = {}) {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: env("SUPABASE_KEY"),
      authorization: `Bearer ${env("SUPABASE_KEY")}`,
    },
    body: JSON.stringify({ p_clave: env("BOT_CLAVE"), p_accion: accion, p_datos: datos }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || "error de base de datos");
  return j;
}

const WEB_URL = env("WEB_URL") || "https://bot-apuestas-telegram.vercel.app";

// Avisa por Telegram a los demás que alguien publicó en la comunidad (sin bloquear la respuesta si falla).
// Ahora respeta lo que cada quien eligió en Mis avisos (celular, Telegram o los dos) y sus horas de silencio.
async function avisarComunidad(autorChat, autor, texto) {
  try {
    const corto = texto ? `“${texto.slice(0, 120)}${texto.length > 120 ? "…" : ""}”` : "Toca para verlo.";
    await notificar({ tipo: "comunidad", excepto: autorChat, telegram: true, tag: "comunidad",
      titulo: `💬 ${autor || "Alguien"} publicó en la comunidad`, cuerpo: corto, url: "/#comunidad" });
  } catch (e) { console.error("aviso comunidad", e); }
}

const num = (v) => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? null : Number(v));
const txt = (v, max = 120) => String(v ?? "").trim().slice(0, max);

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  setFormato("americano");
  if (req.method !== "POST") return res.status(405).json({ error: "Usa POST" });
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

  try {
    if (b.op === "login") {
      const r = await rpc("web", "login", { nombre_web: txt(b.usuario, 40), pass: String(b.pass ?? "").slice(0, 200) });
      if (!r || !r.token) return res.status(401).json({ error: (r && r.error) || "Usuario o contraseña incorrectos." });
      return res.status(200).json({ token: r.token });
    }
    if (b.op === "registro") {
      // Cuenta solo de página (sin Telegram) con un código de invitación del dueño
      const d = b.datos || {};
      const r = await admin("registro", { codigo: txt(d.codigo, 12), nombre: txt(d.nombre, 40), nombre_web: txt(d.usuario, 40),
        pass: String(d.pass ?? "").slice(0, 200), v: txt(d.v, 20) });
      if (r.error) return res.status(400).json({ error: r.error });
      const l = await rpc("web", "login", { nombre_web: txt(d.usuario, 40), pass: String(d.pass ?? "").slice(0, 200) });
      try {
        await tg("sendMessage", { chat_id: env("TELEGRAM_CHAT_ID"), parse_mode: "Markdown",
          text: `🆕 *${txt(d.nombre, 40).replace(/[_*\x60[\]]/g, "")}* se registró en la página con el código \`${txt(d.codigo, 12).toUpperCase()}\` (cuenta sin Telegram).` });
      } catch (e) { console.error(e); }
      return res.status(200).json({ token: l.token });
    }
    if (b.op === "salir") {
      await rpc("web", "salir", { token: txt(b.token, 100) });
      return res.status(200).json({ ok: true });
    }

    const usuario = await rpc("web", "sesion", { token: txt(b.token, 100) });
    if (!usuario) return res.status(401).json({ error: "Tu sesión venció. Vuelve a iniciar sesión." });

    switch (b.op) {
      case "todas": {
        const r = await rpc("web", "todas", { usuario });
        // Rellenar logos que falten (hasta 5 por carga). Si no se encuentra, se marca con "" para no buscar otra vez.
        const sinLogo = (r.apuestas || []).filter((a) => a.logo === null && a.cartera !== "libre").slice(0, 5);
        await Promise.all(sinLogo.map(async (a) => {
          try {
            const l = (await buscarLogo(`${a.seleccion} ${a.partido || ""}`)) || { logo: "", liga: null, liga_logo: null };
            await rpc("resultados", "logo", { id: a.id, ...l });
            Object.assign(a, { logo: l.logo || "", liga: a.liga || l.liga, liga_logo: a.liga_logo || l.liga_logo });
          } catch (e) { console.error("logo", e); }
        }));
        return res.status(200).json(r);
      }
      case "registrar": {
        const d = b.datos || {};
        const cuota = num(d.cuota), monto = num(d.monto), prob = num(d.prob);
        if (!(cuota > 1) || !(monto > 0) || !txt(d.seleccion))
          return res.status(400).json({ error: "Faltan la selección, el momio o el monto." });
        if (prob !== null && !(prob > 0 && prob < 1)) return res.status(400).json({ error: "El % debe estar entre 0 y 100." });
        const a = await rpc("bot", "registrar", {
          usuario, cartera: d.cartera === "libre" ? "libre" : "bot", partido: txt(d.partido),
          seleccion: txt(d.seleccion), casa: txt(d.casa, 40), cuota, monto, prob,
          ...(typeof d.anticipado === "boolean" ? { anticipado: d.anticipado } : {}),
        });
        try {
          const l = await buscarLogo(`${txt(d.seleccion)} ${txt(d.partido)}`);
          if (l) await rpc("resultados", "logo", { id: a.id, ...l });
        } catch (e) { console.error("logo", e); }
        return res.status(200).json(a);
      }
      case "cerrar": {
        const d = b.datos || {};
        if (!["gana", "pierde", "nula", "pendiente"].includes(d.resultado)) return res.status(400).json({ error: "Resultado inválido" });
        return res.status(200).json(await rpc("bot", "cerrar", { usuario, id: num(d.id), resultado: d.resultado }));
      }
      case "cashout": {
        // apuesta cerrada antes de que termine el partido: se guarda lo que te pagaron
        const d = b.datos || {}, cobro = Number(d.cobro);
        if (!(cobro >= 0 && cobro < 1e7)) return res.status(400).json({ error: "Escribe cuánto te pagaron al cerrarla." });
        return res.status(200).json(await rpc("bot", "cashout", { usuario, id: num(d.id), cobro }));
      }
      case "borrar":
        return res.status(200).json(await rpc("bot", "borrar", { usuario, id: num((b.datos || {}).id) }));
      case "sugerir":
        return res.status(200).json(await sugerencias(txt((b.datos || {}).texto, 200)));
      case "fijar_logo": {
        const d = b.datos || {};
        const e = await equipoPorClave(txt(d.k, 40));
        if (!e) return res.status(404).json({ error: "No encontré ese club." });
        await rpc("resultados", "logo_forzar", { id: num(d.id), usuario, logo: e.logo, liga: e.liga, liga_logo: e.liga_logo });
        return res.status(200).json(e);
      }
      case "feed":
        return res.status(200).json(await rpc("comunidad", "feed", { usuario }));
      case "publicar": {
        const d = b.datos || {};
        const r = await rpc("comunidad", "publicar", { usuario, texto: txt(d.texto, 1000), link: txt(d.link, 500),
          imagen: typeof d.imagen === "string" ? d.imagen : null, horas: num(d.horas) || 48,
          apuesta_id: num(d.apuesta_id) || null, mostrar_monto: d.mostrar_monto === true, historia: d.historia === true, muro: d.muro === true });
        if (r && r.error) return res.status(400).json(r);
        await avisarComunidad(usuario, r.autor, txt(d.texto, 1000) || (d.muro === true ? "🎟️ subió un ticket a su perfil" : num(d.apuesta_id) ? "🎯 subió una apuesta a su historia" : ""));
        return res.status(200).json(r);
      }
      case "reaccionar": {
        const d = b.datos || {};
        if (!["🔥", "👍", "😂"].includes(d.emoji)) return res.status(400).json({ error: "Reacción inválida" });
        return res.status(200).json(await rpc("comunidad", "reaccionar", { usuario, id: num(d.id), emoji: d.emoji }));
      }
      case "bajar": {
        const r = await rpc("comunidad", "bajar", { usuario, id: num((b.datos || {}).id) });
        if (r && r.error) return res.status(400).json(r);
        return res.status(200).json(r);
      }
      // ---------- perfil / equipo favorito
      case "perfil":
        return res.status(200).json(await mas("perfil", { usuario }));
      // ---------- 👤 perfiles públicos (para farolear) y caritas de historias
      case "avatares":
        return res.status(200).json(await rpc("perfiles", "avatares", { usuario }));
      case "perfil_ver":
        return res.status(200).json(await rpc("perfiles", "ver", { usuario, uid: txt((b.datos || {}).uid, 20) }));
      case "perfil_editar": {
        const d = (b.datos || {}).perfil || {};
        const r = await rpc("perfiles", "editar", { usuario, perfil: {
          bio: txt(d.bio, 140), frase: txt(d.frase, 40), emoji: txt(d.emoji, 8) || null, color: txt(d.color, 7) || null, portada: txt(d.portada, 20) || null,
          foto: typeof d.foto === "string" ? d.foto : null, portada_foto: typeof d.portada_foto === "string" ? d.portada_foto : null,
          mostrar_dinero: d.mostrar_dinero === true } });
        if (r && r.error) return res.status(400).json(r);
        return res.status(200).json(r);
      }
      case "fav": {
        const k = txt((b.datos || {}).k, 40);
        if (!k) return res.status(200).json(await mas("fav", { usuario, equipo: null }));
        const e = await equipoPorClave(k);
        if (!e) return res.status(404).json({ error: "No encontré ese club." });
        const intensidad = (b.datos || {}).intensidad === "mucho" ? "mucho" : "poco";
        return res.status(200).json(await mas("fav", { usuario, equipo: { ...e, intensidad } }));
      }
      // ---------- movimiento de líneas
      case "senales":
        return res.status(200).json(agruparSenales(await mas("lineas2", {})));
      // ---------- ¿Conviene? momios de Caliente/Draftea que captura cada quien, votos y análisis
      case "conviene": {
        const [lineas, est] = await Promise.all([mas("lineas2", {}), conv("estado", { usuario })]);
        return res.status(200).json({ partidos: agruparSenales(lineas), ...est });
      }
      case "cotizar": {
        const d = b.datos || {};
        const casa = ["Caliente", "Draftea", "Otra"].includes(d.casa) ? d.casa : null;
        const cuota = d.cuota === null || d.cuota === "" ? null : num(d.cuota);
        if (!casa || (cuota !== null && !(cuota > 1 && cuota < 100))) return res.status(400).json({ error: "Momio inválido." });
        const datos = { usuario, evento: txt(d.evento, 80), mercado: txt(d.mercado, 20), seleccion: txt(d.seleccion), casa,
          cuota: cuota === null ? null : Math.round(cuota * 1000) / 1000 };
        const r = await conv("cotizar", datos);
        if (r && r.error) return res.status(400).json(r);
        if (r && r.ventaja >= 0.03 && r.nuevo_mejor) {
          try { await avisarValor(await rpc("bot", "usuarios"), usuario, datos, r); } catch (e) { console.error("aviso valor", e); }
        }
        return res.status(200).json(r);
      }
      case "votar": {
        const d = b.datos || {};
        if (!["si", "no", ""].includes(d.voto)) return res.status(400).json({ error: "Voto inválido" });
        const r = await conv("votar", { usuario, evento: txt(d.evento, 80), mercado: txt(d.mercado, 20), seleccion: txt(d.seleccion), voto: d.voto });
        return res.status(r && r.error ? 400 : 200).json(r);
      }
      case "checar": {
        // "El casino me ofrece esto": busca la señal y dice si está barata, justa o cara
        const d = b.datos || {};
        try { setFormato((await admin("avisos_get", { usuario }))?.momio); } catch (e) { setFormato("americano"); }
        const [cuota, resto] = sacarMomio(txt(d.texto, 200).replace(/\?/g, " "));
        if (!cuota) return res.status(400).json({ error: "Escribe también el momio, por ejemplo: Ravens -250" });
        const ops = buscarSenal(await mas("lineas2", {}), resto);
        if (!ops.length) return res.status(200).json({ cuota, ops: [] });
        const casa = ["Caliente", "Draftea"].includes(d.casa) ? d.casa : null;
        const salida = ops.map((o) => ({ evento: o.evento, mercado: o.mercado, seleccion: o.seleccion, partido: o.partido, deporte: o.deporte,
          inicio: o.inicio, prob: o.prob, minima: Number(o.minima), pts: o.pts, ...veredicto(o.prob, Number(o.minima), cuota) }));
        const claro = salida.length === 1 || salida[0].pts - salida[1].pts >= 0.3;
        if (claro && casa) {
          const o = salida[0];
          const r = await conv("cotizar", { usuario, evento: o.evento, mercado: o.mercado, seleccion: o.seleccion, casa, cuota: Math.round(cuota * 1000) / 1000 }).catch(() => null);
          if (r && r.ventaja >= 0.03 && r.nuevo_mejor)
            try { await avisarValor(await rpc("bot", "usuarios"), usuario, { ...o, casa, cuota: Math.round(cuota * 1000) / 1000 }, r); } catch (e) { console.error(e); }
        }
        return res.status(200).json({ cuota, casa, claro, ops: claro ? salida.slice(0, 1) : salida });
      }
      // ---------- retiros y depósitos (cambian la banca del bot)
      case "movimientos":
        return res.status(200).json(await mas("movimientos", { usuario }));
      case "mov_crear": {
        const d = b.datos || {};
        const monto = num(d.monto), tipo = d.tipo === "deposito" ? "deposito" : "retiro", cartera = d.cartera === "libre" ? "libre" : "bot";
        if (!(monto > 0)) return res.status(400).json({ error: "Escribe un monto mayor a cero." });
        if (tipo === "retiro" && cartera === "bot") {
          const r0 = await rpc("bot", "resumen", { usuario });
          const disp = Number(r0.banca_inicial) + Number(r0.bot.ganancia) - Number(r0.bot.en_juego);
          if (monto > disp + 0.001) return res.status(400).json({ error: `Solo tienes $${disp.toFixed(2)} disponibles en la banca del bot.` });
        }
        return res.status(200).json(await mas("mov_crear", { usuario, tipo, monto, nota: txt(d.nota, 80), cartera }));
      }
      case "mov_anular":
        return res.status(200).json(await mas("mov_anular", { usuario, id: num((b.datos || {}).id) }));
      // ---------- 🕹️ minijuegos y mascota
      case "jugar": {
        const d = b.datos || {};
        if (!["estado", "comprar", "poner", "nombre", "premio", "ranking", "especie", "logros", "general"].includes(d.accion)) return res.status(400).json({ error: "acción" });
        const r = await jugar(d.accion, { usuario, item: txt(d.item, 20), nombre: txt(d.nombre, 20), juego: txt(d.juego, 20), puntos: Math.round(num(d.puntos) || 0), especie: txt(d.especie, 20) });
        return res.status(r && r.error ? 400 : 200).json(r);
      }
      case "ligas_juego":
        return res.status(200).json(LIGAS_JUEGO);
      case "equipos_quiz": {
        const rutas = (Array.isArray((b.datos || {}).rutas) ? b.datos.rutas : []).slice(0, 19).map((r) => txt(r, 40));
        const listas = await Promise.all(rutas.map(async (r) => (await equiposDe(r)).map((e) => ({ ...e, liga: r }))));
        const vistos = new Set();
        return res.status(200).json(listas.flat().filter((e) => !vistos.has(e.logo) && vistos.add(e.logo)));
      }
      // ---------- 🐉 pick'em del Mundial de LoL
      case "lol_quiniela":
        return res.status(200).json(await mas("lol_quiniela", { usuario }));
      case "lol_pick": {
        const d = b.datos || {};
        if (!["L", "V"].includes(d.pick)) return res.status(400).json({ error: "Pick inválido" });
        const e = (await datosLol()).eventos.find((x) => String(x.id) === String(d.id));
        if (!e || e.estado !== "unstarted" || !e.a || !e.b || e.a.code === "TBD" || e.b.code === "TBD")
          return res.status(400).json({ error: "Esa serie ya empezó o todavía no tiene equipos." });
        const r = await mas("quiniela_pick", { usuario, evento: `lol:${e.id}`, liga: "lol/worlds",
          partido: `${e.a.nombre} vs ${e.b.nombre}`, inicio: e.inicio, pick: d.pick });
        return res.status(r && r.error ? 400 : 200).json(r);
      }
      case "guru": {
        const [lista, precision, duelo, historial, duelo_xg, historial_xg] = await Promise.all([guru("lista"), guru("precision"),
          guru("duelo"), guru("historial", { n: 200 }), guru("duelo", { modelo: "xG" }), guru("historial", { n: 200, modelo: "xG" })]);
        return res.status(200).json({ lista, precision, duelo, historial, duelo_xg, historial_xg });
      }
      case "archivo": {
        // buscador de partidos pasados: marcador, quién ganó, qué dijo el Gurú y Pinnacle
        const d = b.datos || {};
        const txt = (v, n) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 .&'-]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
        const f = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || "")) ? String(v).slice(0, 25) : "");
        const filtro = ["todos", "con", "guru", "pinn", "ninguno"].includes(d.filtro) ? d.filtro : "todos";
        return res.status(200).json(await guru("buscar", { q: txt(d.q, 40), ruta: String(d.ruta || "").replace(/[^a-z0-9/._-]/gi, "").slice(0, 40), deporte: txt(d.deporte, 12),
          desde: f(d.desde), hasta: f(d.hasta), filtro, n: Math.min(Math.max(Number(d.n) || 40, 1), d.exportar ? 2000 : 100),
          desde_n: Math.max(Number(d.desde_n) || 0, 0) }));
      }
      case "analisis":
        return res.status(200).json(await conv("analisis", { dias: 90 }));
      case "lineas":
        return res.status(200).json(await mas("lineas2", {}));
      // ---------- quiniela
      case "quiniela": {
        let partidos = [];
        for (const ruta of QUINIELA) {
          partidos = (await proximos(ruta, 8)).slice(0, 12);
          if (partidos.length >= 3) break;
        }
        return res.status(200).json({ partidos, ...(await mas("quiniela", { usuario })) });
      }
      case "quiniela_pick": {
        const d = b.datos || {};
        if (!["L", "E", "V"].includes(d.pick) || !QUINIELA.includes(d.ruta)) return res.status(400).json({ error: "Pick inválido" });
        const p = (await proximos(d.ruta, 8)).find((x) => String(x.id) === String(d.evento));
        if (!p) return res.status(400).json({ error: "Ese partido ya empezó o no está en la jornada." });
        const r = await mas("quiniela_pick", { usuario, evento: `${p.ruta}:${p.id}`, liga: p.ruta,
          partido: `${p.visita.nombre} vs ${p.local.nombre}`, inicio: p.inicio, pick: d.pick });
        return res.status(r && r.error ? 400 : 200).json(r);
      }
      // ---------- retos 1 vs 1
      case "retos": {
        const [retos, perfil, listas] = await Promise.all([mas("retos", { usuario }), mas("perfil", { usuario }),
          Promise.all(PRINCIPALES.map((r) => proximos(r, 3).catch(() => [])))]);
        const partidos = listas.flat().sort((a, b) => a.inicio.localeCompare(b.inicio)).slice(0, 80);
        return res.status(200).json({ retos, amigos: (perfil && perfil.amigos) || [], partidos });
      }
      case "reto_crear": {
        const d = b.datos || {};
        if (!["local", "visita"].includes(d.lado)) return res.status(400).json({ error: "Elige tu equipo." });
        const p = (await proximos(txt(d.ruta, 40), 8)).find((x) => String(x.id) === String(d.evento));
        if (!p) return res.status(400).json({ error: "Ese partido ya empezó." });
        const datos = { usuario, rival: txt(d.rival, 40), evento: p.id, liga: p.ruta, partido: `${p.visita.nombre} vs ${p.local.nombre}`,
          inicio: p.inicio, local: p.local.nombre, visita: p.visita.nombre, logo_local: p.local.logo, logo_visita: p.visita.logo,
          lado: d.lado, premio: txt(d.premio, 80) };
        const r = await mas("reto_crear", datos);
        if (r && r.error) return res.status(400).json(r);
        await tg("sendMessage", { chat_id: datos.rival, parse_mode: "Markdown", text: textoReto({ ...datos, ...r }),
          reply_markup: botonesReto(r.id) });
        notificar({ tipo: "retos", usuarios: [String(datos.rival)], tag: "reto-" + r.id, url: "/#retos",
          titulo: "⚔️ Te retaron", cuerpo: `${datos.partido}${datos.premio ? " · premio: " + datos.premio : ""}. Acéptalo o recházalo.` }).catch(() => {});
        return res.status(200).json(r);
      }
      case "reto_responder": {
        const d = b.datos || {};
        const r = await mas("reto_responder", { usuario, id: num(d.id), acepta: Boolean(d.acepta) });
        await avisarRespuesta(r);
        return res.status(200).json(r);
      }
      case "reto_cancelar":
        return res.status(200).json(await mas("reto_cancelar", { usuario, id: num((b.datos || {}).id) }));
      // ---------- modo práctica (dinero de mentira)
      case "practica": {
        const [perfil, apuestas, lineas] = await Promise.all([mas("perfil", { usuario }), mas("practica", { usuario }), mas("lineas2", {})]);
        const ahora = Date.now();
        return res.status(200).json({ perfil, apuestas, opciones: lineas.filter((l) => Date.parse(l.inicio) > ahora && Number(l.minima) > 1) });
      }
      case "practica_crear": {
        const d = b.datos || {};
        const senales = Array.isArray(d.senales) ? d.senales.map(Number).filter((x) => x > 0).slice(0, 8) : [];
        const monto = num(d.monto);
        if (!senales.length || !(monto > 0)) return res.status(400).json({ error: "Elige al menos una selección y un monto." });
        const r = await mas("practica_crear", { usuario, senales, monto });
        return res.status(r && r.error ? 400 : 200).json(r);
      }
      case "practica_reiniciar":
        return res.status(200).json(await mas("practica_reiniciar", { usuario }));
      case "torneo":
        return res.status(200).json(await torneo("estado", { usuario }));
      case "torneo_crear": {
        const d = b.datos || {};
        const ids = Array.isArray(d.senales) ? d.senales.map(Number).filter((x) => x > 0).slice(0, 8) : [];
        const monto = num(d.monto);
        if (!ids.length || !(monto > 0)) return res.status(400).json({ error: "Elige al menos una opción y un monto." });
        const r = await torneo("crear", { usuario, senales: ids, monto });
        if (r.error) return res.status(400).json(r);
        return res.status(200).json(r);
      }
      case "yo": {
        const av = await admin("avisos_get", { usuario }).catch(() => ({}));
        return res.status(200).json({ dueno: String(usuario) === env("TELEGRAM_CHAT_ID"), solo_web: String(usuario).startsWith("w"), momio: av.momio || null });
      }
      case "momio_set":
        return res.status(200).json(await admin("momio_set", { usuario, momio: (b.datos || {}).momio === "decimal" ? "decimal" : "americano" }));
      case "uso":
        await admin("uso", { usuario, seccion: txt((b.datos || {}).seccion, 30) });
        return res.status(200).json({ ok: true });
      case "avisos_get":
        return res.status(200).json(await admin("avisos_get", { usuario }));
      // ---- 🔔 notificaciones al celular
      case "push_llave":
        return res.status(200).json({ llave: env("VAPID_PUBLIC") || VAPID_PUBLICA });
      case "push_alta": {
        const sb = (b.datos || {}).sub || {}, k = sb.keys || {};
        if (!/^https:\/\//.test(String(sb.endpoint || "")) || !k.p256dh || !k.auth) return res.status(400).json({ error: "Suscripción inválida." });
        await notif("alta", { usuario: String(usuario), endpoint: txt(sb.endpoint, 800), p256dh: txt(k.p256dh, 200), auth: txt(k.auth, 100), nombre: txt((b.datos || {}).nombre, 60) });
        return res.status(200).json({ ok: true });
      }
      case "push_baja":
        await notif("baja", { usuario: String(usuario), endpoint: txt((b.datos || {}).endpoint, 800) });
        return res.status(200).json({ ok: true });
      case "push_mis":
        return res.status(200).json(await notif("mis", { usuario: String(usuario) }));
      case "push_prueba": {
        const tipo = Object.keys(TIPOS).includes((b.datos || {}).tipo) ? b.datos.tipo : null;
        if (tipo === "resumen") {
          const [r, av] = await Promise.all([notif("resumen", { usuario: String(usuario) }), admin("avisos_get", { usuario })]);
          const m = textoResumen(r, av);
          const x = await notificar({ tipo: "resumen", usuarios: [String(usuario)], para: () => m, url: "/#avisos", telegram: true, ignorarSilencio: true, forzar: true });
          return res.status(200).json(x);
        }
        // prueba directa a sus celulares, sin importar preferencias
        const x = await notificar({ tipo: "resultados", usuarios: [String(usuario)], ignorarSilencio: true, forzar: true, tag: "prueba",
          para: () => ({ titulo: "🔔 ¡Listo! Así te van a llegar", cuerpo: "Las notificaciones de la Bitácora ya funcionan en este celular. Despliégala para ver la tarjeta.", url: "/#avisos",
            img: { k: "resultado", r: "gana", m: "2 – 1", l: { n: "Tu equipo" }, v: { n: "El rival" }, s: "Así se ve el resultado de una apuesta" } }) }).catch(() => ({ enviados: 0 }));
        return res.status(200).json(x);
      }
      case "avisos_set": {
        const a = (b.datos || {}).avisos || {};
        const GR = ["ligamx", "europa", "champions", "nfl", "nba", "mlb"];
        const ligas = Array.isArray(a.ligas) ? a.ligas.filter((x) => GR.includes(x)) : null;
        const pm = num(a.prob_min);
        const hora = (h) => (Number.isInteger(h) && h >= 0 && h <= 23 ? h : null);
        const sil = a.silencio && hora(a.silencio.de) !== null && hora(a.silencio.a) !== null ? { de: a.silencio.de, a: a.silencio.a } : null;
        // qué quiere recibir y por dónde (celular / Telegram), tipo por tipo
        const nt = {};
        for (const k of Object.keys(TIPOS)) {
          const v = (a.notif || {})[k];
          if (v && typeof v === "object") nt[k] = { cel: v.cel === true, tg: v.tg === true };
        }
        const rs = a.resumen || {};
        const dias = Array.isArray(rs.dias) ? [...new Set(rs.dias.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))] : [];
        const inc = {};
        ["banca", "dia", "semana", "senales", "sorteos"].forEach((k) => { inc[k] = !(rs.incluir && rs.incluir[k] === false); });
        const resumen = { activo: rs.activo === true, hora: hora(Number(rs.hora)) ?? 21, dias, incluir: inc };
        const limpio = { ligas: ligas && ligas.length && ligas.length < GR.length ? ligas : null,
          prob_min: pm > 0 && pm < 1 ? Math.round(pm * 100) / 100 : null, silencio: sil,
          movimientos: nt.movimientos ? nt.movimientos.tg : a.movimientos !== false, notif: nt, resumen };
        return res.status(200).json(await admin("avisos_set", { usuario, avisos: limpio }));
      }
      case "admin_panel": case "admin_invitar": case "admin_invitacion_cerrar": case "admin_usuario": case "admin_aceptar": {
        if (String(usuario) !== env("TELEGRAM_CHAT_ID")) return res.status(403).json({ error: "Solo el administrador." });
        const d = b.datos || {};
        if (b.op === "admin_panel") return res.status(200).json(await admin("panel"));
        if (b.op === "admin_invitar") return res.status(200).json(await admin("invitar", { usos: num(d.usos), dias: num(d.dias), nota: txt(d.nota, 60) }));
        if (b.op === "admin_invitacion_cerrar") return res.status(200).json(await admin("invitacion_cerrar", { codigo: txt(d.codigo, 12) }));
        if (b.op === "admin_usuario") {
          if (String(d.chat_id) === String(usuario)) return res.status(400).json({ error: "No puedes quitarte a ti mismo." });
          return res.status(200).json(await admin("usuario_activo", { chat_id: txt(d.chat_id, 30), activo: !!d.activo }));
        }
        // aceptar una solicitud de Telegram desde el panel
        const id = txt(d.chat_id, 30);
        if (!/^-?\d+$/.test(id)) return res.status(400).json({ error: "ID inválido" });
        await rpc("bot", "agregar", { usuario: id, nombre: txt(d.nombre, 40) || "Amigo" });
        await tg("sendMessage", { chat_id: id, parse_mode: "Markdown",
          reply_markup: { keyboard: [[{ text: "🎯 Señales" }, { text: "💰 Saldo" }, { text: "📋 Pendientes" }], [{ text: "🌐 Mi página" }, { text: "📘 Guía" }, { text: "📝 Opinar" }, { text: "❓ Ayuda" }]], resize_keyboard: true, is_persistent: true },
          text: "🎉 *¡Ya tienes acceso al bot!*\n\nToca ❓ Ayuda para ver cómo funciona, 📘 Guía para recibir el manual, o 🌐 Mi página para crear tu usuario de la página web." });
        return res.status(200).json({ ok: true });
      }
      case "terminos":
        return res.status(200).json(await rpc("terminos", "estado", { usuario }));
      case "aceptar_terminos":
        return res.status(200).json(await rpc("terminos", "aceptar", { usuario, v: txt((b.datos || {}).v, 20), medio: "web" }));
      case "opiniones": {
        const lista = await opinion("lista", { usuario });
        const dueno = String(usuario) === env("TELEGRAM_CHAT_ID");
        return res.status(200).json({ lista, dueno, resumen: await opinion("resumen") });
      }
      case "opinar": {
        const d = b.datos || {};
        if (!["idea", "error", "opinion"].includes(d.tipo)) return res.status(400).json({ error: "Elige el tipo." });
        if (txt(d.texto, 1000).length < 3) return res.status(400).json({ error: "Escribe tu comentario." });
        const e = num(d.estrellas);
        try {
          const o = await opinion("crear", { usuario, tipo: d.tipo, texto: txt(d.texto, 1000), seccion: txt(d.seccion, 40),
            estrellas: e >= 1 && e <= 5 ? Math.round(e) : null });
          if (String(usuario) !== env("TELEGRAM_CHAT_ID")) await avisarOpinion(o);
          return res.status(200).json(o);
        } catch (err) { return res.status(400).json({ error: err.message }); }
      }
      case "opinion_votar":
        return res.status(200).json(await opinion("votar", { usuario, id: num((b.datos || {}).id) }));
      case "opinion_estado": {
        if (String(usuario) !== env("TELEGRAM_CHAT_ID")) return res.status(403).json({ error: "Solo el dueño." });
        const d = b.datos || {};
        const estado = ["nueva", "vista", "en_proceso", "hecha", "no"].includes(d.estado) ? d.estado : null;
        const respuesta = txt(d.respuesta, 600);
        const o = await opinion("estado", { id: num(d.id), estado, respuesta });
        if (respuesta) await avisarAutor(o, "respuesta"); else if (estado) await avisarAutor(o, "estado");
        return res.status(200).json(o);
      }
      case "banca": {
        const v = num((b.datos || {}).valor);
        if (!(v > 0)) return res.status(400).json({ error: "La banca debe ser mayor a cero." });
        return res.status(200).json(await rpc("bot", "banca", { usuario, valor: v }));
      }
    }
    return res.status(400).json({ error: "Operación desconocida" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "No se pudo completar. Intenta de nuevo." });
  }
}
