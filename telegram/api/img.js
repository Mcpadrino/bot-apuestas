// Foto de una publicación de la comunidad. Se pide una sola vez: el navegador la guarda 7 días.
const env = (k) => (process.env[k] || "").replace(/\s/g, "");

async function rpc(fn, accion, datos) {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: env("SUPABASE_KEY"), authorization: `Bearer ${env("SUPABASE_KEY")}` },
    body: JSON.stringify({ p_clave: env("BOT_CLAVE"), p_accion: accion, p_datos: datos }),
  });
  if (!r.ok) throw new Error("bd");
  return r.json();
}

export default async function handler(req, res) {
  const id = Number(req.query.id), token = String(req.query.t || "").slice(0, 100);
  if (!id || !token) return res.status(400).end();
  try {
    const usuario = await rpc("web", "sesion", { token });
    if (!usuario) return res.status(401).end();
    const dataUrl = await rpc("comunidad", "imagen", { usuario, id });
    const m = typeof dataUrl === "string" && dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return res.status(404).end();
    res.setHeader("content-type", m[1]);
    res.setHeader("cache-control", "private, max-age=604800, immutable");
    return res.status(200).send(Buffer.from(m[2], "base64"));
  } catch (e) {
    console.error(e);
    return res.status(500).end();
  }
}
