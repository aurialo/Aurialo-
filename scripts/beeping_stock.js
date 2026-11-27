/* Stock de Beeping → CRM de Aurialo.
   Se ejecuta DENTRO de https://newapp.gobeeping.com con la sesión de Cristian iniciada
   (lo lanza el agente «Stock Beeping» con el navegador integrado, o el marcador del CRM).
   Lee el stock de cada producto y las unidades enviadas en los últimos días (pedidos procesados),
   calcula cuántos días de stock quedan, hasta cuándo se puede pedir sin rotura y cuánto pedir y lo guarda en Supabase (crm:sistema:stock).
   El token de Beeping solo se usa aquí, en la propia página: no se guarda en ningún sitio.
   No guarda datos de clientes: solo cifras por producto. Devuelve un resumen. */
(async () => {
  const SB = "https://eaimghtolwqfuonxzfen.supabase.co/rest/v1/aurialo";
  const K = "sb_publishable_DxXd5Wa0XUOwClz8SxmYkw_thtcOA82";
  const AVISO = 20;                           // avisar para pedir cuando queden 20 días de stock
  const PLAZO_LAB = 14;                       // 10–12 días laborables del proveedor + 2 de Beeping
  const COBERTURA = 30;                       // el pedido sugerido cubre 30 días más tras recibirlo
  const sumaLab = (d, n) => { d = new Date(d); while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) n--; } return d; };
  const llegada = sumaLab(Date.now(), PLAZO_LAB), plazoCal = Math.round((llegada - Date.now()) / 864e5);
  if (!/gobeeping\.com/.test(location.host)) throw new Error("Abre newapp.gobeeping.com con la sesión iniciada");
  const a = JSON.parse(localStorage.getItem("auth-storage") || "null");
  const t = a && (a.state || a).token;
  if (!t) throw new Error("No hay sesión de Beeping iniciada en este navegador");
  const H = { headers: { Authorization: "Bearer " + t, Accept: "application/json" } };
  const g = async u => { const r = await fetch("https://api.gobeeping.com/api/v1/" + u, H); if (!r.ok) throw new Error("Beeping HTTP " + r.status + " en " + u.split("?")[0]); return r.json(); };
  const madrid = d => new Date(d).toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  const hoy = madrid(Date.now());
  const hace = k => madrid(Date.now() - k * 864e5);

  const prods = (await g("products?per_page=100")).data;
  // Pedidos: la API los devuelve del más antiguo al más reciente → leemos las últimas páginas
  const meta = (await g("orders?per_page=100")).meta;
  let L = [];
  for (let p = meta.lastPage; p >= 1 && p > meta.lastPage - 6; p--) {
    const d = (await g("orders?per_page=100&page=" + p)).data;
    L = L.concat(d);
    const masViejo = d.map(o => o.order_created_at).sort()[0];
    if (masViejo && masViejo.slice(0, 10) < hace(20)) break;
  }
  const ud = {};   // product_id → { e7, e14, porConfirmar, porDia: {fecha: uds} }
  const add = (pid, k, q) => { const x = ud[pid] || (ud[pid] = { e7: 0, e14: 0, porConfirmar: 0, dias: {} }); x[k] += q; };
  L.forEach(o => {
    const proc = o.shipment && o.shipment.processed_at;
    const est = (o.status && o.status.description) || "";
    (o.lines || []).forEach(l => {
      if (!l.product_id) return;
      const q = Number(l.qty) || 0;
      if (proc && !o.canceled_at) {
        const f = String(proc).slice(0, 10);
        if (f >= hace(6)) add(l.product_id, "e7", q);
        if (f >= hace(13)) { add(l.product_id, "e14", q); ud[l.product_id].dias[f] = (ud[l.product_id].dias[f] || 0) + q; }
      } else if (/confirmar/i.test(est)) add(l.product_id, "porConfirmar", q);
    });
  });

  // historial previo (para la evolución del stock)
  let prev = null;
  try { const r = await fetch(SB + "?select=valor&clave=eq.crm:sistema:stock", { headers: { apikey: K, Authorization: "Bearer " + K } }); const j = await r.json(); prev = j[0] && j[0].valor; if (typeof prev === "string") prev = JSON.parse(prev); } catch (e) {}
  const hist = (prev && prev.historial) || {};

  const productos = prods.map(p => {
    const s = p.stock || {}, u = ud[p.id] || { e7: 0, e14: 0, porConfirmar: 0, dias: {} };
    const porDia = Math.max(u.e14 / 14, u.e7 / 7);   // ritmo prudente: el mayor de 7 y 14 días
    const dias = porDia > 0 && u.e14 >= 3 ? (s.disponible || 0) / porDia : null;
    const estado = (s.disponible || 0) <= 0 && u.e14 >= 3 ? "agotado" : dias == null ? (s.disponible ? "sin ventas" : "sin stock") : dias < plazoCal ? "rotura" : dias <= AVISO ? "pedir ya" : "ok";
    const pedirAntes = dias == null ? null : madrid(Date.now() + Math.max(0, dias - plazoCal) * 864e5);
    const sugerido = porDia > 0 && u.e14 >= 3 ? Math.max(0, Math.ceil(porDia * (plazoCal + COBERTURA) - (s.disponible || 0) - (s.entrante || 0))) : 0;
    return { id: p.id, nombre: p.name, code: p.code, estadoBeeping: p.status, disponible: s.disponible || 0, entrante: s.entrante || 0, reservado: s.reservado || 0, bloqueado: s.bloqueado || 0,
      enviadas7: u.e7, enviadas14: u.e14, porDia: Math.round(porDia * 100) / 100, diasCobertura: dias == null ? null : Math.round(dias * 10) / 10,
      agotaEl: dias == null ? null : madrid(Date.now() + dias * 864e5), porConfirmar: u.porConfirmar, estado, pedirAntes, sugerido, llegariaEl: madrid(llegada),
      tiendas: (p.linked_products || []).map(x => x.title && x.title.trim()).filter(Boolean), ventasDia: u.dias };
  });
  hist[hoy] = Object.fromEntries(productos.map(p => [p.id, p.disponible]));
  Object.keys(hist).sort().slice(0, -90).forEach(k => delete hist[k]);
  const valor = { id: "stock", fecha: new Date().toISOString(), fuente: "Beeping", aviso: AVISO, plazoLaborables: PLAZO_LAB, plazoDias: plazoCal, cobertura: COBERTURA, productos, historial: hist };
  const r = await fetch(SB, { method: "POST", headers: { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ clave: "crm:sistema:stock", valor, actualizado: valor.fecha }]) });
  if (!r.ok) throw new Error("Supabase HTTP " + r.status);
  return { ok: true, productos: productos.map(p => ({ nombre: p.nombre, code: p.code, disponible: p.disponible, entrante: p.entrante, porDia: p.porDia, diasCobertura: p.diasCobertura, agotaEl: p.agotaEl, pedirAntes: p.pedirAntes, sugerido: p.sugerido, estado: p.estado })), llegariaSiPidesHoy: madrid(llegada) };
})()
