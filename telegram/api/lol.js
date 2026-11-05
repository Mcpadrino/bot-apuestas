// 🐉 LoL: calendario, en vivo y Elo del Mundial (ver lib/lol.js). No gasta créditos de cuotas.
import { datosLol } from "../lib/lol.js";

export default async function handler(req, res) {
  try {
    const d = await datosLol();
    res.setHeader("cache-control", "s-maxage=60, stale-while-revalidate=600, stale-if-error=86400");
    return res.status(200).json(d);
  } catch (e) {
    console.error(e);
    res.setHeader("cache-control", "no-store");
    return res.status(503).json({ error: "LoL Esports no responde ahorita. Intenta en un par de minutos." });
  }
}
