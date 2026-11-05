// Partidos de hoy (hora de México) con marcadores en vivo de ESPN. Gratis, no gasta créditos.
import { partidosDelDia } from "../lib/espn.js";

export default async function handler(req, res) {
  const zona = "America/Mexico_City";
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date()).replace(/-/g, "");
  const fecha = /^\d{8}$/.test(req.query.fecha || "") ? req.query.fecha : hoy;
  try {
    const partidos = await partidosDelDia(fecha);
    res.setHeader("cache-control", "public, s-maxage=45, stale-while-revalidate=60");   // máx. 1 consulta a ESPN cada 45 s
    return res.status(200).json({ fecha, partidos });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "No se pudieron leer los marcadores." });
  }
}
