/* Aurialo CRM — app de una sola página, sin dependencias.
   Datos: tabla `aurialo` de Supabase, una fila por registro con clave "crm:<colección>:<id>".
   Si Supabase no responde, trabaja en local (localStorage) y avisa. */
(() => {
const C = window.AURIALO_CONFIG;
const COLS = ["creativos", "produccion", "confirmaciones", "incidencias", "tareas", "competidores", "anuncios", "sistema", "notas"];
const EQ = window.CRM_MODO === "equipo";
const OBJ = Object.assign({ conf: 0.78, confTop: 0.80, confAviso: 0.70, entrega: 0.85, devol: 0.15, sinMotivo: 0.3 }, C.objetivos || {});
const objConf = () => `${Math.round(OBJ.conf * 100)}–${Math.round(OBJ.confTop * 100)} %`;   // panel del equipo logístico: solo logística y sin datos de dinero
const db = Object.fromEntries(COLS.map(c => [c, []]));
let online = false;
const ui = { view: "panel", tabs: {}, sort: {}, filters: {} };

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const n = v => { const x = Number(v); return isFinite(x) ? x : 0; };
const eur = v => (v == null || !isFinite(v)) ? "—" : v.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const pct = v => (v == null || !isFinite(v)) ? "—" : (v * 100).toFixed(1).replace(".", ",") + "%";
const x2 = v => (v == null || !isFinite(v)) ? "—" : v.toFixed(2).replace(".", ",") + "×";
const today = () => new Date().toISOString().slice(0, 10);
const daysSince = d => d ? Math.floor((Date.now() - new Date(d + "T00:00:00").getTime()) / 864e5) : null;
const fdate = d => d ? new Date(d + "T00:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : "—";
const prodName = code => (C.productos.find(p => p.code === code) || {}).nombre || code || "—";
const me = () => localStorage.getItem("crm_yo") || C.equipo[0];
const toast = msg => { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200); };
const camel = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join("");
const nombreCreativo = r => [camel(r.angulo), camel(r.ident), r.producto].filter(Boolean).join("_");
function parseNombre(nombre) {
  const base = String(nombre || "").replace(/\.(mp4|mov|jpg|png)$/i, "");
  const p = base.split("_");
  const codes = C.productos.map(x => x.code);
  const last = (p[p.length - 1] || "").toUpperCase();
  return { angulo: p[0] || "", ident: p.length > 2 ? p.slice(1, -1).join("_") : (p[1] || ""), producto: codes.includes(last) ? last : "" };
}

/* ---------- datos (Supabase REST + caché local) ---------- */
const H = { apikey: C.supabaseKey, Authorization: "Bearer " + C.supabaseKey, "Content-Type": "application/json" };
const api = (q = "") => `${C.supabaseUrl}/rest/v1/${C.tabla}${q}`;
const keyOf = (col, id) => `${C.prefijo}${col}:${id}`;

async function load() {
  try {
    const r = await fetch(api(`?select=clave,valor&clave=like.${encodeURIComponent(C.prefijo)}*`), { headers: H });
    if (!r.ok) throw new Error(r.status);
    const rows = await r.json();
    COLS.forEach(c => db[c] = []);
    rows.forEach(row => {
      const [, col] = row.clave.slice(C.prefijo.length).match(/^([^:]+):/) || [];
      if (!db[col]) return;
      let v = row.valor; if (typeof v === "string") { try { v = JSON.parse(v); } catch { return; } }
      if (v && v.id) db[col].push(v);
    });
    online = true;
    localStorage.setItem("crm_cache", JSON.stringify(db));
  } catch (e) {
    online = false;
    const cache = JSON.parse(localStorage.getItem("crm_cache") || "null");
    if (cache) COLS.forEach(c => db[c] = cache[c] || []);
  }
  setSync();
}
async function save(col, rec) {
  rec.id = rec.id || uid();
  rec._upd = new Date().toISOString(); rec._por = me();
  const i = db[col].findIndex(r => r.id === rec.id);
  if (i >= 0) db[col][i] = rec; else db[col].push(rec);
  localStorage.setItem("crm_cache", JSON.stringify(db));
  try {
    const r = await fetch(api(), { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ clave: keyOf(col, rec.id), valor: rec, actualizado: rec._upd }]) });
    if (!r.ok) throw new Error(await r.text());
    online = true;
  } catch (e) { online = false; toast("⚠️ Guardado solo en este navegador (sin conexión con Supabase)"); }
  setSync();
  return rec;
}
async function saveMany(col, recs) { for (const r of recs) await save(col, r); }
async function remove(col, id) {
  db[col] = db[col].filter(r => r.id !== id);
  localStorage.setItem("crm_cache", JSON.stringify(db));
  try { await fetch(api(`?clave=eq.${encodeURIComponent(keyOf(col, id))}`), { method: "DELETE", headers: H }); } catch { online = false; }
  setSync();
}
function setSync() {
  const s = $("#sync");
  s.className = "sync " + (online ? "ok" : "off");
  s.textContent = online ? "Sincronizado con Supabase" : "Sin conexión · modo local";
}

/* ---------- Beeping (Google Sheet "Registro-Base") ---------- */
const beeping = { rows: [], fuente: "", fecha: null, error: "" };
const bnum = s => { s = String(s ?? "").trim(); if (!s || s === "-") return 0; const neg = /^\(.*\)/.test(s) || s.startsWith("-"); s = s.replace(/[()€%\s-]/g, "").replace(/\./g, "").replace(",", "."); const v = n(s); return neg ? -v : v; };
function parseBeeping(text) {
  const rows = parseCSV(text);
  const hi = rows.findIndex(r => r.some(c => norm(c) === "fecha") && r.some(c => norm(c) === "generados"));
  if (hi < 0) return [];
  const h = rows[hi].map(norm), col = name => h.findIndex(x => x.startsWith(norm(name)));
  const I = { fecha: col("fecha"), inversion: col("inversion publicitaria"), ventas: col("importe total"), generados: col("generados"), confirmados: col("confirmados"),
    entregados: col("entregados"), devueltos: col("devueltos"), ingresos: col("importe entregado"), costeProducto: col("coste total de producto"),
    envio: col("coste por envio"), picking: col("coste por picking"), cod: col("coste por cod"), financiero: col("coste financiero"), costes: col("total costes") };
  const out = [];
  rows.slice(hi + 1).forEach(r => {
    const m = String(r[I.fecha] || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (!m) return;
    const o = { fecha: `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` };
    Object.entries(I).forEach(([k, i]) => { if (k !== "fecha") o[k] = i >= 0 ? Math.abs(bnum(r[i])) : 0; });
    out.push(o);
  });
  return out;
}
async function loadBeeping() {
  beeping.error = "";
  if (C.beepingCsvUrl) {
    try {
      const r = await fetch(C.beepingCsvUrl + (C.beepingCsvUrl.includes("?") ? "&" : "?") + "t=" + Date.now());
      if (!r.ok) throw new Error("HTTP " + r.status);
      const rows = parseBeeping(await r.text());
      if (!rows.length) throw new Error("no encuentro la tabla de Registro-Base");
      Object.assign(beeping, { rows, fuente: "Google Sheet en directo", fecha: new Date().toISOString() });
      const snap = db.sistema.find(x => x.id === "beeping");
      if (online && (!snap || Date.now() - new Date(snap.fecha).getTime() > 30 * 60e3)) save("sistema", { id: "beeping", fecha: beeping.fecha, fuente: "Google Sheet", filas: rows });
      return;
    } catch (e) { beeping.error = "No se pudo leer el Google Sheet (" + e.message + "). Se muestra la última copia guardada."; }
  }
  const snap = db.sistema.find(x => x.id === "beeping");
  if (snap) Object.assign(beeping, { rows: snap.filas || [], fuente: "Copia guardada (" + (snap.fuente || "Sheet") + ")", fecha: snap.fecha });
}
function aggBeeping(rows) {
  const t = rows.reduce((a, r) => { ["inversion", "ventas", "generados", "confirmados", "entregados", "devueltos", "ingresos", "costes"].forEach(k => a[k] += n(r[k])); return a; },
    { inversion: 0, ventas: 0, generados: 0, confirmados: 0, entregados: 0, devueltos: 0, ingresos: 0, costes: 0 });
  t.beneficio = t.ingresos - t.costes - t.inversion;
  t.pConf = t.generados ? t.confirmados / t.generados : null;
  t.pEnt = t.confirmados ? t.entregados / t.confirmados : null;
  t.pBen = t.ingresos ? t.beneficio / t.ingresos : null;
  t.roas = t.inversion ? t.ingresos / t.inversion : null;
  t.cpa = t.entregados ? t.inversion / t.entregados : null;
  return t;
}
const semaf = (v, ok, warn) => v == null ? "" : v >= ok ? "ok" : v >= warn ? "warn" : "bad";
function rangoBeeping(preset, desde, hasta) {
  const d = new Date(), iso = x => x.toISOString().slice(0, 10), menos = k => { const x = new Date(); x.setDate(x.getDate() - k); return iso(x); };
  if (preset === "hoy") return [iso(d), iso(d)];
  if (preset === "cerrada") return [menos(13), menos(7)];
  if (preset === "ayer") return [menos(1), menos(1)];
  if (preset === "mes") return [iso(new Date(d.getFullYear(), d.getMonth(), 1, 12)), iso(d)];
  if (preset === "mespasado") return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1, 12)), iso(new Date(d.getFullYear(), d.getMonth(), 0, 12))];
  if (preset === "todo") return ["2000-01-01", "2999-12-31"];
  if (preset === "custom") return [desde || "2000-01-01", hasta || "2999-12-31"];
  return [menos(n(preset) - 1), iso(d)];
}

