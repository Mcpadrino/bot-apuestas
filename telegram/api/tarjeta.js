// 🖼️ Tarjeta de imagen para las notificaciones del celular (se ve grande al desplegar la notificación).
//   GET /api/tarjeta?d=<json en base64url>   → PNG de 1024×512
// Tipos: resumen · resultado · senal · melate · progol
import { ImageResponse } from "@vercel/og";
import fs from "node:fs";

const F500 = fs.readFileSync(new URL("../fonts/bricolage-grotesque-latin-500-normal.woff", import.meta.url));
const F800 = fs.readFileSync(new URL("../fonts/bricolage-grotesque-latin-800-normal.woff", import.meta.url));

const C = { bg: "#0b1210", card: "#121c18", line: "#24332c", fg: "#eef4f0", muted: "#8fa398", win: "#3fd39a", loss: "#ff7a68", gold: "#f5c451", soft: "#1a2822" };

// h("div", {estilo}, ...hijos) → nodo para satori
const h = (type, style = {}, ...children) => ({ type, props: { style: { display: "flex", ...style }, children: children.flat().filter((x) => x !== null && x !== undefined && x !== false) } });
const txt = (t, style = {}) => h("div", style, String(t));

const marca = () => h("div", { alignItems: "center", gap: 12 },
  { type: "svg", props: { width: 34, height: 34, viewBox: "0 0 24 24", children: [
    { type: "rect", props: { x: 1, y: 1, width: 22, height: 22, rx: 6, fill: C.soft, stroke: C.line } },
    { type: "path", props: { d: "M5 16 L10 11 L13 14 L19 8", stroke: C.win, "stroke-width": 2.4, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" } } ] } },
  txt("BITÁCORA DE APUESTAS", { fontSize: 20, letterSpacing: 2, color: C.muted, fontWeight: 800 }));

const marco = (etiqueta, ...cuerpo) => h("div", { width: "100%", height: "100%", flexDirection: "column", background: C.bg, padding: "36px 48px", fontFamily: "Bricolage",
  backgroundImage: `radial-gradient(circle at 92% 0%, rgba(63,211,154,.20), transparent 45%), radial-gradient(circle at 0% 100%, rgba(63,211,154,.08), transparent 40%)` },
  h("div", { justifyContent: "space-between", alignItems: "center" }, marca(), etiqueta ? txt(etiqueta, { fontSize: 20, color: C.muted, fontWeight: 500 }) : null),
  h("div", { flex: 1, flexDirection: "column", justifyContent: "center" }, ...cuerpo));

const dinero = (n) => (Number(n) < 0 ? "−" : "") + "$" + Math.abs(Math.round(Number(n) || 0)).toLocaleString("en-US");
const signo = (n) => (Number(n) >= 0 ? "+" : "−") + "$" + Math.abs(Math.round(Number(n) || 0)).toLocaleString("en-US");
const colorDe = (n) => (Number(n) >= 0 ? C.win : C.loss);
const dato = (lab, val, color = C.fg) => h("div", { flexDirection: "column", flex: 1, background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, padding: "16px 20px" },
  txt(lab, { fontSize: 20, color: C.muted, fontWeight: 500 }), txt(val, { fontSize: 38, fontWeight: 800, color, marginTop: 2 }));

function resumen(d) {
  if (!d.dia && d.banca != null) d.dia = { etiqueta: "Banca del bot", n: 1, g: d.banca, plano: true };
  const g = d.dia || {};
  return marco(d.fecha || "Tu resumen",
    txt(g.etiqueta || "Hoy", { fontSize: 26, color: C.muted, fontWeight: 500 }),
    h("div", { alignItems: "baseline", gap: 18 },
      txt(g.plano ? dinero(g.g) : g.n ? signo(g.g) : "Sin apuestas", { fontSize: g.n ? 104 : 72, fontWeight: 800, color: g.plano ? C.fg : g.n ? colorDe(g.g) : C.fg, letterSpacing: -3, lineHeight: 1 }),
      g.n && !g.plano ? txt(`${g.n} apuesta${g.n === 1 ? "" : "s"}`, { fontSize: 26, color: C.muted }) : null),
    h("div", { gap: 14, marginTop: 26 },
      d.banca != null && !(d.dia || {}).plano ? dato("Banca del bot", dinero(d.banca)) : null,
      d.juego != null ? dato("En juego", dinero(d.juego) + (d.pend ? ` · ${d.pend}` : "")) : null,
      d.semana ? dato(`7 días${d.semana.r ? " · " + d.semana.r : ""}`, signo(d.semana.g), colorDe(d.semana.g)) : null));
}

function resultado(d) {
  const eq = (e) => h("div", { flexDirection: "column", alignItems: "center", width: 230 },
    e.logo ? { type: "img", props: { src: e.logo, width: 120, height: 120, style: { objectFit: "contain" } } } : h("div", { width: 120, height: 120, borderRadius: 60, background: C.soft }),
    txt(e.n || "", { fontSize: 26, fontWeight: 800, color: C.fg, marginTop: 12, textAlign: "center" }));
  const est = { gana: ["GANASTE", C.win], pierde: ["PERDISTE", C.loss], nula: ["NULA", C.muted] }[d.r] || ["TERMINÓ", C.gold];
  return marco("Final",
    h("div", { alignItems: "center", justifyContent: "space-between" },
      eq(d.l || {}),
      h("div", { flexDirection: "column", alignItems: "center" },
        txt(d.m || "", { fontSize: 92, fontWeight: 800, color: C.fg, letterSpacing: -2, lineHeight: 1 }),
        txt(est[0], { fontSize: 28, fontWeight: 800, color: C.bg, background: est[1], borderRadius: 999, padding: "6px 22px", marginTop: 16, letterSpacing: 2 })),
      eq(d.v || {})),
    txt(d.s || "", { fontSize: 24, color: C.muted, marginTop: 24, justifyContent: "center" }));
}

function senal(d) {
  return marco(d.n > 1 ? `${d.n} partidos con señal` : "Señal nueva",
    h("div", { alignItems: "center", gap: 14 },
      { type: "svg", props: { width: 34, height: 34, viewBox: "0 0 24 24", children: [{ type: "path", props: { d: "M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z", fill: C.gold } }] } },
      txt("La más probable", { fontSize: 26, color: C.gold, fontWeight: 800 })),
    txt(d.sel || "", { fontSize: 64, fontWeight: 800, color: C.fg, lineHeight: 1.05, marginTop: 10, letterSpacing: -1 }),
    txt(d.p || "", { fontSize: 26, color: C.muted, marginTop: 6 }),
    h("div", { gap: 14, marginTop: 24 },
      dato("Probabilidad real", `${Math.round((d.prob || 0) * 100)}%`, C.win),
      d.min ? dato("Apuesta solo desde", d.min) : null,
      d.poly ? dato("Polymarket", `${Math.round(d.poly * 100)}%`) : null));
}

function melate(d) {
  const filas = (d.j || []).slice(0, 3);
  return marco(filas.length > 1 ? "Resultados" : `Concurso ${(filas[0] || {}).c || ""}`,
    ...filas.map((x, i) => h("div", { alignItems: "center", gap: 16, marginTop: i ? 18 : 0 },
      txt(x.n, { fontSize: 26, fontWeight: 800, color: C.muted, width: 190 }),
      ...(x.nums || []).map((v) => txt(v, { width: filas.length > 1 ? 70 : 92, height: filas.length > 1 ? 70 : 92, borderRadius: 999, background: C.fg, color: C.bg,
        fontSize: filas.length > 1 ? 32 : 42, fontWeight: 800, alignItems: "center", justifyContent: "center" })),
      x.a ? txt("+" + x.a, { width: filas.length > 1 ? 70 : 92, height: filas.length > 1 ? 70 : 92, borderRadius: 999, background: C.gold, color: C.bg,
        fontSize: filas.length > 1 ? 30 : 38, fontWeight: 800, alignItems: "center", justifyContent: "center" }) : null)),
    d.t ? txt(d.t, { fontSize: 24, color: C.muted, marginTop: 24 }) : null);
}

function progol(d) {
  const cas = d.r || [];
  return marco(d.nom || "Progol",
    h("div", { alignItems: "baseline", gap: 18 },
      txt(`${d.a} de ${cas.length}`, { fontSize: 104, fontWeight: 800, color: C.fg, letterSpacing: -3, lineHeight: 1 }),
      txt("atinó el favorito", { fontSize: 28, color: C.muted })),
    h("div", { gap: 8, marginTop: 28, flexWrap: "wrap" },
      ...cas.map((x) => txt(x.l, { width: 56, height: 56, borderRadius: 12, fontSize: 26, fontWeight: 800, alignItems: "center", justifyContent: "center",
        background: x.ok ? C.win : C.card, color: x.ok ? C.bg : C.muted, border: `1px solid ${x.ok ? C.win : C.line}` }))),
    d.t ? txt(d.t, { fontSize: 24, color: C.muted, marginTop: 22 }) : null);
}

const TIPOS = { resumen, resultado, senal, melate, progol };

export default async function handler(req, res) {
  try {
    const d = JSON.parse(Buffer.from(String(req.query.d || ""), "base64url").toString("utf8") || "{}");
    const f = TIPOS[d.k];
    if (!f) return res.status(400).end();
    const img = new ImageResponse(f(d), { width: 1024, height: 512,
      fonts: [{ name: "Bricolage", data: F500, weight: 500 }, { name: "Bricolage", data: F800, weight: 800 }] });
    const buf = Buffer.from(await img.arrayBuffer());
    res.setHeader("content-type", "image/png");
    res.setHeader("cache-control", "public, max-age=604800, s-maxage=604800, immutable");
    return res.status(200).send(buf);
  } catch (e) {
    console.error("tarjeta", e);
    return res.status(500).end();
  }
}
