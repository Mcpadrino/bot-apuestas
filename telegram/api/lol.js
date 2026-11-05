// 🐉 LoL: calendario, en vivo y Elo del Mundial (ver lib/lol.js). No gasta créditos de cuotas.
import { datosLol } from "../lib/lol.js";

export default async function handler(req, res) {
  try {
    const d = await datosLol();
    res.setHeader("cache-control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json(d);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "No se pudo leer LoL Esports." });
  }
}
