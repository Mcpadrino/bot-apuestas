// API de la página web. Cada quien entra con su usuario y contraseña (los crea desde el bot
// de Telegram) y solo puede ver y cambiar sus propias apuestas.

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
      case "todas":
        return res.status(200).json(await rpc("web", "todas", { usuario }));
      case "registrar": {
        const d = b.datos || {};
        const cuota = num(d.cuota), monto = num(d.monto), prob = num(d.prob);
        if (!(cuota > 1) || !(monto > 0) || !txt(d.seleccion))
          return res.status(400).json({ error: "Faltan la selección, el momio o el monto." });
        if (prob !== null && !(prob > 0 && prob < 1)) return res.status(400).json({ error: "El % debe estar entre 0 y 100." });
        return res.status(200).json(await rpc("bot", "registrar", {
          usuario, cartera: d.cartera === "libre" ? "libre" : "bot", partido: txt(d.partido),
          seleccion: txt(d.seleccion), casa: txt(d.casa, 40), cuota, monto, prob,
        }));
      }
      case "cerrar": {
        const d = b.datos || {};
        if (!["gana", "pierde", "nula", "pendiente"].includes(d.resultado)) return res.status(400).json({ error: "Resultado inválido" });
        return res.status(200).json(await rpc("bot", "cerrar", { usuario, id: num(d.id), resultado: d.resultado }));
      }
      case "borrar":
        return res.status(200).json(await rpc("bot", "borrar", { usuario, id: num((b.datos || {}).id) }));
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
      case "bajar":
        return res.status(200).json(await rpc("comunidad", "bajar", { usuario, id: num((b.datos || {}).id) }));
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
