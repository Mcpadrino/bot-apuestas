// API de la página web. Cada quien entra con su usuario y contraseña (los crea desde el bot
// de Telegram) y solo puede ver y cambiar sus propias apuestas.

import { buscarLogo, sugerencias, equipoPorClave, proximos, PRINCIPALES } from "../lib/espn.js";
import { mas, tg, textoReto, botonesReto, avisarRespuesta, agruparSenales } from "../lib/mas.js";

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
async function avisarComunidad(autorChat, autor, texto) {
  try {
    const usuarios = await rpc("bot", "usuarios");
    const corto = texto ? `: “${texto.slice(0, 120)}${texto.length > 120 ? "…" : ""}”` : "";
    await Promise.all(usuarios.filter((u) => String(u.chat_id) !== String(autorChat)).map((u) =>
      fetch(`https://api.telegram.org/bot${env("TELEGRAM_TOKEN")}/sendMessage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: u.chat_id, disable_web_page_preview: true,
          text: `💬 ${autor || "Alguien"} publicó en la comunidad${corto}\n${WEB_URL}/#comunidad` }),
      })));
  } catch (e) { console.error("aviso comunidad", e); }
}

const num = (v) => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? null : Number(v));
const txt = (v, max = 120) => String(v ?? "").trim().slice(0, max);

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Usa POST" });
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

  try {
    if (b.op === "login") {
      const r = await rpc("web", "login", { nombre_web: txt(b.usuario, 40), pass: String(b.pass ?? "").slice(0, 200) });
      if (!r || !r.token) return res.status(401).json({ error: (r && r.error) || "Usuario o contraseña incorrectos." });
      return res.status(200).json({ token: r.token });
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
          imagen: typeof d.imagen === "string" ? d.imagen : null, horas: num(d.horas) || 48 });
        if (r && r.error) return res.status(400).json(r);
        await avisarComunidad(usuario, r.autor, txt(d.texto, 1000));
        return res.status(200).json(r);
      }
      case "reaccionar": {
        const d = b.datos || {};
        if (!["🔥", "👍", "😂"].includes(d.emoji)) return res.status(400).json({ error: "Reacción inválida" });
        return res.status(200).json(await rpc("comunidad", "reaccionar", { usuario, id: num(d.id), emoji: d.emoji }));
      }
      case "bajar":
        return res.status(200).json(await rpc("comunidad", "bajar", { usuario, id: num((b.datos || {}).id) }));
      // ---------- perfil / equipo favorito
      case "perfil":
        return res.status(200).json(await mas("perfil", { usuario }));
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