/* ---------- componentes ---------- */
function armDelete(btn, fn) {
  if (btn.classList.contains("armed")) { fn(); return; }
  btn.classList.add("armed"); const t = btn.textContent; btn.textContent = "¿Seguro?";
  setTimeout(() => { btn.classList.remove("armed"); btn.textContent = t; }, 3000);
}
function openModal(title, html) { $("#modal-title").textContent = title; $("#modal-body").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeModal() { $("#modal").classList.add("hidden"); }
$("#modal-close").onclick = closeModal;
$("#modal").onclick = e => { if (e.target.id === "modal") closeModal(); };

function input(f, val) {
  const v = val ?? f.def ?? "";
  if (f.type === "select") return `<select name="${f.k}">${(f.opts || []).map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(v) ? "selected" : ""}>${esc(ol)}</option>`; }).join("")}</select>`;
  if (f.type === "textarea") return `<textarea name="${f.k}">${esc(v)}</textarea>`;
  return `<input name="${f.k}" type="${f.type || "text"}" value="${esc(v)}" ${f.type === "number" ? 'step="any"' : ""} placeholder="${esc(f.ph || "")}">`;
}
function openForm(title, fields, rec, onSave, extra = "") {
  rec = rec || {};
  openModal(title, `<form class="form" id="frm">${fields.map(f => `<div class="f ${f.full ? "full" : ""}"><label>${esc(f.label)}</label>${input(f, rec[f.k])}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ""}</div>`).join("")}</form>${extra}
    <div class="form-actions"><button class="btn sec" id="frm-cancel">Cancelar</button><button class="btn" id="frm-ok">Guardar</button></div>`);
  $("#frm-cancel").onclick = closeModal;
  const frm = $("#frm");
  frm.oninput = () => frm.dispatchEvent(new CustomEvent("change-live"));
  $("#frm-ok").onclick = async () => {
    const out = { ...rec };
    fields.forEach(f => { const el = frm.elements[f.k]; out[f.k] = f.type === "number" ? (el.value === "" ? "" : n(el.value)) : el.value; });
    await onSave(out); closeModal(); render();
  };
  return frm;
}
function table(id, cols, rows, empty = "Sin datos todavía") {
  if (!rows.length) return `<div class="tbl-wrap"><div class="empty">${empty}</div></div>`;
  const s = ui.sort[id];
  if (s) {
    const col = cols.find(c => c.k === s.k);
    const val = r => col && col.v ? col.v(r) : r[s.k];
    rows = [...rows].sort((a, b) => { const A = val(a), B = val(b); const r = (typeof A === "number" || typeof B === "number") ? n(A) - n(B) : String(A ?? "").localeCompare(String(B ?? "")); return s.dir * r; });
  }
  return `<div class="tbl-wrap"><table data-tbl="${id}"><thead><tr>${cols.map(c => `<th class="${c.num ? "num" : ""}" data-sort="${c.k}">${esc(c.label)}${s && s.k === c.k ? (s.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
  <tbody>${rows.map(r => `<tr>${cols.map(c => `<td class="${c.num ? "num" : ""}">${c.h ? c.h(r) : esc(c.v ? c.v(r) : r[c.k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
document.addEventListener("click", e => {
  const th = e.target.closest("th[data-sort]");
  if (th) { const id = th.closest("table").dataset.tbl, k = th.dataset.sort; const s = ui.sort[id]; ui.sort[id] = { k, dir: s && s.k === k ? -s.dir : -1 }; render(); }
});
const tabs = (view, list) => { const cur = ui.tabs[view] || list[0][0]; return [cur, `<div class="tabs">${list.map(([k, l]) => `<button data-tab="${view}:${k}" class="${k === cur ? "active" : ""}">${l}</button>`).join("")}</div>`]; };
document.addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) { const [v, k] = b.dataset.tab.split(":"); ui.tabs[v] = k; render(); } });
const prodOpts = (blank) => (blank ? [["", blank]] : []).concat(C.productos.map(p => [p.code, p.nombre]));
const kpi = (l, v, s = "") => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;

/* ---------- Meta Ads: cálculos ---------- */
function m(r) {
  const gasto = n(r.gasto), impr = n(r.impresiones), clics = n(r.clicsEnlace), hook3 = n(r.reprod3s);
  const cMeta = n(r.comprasMeta), cShop = r.comprasShopify === "" || r.comprasShopify == null ? null : n(r.comprasShopify);
  const compras = cShop != null ? cShop : cMeta;
  let ingresos = n(r.ingresos);
  if (cShop != null && cMeta > 0) ingresos = ingresos * cShop / cMeta;          // corrige el pixel con compras reales de Shopify
  else if (cShop != null && cMeta === 0 && cShop > 0 && n(r.ticketMedio)) ingresos = cShop * n(r.ticketMedio);
  const dias = daysSince(r.fechaLanz);
  const res = { gasto, impr, clics, compras, ingresos, dias,
    ctr: impr ? clics / impr : null, cpc: clics ? gasto / clics : null, hook: impr && hook3 ? hook3 / impr : null,
    cpa: compras ? gasto / compras : null, roas: gasto ? ingresos / gasto : null };
  res.veredicto = r.veredictoManual || veredicto(res);
  return res;
}
function veredicto(k) {
  const R = C.reglas;
  if (k.dias != null && k.dias < R.diasMinimos) return "En test";
  if (k.gasto < R.gastoMinimo && k.compras === 0) return (k.dias != null && k.dias >= 7) ? "Sin datos" : "En test";
  if (k.compras === 0 && k.gasto >= R.gastoSinVentas) return "No relanzar";
  if (k.compras === 0) return "Vigilar";
  if (k.compras >= R.comprasGanador && k.roas >= R.roasGanador) return "Ganador";
  if (k.roas >= R.roasPrometedor) return "Prometedor";
  if (k.roas != null && k.roas < R.roasDescartar) return "No relanzar";
  return "Vigilar";
}
function rentab(x) {
  const p = C.productos.find(q => q.code === x.r.producto);
  if (!p || !p.cpaMax || !x.k.compras) return { t: "", o: 0 };
  const cpa = x.k.cpa, tt = `CPA ${eur(cpa)} · objetivo ${eur(p.cpaObj)} · máximo ${eur(p.cpaMax)}`;
  if (cpa <= p.cpaObj) return { t: "Rentable +20 %", c: "ok", o: 3, tt };
  if (cpa <= p.cpaMax) return { t: "Rentable", c: "warn", o: 2, tt };
  return { t: "Pierde dinero", c: "bad", o: 1, tt };
}
const VCLS = { "Ganador": "ok", "Prometedor": "info", "Vigilar": "warn", "No relanzar": "bad", "En test": "brand", "Sin datos": "" };
const vpill = v => `<span class="pill ${VCLS[v] || ""}">${esc(v)}</span>`;

/* ---------- vistas ---------- */
const views = {};

const PRINC = ["GLP1", "MENO", "DRENAJE"];
const prodPill = code => code ? `<span class="pill brand">${esc(prodName(code))}</span>` : `<span class="hint">—</span>`;
/* Clasificación del día para anuncios activos en Meta (si el agente no ha dejado sus acciones) */
function accionesCalculadas() {
  const act = db.creativos.filter(r => r.estadoMeta === "ACTIVE" && n(r.gasto) >= 1).map(r => ({ r, k: m(r) }));
  const out = { escalar: [], apagar: [], sano: [], vigilar: [] };
  act.forEach(x => {
    const rt = rentab(x), v = x.k.veredicto;
    const it = { nombre: x.r.nombre, producto: x.r.producto, conjunto: x.r.conjunto, gasto: x.k.gasto, compras: x.k.compras, roas: x.k.roas, cpa: x.k.cpa };
    if (v === "No relanzar" || (rt.o === 1 && x.k.gasto >= C.reglas.gastoSinVentas)) out.apagar.push({ ...it, motivo: rt.o === 1 ? `CPA ${eur(x.k.cpa)} por encima del máximo del producto` : (x.k.compras ? `ROAS ${x2(x.k.roas)} muy bajo` : `${eur(x.k.gasto)} gastados sin ventas`) });
    else if (v === "Ganador" && rt.o === 3) out.escalar.push({ ...it, motivo: `${x.k.compras} compras y CPA ${eur(x.k.cpa)} dentro del objetivo` });
    else if (rt.o >= 2 || v === "Ganador" || v === "Prometedor") out.sano.push({ ...it, motivo: rt.o === 3 ? "Rentable con margen; faltan compras para escalar" : rt.o === 2 ? "Rentable, pero sin el 20 % de margen" : "Buenas señales" });
    else out.vigilar.push({ ...it, motivo: v === "En test" || v === "Sin datos" ? "Aún sin datos suficientes" : (rt.o === 1 ? `CPA ${eur(x.k.cpa)} por encima del máximo` : "Resultados flojos: revisar en 48 h") });
  });
  Object.values(out).forEach(l => l.sort((a, b) => b.gasto - a.gasto));
  return out;
}
function listaAccion(items, vacio) {
  if (!items || !items.length) return `<div class="hint" style="padding:8px 0">${vacio}</div>`;
  return items.slice(0, 12).map(i => `<div style="border-top:1px solid var(--line);padding:8px 0">
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><b style="color:var(--strong);font-size:13px">${esc(i.nombre || i.conjunto || "")}</b> ${prodPill(i.producto)}</div>
    ${i.conjunto && i.nombre ? `<div class="hint">${esc(i.conjunto)}</div>` : ""}
    <div class="hint">${[i.gasto != null ? eur(n(i.gasto)) : "", i.compras != null ? `${i.compras} compras` : "", i.roas ? `ROAS ${x2(n(i.roas))}` : "", i.cpa ? `CPA ${eur(n(i.cpa))}` : ""].filter(Boolean).join(" · ")}</div>
    ${i.motivo ? `<div style="font-size:12.5px;margin-top:2px">${esc(i.motivo)}</div>` : ""}</div>`).join("") + (items.length > 12 ? `<div class="hint">…y ${items.length - 12} más</div>` : "");
}
function panelHoy() {
  const w = new Date().getDay(), finde = [5, 6, 0].includes(w);
  const ag = db.sistema.find(x => x.id === "acciones");
  const agReciente = ag && Date.now() - new Date(ag.fecha).getTime() < 3.5 * 864e5;
  const A = agReciente ? { escalar: ag.escalar || [], apagar: ag.apagar || [], sano: ag.sano || [], vigilar: [...(ag.esperar || []), ...(ag.vigilar || [])], iterar: ag.iterar || [] } : { ...accionesCalculadas(), iterar: [] };
  const fuente = agReciente ? `Según el agente <b>Analíticas Meta Ads</b> · ${new Date(ag.fecha).toLocaleString("es-ES", { weekday: "long", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}${ag.titular ? " · " + esc(ag.titular) : ""}${ag.totales ? " · " + esc(ag.totales) : ""}` : "Calculado con los anuncios activos en Meta y el CPA máximo de cada producto (datos acumulados de cada anuncio)";
  const dIso = k => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
  const b7 = aggBeeping(beeping.rows.filter(r => r.fecha >= dIso(6)));
  const bc = aggBeeping(beeping.rows.filter(r => r.fecha >= dIso(13) && r.fecha <= dIso(7)));
  const sh = db.sistema.find(x => x.id === "shopify");
  const shD = f => (sh && sh.dias || []).find(d => d.fecha === f);
  const hoyISO = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  const ayerISO = new Date(Date.now() - 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  const sHoy = shD(hoyISO), sAyer = shD(ayerISO);
  const prev = (sh && sh.dias || []).filter(d => d.fecha < hoyISO).slice(-7);
  const media = prev.length ? prev.reduce((a, d) => a + d.pedidos, 0) / prev.length : null;
  const mix = d => d ? ["GLP1", "MENO", "DRENAJE", "UNPUFF"].filter(k => d.porProducto && d.porProducto[k] && d.porProducto[k].pedidos).map(k => `${d.porProducto[k].pedidos} ${({ GLP1: "GLP", MENO: "MENO", DRENAJE: "Drenaje", UNPUFF: "Unpuff" })[k]}`).join(" · ") : "";
  const avisos = db.sistema.filter(x => String(x.id).startsWith("aviso_") && Date.now() - new Date(x.fecha).getTime() < 4 * 864e5).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const inc = db.sistema.find(x => x.id === "inc_resumen");
  const mot = db.sistema.find(x => x.id === "motivos");
  const comp = db.sistema.find(x => x.id === "competencia");
  const tar = db.tareas.filter(t => t.estado !== "Hecha").sort((a, b) => (a.fecha || "9").localeCompare(b.fecha || "9"));
  const listos = db.produccion.filter(p => p.estado === "Listo");
  const incMan = db.incidencias.filter(i => i.estado === "Abierta");
  const dia = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  const pendientes = [];
  if (inc && inc.sinGestionar) pendientes.push(`<b style="color:var(--bad)">${inc.sinGestionar}</b> incidencias de Beeping sin gestionar${inc.masAntigua ? ` (la más antigua lleva ${inc.masAntigua} días)` : ""} → <a href="#logistica" data-goinc="1">Incidencias</a>`);
  if (inc && inc.zombies) pendientes.push(`${inc.zombies} incidencias abiertas en Beeping con el envío ya cerrado: cerrarlas`);
  const dudas = db.notas.filter(x => x.tipo === "Duda para Cristian" && !x.respuesta);
  if (dudas.length) pendientes.push(`<b>${dudas.length}</b> duda${dudas.length > 1 ? "s" : ""} del equipo sin responder → Equipo logístico → Notas del equipo`);
  const notasHoy = db.notas.filter(x => x.tipo !== "Feedback de Cristian" && x.fecha && Date.now() - new Date(x.fecha).getTime() < 864e5);
  if (notasHoy.length) pendientes.push(`${notasHoy.length} nota${notasHoy.length > 1 ? "s" : ""} nueva${notasHoy.length > 1 ? "s" : ""} del equipo en las últimas 24 h`);
  if (incMan.length) pendientes.push(`${incMan.length} incidencias del registro manual abiertas`);
  if (listos.length) pendientes.push(`${listos.length} creativos listos para lanzar (${listos.slice(0, 3).map(p => esc(nombreCreativo(p))).join(", ")}${listos.length > 3 ? "…" : ""})`);
  if ([2, 4].includes(w) && !listos.length) pendientes.push("Hoy es día de lanzamiento y no hay creativos en «Listo»");
  tar.slice(0, 6).forEach(t => pendientes.push(`Tarea: ${esc(t.titulo)} <span class="hint">· ${esc(t.responsable || "")}${t.fecha ? " · " + fdate(t.fecha) : ""}${t.prioridad === "Alta" ? " · <b style='color:var(--bad)'>alta</b>" : ""}</span>`));
  if (!agReciente) pendientes.push(`El agente Analíticas Meta Ads aún no ha dejado sus recomendaciones (sale lunes, miércoles y viernes a las 9:38)`);
  const col = (titulo, cls, items, vacio, nota) => `<div class="card" style="margin:0;border-top:4px solid var(--${cls})"><h3 style="margin:0">${titulo} <span class="hint">${(items || []).length}</span></h3>${nota ? `<div class="hint" style="margin:2px 0 4px">${nota}</div>` : ""}${listaAccion(items, vacio)}</div>`;
  return `<h1>Hoy · ${esc(dia)}</h1><div class="sub">Qué hacer hoy, lo pendiente y cómo va la tienda.</div>
  <div class="card"><h3 style="margin:0 0 10px">🏪 Resumen de la tienda</h3><div class="grid">
    ${kpi(`Pedidos hoy · Shopify`, sHoy ? `${sHoy.pedidos} pedidos` : "—", sHoy ? `${eur(sHoy.ventas)} · ${mix(sHoy)}${sh.ultimoPedido ? ` · último ${esc(sh.ultimoPedido.name)} a las ${new Date(sh.ultimoPedido.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })}` : ""}` : "Sin datos de hoy todavía")}
    ${kpi("Ayer · Shopify", sAyer ? `${sAyer.pedidos} pedidos` : "—", sAyer ? `${eur(sAyer.ventas)} · ${mix(sAyer)}${sAyer.manuales ? ` · ${sAyer.manuales} manuales` : ""}${media ? ` · media 7 días ${String(media.toFixed(1)).replace(".", ",")}` : ""}` : "")}
    ${kpi("% Confirmación · 7 días", `<span class="pill ${semaf(b7.pConf, OBJ.conf, OBJ.confAviso)}" style="font-size:20px">${pct(b7.pConf)}</span>`, `${b7.confirmados} de ${b7.generados} pedidos`)}
    ${kpi("% Entrega · semana cerrada", `<span class="pill ${semaf(bc.pEnt, .85, .7)}" style="font-size:20px">${pct(bc.pEnt)}</span>`, `${fdate(dIso(13))}–${fdate(dIso(7))}`)}
    ${kpi("Beneficio · semana cerrada", `<span style="color:var(--${bc.beneficio >= 0 ? "ok" : "bad"})">${eur(bc.beneficio)}</span>`, `${pct(bc.pBen)} sobre lo entregado`)}
  </div>
  ${sh ? `<div class="hint" style="margin-top:8px">Pedidos de Shopify actualizados ${new Date(sh.fecha).toLocaleString("es-ES", { weekday: "short", hour: "2-digit", minute: "2-digit" })}. Confirmación, entrega y beneficio salen de Beeping.</div>` : ""}
  ${mot && (mot.resumen || []).length ? `<div style="margin-top:10px;font-size:13px">🗣️ <b>Por qué no quieren el pedido:</b> ${esc(mot.resumen[0])}</div>` : ""}
  ${comp && (comp.acciones || []).length ? `<div style="margin-top:6px;font-size:13px">🔎 <b>Competencia, a probar esta semana:</b> ${esc(comp.acciones[0])}</div>` : ""}
  </div>
  ${avisos.length ? `<div class="card"><h3 style="margin:0 0 8px">🤖 Lo que dicen los agentes</h3><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">${avisos.map(a => { const esHoy = new Date(a.fecha).toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" }) === hoyISO;
    return `<div style="border:1px solid var(--line);border-radius:10px;padding:12px;${esHoy ? "border-left:4px solid var(--brand)" : "opacity:.8"}"><div style="display:flex;justify-content:space-between;gap:8px"><b style="color:var(--strong)">${esc(a.agente)}</b><span class="hint">${esHoy ? "hoy" : new Date(a.fecha).toLocaleDateString("es-ES", { weekday: "short", day: "2-digit" })} ${new Date(a.fecha).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span></div>
      ${a.titular ? `<div style="font-weight:600;margin:4px 0">${esc(a.titular)}</div>` : ""}<ul class="rules" style="margin:4px 0;padding-left:18px">${(a.puntos || []).slice(0, 6).map(p => `<li style="margin:3px 0">${esc(p)}</li>`).join("")}</ul>${a.enlace ? `<a href="${esc(a.enlace)}" target="_blank" rel="noopener" class="hint">Ver completo</a>` : ""}</div>`; }).join("")}</div></div>` : ""}
  ${finde ? `<div class="card" style="background:var(--warn-soft);border-color:transparent">✋ <b>Viernes a domingo no se escala ni se pausa.</b> Lo de «Escalar» y «Parar» queda apuntado para el lunes.</div>` : ""}
  <div class="hint" style="margin:6px 0 8px">${fuente}</div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(250px,1fr));align-items:start">
    ${col("🚀 Escalar", "ok", A.escalar, "Nada que escalar hoy", finde ? "Para el lunes · +20–25 % cada 48–72 h" : "+20–25 % de presupuesto, máximo cada 48–72 h")}
    ${col("⛔ Parar", "bad", A.apagar, "Nada que parar", finde ? "Para el lunes" : "")}
    ${col("✅ Sano", "info", A.sano, "Sin anuncios en esta situación", "Mantener como está")}
    ${col("👀 Vigilar", "warn", A.vigilar, "Nada que vigilar", "Sin decisión todavía")}
  </div>
  ${A.iterar.length ? `<div class="card" style="margin-top:14px"><h3 style="margin:0">🔁 Iterar: sacar 2–3 variaciones de hook</h3>${listaAccion(A.iterar, "")}</div>` : ""}
  <div class="card" style="margin-top:14px"><h3 style="margin:0 0 6px">📋 Pendiente y novedades</h3>${pendientes.length ? `<ul class="rules">${pendientes.map(p => `<li>${p}</li>`).join("")}</ul>` : `<div class="hint">Nada pendiente 🎉</div>`}</div>`;
}
function panelKpis() {
  const cr = db.creativos.map(r => ({ r, k: m(r) }));
  const gasto = cr.reduce((a, x) => a + x.k.gasto, 0), ing = cr.reduce((a, x) => a + x.k.ingresos, 0), comp = cr.reduce((a, x) => a + x.k.compras, 0);
  const count = v => cr.filter(x => x.k.veredicto === v).length;
  const pipe = ["Idea", "Guion", "Producción", "Listo"].map(e => [e, db.produccion.filter(p => p.estado === e).length]);
  const incAb = db.incidencias.filter(i => i.estado === "Abierta" || i.estado === "Gestionada");
  const tarPend = db.tareas.filter(t => t.estado !== "Hecha");
  const hace7 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const conf7 = db.confirmaciones.filter(c => c.fecha >= hace7);
  const cOk = conf7.reduce((a, c) => a + n(c.confirmados), 0), cTot = conf7.reduce((a, c) => a + n(c.confirmados) + n(c.cancelados) + n(c.noContesta), 0);
  const dIso = k => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
  const b7 = aggBeeping(beeping.rows.filter(r => r.fecha >= dIso(6)));
  const bc = aggBeeping(beeping.rows.filter(r => r.fecha >= dIso(13) && r.fecha <= dIso(7)));
  const bcTxt = `${fdate(dIso(13))}–${fdate(dIso(7))}`;
  const colsTop = [
    { k: "nombre", label: "Creativo", v: x => x.r.nombre, h: x => `<span class="name">${esc(x.r.nombre)}</span>${x.r.conjunto ? `<div class="hint">${esc(x.r.conjunto)}</div>` : ""}` },
    { k: "estadoMeta", label: "En Meta", v: x => x.r.estadoMeta || "", h: x => x.r.estadoMeta === "ACTIVE" ? `<span class="pill ok">Activo</span>` : `<span class="hint">Pausado</span>` },
    { k: "formato", label: "Formato", v: x => x.r.formato || "—" },
    { k: "gasto", label: "Gasto", num: 1, v: x => x.k.gasto, h: x => eur(x.k.gasto) },
    { k: "compras", label: "Compras", num: 1, v: x => x.k.compras },
    { k: "cpa", label: "CPA", num: 1, v: x => x.k.cpa, h: x => eur(x.k.cpa) },
    { k: "roas", label: "ROAS", num: 1, v: x => x.k.roas, h: x => x2(x.k.roas) },
    { k: "rent", label: "vs CPA máx.", v: x => rentab(x).o, h: x => { const r = rentab(x); return r.t ? `<span class="pill ${r.c}" title="${esc(r.tt)}">${r.t}</span>` : ""; } },
    { k: "v", label: "Estado", v: x => x.k.veredicto, h: x => vpill(x.k.veredicto) }];
  const porProd = PRINC.concat([...new Set(db.creativos.map(r => r.producto).filter(p => p && !PRINC.includes(p)))]).map(code => {
    const l = cr.filter(x => x.r.producto === code && x.k.compras > 0 && x.k.gasto >= C.reglas.gastoMinimo).sort((a, b) => n(b.k.roas) - n(a.k.roas));
    if (!l.length) return "";
    const p = C.productos.find(q => q.code === code) || {};
    const g = l.reduce((a, x) => a + x.k.gasto, 0), c = l.reduce((a, x) => a + x.k.compras, 0);
    return `<h3 style="margin:18px 0 6px">${esc(prodName(code))} <span class="hint">· ${l.filter(x => rentab(x).o >= 2).length} de ${l.length} creativos con ventas son rentables${p.cpaMax ? ` · CPA máx. ${eur(p.cpaMax)} · ROAS breakeven ${x2(p.roasBE)}` : ""}</span></h3>` +
      table("p-top-" + code, colsTop, l.slice(0, 8));
  }).join("");
  const malos = cr.filter(x => x.k.veredicto === "No relanzar").sort((a, b) => b.k.gasto - a.k.gasto).slice(0, 8);
  return `<h1>KPIs</h1><div class="sub">Todos los indicadores de la tienda, Meta Ads y el equipo.</div>
  ${beeping.rows.length ? `<h2 style="margin-top:0">📦 Tienda (Beeping)</h2><div class="grid" style="margin-bottom:14px">
    ${kpi("% Confirmación · 7 días", `<span class="pill ${semaf(b7.pConf, OBJ.conf, OBJ.confAviso)}" style="font-size:20px">${pct(b7.pConf)}</span>`, `${b7.confirmados} de ${b7.generados} pedidos`)}
    ${kpi("% Entrega · semana cerrada", `<span class="pill ${semaf(bc.pEnt, .85, .7)}" style="font-size:20px">${pct(bc.pEnt)}</span>`, `${bc.entregados} de ${bc.confirmados} · ${bcTxt}`)}
    ${kpi("Beneficio · semana cerrada", `<span style="color:var(--${bc.beneficio >= 0 ? "ok" : "bad"})">${eur(bc.beneficio)}</span>`, `Ingresos ${eur(bc.ingresos)} · ${bcTxt}`)}
    ${kpi("% Beneficio · semana cerrada", pct(bc.pBen), "Sobre lo entregado")}
  </div><h2>📈 Meta Ads y equipo</h2>` : ""}
  <div class="grid">
    ${kpi("Gasto en creativos", eur(gasto), `${cr.length} creativos registrados`)}
    ${kpi("ROAS global (corregido)", x2(gasto ? ing / gasto : null), `${comp} compras · CPA ${eur(comp ? gasto / comp : null)}`)}
    ${kpi("Ganadores", count("Ganador"), `${count("Prometedor")} prometedores · ${count("En test")} en test · ${count("Sin datos")} sin datos`)}
    ${kpi("No relanzar", count("No relanzar"), "Creativos descartados por datos")}
    ${kpi("En producción", pipe.reduce((a, p) => a + p[1], 0), pipe.map(p => `${p[0]} ${p[1]}`).join(" · "))}
    ${kpi("Incidencias abiertas", incAb.length, `${db.incidencias.filter(i => i.estado === "Abierta").length} sin gestionar`)}
    ${kpi("Tareas pendientes", tarPend.length, C.equipo.map(p => `${p} ${tarPend.filter(t => t.responsable === p).length}`).join(" · "))}
    ${kpi("Confirmación 7 días", pct(cTot ? cOk / cTot : null), `${cOk} confirmados de ${cTot}`)}
  </div>
  <h2>🏆 Lo que funciona, por producto</h2><div class="hint">Creativos con ventas y al menos ${eur(C.reglas.gastoMinimo)} de gasto, ordenados por ROAS (métricas acumuladas de cada anuncio).</div>
  ${porProd || `<div class="card empty">Aún no hay creativos con ventas</div>`}
  <h2>⛔ No volver a lanzar</h2>${table("p-bad", [
    { k: "nombre", label: "Creativo", h: x => `<span class="name">${esc(x.r.nombre)}</span>${x.r.conjunto ? `<div class="hint">${esc(x.r.conjunto)}</div>` : ""}` },
    { k: "producto", label: "Producto", v: x => x.r.producto, h: x => prodPill(x.r.producto) },
    { k: "gasto", label: "Gasto", num: 1, v: x => x.k.gasto, h: x => eur(x.k.gasto) },
    { k: "compras", label: "Compras", num: 1, v: x => x.k.compras },
    { k: "roas", label: "ROAS", num: 1, v: x => x.k.roas, h: x => x2(x.k.roas) }], malos, "Nada descartado todavía")}
  <h2>📦 Incidencias abiertas (registro manual)</h2>${table("p-inc", [
    { k: "fecha", label: "Fecha", h: r => fdate(r.fecha) }, { k: "pedido", label: "Pedido" }, { k: "cliente", label: "Cliente" },
    { k: "tipo", label: "Tipo" }, { k: "estado", label: "Estado" }, { k: "responsable", label: "Responsable" }], incAb.slice(0, 8), "Sin incidencias abiertas 🎉")}`;
}
views.panel = () => {
  const [tab, tabsHtml] = tabs("panel", [["hoy", "📌 Hoy"], ["kpis", "📊 KPIs"]]);
  return tabsHtml + (tab === "hoy" ? panelHoy() : panelKpis());
};
views.panel.bind = () => {
  const g = document.querySelector("[data-goinc]");
  if (g) g.onclick = e => { e.preventDefault(); ui.view = "logistica"; ui.tabs.logistica = "inc"; location.hash = "logistica"; render(); };
};

/* ----- Meta Ads ----- */
const F_CREATIVO = [
  { k: "nombre", label: "Nombre (angulo_identificacion_producto)", full: 1, ph: "ClientaEnfadada_LuciaVar1_GLP1", hint: "Al escribirlo se rellenan ángulo, identificación y producto" },
  { k: "producto", label: "Producto", type: "select", opts: prodOpts("—") },
  { k: "angulo", label: "Ángulo" }, { k: "ident", label: "Identificación / variante" },
  { k: "formato", label: "Formato", type: "select", opts: ["", ...C.formatos] },
  { k: "fechaLanz", label: "Fecha de lanzamiento", type: "date", def: today() },
  { k: "gasto", label: "Gasto (€)", type: "number" }, { k: "impresiones", label: "Impresiones", type: "number" },
  { k: "clicsEnlace", label: "Clics en el enlace", type: "number" }, { k: "reprod3s", label: "Reproducciones 3 s (hook)", type: "number" },
  { k: "comprasMeta", label: "Compras (Meta)", type: "number" }, { k: "ingresos", label: "Valor de compras Meta (€)", type: "number" },
  { k: "comprasShopify", label: "Compras reales Shopify", type: "number", hint: "Opcional: corrige el pixel (Meta capta ~60–80%)" },
  { k: "ticketMedio", label: "Ticket medio (€)", type: "number", hint: "Se usa si Meta marca 0 compras pero Shopify sí" },
  { k: "veredictoManual", label: "Forzar estado", type: "select", opts: [["", "Automático"], "Ganador", "Prometedor", "Vigilar", "No relanzar", "En test"] },
  { k: "notas", label: "Notas / aprendizajes", type: "textarea", full: 1 }
];
function editCreativo(rec) {
  const frm = openForm(rec ? "Editar creativo" : "Nuevo creativo", F_CREATIVO, rec, r => save("creativos", r));
  frm.elements.nombre.addEventListener("input", e => {
    const p = parseNombre(e.target.value);
    if (p.angulo) frm.elements.angulo.value = p.angulo;
    if (p.ident) frm.elements.ident.value = p.ident;
    if (p.producto) frm.elements.producto.value = p.producto;
  });
}
views.meta = () => {
  const [tab, tabsHtml] = tabs("meta", [["lista", "Creativos"], ["angulos", "Por ángulo"], ["formatos", "Por formato"]]);
  const f = ui.filters.meta || (ui.filters.meta = { prod: "", ver: "", q: "", act: false });
  let rows = db.creativos.map(r => ({ r, k: m(r) }))
    .filter(x => (!f.act || x.r.estadoMeta === "ACTIVE") && (!f.prod || x.r.producto === f.prod) && (!f.ver || x.k.veredicto === f.ver) && (!f.q || (x.r.nombre || "").toLowerCase().includes(f.q.toLowerCase())));
  const toolbar = `<div class="toolbar">
    <select id="f-prod">${prodOpts("Todos los productos").map(([v, l]) => `<option value="${v}" ${v === f.prod ? "selected" : ""}>${l}</option>`).join("")}</select>
    <select id="f-ver">${["", "Ganador", "Prometedor", "Vigilar", "No relanzar", "En test", "Sin datos"].map(v => `<option value="${v}" ${v === f.ver ? "selected" : ""}>${v || "Todos los estados"}</option>`).join("")}</select>
    <input id="f-q" placeholder="Buscar creativo…" value="${esc(f.q)}"><label class="hint"><input type="checkbox" id="f-act" ${f.act ? "checked" : ""}> Solo activos en Meta</label><span class="grow"></span>
    <button class="btn sec" id="imp-meta">⬆️ Importar CSV de Meta</button><button class="btn" id="new-cr">+ Creativo</button></div>`;
  let body = "";
  if (tab === "lista") {
    body = table("meta", [
      { k: "nombre", label: "Creativo", h: x => `<span class="name">${esc(x.r.nombre)}</span>${x.r.conjunto ? `<div class="hint">${esc(x.r.campana || "")} › ${esc(x.r.conjunto)}</div>` : ""}`, v: x => x.r.nombre },
      { k: "estadoMeta", label: "En Meta", v: x => x.r.estadoMeta || "", h: x => x.r.estadoMeta ? (x.r.estadoMeta === "ACTIVE" ? `<span class="pill ok">Activo</span>` : `<span class="hint">${esc(x.r.estadoMeta === "DISAPPROVED" ? "Rechazado" : "Pausado")}</span>`) : "" },
      { k: "producto", label: "Producto", v: x => prodName(x.r.producto) },
      { k: "formato", label: "Formato", v: x => x.r.formato || "—" },
      { k: "fechaLanz", label: "Lanzado", v: x => x.r.fechaLanz, h: x => fdate(x.r.fechaLanz) },
      { k: "dias", label: "Días", num: 1, v: x => x.k.dias, h: x => x.k.dias ?? "—" },
      { k: "gasto", label: "Gasto", num: 1, v: x => x.k.gasto, h: x => eur(x.k.gasto) },
      { k: "hook", label: "Hook", num: 1, v: x => x.k.hook, h: x => pct(x.k.hook) },
      { k: "ctr", label: "CTR", num: 1, v: x => x.k.ctr, h: x => pct(x.k.ctr) },
      { k: "cpc", label: "CPC", num: 1, v: x => x.k.cpc, h: x => eur(x.k.cpc) },
      { k: "compras", label: "Compras", num: 1, v: x => x.k.compras, h: x => x.k.compras },
      { k: "cpa", label: "CPA", num: 1, v: x => x.k.cpa, h: x => eur(x.k.cpa) },
      { k: "roas", label: "ROAS", num: 1, v: x => x.k.roas, h: x => x2(x.k.roas) },
      { k: "rent", label: "vs CPA máx.", v: x => rentab(x).o, h: x => { const r = rentab(x); return r.t ? `<span class="pill ${r.c}" title="${esc(r.tt)}">${r.t}</span>` : ""; } },
      { k: "ver", label: "Estado", v: x => x.k.veredicto, h: x => vpill(x.k.veredicto) },
      { k: "acc", label: "", h: x => `<button class="btn sm sec" data-edit-cr="${x.r.id}">Editar</button> <button class="btn sm danger" data-del-cr="${x.r.id}">Borrar</button>` }
    ], rows, "Añade creativos a mano o importa el CSV exportado del Administrador de anuncios");
  } else {
    const key = tab === "angulos" ? (x => `${x.r.producto || "—"}|${x.r.angulo || "Sin ángulo"}`) : (x => `${x.r.producto || "—"}|${x.r.formato || "Sin formato"}`);
    const g = {};
    rows.forEach(x => { const k = key(x); const a = g[k] || (g[k] = { k, n: 0, gasto: 0, ing: 0, comp: 0, gan: 0, mal: 0, hookN: 0, hookS: 0 });
      a.n++; a.gasto += x.k.gasto; a.ing += x.k.ingresos; a.comp += x.k.compras;
      if (x.k.veredicto === "Ganador") a.gan++; if (x.k.veredicto === "No relanzar") a.mal++;
      if (x.k.hook != null) { a.hookN++; a.hookS += x.k.hook; } });
    const agg = Object.values(g).map(a => ({ ...a, prod: a.k.split("|")[0], nom: a.k.split("|")[1], roas: a.gasto ? a.ing / a.gasto : null, cpa: a.comp ? a.gasto / a.comp : null, hook: a.hookN ? a.hookS / a.hookN : null }));
    const dec = a => a.gan ? "Escalar / iterar" : (a.roas != null && a.roas >= C.reglas.roasPrometedor ? "Seguir probando" : (a.mal >= 2 ? "Abandonar" : "Pocos datos"));
    body = table("meta-" + tab, [
      { k: "nom", label: tab === "angulos" ? "Ángulo" : "Formato", h: a => `<span class="name">${esc(a.nom)}</span>` },
      { k: "prod", label: "Producto", v: a => prodName(a.prod) },
      { k: "n", label: "Creativos", num: 1 }, { k: "gasto", label: "Gasto", num: 1, h: a => eur(a.gasto) },
      { k: "hook", label: "Hook medio", num: 1, h: a => pct(a.hook) },
      { k: "comp", label: "Compras", num: 1 }, { k: "cpa", label: "CPA", num: 1, h: a => eur(a.cpa) },
      { k: "roas", label: "ROAS", num: 1, h: a => x2(a.roas) },
      { k: "gan", label: "Ganadores", num: 1 }, { k: "mal", label: "Descartados", num: 1 },
      { k: "dec", label: "Decisión", v: dec, h: a => { const d = dec(a); return `<span class="pill ${{ "Escalar / iterar": "ok", "Seguir probando": "info", "Abandonar": "bad" }[d] || "brand"}">${d}</span>`; } }
    ], agg, "Sin datos");
  }
  const sync = db.sistema.find(s => s.id === "metasync");
  const syncTxt = sync ? `<span class="pill brand">🤖 Agente Meta · última sincronización ${new Date(sync.fecha).toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · ${sync.anuncios} anuncios</span>` : "";
  const eco = C.productos.filter(p => p.cpaMax);
  const ecoHtml = eco.length ? `<div class="card"><h3 style="margin:0 0 4px">💶 Límites de rentabilidad por producto</h3><p class="hint" style="margin:0 0 10px">Por pedido generado (lo que mide Meta). Con un píxel que capta el 60–80 % de las compras, el CPA que ves en Meta es más alto que el real: compáralo con las compras de Shopify.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Producto</th><th class="num">Ticket medio</th><th class="num">Confirmación</th><th class="num">Entrega</th><th class="num">CPA máx.</th><th class="num">ROAS breakeven</th><th class="num">CPA objetivo (20 %)</th><th class="num">ROAS objetivo</th><th class="num">CPA máx. por entregado</th><th class="num">Oferta mínima: CPA máx. · ROAS BE</th></tr></thead><tbody>
    ${eco.map(p => `<tr><td><b>${esc(p.nombre)}</b> <span class="hint">${String(p.uds).replace(".", ",")} uds · ${eur(p.costeUd)}/ud</span></td><td class="num">${eur(p.ticket)}</td><td class="num">${pct(p.conf)}</td><td class="num">${pct(p.entrega)}</td><td class="num"><b>${eur(p.cpaMax)}</b></td><td class="num"><b>${x2(p.roasBE)}</b></td><td class="num">${eur(p.cpaObj)}</td><td class="num">${x2(p.roasObj)}</td><td class="num">${eur(p.cpaMaxEnt)}</td><td class="num">${p.cpaMaxMin ? `${eur(p.cpaMaxMin)} · ${x2(p.roasBEMin)} <span class="hint">(${esc(p.ofertaMin)})</span>` : "—"}</td></tr>`).join("")}</tbody></table></div></div>` : "";
  return `<h1>Meta Ads · Creativos</h1><div class="sub">Cada vídeo o imagen lanzado, si ha funcionado o no, y qué ángulos merece la pena iterar. Métricas acumuladas de cada anuncio; ROAS corregido con compras reales de Shopify cuando las indicas.</div><div class="banner">${syncTxt}</div>${ecoHtml}${tabsHtml}${toolbar}${body}`;
};
views.meta.bind = () => {
  const f = ui.filters.meta;
  $("#f-prod").onchange = e => { f.prod = e.target.value; render(); };
  $("#f-ver").onchange = e => { f.ver = e.target.value; render(); };
  $("#f-act").onchange = e => { f.act = e.target.checked; render(); };
  $("#f-q").oninput = e => { f.q = e.target.value; clearTimeout(f._t); f._t = setTimeout(() => { render(); const q = $("#f-q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 300); };
  $("#new-cr").onclick = () => editCreativo();
  $("#imp-meta").onclick = importMeta;
};

/* ----- Importar CSV de Meta ----- */
function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/)[0];
  const d = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === d) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
function parseNum(s) {
  s = String(s ?? "").replace(/[€%\s]/g, "");
  if (!s || s === "-") return 0;
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");        // 15.000 → 15000
  else if (/^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");     // 15,000 → 15000
  else if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  return n(s);
}
const MAP = {
  nombre: ["nombre del anuncio", "ad name"],
  gasto: ["importe gastado", "amount spent"],
  impresiones: ["impresiones", "impressions"],
  clicsEnlace: ["clics en el enlace", "link clicks"],
  reprod3s: ["reproducciones de video de 3 segundos", "reproducciones de vídeo de 3 segundos", "3-second video plays", "reproducciones continuas de 2 segundos"],
  comprasMeta: ["compras", "purchases", "resultados"],
  ingresos: ["valor de conversion de compras", "valor de conversión de compras", "purchases conversion value", "purchase conversion value"],
  inicio: ["inicio del informe", "reporting starts"]
};
const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
function importMeta() {
  openModal("Importar CSV de Meta Ads", `<p class="hint">En el Administrador de anuncios, nivel <b>Anuncios</b>, exporta la tabla (Exportar → .csv) con estas columnas: Nombre del anuncio, Importe gastado, Impresiones, Clics en el enlace, Reproducciones de vídeo de 3 segundos, Compras y Valor de conversión de compras. Si el anuncio ya existe se actualizan sus métricas; tus notas y las compras de Shopify se conservan.</p>
  <input type="file" id="csvf" accept=".csv,.tsv,.txt"><p class="hint">…o pega aquí el contenido:</p><textarea id="csvt" style="min-height:120px"></textarea>
  <div id="csvprev" class="hint"></div><div class="form-actions"><button class="btn sec" id="c-cancel">Cancelar</button><button class="btn" id="c-ok">Importar</button></div>`);
  $("#c-cancel").onclick = closeModal;
  $("#csvf").onchange = e => { const fl = e.target.files[0]; if (!fl) return; const rd = new FileReader(); rd.onload = () => { $("#csvt").value = rd.result; preview(); }; rd.readAsText(fl); };
  $("#csvt").oninput = preview;
  let parsed = [];
  function preview() {
    const rows = parseCSV($("#csvt").value); parsed = [];
    if (rows.length < 2) { $("#csvprev").textContent = ""; return; }
    const head = rows[0].map(norm);
    const idx = {}; Object.entries(MAP).forEach(([k, al]) => { idx[k] = head.findIndex(h => al.some(a => h.startsWith(norm(a)))); });
    if (idx.nombre < 0) { $("#csvprev").innerHTML = "⚠️ No encuentro la columna «Nombre del anuncio»."; return; }
    const by = {};
    rows.slice(1).forEach(r => { const nom = (r[idx.nombre] || "").trim(); if (!nom) return;
      const a = by[nom] || (by[nom] = { nombre: nom, gasto: 0, impresiones: 0, clicsEnlace: 0, reprod3s: 0, comprasMeta: 0, ingresos: 0, inicio: "" });
      ["gasto", "impresiones", "clicsEnlace", "reprod3s", "comprasMeta", "ingresos"].forEach(k => { if (idx[k] >= 0) a[k] += parseNum(r[idx[k]]); });
      if (idx.inicio >= 0 && r[idx.inicio] && (!a.inicio || r[idx.inicio] < a.inicio)) a.inicio = r[idx.inicio].slice(0, 10); });
    parsed = Object.values(by);
    const nuevos = parsed.filter(p => !db.creativos.some(c => c.nombre === p.nombre)).length;
    const falt = Object.entries(idx).filter(([k, v]) => v < 0 && k !== "inicio").map(([k]) => k);
    $("#csvprev").innerHTML = `✅ ${parsed.length} anuncios detectados (${nuevos} nuevos, ${parsed.length - nuevos} a actualizar).${falt.length ? ` Columnas no encontradas: ${falt.join(", ")}.` : ""}`;
  }
  $("#c-ok").onclick = async () => {
    if (!parsed.length) return toast("No hay nada que importar");
    for (const p of parsed) {
      const ex = db.creativos.find(c => c.nombre === p.nombre);
      const meta = parseNombre(p.nombre);
      const rec = ex ? { ...ex } : { nombre: p.nombre, ...meta, fechaLanz: /^\d{4}-\d{2}-\d{2}$/.test(p.inicio) ? p.inicio : today() };
      Object.assign(rec, { gasto: p.gasto, impresiones: p.impresiones, clicsEnlace: p.clicsEnlace, reprod3s: p.reprod3s, comprasMeta: p.comprasMeta, ingresos: p.ingresos });
      const prod = db.produccion.find(x => nombreCreativo(x) === p.nombre); if (prod && !rec.formato) rec.formato = prod.formato;
      await save("creativos", rec);
    }
    closeModal(); toast(`Importados ${parsed.length} anuncios`); render();
  };
}

/* ----- Director creativo ----- */
const ESTADOS_PROD = ["Idea", "Guion", "Producción", "Listo", "Lanzado", "Descartado"];
const F_PROD = [
  { k: "producto", label: "Producto", type: "select", opts: prodOpts() },
  { k: "angulo", label: "Ángulo", ph: "Clienta enfadada" },
  { k: "ident", label: "Identificación / variante", ph: "Lucia Var1" },
  { k: "formato", label: "Formato", type: "select", opts: C.formatos },
  { k: "herramienta", label: "Herramienta", type: "select", opts: C.herramientas },
  { k: "estado", label: "Estado", type: "select", opts: ESTADOS_PROD, def: "Idea" },
  { k: "fechaPrev", label: "Lanzamiento previsto", type: "date" },
  { k: "responsable", label: "Responsable", type: "select", opts: C.equipo },
  { k: "hook", label: "Hook (primeros 3 s)", full: 1, type: "textarea" },
  { k: "guion", label: "Guion", full: 1, type: "textarea" },
  { k: "link", label: "Enlace al archivo (Drive, HeyGen…)", full: 1 },
  { k: "notas", label: "Notas", full: 1, type: "textarea" }
];
function nextLaunch() { const d = new Date(); for (let i = 0; i < 8; i++) { const w = d.getDay(); if (w === 2 || w === 4) return d.toISOString().slice(0, 10); d.setDate(d.getDate() + 1); } return today(); }
function editProd(rec) {
  const frm = openForm(rec ? "Editar creativo en producción" : "Nueva idea de creativo", F_PROD, rec || { fechaPrev: nextLaunch(), responsable: me() },
    r => save("produccion", r), `<p class="hint">Nombre final: <code id="nm-prev"></code></p>`);
  const upd = () => { $("#nm-prev").textContent = nombreCreativo({ angulo: frm.elements.angulo.value, ident: frm.elements.ident.value, producto: frm.elements.producto.value }); };
  frm.addEventListener("input", upd); frm.addEventListener("change", upd); upd();
}
views.creativo = () => {
  const [tab, tabsHtml] = tabs("creativo", [["pipeline", "Pipeline"], ["reglas", "Reglas creativas"], ["validados", "Ángulos validados"]]);
  let body = "";
  if (tab === "pipeline") {
    const f = ui.filters.creativo || (ui.filters.creativo = { prod: "" });
    const items = db.produccion.filter(p => !f.prod || p.producto === f.prod);
    body = `<div class="toolbar"><select id="fc-prod">${prodOpts("Todos los productos").map(([v, l]) => `<option value="${v}" ${v === f.prod ? "selected" : ""}>${l}</option>`).join("")}</select>
      <span class="hint">Próximo día de lanzamiento: <b>${fdate(nextLaunch())}</b> (martes y jueves)</span><span class="grow"></span><button class="btn" id="new-prod">+ Idea</button></div>
    <div class="kanban">${ESTADOS_PROD.map((e, i) => { const list = items.filter(p => (p.estado || "Idea") === e);
      return `<div class="col"><h4>${e}<span>${list.length}</span></h4>${list.map(p => `<div class="kc"><div class="t">${esc(nombreCreativo(p))}</div>
        <div class="m">${esc(p.formato || "")} · ${esc(p.herramienta || "")}${p.fechaPrev ? " · " + fdate(p.fechaPrev) : ""}${p.responsable ? " · " + esc(p.responsable) : ""}</div>
        ${p.hook ? `<div>🎣 ${esc(p.hook.slice(0, 90))}</div>` : ""}
        <div class="a">${i > 0 ? `<button class="btn sm sec" data-mv="${p.id}" data-d="-1">←</button>` : ""}${i < 5 ? `<button class="btn sm sec" data-mv="${p.id}" data-d="1">→</button>` : ""}
        ${e === "Listo" ? `<button class="btn sm" data-launch="${p.id}">🚀 Lanzar</button>` : ""}
        <button class="btn sm sec" data-edit-p="${p.id}">Editar</button>${p.link ? `<a class="btn sm sec" href="${esc(p.link)}" target="_blank" rel="noopener">Abrir</a>` : ""}
        <button class="btn sm danger" data-del-p="${p.id}">✕</button></div></div>`).join("")}</div>`; }).join("")}</div>`;
  } else if (tab === "reglas") {
    body = `<div class="card"><ul class="rules">${C.reglasCreativas.map(r => `<li>✅ ${esc(r)}</li>`).join("")}</ul><p class="hint">Puedes editar estas reglas en <code>config.js</code>.</p></div>`;
  } else {
    const gan = db.creativos.map(r => ({ r, k: m(r) })).filter(x => x.k.veredicto === "Ganador" || x.k.veredicto === "Prometedor");
    body = `<p class="sub">Creativos con datos que justifican hacer variaciones. Pulsa «Iterar» para crear una nueva idea con el mismo ángulo y formato.</p>` + table("val", [
      { k: "nombre", label: "Creativo", h: x => `<span class="name">${esc(x.r.nombre)}</span>` },
      { k: "angulo", label: "Ángulo", v: x => x.r.angulo }, { k: "formato", label: "Formato", v: x => x.r.formato || "—" },
      { k: "roas", label: "ROAS", num: 1, v: x => x.k.roas, h: x => x2(x.k.roas) }, { k: "cpa", label: "CPA", num: 1, v: x => x.k.cpa, h: x => eur(x.k.cpa) },
      { k: "hook", label: "Hook", num: 1, v: x => x.k.hook, h: x => pct(x.k.hook) }, { k: "v", label: "Estado", h: x => vpill(x.k.veredicto) },
      { k: "a", label: "", h: x => `<button class="btn sm" data-iter="${x.r.id}">Iterar</button>` }], gan, "Todavía no hay ganadores");
  }
  return `<h1>Director creativo</h1><div class="sub">De la idea al anuncio publicado. Al lanzar, el creativo pasa a Meta Ads con su nombre estándar.</div>${tabsHtml}${body}`;
};
views.creativo.bind = () => {
  const s = $("#fc-prod"); if (s) s.onchange = e => { ui.filters.creativo.prod = e.target.value; render(); };
  const b = $("#new-prod"); if (b) b.onclick = () => editProd();
};

/* ----- Logística ----- */
const TIPOS_INC = ["No contesta", "Rehúse", "Dirección incorrecta", "Ausente / no recogido", "Producto dañado", "Cambio / devolución", "Retraso transportista", "Otro"];
const ESTADOS_INC = ["Abierta", "Gestionada", "Resuelta", "No resuelta"];
const F_CONF = [
  { k: "fecha", label: "Fecha", type: "date", def: today() }, { k: "persona", label: "Persona", type: "select", opts: C.equipo },
  { k: "confirmados", label: "Confirmados", type: "number" }, { k: "cancelados", label: "Cancelados", type: "number" },
  { k: "noContesta", label: "No contesta", type: "number" }, { k: "notas", label: "Notas", type: "textarea", full: 1 }];
const F_INC = [
  { k: "fecha", label: "Fecha", type: "date", def: today() }, { k: "pedido", label: "Nº pedido", ph: "#1234" },
  { k: "cliente", label: "Cliente" }, { k: "telefono", label: "Teléfono" },
  { k: "producto", label: "Producto", type: "select", opts: prodOpts("—") },
  { k: "tipo", label: "Tipo", type: "select", opts: TIPOS_INC }, { k: "estado", label: "Estado", type: "select", opts: ESTADOS_INC },
  { k: "responsable", label: "Responsable", type: "select", opts: C.equipo }, { k: "tracking", label: "Tracking / transportista" },
  { k: "notas", label: "Notas", type: "textarea", full: 1 }];
const F_TAR = [
  { k: "titulo", label: "Tarea", full: 1 }, { k: "responsable", label: "Responsable", type: "select", opts: C.equipo },
  { k: "prioridad", label: "Prioridad", type: "select", opts: ["Alta", "Media", "Baja"], def: "Media" },
  { k: "estado", label: "Estado", type: "select", opts: ["Pendiente", "En curso", "Hecha"] }, { k: "fecha", label: "Fecha límite", type: "date" },
  { k: "notas", label: "Notas", type: "textarea", full: 1 }];
views.logistica = () => {
  const nPend = db.notas.filter(x => x.tipo === "Duda para Cristian" && !x.respuesta).length;
  const [tab, tabsHtml] = tabs("logistica", [["res", "Resultados (Beeping)"], ["mot", "Motivos de rechazo"], ...(EQ ? [] : [["conf", "Confirmaciones WhatsApp"]]), ["inc", "Incidencias"], ["tar", "Tareas"], ["notas", `📝 Notas del equipo${nPend ? ` (${nPend})` : ""}`]].filter(Boolean));
  let body = "";
  if (tab === "notas") body = notasView();
  else if (tab === "mot") {
    const M = db.sistema.find(x => x.id === "motivos");
    if (!M) body = `<div class="card empty">Aún no hay motivos cargados. El agente «Motivos de rechazo» los saca cada día del Sheet PEDIDOS E INCIDENCIAS.</div>`;
    else {
      const f = ui.filters.mot || (ui.filters.mot = { tipo: "", cat: "" });
      const R = M.registros || [], canc = R.filter(r => r.tipo === "cancelado"), dev = R.filter(r => r.tipo === "devuelto");
      const sinMot = canc.filter(r => r.categoria.startsWith("Ya no lo quiere")).length;
      const auto = dev.filter(r => r.categoria.startsWith("Devuelto automático")).length;
      const desc = R.filter(r => r.rechazaDescuento).length;
      const bars = (list, titulo) => { const c = {}; list.forEach(r => c[r.categoria] = (c[r.categoria] || 0) + 1); const e = Object.entries(c).sort((a, b) => b[1] - a[1]), mx = Math.max(1, ...e.map(x => x[1]));
        return `<div class="card"><h3 style="margin:0 0 10px">${titulo} <span class="hint">${list.length}</span></h3>${e.length ? e.map(([k, v]) => `<div style="display:grid;grid-template-columns:220px 1fr 70px;gap:10px;align-items:center;margin:6px 0;font-size:13px;cursor:pointer" data-motcat="${esc(k)}"><span>${esc(k)}</span><div class="bar"><span style="width:${v * 100 / mx}%"></span></div><span class="hint" style="text-align:right">${v} · ${pct(v / list.length)}</span></div>`).join("") : '<span class="hint">Sin registros</span>'}</div>`; };
      const rows = R.filter(r => (!f.tipo || r.tipo === f.tipo) && (!f.cat || r.categoria === f.cat));
      body = `<div class="toolbar"><span class="hint">Fuente: ${esc(M.fuente)} · actualizado ${new Date(M.fecha).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
      <div class="grid">
        ${kpi("Pedidos cancelados", canc.length, `${pct(canc.length ? sinMot / canc.length : null)} sin motivo concreto`)}
        ${kpi("Incidencias devueltas", dev.length, `${auto} automáticas por Beeping sin gestión`)}
        ${kpi("Rechazan el descuento", desc, "Se les ofreció descuento y dijeron que no")}
        ${kpi("Carritos recuperados", (M.carritos || []).length, `${(M.carritos || []).filter(c => /entreg/i.test(c.estado)).length} ya entregados`)}
      </div>
      <div class="card" style="margin-top:14px"><h3 style="margin:0 0 8px">📝 Resumen</h3><ul class="rules">${(M.resumen || []).map(l => `<li>${esc(l)}</li>`).join("")}</ul></div>
      <div class="two">${bars(canc, "¿Por qué cancelan en la confirmación?")}${bars(dev, "¿Por qué se devuelven las incidencias?")}</div>
      <div class="toolbar"><select id="fm-tipo">${[["", "Cancelados y devueltos"], ["cancelado", "Solo cancelados"], ["devuelto", "Solo devueltos"]].map(([v, l]) => `<option value="${v}" ${v === f.tipo ? "selected" : ""}>${l}</option>`).join("")}</select>
        ${f.cat ? `<span class="pill brand">${esc(f.cat)} <a href="#" id="fm-clear" style="margin-left:6px">✕</a></span>` : `<span class="hint">Pulsa una barra para filtrar por motivo</span>`}</div>` +
      table("mot", [{ k: "pedido", label: "Pedido", h: r => `<b>#${esc(r.pedido)}</b>` }, { k: "tipo", label: "Tipo", h: r => `<span class="pill ${r.tipo === "cancelado" ? "warn" : "bad"}">${r.tipo === "cancelado" ? "Cancelado" : "Devuelto"}</span>` },
        { k: "categoria", label: "Motivo" }, { k: "rechazaDescuento", label: "Desc.", v: r => r.rechazaDescuento ? 1 : 0, h: r => r.rechazaDescuento ? "❌ rechazado" : "" },
        { k: "obs", label: "Lo que anotó el equipo", h: r => `<span style="white-space:normal">${esc(r.obs)}</span>` }], rows) +
      ((M.carritos || []).length ? `<h2>🛒 Carritos recuperados</h2>` + table("carr", [{ k: "carrito", label: "Carrito" }, { k: "obs", label: "Observación" }, { k: "estado", label: "Estado", h: c => c.estado ? `<span class="pill ok">${esc(c.estado)}</span>` : `<span class="hint">pendiente</span>` }], M.carritos) : "");
    }
  } else if (tab === "res") {
    const f = ui.filters.bee || (ui.filters.bee = { preset: "cerrada", desde: "", hasta: "" });
    const [d1, d2] = rangoBeeping(f.preset, f.desde, f.hasta);
    const rows = beeping.rows.filter(r => r.fecha >= d1 && r.fecha <= d2).sort((a, b) => b.fecha.localeCompare(a.fecha));
    const t = aggBeeping(rows), hace7 = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
    const presets = [["cerrada", "Semana cerrada (hace 7–13 días)"], ["hoy", "Hoy"], ["ayer", "Ayer"], ["7", "Últimos 7 días"], ["14", "Últimos 14 días"], ["30", "Últimos 30 días"], ["mes", "Este mes"], ["mespasado", "Mes pasado"], ["todo", "Todo"], ["custom", "Personalizado"]];
    const big = (l, v, cls, s) => `<div class="kpi"><div class="l">${l}</div><div class="v"><span class="pill ${cls}" style="font-size:22px;padding:4px 12px">${v}</span></div><div class="s">${s}</div></div>`;
    body = `<div class="toolbar"><select id="fb-preset">${presets.map(([v, l]) => `<option value="${v}" ${v === f.preset ? "selected" : ""}>${l}</option>`).join("")}</select>
      <label class="hint">Desde</label><input type="date" id="fb-desde" value="${esc(d1 < "2001" ? (beeping.rows.map(r => r.fecha).sort()[0] || "") : d1)}">
      <label class="hint">Hasta</label><input type="date" id="fb-hasta" value="${esc(d2 > "2998" ? today() : d2)}">
      <span class="hint">${esc(beeping.fuente || "Sin datos")}${beeping.fecha ? " · " + new Date(beeping.fecha).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>
      <span class="grow"></span><button class="btn sec" id="fb-reload">🔄 Actualizar</button></div>
    ${beeping.error ? `<div class="card hint">⚠️ ${esc(beeping.error)}</div>` : ""}
    <div class="grid">
      ${big("% Confirmación", pct(t.pConf), semaf(t.pConf, OBJ.conf, OBJ.confAviso), `${t.confirmados} confirmados de ${t.generados} generados`)}
      ${big("% Entrega", pct(t.pEnt), semaf(t.pEnt, .85, .7), `${t.entregados} entregados · ${t.devueltos} devueltos`)}
      ${EQ ? big("% Devoluciones", pct(t.confirmados ? t.devueltos / t.confirmados : null), t.confirmados && t.devueltos / t.confirmados > .15 ? "bad" : "ok", "Sobre los confirmados") + kpi("Pedidos generados", t.generados, `${t.confirmados} confirmados · ${t.entregados} entregados`)
        : big("Beneficio (resultado)", eur(t.beneficio), t.beneficio > 0 ? "ok" : "bad", `Ingresos entregados ${eur(t.ingresos)}`) + big("% Beneficio", pct(t.pBen), semaf(t.pBen, .2, .05), "Sobre el importe entregado")}
    </div>
    ${EQ ? "" : `<div class="grid" style="margin-top:12px">
      ${kpi("Ventas generadas", eur(t.ventas), `${t.generados} pedidos`)}
      ${kpi("Gasto en publicidad", eur(t.inversion), `ROAS real ${x2(t.roas)} · CPA entregado ${eur(t.cpa)}`)}
      ${kpi("Producto + logística", eur(t.costes), "Producto, envío, picking, COD y financiero")}
    </div>`}
    <p class="hint">El % de entrega de los últimos días sube a medida que llegan los pedidos (marcados «en curso»).${EQ ? "" : " Si un día no tiene gasto de publicidad en el Sheet, su beneficio aparece sin descontarlo."}</p>` +
    table("bee", [
      { k: "fecha", label: "Fecha", h: r => fdate(r.fecha) + (r.fecha >= hace7 ? ` <span class="hint">en curso</span>` : "") },
      { k: "generados", label: "Generados", num: 1 }, { k: "confirmados", label: "Confirm.", num: 1 },
      { k: "pConf", label: "% Conf.", num: 1, v: r => r.generados ? r.confirmados / r.generados : null, h: r => { const v = r.generados ? r.confirmados / r.generados : null; return `<span class="pill ${semaf(v, OBJ.conf, OBJ.confAviso)}">${pct(v)}</span>`; } },
      { k: "entregados", label: "Entreg.", num: 1 },
      { k: "pEnt", label: "% Entrega", num: 1, v: r => r.confirmados ? r.entregados / r.confirmados : null, h: r => { const v = r.confirmados ? r.entregados / r.confirmados : null; return `<span class="pill ${semaf(v, .85, .7)}">${pct(v)}</span>`; } },
      { k: "devueltos", label: "Devuel.", num: 1 },
      { k: "ventas", label: "Ventas", num: 1, h: r => eur(r.ventas) }, { k: "ingresos", label: "Entregado", num: 1, h: r => eur(r.ingresos) },
      { k: "inversion", label: "Publicidad", num: 1, h: r => r.inversion ? eur(r.inversion) : `<span class="hint">—</span>` },
      { k: "costes", label: "Costes", num: 1, h: r => eur(r.costes) },
      { k: "ben", label: "Beneficio", num: 1, v: r => r.ingresos - r.costes - r.inversion, h: r => { const b = r.ingresos - r.costes - r.inversion; return `<b style="color:var(--${b >= 0 ? "ok" : "bad"})">${eur(b)}</b>`; } },
      { k: "pBen", label: "% Benef.", num: 1, v: r => r.ingresos ? (r.ingresos - r.costes - r.inversion) / r.ingresos : null, h: r => pct(r.ingresos ? (r.ingresos - r.costes - r.inversion) / r.ingresos : null) }
    ].filter(c => !EQ || !["ventas", "ingresos", "inversion", "costes", "ben", "pBen"].includes(c.k)), rows, beeping.rows.length ? "No hay días en este rango" : "Aún no hay datos de Beeping. Publica la pestaña Registro-Base del Sheet (ver README).");
  } else if (tab === "conf") {
    const hace7 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const stats = C.equipo.map(p => { const l = db.confirmaciones.filter(c => c.persona === p && c.fecha >= hace7);
      const ok = l.reduce((a, c) => a + n(c.confirmados), 0), tot = l.reduce((a, c) => a + n(c.confirmados) + n(c.cancelados) + n(c.noContesta), 0);
      return kpi(`${p} · 7 días`, pct(tot ? ok / tot : null), `${ok} confirmados de ${tot} contactados`); }).join("");
    body = `<div class="grid">${stats}</div><div class="toolbar" style="margin-top:14px"><span class="grow"></span><button class="btn" id="new-conf">+ Registro del día</button></div>` +
      table("conf", [{ k: "fecha", label: "Fecha", h: r => fdate(r.fecha) }, { k: "persona", label: "Persona" },
        { k: "confirmados", label: "Confirmados", num: 1 }, { k: "cancelados", label: "Cancelados", num: 1 }, { k: "noContesta", label: "No contesta", num: 1 },
        { k: "tasa", label: "% Confirmación", num: 1, v: r => { const t = n(r.confirmados) + n(r.cancelados) + n(r.noContesta); return t ? n(r.confirmados) / t : 0; }, h: r => { const t = n(r.confirmados) + n(r.cancelados) + n(r.noContesta); return pct(t ? n(r.confirmados) / t : null); } },
        { k: "notas", label: "Notas" },
        { k: "a", label: "", h: r => `<button class="btn sm sec" data-edit="confirmaciones:${r.id}">Editar</button> <button class="btn sm danger" data-del="confirmaciones:${r.id}">Borrar</button>` }],
        [...db.confirmaciones].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")), "Cada persona apunta al final del día cuántos pedidos confirmó, canceló o no contestaron");
  } else if (tab === "inc") {
    const f = ui.filters.inc || (ui.filters.inc = { est: "abiertas", modo: "beeping" });
    if (EQ) f.modo = "beeping";
    const sw = EQ ? "" : `<div class="tabs" style="border:0;margin-bottom:10px">${[["beeping", "📦 Beeping (automático)"], ["manual", "✍️ Registro manual"]].map(([k, l]) => `<button data-incmodo="${k}" class="${(f.modo || "beeping") === k ? "active" : ""}">${l}</button>`).join("")}</div>`;
    if ((f.modo || "beeping") === "beeping") {
      body = sw + `<iframe id="inc-frame" src="incidencias.html${EQ ? "?modo=equipo" : ""}" title="Incidencias de Beeping" style="width:100%;border:0;min-height:700px;display:block"></iframe>`;
    } else {
    const rows = db.incidencias.filter(i => f.est === "todas" || (f.est === "abiertas" ? ["Abierta", "Gestionada"].includes(i.estado) : i.estado === f.est))
      .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    body = `<div class="grid">${ESTADOS_INC.map(e => kpi(e, db.incidencias.filter(i => i.estado === e).length)).join("")}</div>
    <div class="toolbar" style="margin-top:14px"><select id="fi-est">${[["abiertas", "Abiertas + gestionadas"], ["todas", "Todas"], ...ESTADOS_INC.map(e => [e, e])].map(([v, l]) => `<option value="${v}" ${v === f.est ? "selected" : ""}>${l}</option>`).join("")}</select>
    <span class="grow"></span><button class="btn" id="new-inc">+ Incidencia</button></div>` +
      table("inc", [{ k: "fecha", label: "Fecha", h: r => fdate(r.fecha) }, { k: "pedido", label: "Pedido" }, { k: "cliente", label: "Cliente" },
        { k: "telefono", label: "Teléfono", h: r => r.telefono ? `<a href="https://wa.me/${esc(String(r.telefono).replace(/\D/g, "").replace(/^(?!34)(\d{9})$/, "34$1"))}" target="_blank" rel="noopener">${esc(r.telefono)}</a>` : "" },
        { k: "producto", label: "Producto", v: r => prodName(r.producto) }, { k: "tipo", label: "Tipo" },
        { k: "estado", label: "Estado", h: r => `<span class="pill ${{ Abierta: "bad", Gestionada: "warn", Resuelta: "ok", "No resuelta": "brand" }[r.estado] || ""}">${esc(r.estado)}</span>` },
        { k: "responsable", label: "Responsable" }, { k: "notas", label: "Notas", v: r => (r.notas || "").slice(0, 50) },
        { k: "a", label: "", h: r => `<button class="btn sm sec" data-edit="incidencias:${r.id}">Editar</button> <button class="btn sm danger" data-del="incidencias:${r.id}">Borrar</button>` }], rows, "Sin incidencias en este filtro");
    body = sw + body;
    }
  } else {
    const order = { Alta: 0, Media: 1, Baja: 2 };
    body = `${EQ ? "" : `<div class="toolbar"><span class="grow"></span><button class="btn" id="new-tar">+ Tarea</button></div>`}
    <div class="kanban" style="grid-template-columns:repeat(3,minmax(220px,1fr))">${["Pendiente", "En curso", "Hecha"].map((e, i) => { const l = db.tareas.filter(t => (t.estado || "Pendiente") === e).sort((a, b) => order[a.prioridad] - order[b.prioridad]);
      return `<div class="col"><h4>${e}<span>${l.length}</span></h4>${l.map(t => `<div class="kc"><div class="t">${esc(t.titulo)}</div>
        <div class="m"><span class="pill ${{ Alta: "bad", Media: "warn", Baja: "info" }[t.prioridad] || ""}">${esc(t.prioridad || "")}</span> ${esc(t.responsable || "")}${t.fecha ? " · " + fdate(t.fecha) : ""}</div>
        ${t.notas ? `<div>${esc(t.notas.slice(0, 100))}</div>` : ""}
        ${EQ ? "" : `<div class="a">${i > 0 ? `<button class="btn sm sec" data-tmv="${t.id}" data-d="-1">←</button>` : ""}${i < 2 ? `<button class="btn sm sec" data-tmv="${t.id}" data-d="1">→</button>` : ""}
        <button class="btn sm sec" data-edit="tareas:${t.id}">Editar</button><button class="btn sm danger" data-del="tareas:${t.id}">✕</button></div>`}</div>`).join("")}</div>`; }).join("")}</div>`;
  }
  return `<h1>Equipo logístico</h1><div class="sub">Confirmaciones COD por WhatsApp, incidencias de envío y tareas del equipo (${C.equipo.slice(1).join(" y ")}).</div>${tabsHtml}${body}`;
};
views.logistica.bind = () => {
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on("#new-conf", () => openForm("Registro de confirmaciones", F_CONF, { persona: me() }, r => save("confirmaciones", r)));
  on("#new-inc", () => openForm("Nueva incidencia", F_INC, { responsable: me(), estado: "Abierta" }, r => save("incidencias", r)));
  on("#new-tar", () => openForm("Nueva tarea", F_TAR, { responsable: me(), estado: "Pendiente" }, r => save("tareas", r)));
  const s = $("#fi-est"); if (s) s.onchange = e => { ui.filters.inc.est = e.target.value; render(); };
  const fmt = $("#fm-tipo"); if (fmt) fmt.onchange = e => { ui.filters.mot.tipo = e.target.value; render(); };
  document.querySelectorAll("[data-motcat]").forEach(el => el.onclick = () => { ui.filters.mot.cat = el.dataset.motcat; render(); });
  const fmc = $("#fm-clear"); if (fmc) fmc.onclick = e => { e.preventDefault(); ui.filters.mot.cat = ""; render(); };
  document.querySelectorAll("[data-incmodo]").forEach(bt => bt.onclick = () => { ui.filters.inc.modo = bt.dataset.incmodo; render(); });
  const fr = $("#inc-frame");
  if (fr) { clearInterval(fr._h); const fit = () => { try { const h = fr.contentDocument.documentElement.scrollHeight; if (h && Math.abs(fr.offsetHeight - h) > 4) fr.style.height = h + "px"; } catch (e) {} }; fr.onload = fit; window._incFit && clearInterval(window._incFit); window._incFit = setInterval(fit, 700); }
  const fb = ui.filters.bee;
  const p = $("#fb-preset"); if (p) p.onchange = e => { fb.preset = e.target.value; if (fb.preset === "custom" && !fb.desde) { fb.desde = $("#fb-desde").value; fb.hasta = $("#fb-hasta").value; } render(); };
  const fix = () => { fb.desde = $("#fb-desde").value; fb.hasta = $("#fb-hasta").value; if (fb.desde && fb.hasta && fb.desde > fb.hasta) [fb.desde, fb.hasta] = [fb.hasta, fb.desde]; fb.preset = "custom"; render(); };
  const d1 = $("#fb-desde"); if (d1) d1.onchange = fix;
  const d2 = $("#fb-hasta"); if (d2) d2.onchange = fix;
  on("#fb-reload", async () => { await loadBeeping(); render(); toast("Datos de Beeping actualizados"); });
};

/* ----- Competencia ----- */
const adsLib = c => c.adsLibraryUrl || `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ES&q=${encodeURIComponent(c.nombre)}&search_type=keyword_unordered`;
const F_COMP = [
  { k: "nombre", label: "Marca" }, { k: "producto", label: "Compite con", type: "select", opts: prodOpts() },
  { k: "web", label: "Web" }, { k: "adsLibraryUrl", label: "URL en Ads Library", hint: "Si lo dejas vacío, se busca por nombre" },
  { k: "oferta", label: "Precio / oferta" }, { k: "anunciosActivos", label: "Anuncios activos", type: "number" }, { k: "nuevos7d", label: "Nuevos en 7 días", type: "number" },
  { k: "angulos", label: "Ángulos principales", full: 1 }, { k: "notas", label: "Notas", type: "textarea", full: 1 }];
const fAnuncio = () => [
  { k: "competidor", label: "Competidor", type: "select", opts: db.competidores.map(c => [c.id, c.nombre]) },
  { k: "fechaVisto", label: "Visto el", type: "date", def: today() },
  { k: "angulo", label: "Ángulo" }, { k: "formato", label: "Formato", type: "select", opts: C.formatos },
  { k: "diasActivo", label: "Días activo", type: "number", hint: "Cuanto más tiempo, más probable que les funcione" },
  { k: "oferta", label: "Oferta que usa" }, { k: "hook", label: "Hook", full: 1 },
  { k: "link", label: "Enlace al anuncio", full: 1 }, { k: "notas", label: "Qué podemos copiar / mejorar", type: "textarea", full: 1 }];
views.competencia = () => {
  const [tab, tabsHtml] = tabs("competencia", [["comp", "Competidores"], ["anu", "Anuncios vistos"], ["ang", "Ángulos de la competencia"]]);
  const cName = id => (db.competidores.find(c => c.id === id) || {}).nombre || "—";
  const cProd = id => (db.competidores.find(c => c.id === id) || {}).producto;
  let body = "";
  if (tab === "comp") {
    body = `<div class="toolbar"><span class="grow"></span><button class="btn" id="new-comp">+ Competidor</button></div>` + table("comp", [
      { k: "nombre", label: "Marca", h: c => `<span class="name">${esc(c.nombre)}</span>` }, { k: "producto", label: "Compite con", v: c => prodName(c.producto) },
      { k: "anunciosActivos", label: "Anuncios activos", num: 1, v: c => c.anunciosActivos ?? "", h: c => c.anunciosActivos != null && c.anunciosActivos !== "" ? `<b>${c.anunciosActivos}</b>` : `<span class="hint">—</span>` },
      { k: "nuevos7d", label: "Nuevos 7 días", num: 1, v: c => c.nuevos7d ?? "", h: c => c.nuevos7d ? `<span class="pill ${n(c.nuevos7d) >= 10 ? "bad" : "warn"}">+${c.nuevos7d}</span>` : `<span class="hint">—</span>` },
      { k: "max", label: "Más longevo (días)", num: 1, v: c => Math.max(n(c.masLongevoDias), 0, ...db.anuncios.filter(a => a.competidor === c.id).map(a => n(a.diasActivo))) },
      { k: "oferta", label: "Oferta", h: c => `<span style="white-space:normal">${esc(c.oferta || c.precio || "")}</span>` },
      { k: "angulos", label: "Ángulos", h: c => `<span style="white-space:normal;font-size:12px">${esc(c.angulos || "")}</span>` },
      { k: "nAnu", label: "Anuncios guardados", num: 1, v: c => db.anuncios.filter(a => a.competidor === c.id).length },
      { k: "links", label: "", h: c => `<a class="btn sm sec" href="${esc(adsLib(c))}" target="_blank" rel="noopener">Ads Library</a>${c.web ? ` <a class="btn sm sec" href="${esc(c.web)}" target="_blank" rel="noopener">Web</a>` : ""}` },
      { k: "a", label: "", h: c => `<button class="btn sm sec" data-edit="competidores:${c.id}">Editar</button> <button class="btn sm danger" data-del="competidores:${c.id}">Borrar</button>` }],
      db.competidores, "Sin competidores");
  } else if (tab === "anu") {
    body = `<div class="toolbar"><span class="hint">Apunta los anuncios que ves en la Ads Library, sobre todo los que llevan muchos días activos.</span><span class="grow"></span><button class="btn" id="new-anu">+ Anuncio visto</button></div>` + table("anu", [
      { k: "fechaVisto", label: "Visto", h: a => fdate(a.ultimaVez || a.fechaVisto) }, { k: "competidor", label: "Competidor", v: a => cName(a.competidor) },
      { k: "prod", label: "Producto", v: a => prodName(cProd(a.competidor)) }, { k: "angulo", label: "Ángulo" }, { k: "formato", label: "Formato" },
      { k: "diasActivo", label: "Días activo", num: 1, v: a => n(a.diasActivo) }, { k: "oferta", label: "Oferta" }, { k: "hook", label: "Hook", v: a => (a.hook || "").slice(0, 50) },
      { k: "a", label: "", h: a => `${a.link ? `<a class="btn sm sec" href="${esc(a.link)}" target="_blank" rel="noopener">Ver</a> ` : ""}<button class="btn sm sec" data-edit="anuncios:${a.id}">Editar</button> <button class="btn sm danger" data-del="anuncios:${a.id}">Borrar</button>` }],
      [...db.anuncios].sort((a, b) => n(b.diasActivo) - n(a.diasActivo)), "Aún no has registrado anuncios de la competencia");
  } else {
    const g = {};
    db.anuncios.forEach(a => { const k = `${cProd(a.competidor) || "—"}|${(a.angulo || "Sin ángulo").trim()}`; const x = g[k] || (g[k] = { k, n: 0, max: 0, marcas: new Set(), formatos: new Set() });
      x.n++; x.max = Math.max(x.max, n(a.diasActivo)); x.marcas.add(cName(a.competidor)); if (a.formato) x.formatos.add(a.formato); });
    const ours = new Set(db.creativos.map(c => `${c.producto}|${(c.angulo || "").toLowerCase()}`).concat(db.produccion.map(c => `${c.producto}|${camel(c.angulo).toLowerCase()}`)));
    const rows = Object.values(g).map(x => ({ ...x, prod: x.k.split("|")[0], ang: x.k.split("|")[1], marcasT: [...x.marcas].join(", "), formatosT: [...x.formatos].join(", "),
      probado: ours.has(`${x.k.split("|")[0]}|${camel(x.k.split("|")[1]).toLowerCase()}`) }));
    body = `<p class="sub">Ángulos que usa la competencia, cuántas marcas los repiten y cuánto tiempo los mantienen activos. «Sin probar» = oportunidad para Aurialo.</p>` + table("ang", [
      { k: "ang", label: "Ángulo", h: x => `<span class="name">${esc(x.ang)}</span>` }, { k: "prod", label: "Producto", v: x => prodName(x.prod) },
      { k: "n", label: "Anuncios", num: 1 }, { k: "max", label: "Máx. días activo", num: 1 }, { k: "marcasT", label: "Marcas" }, { k: "formatosT", label: "Formatos" },
      { k: "probado", label: "¿Lo usamos?", v: x => x.probado ? 1 : 0, h: x => x.probado ? `<span class="pill ok">Ya probado</span>` : `<span class="pill warn">Sin probar</span>` }],
      rows, "Registra anuncios para ver los ángulos");
  }
  const R = db.sistema.find(x => x.id === "competencia");
  const rep = R ? `<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h3 style="margin:0">🤖 Informe del agente${R.semana ? " · semana del " + fdate(R.semana) : ""}</h3>
    <span class="hint">Actualizado ${new Date(R.fecha).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}${R.docUrl ? ` · <a href="${esc(R.docUrl)}" target="_blank" rel="noopener">Ver informe completo</a>` : ""}</span></div>
    <div class="two" style="margin-top:8px"><div><b>Resumen</b><ul class="rules">${(R.resumen || []).map(l => `<li>${esc(l)}</li>`).join("")}</ul></div>
    <div><b>Qué probar esta semana</b><ol class="rules">${(R.acciones || []).map(l => `<li>${esc(l)}</li>`).join("")}</ol></div></div></div>` : "";
  return `<h1>Competencia</h1><div class="sub">Qué hacen Resilea, Sonvital, Menoesp y compañía, y qué ángulos les funcionan.</div>${rep}${tabsHtml}${body}`;
};
views.competencia.bind = () => {
  const b = $("#new-comp"); if (b) b.onclick = () => openForm("Nuevo competidor", F_COMP, {}, r => save("competidores", r));
  const a = $("#new-anu"); if (a) a.onclick = () => { if (!db.competidores.length) return toast("Añade primero un competidor"); openForm("Anuncio de la competencia", fAnuncio(), {}, r => save("anuncios", r)); };
};

/* ----- Ajustes ----- */
views.ajustes = () => `<h1>Ajustes</h1>
  <div class="card"><h3>Conexión</h3><p>Estado: <b>${online ? "conectado a Supabase ✅" : "sin conexión (modo local) ⚠️"}</b></p>
  <p class="hint">Proyecto: <code>${esc(C.supabaseUrl)}</code> · tabla <code>${esc(C.tabla)}</code> · claves <code>${esc(C.prefijo)}*</code> · se refresca cada ${C.refrescoSegundos} s.</p>
  <button class="btn sec" id="reload">🔄 Recargar datos</button></div>
  <div class="card"><h3>Copia de seguridad</h3><p class="hint">Copia todos los datos en formato JSON para guardarlos donde quieras, o restaura una copia anterior.</p>
  <button class="btn sec" id="bk-copy">📋 Copiar copia de seguridad</button> <button class="btn sec" id="bk-rest">♻️ Restaurar copia</button></div>
  <div class="card"><h3>Reglas de decisión de Meta Ads</h3><ul class="rules">
    <li>«En test»: menos de ${C.reglas.diasMinimos} días o menos de ${eur(C.reglas.gastoMinimo)} gastados</li>
    <li>«Ganador»: ${C.reglas.comprasGanador}+ compras y ROAS ≥ ${C.reglas.roasGanador}×</li>
    <li>«Prometedor»: ROAS ≥ ${C.reglas.roasPrometedor}×</li>
    <li>«No relanzar»: ROAS &lt; ${C.reglas.roasDescartar}× o ${eur(C.reglas.gastoSinVentas)} gastados sin ventas</li></ul>
  <p class="hint">Se cambian en <code>config.js</code> del repositorio.</p></div>`;
views.ajustes.bind = () => {
  $("#reload").onclick = async () => { await load(); render(); toast("Datos recargados"); };
  $("#bk-copy").onclick = () => { const txt = JSON.stringify(db, null, 1);
    openModal("Copia de seguridad", `<textarea id="bk" style="min-height:260px">${esc(txt)}</textarea><div class="form-actions"><button class="btn" id="bk-c">Copiar</button></div>`);
    $("#bk-c").onclick = async () => { try { await navigator.clipboard.writeText(txt); toast("Copiado"); } catch { $("#bk").select(); document.execCommand("copy"); toast("Copiado"); } }; };
  $("#bk-rest").onclick = () => {
    openModal("Restaurar copia", `<p class="hint">Pega el JSON de una copia. Los registros con el mismo id se sobrescriben; no se borra nada.</p><textarea id="bk" style="min-height:220px"></textarea><div class="form-actions"><button class="btn" id="bk-r">Restaurar</button></div>`);
    $("#bk-r").onclick = async () => { let d; try { d = JSON.parse($("#bk").value); } catch { return toast("JSON no válido"); }
      for (const c of COLS) if (Array.isArray(d[c])) await saveMany(c, d[c]); closeModal(); render(); toast("Copia restaurada"); };
  };
};

/* ----- Notas del equipo (observaciones, dudas y feedback) ----- */
const TIPOS_NOTA = ["Observación", "Incidencia de pedido", "Idea / mejora", "Duda para Cristian"].concat(EQ ? [] : ["Feedback de Cristian"]);
const TIPO_CLS = { "Observación": "info", "Incidencia de pedido": "bad", "Idea / mejora": "ok", "Duda para Cristian": "warn", "Feedback de Cristian": "brand" };
const fechaHora = iso => iso ? new Date(iso).toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
function notaCard(x) {
  const mia = x.autor === me() || !EQ;
  return `<div class="card" style="margin-bottom:10px;${x.fijada ? "border-left:4px solid var(--brand)" : ""}">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><b style="color:var(--strong)">${esc(x.autor)}</b> <span class="pill ${TIPO_CLS[x.tipo] || ""}">${esc(x.tipo)}</span>${x.pedido ? ` <span class="hint">Pedido ${esc(x.pedido)}</span>` : ""}${x.fijada ? ` <span class="hint">📌 fijada</span>` : ""}</div>
    <span class="hint">${fechaHora(x.fecha)}</span></div>
    <div style="margin-top:6px;white-space:pre-wrap">${esc(x.texto)}</div>
    ${x.respuesta ? `<div style="margin-top:8px;padding:8px 10px;background:var(--brand-soft);border-radius:8px"><b>${esc(x.respondidoPor || "")}</b> <span class="hint">${fechaHora(x.respondidoEn)}</span><div style="white-space:pre-wrap">${esc(x.respuesta)}</div></div>` : ""}
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn sm sec" data-nresp="${x.id}">${x.respuesta ? "Editar respuesta" : "Responder"}</button>
    ${mia ? `<button class="btn sm sec" data-nedit="${x.id}">Editar</button><button class="btn sm danger" data-ndel="${x.id}">Borrar</button>` : ""}
    ${!EQ ? `<button class="btn sm sec" data-nfix="${x.id}">${x.fijada ? "Desfijar" : "📌 Fijar"}</button>` : ""}</div></div>`;
}
function notasView() {
  const f = ui.filters.notas || (ui.filters.notas = { tipo: "", autor: "" });
  const l = db.notas.filter(x => (!f.tipo || x.tipo === f.tipo) && (!f.autor || x.autor === f.autor))
    .sort((a, b) => (b.fijada ? 1 : 0) - (a.fijada ? 1 : 0) || (b.fecha || "").localeCompare(a.fecha || ""));
  return `<div class="toolbar"><select id="fn-tipo"><option value="">Todos los tipos</option>${TIPOS_NOTA.concat(EQ ? ["Feedback de Cristian"] : []).map(t => `<option ${t === f.tipo ? "selected" : ""}>${t}</option>`).join("")}</select>
    <select id="fn-autor"><option value="">Todo el equipo</option>${C.equipo.map(t => `<option ${t === f.autor ? "selected" : ""}>${t}</option>`).join("")}</select>
    <span class="hint">Observaciones del día, pedidos con algo raro, ideas y dudas para Cristian. Cristian responde aquí mismo.</span><span class="grow"></span><button class="btn" id="new-nota">+ Nota</button></div>
    ${l.length ? l.map(notaCard).join("") : `<div class="card empty">Todavía no hay notas</div>`}`;
}
function editNota(rec) {
  openForm(rec ? "Editar nota" : "Nueva nota", [
    { k: "tipo", label: "Tipo", type: "select", opts: TIPOS_NOTA, def: "Observación" }, { k: "pedido", label: "Nº de pedido (opcional)", ph: "#7393" },
    { k: "texto", label: "Nota", type: "textarea", full: 1 }], rec, r => save("notas", { ...r, autor: r.autor || me(), fecha: r.fecha || new Date().toISOString() }));
}
function responderNota(x) {
  openForm("Responder", [{ k: "respuesta", label: `Respuesta a ${x.autor}`, type: "textarea", full: 1 }], x,
    r => save("notas", { ...r, respondidoPor: me(), respondidoEn: new Date().toISOString() }));
}
document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t) return; const d = t.dataset;
  if (t.id === "new-nota") editNota();
  if (d.nedit) editNota(db.notas.find(x => x.id === d.nedit));
  if (d.nresp) responderNota(db.notas.find(x => x.id === d.nresp));
  if (d.ndel) armDelete(t, async () => { await remove("notas", d.ndel); render(); });
  if (d.nfix) { const x = db.notas.find(y => y.id === d.nfix); x.fijada = !x.fijada; await save("notas", x); render(); }
});
document.addEventListener("change", e => {
  if (e.target.id === "fn-tipo") { ui.filters.notas.tipo = e.target.value; render(); }
  if (e.target.id === "fn-autor") { ui.filters.notas.autor = e.target.value; render(); }
});

