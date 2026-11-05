// Lo más importante del día: 5 noticias recientes en español y datos curiosos de ayer (ESPN, gratis).
// Se guarda 4 horas en la red de Vercel: se renueva solo unas 5 veces al día.
import { noticias, datosDelDia } from "../lib/espn.js";

export default async function handler(req, res) {
  const zona = "America/Mexico_City";
  const ayer = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() - 86400000)).replace(/-/g, "");
  const [n, d] = await Promise.allSettled([noticias(5), datosDelDia(ayer)]);
  res.setHeader("cache-control", "public, s-maxage=14400, stale-while-revalidate=3600");
  return res.status(200).json({
    noticias: n.status === "fulfilled" ? n.value : [],
    datos: d.status === "fulfilled" ? d.value : [],
    generado: new Date().toISOString(),
  });
}