/* ----- Mi panel (equipo logístico) ----- */
function semanas(n) {
  const out = [], lunes = d => { const x = new Date(d); const w = (x.getDay() + 6) % 7; x.setDate(x.getDate() - w); return x; };
  let ini = lunes(new Date());
  for (let i = 0; i < n; i++) {
    const a = new Date(ini); a.setDate(a.getDate() - 7 * i); const b = new Date(a); b.setDate(b.getDate() + 6);
    const A = a.toLocaleDateString("sv-SE"), B = b.toLocaleDateString("sv-SE");
    out.push({ desde: A, hasta: B, t: aggBeeping(beeping.rows.filter(r => r.fecha >= A && r.fecha <= B)), enCurso: i < 2 });
  }
  return out;
}
views.mipanel = () => {
  const yo = me(), dIso = k => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
  const b7 = aggBeeping(beeping.rows.filter(r => r.fecha >= dIso(6)));
  const bc = aggBeeping(beeping.rows.filter(r => r.fecha >= dIso(13) && r.fecha <= dIso(7)));
  const bp = aggBeeping(beeping.rows.filter(r => r.fecha >= dIso(20) && r.fecha <= dIso(14)));
  const bd = aggBeeping(beeping.rows.filter(r => r.fecha >= dIso(41) && r.fecha <= dIso(14)));   // las devoluciones tardan semanas en registrarse
  const devol = bd.confirmados ? bd.devueltos / bd.confirmados : null;
  const inc = db.sistema.find(x => x.id === "inc_resumen"), mot = db.sistema.find(x => x.id === "motivos");
  const canc = mot ? (mot.registros || []).filter(r => r.tipo === "cancelado") : [];
  const sinMot = canc.length ? canc.filter(r => r.categoria.startsWith("Ya no lo quiere")).length / canc.length : null;
  const sh = db.sistema.find(x => x.id === "shopify"), hoyISO = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  const sHoy = sh && (sh.dias || []).find(d => d.fecha === hoyISO);
  const misTar = db.tareas.filter(t => t.responsable === yo && t.estado !== "Hecha").sort((a, b) => (a.fecha || "9").localeCompare(b.fecha || "9"));
  const vencidas = misTar.filter(t => t.fecha && t.fecha < today());
  const regs = db.confirmaciones.filter(c => c.persona === yo && c.fecha >= dIso(6));
  const fb = db.notas.filter(x => x.tipo === "Feedback de Cristian").sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")).slice(0, 3);
  const misDudas = db.notas.filter(x => x.autor === yo && x.respuesta && x.respondidoEn && Date.now() - new Date(x.respondidoEn).getTime() < 7 * 864e5);
  const flecha = (a, b) => a == null || b == null ? "" : a > b + .01 ? ` <span style="color:var(--ok)">▲ ${Math.round((a - b) * 100)} pts</span>` : a < b - .01 ? ` <span style="color:var(--bad)">▼ ${Math.round((b - a) * 100)} pts</span>` : ` <span class="hint">= igual</span>`;
  const msgs = [];
  if (b7.pConf != null) msgs.push(b7.pConf >= OBJ.confTop ? ["ok", `Confirmación de los últimos 7 días: <b>${pct(b7.pConf)}</b>, objetivo cumplido (${objConf()}). ¡Muy bien!`]
    : b7.pConf >= OBJ.conf ? ["ok", `Confirmación de los últimos 7 días: <b>${pct(b7.pConf)}</b>, dentro del objetivo (${objConf()}). A por el ${Math.round(OBJ.confTop * 100)} %.`]
    : ["warn", `Confirmación de los últimos 7 días: <b>${pct(b7.pConf)}</b>, por debajo del objetivo (${objConf()}). Faltan ${Math.round((OBJ.conf - b7.pConf) * 100)} puntos: insistid con una segunda llamada o WhatsApp a quien no contesta.`]);
  if (bc.pEnt != null) msgs.push(bc.pEnt >= OBJ.entrega ? ["ok", `Entrega de la semana cerrada: <b>${pct(bc.pEnt)}</b>, objetivo cumplido.`] : ["warn", `Entrega de la semana cerrada: <b>${pct(bc.pEnt)}</b> (objetivo ${pct(OBJ.entrega)}). Revisad las incidencias antes de que Beeping las devuelva.`]);
  if (inc) msgs.push(inc.sinGestionar ? ["bad", `Hay <b>${inc.sinGestionar} incidencias de Beeping sin gestionar</b>${inc.masAntigua ? `; la más antigua lleva ${inc.masAntigua} días` : ""}. Es lo primero de hoy.`] : ["ok", "Ninguna incidencia de Beeping sin gestionar. ¡Perfecto!"]);
  if (sinMot != null && sinMot > OBJ.sinMotivo) msgs.push(["warn", `En el <b>${pct(sinMot)}</b> de las cancelaciones no consta el motivo real. Preguntad siempre «¿por qué ha cambiado de idea?» y anotadlo en la hoja.`]);
  if (vencidas.length) msgs.push(["bad", `Tienes <b>${vencidas.length} tarea${vencidas.length > 1 ? "s" : ""} vencida${vencidas.length > 1 ? "s" : ""}</b>.`]);
  if (misDudas.length) msgs.push(["info", `Cristian ha respondido ${misDudas.length} de tus notas esta semana. Míralas en Notas del equipo.`]);
  const sem = semanas(6);
  return `<h1>Hola, ${esc(yo)} 👋</h1><div class="sub">Así va el trabajo del equipo logístico. ${new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</div>
  ${fb.length ? `<div class="card" style="border-left:4px solid var(--brand)"><h3 style="margin:0 0 6px">💬 Feedback de Cristian</h3>${fb.map(x => `<div style="margin:6px 0"><span class="hint">${fechaHora(x.fecha)}</span><div style="white-space:pre-wrap">${esc(x.texto)}</div></div>`).join("")}</div>` : ""}
  <div class="card"><h3 style="margin:0 0 6px">📣 Cómo vamos</h3>${msgs.map(([c, t]) => `<div style="display:flex;gap:8px;align-items:flex-start;margin:6px 0"><span class="pill ${c}" style="min-width:12px">&nbsp;</span><span>${t}</span></div>`).join("") || `<span class="hint">Sin datos todavía</span>`}</div>
  <div class="grid">
    ${kpi("Pedidos hoy", sHoy ? sHoy.pedidos : "—", sh ? `Shopify · actualizado ${new Date(sh.fecha).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : "")}
    ${kpi("% Confirmación · 7 días", `<span class="pill ${semaf(b7.pConf, OBJ.conf, OBJ.confAviso)}" style="font-size:20px">${pct(b7.pConf)}</span>`, `${b7.confirmados} de ${b7.generados} · objetivo ${objConf()}`)}
    ${kpi("% Entrega · semana cerrada", `<span class="pill ${semaf(bc.pEnt, OBJ.entrega, .7)}" style="font-size:20px">${pct(bc.pEnt)}</span>`, `${bc.entregados} de ${bc.confirmados}${flecha(bc.pEnt, bp.pEnt)} vs semana anterior`)}
    ${kpi("% Devoluciones · 4 semanas", `<span class="pill ${devol == null ? "" : devol <= OBJ.devol ? "ok" : "bad"}" style="font-size:20px">${pct(devol)}</span>`, `${bd.devueltos} de ${bd.confirmados} confirmados · máximo ${pct(OBJ.devol)}`)}
    ${kpi("Incidencias sin gestionar", inc ? `<span style="color:var(--${inc.sinGestionar ? "bad" : "ok"})">${inc.sinGestionar}</span>` : "—", inc ? `${inc.zombies || 0} abiertas con envío cerrado · ${inc.total} en total` : "Sincroniza Beeping en Incidencias")}
    ${kpi("Tus tareas pendientes", misTar.length, vencidas.length ? `<span style="color:var(--bad)">${vencidas.length} vencidas</span>` : "Al día")}
  </div>
  <h2>📈 Evolución por semanas</h2>${table("sem", [
    { k: "desde", label: "Semana", h: w => `${fdate(w.desde)} – ${fdate(w.hasta)}${w.enCurso ? ` <span class="hint">en curso</span>` : ""}` },
    { k: "gen", label: "Pedidos", num: 1, h: w => w.t.generados }, { k: "conf", label: "Confirmados", num: 1, h: w => w.t.confirmados },
    { k: "pConf", label: "% Confirmación", num: 1, h: w => `<span class="pill ${semaf(w.t.pConf, OBJ.conf, OBJ.confAviso)}">${pct(w.t.pConf)}</span>` },
    { k: "ent", label: "Entregados", num: 1, h: w => w.t.entregados },
    { k: "pEnt", label: "% Entrega", num: 1, h: w => `<span class="pill ${semaf(w.t.pEnt, OBJ.entrega, .7)}">${pct(w.t.pEnt)}</span>` },
    { k: "dev", label: "Devueltos", num: 1, h: w => w.t.devueltos }], sem.filter(w => w.t.generados))}
  <div class="two">
    <div><h2>✅ Tus tareas</h2>${misTar.length ? misTar.map(t => `<div class="card" style="margin-bottom:8px;padding:10px 12px"><b style="color:var(--strong)">${esc(t.titulo)}</b> <span class="pill ${{ Alta: "bad", Media: "warn", Baja: "info" }[t.prioridad] || ""}">${esc(t.prioridad || "")}</span><div class="hint">${t.fecha ? (t.fecha < today() ? `<span style="color:var(--bad)">venció ${fdate(t.fecha)}</span>` : "para " + fdate(t.fecha)) : "sin fecha"} · ${esc(t.estado || "Pendiente")}</div></div>`).join("") : `<div class="card empty">No tienes tareas pendientes 🎉</div>`}</div>
    <div><h2>📝 Últimas notas</h2>${db.notas.slice().sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")).slice(0, 4).map(notaCard).join("") || `<div class="card empty">Sin notas todavía</div>`}
      <button class="btn" id="new-nota">+ Nota u observación</button></div>
  </div>`;
};

/* ----- PIN del CRM completo (el panel del equipo no lo pide) ----- */
async function sha256(t) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
function pedirPin() {
  return new Promise(res => {
    if (EQ || !C.pinHash || localStorage.getItem("crm_pin") === C.pinHash) return res();
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;background:var(--side);z-index:100;display:flex;align-items:center;justify-content:center";
    ov.innerHTML = `<div class="card" style="width:320px;text-align:center"><h2 style="margin-top:0">🔒 Aurialo CRM</h2><p class="hint">Introduce el PIN de acceso</p>
      <input id="pin-in" type="password" inputmode="numeric" style="width:100%;text-align:center;font-size:22px;letter-spacing:6px" autofocus>
      <div id="pin-err" class="hint" style="color:var(--bad);min-height:18px;margin-top:6px"></div><button class="btn" id="pin-ok" style="width:100%">Entrar</button>
      <p class="hint" style="margin-top:12px">¿Eres del equipo logístico? Entra en <a href="/equipo">aurialo.netlify.app/equipo</a></p></div>`;
    document.body.appendChild(ov);
    const go = async () => { if (await sha256($("#pin-in").value.trim()) === C.pinHash) { localStorage.setItem("crm_pin", C.pinHash); ov.remove(); res(); } else { $("#pin-err").textContent = "PIN incorrecto"; $("#pin-in").value = ""; } };
    $("#pin-ok").onclick = go; $("#pin-in").onkeydown = e => { if (e.key === "Enter") go(); };
  });
}

/* ---------- acciones delegadas ---------- */
document.addEventListener("click", async e => {
  const t = e.target.closest("button,a"); if (!t || !t.dataset) return;
  const d = t.dataset;
  if (d.editCr) editCreativo(db.creativos.find(r => r.id === d.editCr));
  if (d.delCr) armDelete(t, async () => { await remove("creativos", d.delCr); render(); });
  if (d.editP) editProd(db.produccion.find(r => r.id === d.editP));
  if (d.delP) armDelete(t, async () => { await remove("produccion", d.delP); render(); });
  if (d.mv) { const p = db.produccion.find(r => r.id === d.mv); const i = ESTADOS_PROD.indexOf(p.estado || "Idea") + n(d.d); p.estado = ESTADOS_PROD[Math.max(0, Math.min(5, i))]; await save("produccion", p); render(); }
  if (d.tmv) { const S = ["Pendiente", "En curso", "Hecha"]; const tk = db.tareas.find(r => r.id === d.tmv); tk.estado = S[Math.max(0, Math.min(2, S.indexOf(tk.estado || "Pendiente") + n(d.d)))]; await save("tareas", tk); render(); }
  if (d.launch) {
    const p = db.produccion.find(r => r.id === d.launch); p.estado = "Lanzado"; p.fechaLanz = today(); await save("produccion", p);
    const nombre = nombreCreativo(p);
    if (!db.creativos.some(c => c.nombre === nombre)) await save("creativos", { nombre, producto: p.producto, angulo: camel(p.angulo), ident: camel(p.ident), formato: p.formato, fechaLanz: today(), notas: p.hook ? "Hook: " + p.hook : "" });
    toast(`🚀 ${nombre} enviado a Meta Ads`); render();
  }
  if (d.iter) { const c = db.creativos.find(r => r.id === d.iter); editProd({ producto: c.producto, angulo: c.angulo, ident: "", formato: c.formato, estado: "Idea", fechaPrev: nextLaunch(), responsable: me(), notas: `Iteración de ${c.nombre}` }); }
  if (d.edit) { const [col, id] = d.edit.split(":"); const rec = db[col].find(r => r.id === id);
    const spec = { confirmaciones: F_CONF, incidencias: F_INC, tareas: F_TAR, competidores: F_COMP, anuncios: fAnuncio() }[col];
    openForm("Editar", spec, rec, r => save(col, r)); }
  if (d.del) { const [col, id] = d.del.split(":"); armDelete(t, async () => { await remove(col, id); render(); }); }
});

/* ---------- render y arranque ---------- */
function banner() {
  const w = new Date().getDay(); const p = [];
  if (EQ) { $("#banner").innerHTML = ""; return; }
  if ([1, 3, 5].includes(w)) p.push(`<span class="pill info">📊 Hoy toca reporte de creativos</span>`);
  if ([2, 4].includes(w)) p.push(`<span class="pill ok">🚀 Día de lanzamiento de creativos</span>`);
  if ([5, 6, 0].includes(w)) p.push(`<span class="pill warn">✋ No escalar ni pausar conjuntos (viernes a domingo)</span>`);
  $("#banner").innerHTML = p.join("");
}
function render() {
  banner();
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.view === ui.view));
  $("#view").innerHTML = views[ui.view]();
  views[ui.view].bind && views[ui.view].bind();
}
const NAV = EQ ? [["mipanel", "🏠 Mi panel"], ["logistica", "📦 Logística"]]
  : [["panel", "📊 Panel"], ["meta", "📈 Meta Ads"], ["creativo", "🎬 Director creativo"], ["logistica", "📦 Equipo logístico"], ["competencia", "🔎 Competencia"], ["ajustes", "⚙️ Ajustes"]];
$("#nav").innerHTML = NAV.map(([k, l]) => `<button data-view="${k}">${l}</button>`).join("")
  + (!EQ ? `<a href="/equipo" target="_blank" rel="noopener" style="display:block;margin-top:12px;padding:10px 12px;border-radius:8px;color:var(--side-text);text-decoration:none;border:1px dashed #2c4475">👥 Ver panel del equipo ↗</a>`
    : (C.pinHash && localStorage.getItem("crm_pin") === C.pinHash ? `<a href="/" style="display:block;margin-top:12px;padding:10px 12px;border-radius:8px;color:var(--side-text);text-decoration:none;border:1px dashed #2c4475">← Volver a mi CRM</a>` : ""));
if (EQ) { ui.view = "mipanel"; document.title = "Aurialo · Equipo logístico"; document.querySelector(".brand").innerHTML = '<span class="dot"></span>Aurialo <b>Logística</b>'; }
$("#nav").onclick = e => { const b = e.target.closest("button"); if (b) { ui.view = b.dataset.view; location.hash = ui.view; render(); } };
if (EQ && !localStorage.getItem("crm_yo")) localStorage.setItem("crm_yo", C.equipo.find(p => p !== "Cristian") || C.equipo[0]);
$("#yo").innerHTML = C.equipo.map(p => `<option ${p === me() ? "selected" : ""}>${p}</option>`).join("");
$("#yo").onchange = e => { localStorage.setItem("crm_yo", e.target.value); render(); };

(async () => {
  await pedirPin();
  const h = location.hash.slice(1); if (views[h] && NAV.some(([k]) => k === h)) ui.view = h;
  await load();
  await loadBeeping();
  if (online && !db.competidores.length && !db.sistema.some(s => s.id === "seed")) {
    for (const c of C.competidoresIniciales) await save("competidores", { ...c });
    await save("sistema", { id: "seed", fecha: today() });
  }
  render();
  setInterval(async () => { if (!$("#modal").classList.contains("hidden") || ["INPUT", "TEXTAREA", "IFRAME"].includes(document.activeElement?.tagName) || $("#inc-frame")) return; await load(); if (!C.beepingCsvUrl || Date.now() - new Date(beeping.fecha || 0).getTime() > 5 * 60e3) await loadBeeping(); render(); }, C.refrescoSegundos * 1000);
})();
})();
