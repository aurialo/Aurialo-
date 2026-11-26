// Configuración del CRM Aurialo
// La clave "publishable" de Supabase está pensada para usarse en el navegador.
// Los datos se guardan en la tabla `aurialo` (clave / valor / actualizado),
// cada registro como una fila con clave "crm:<colección>:<id>".
window.AURIALO_CONFIG = {
  supabaseUrl: "https://eaimghtolwqfuonxzfen.supabase.co",
  supabaseKey: "sb_publishable_DxXd5Wa0XUOwClz8SxmYkw_thtcOA82",
  tabla: "aurialo",
  prefijo: "crm:",
  refrescoSegundos: 30,

  // Resultados diarios de Beeping: pestaña "Registro-Base" del Google Sheet
  // "Control Contable de Tienda Aurialo", publicada en la web como CSV
  // (Archivo → Compartir → Publicar en la web → Registro-Base → CSV).
  // Si está vacío, el CRM usa la última copia guardada en Supabase.
  beepingCsvUrl: "",

  equipo: ["Cristian", "Florencia", "Mayra"],

  // Economía por producto (calculada el 26/11/2026 con los pedidos de Beeping del 27/10 al 16/11:
  // ticket medio, unidades por pedido, coste unitario y costes logísticos del Sheet contable).
  // cpaMax / roasBE: por pedido generado (lo que mide Meta). cpaObj / roasObj: dejando un 20 % de beneficio.
  // cpaMaxEnt / roasBEEnt: por pedido entregado (como el CPA y ROAS del Informe Contable).
  // cpaMaxMin / roasBEMin: si todos los pedidos fueran la oferta mínima (GLP 3 uds, MENO 2 uds, Drenaje 1 ud).
  productos: [
    { code: "GLP1", nombre: "Parches GLP-1", ticket: 31.80, uds: 3.16, costeUd: 0.40, conf: 0.788, entrega: 0.827, cpaMax: 13.36, roasBE: 2.38, cpaObj: 9.22, roasObj: 3.45, cpaMaxEnt: 20.51, roasBEEnt: 1.55, ofertaMin: "3 uds · 29,99 €", cpaMaxMin: 12.23, roasBEMin: 2.45 },
    { code: "MENO", nombre: "MENO", ticket: 33.38, uds: 2.34, costeUd: 1.79, conf: 0.802, entrega: 0.795, cpaMax: 11.96, roasBE: 2.79, cpaObj: 7.70, roasObj: 4.34, cpaMaxEnt: 18.76, roasBEEnt: 1.78, ofertaMin: "2 uds · 29,99 €", cpaMaxMin: 10.18, roasBEMin: 2.95 },
    { code: "DRENAJE", nombre: "Drenaje Linfático", ticket: 32.68, uds: 1.19, costeUd: 2.14, conf: 0.714, entrega: 0.646, cpaMax: 7.98, roasBE: 4.09, cpaObj: 4.96, roasObj: 6.58, cpaMaxEnt: 17.29, roasBEEnt: 1.89, ofertaMin: "1 ud · 29,90 €", cpaMaxMin: 6.89, roasBEMin: 4.34 },
    { code: "MAGNESIO", nombre: "Magnesium Complex" },
    { code: "BOTOX", nombre: "Botox en Barra" },
    { code: "TIRAS", nombre: "Tiras Dentales" },
    { code: "UNPUFF", nombre: "Unpuff" }
  ],

  formatos: ["UGC IA", "Almacén a cámara", "Entrevista calle", "Animado + música", "Imagen", "Carrusel", "Otro"],
  herramientas: ["HeyGen", "Google Flow", "Higgsfield", "CapCut", "Canva", "Otra"],

  // Reglas de decisión para Meta Ads (veredicto automático por creativo)
  reglas: {
    diasMinimos: 3,        // mínimo de días con datos antes de decidir
    gastoMinimo: 15,       // € gastados antes de decidir
    comprasGanador: 5,     // compras mínimas para "Ganador"
    roasGanador: 3.0,      // ROAS mínimo para "Ganador"
    roasPrometedor: 2.0,   // ROAS para "Prometedor"
    roasDescartar: 1.5,    // por debajo de esto, "No relanzar"
    gastoSinVentas: 30     // € gastados sin ninguna compra → "No relanzar"
  },

  // Competidores iniciales (se cargan solo si la lista está vacía)
  competidoresIniciales: [
    { nombre: "Resilea", producto: "GLP1" },
    { nombre: "Glow Patch", producto: "GLP1" },
    { nombre: "Velia Parches", producto: "GLP1" },
    { nombre: "Nura", producto: "GLP1" },
    { nombre: "Brunel", producto: "GLP1" },
    { nombre: "Menoesp", producto: "MENO" },
    { nombre: "Meno España", producto: "MENO" },
    { nombre: "Sonvital", producto: "DRENAJE" },
    { nombre: "Lympha", producto: "DRENAJE" },
    { nombre: "Mayaverra", producto: "DRENAJE" }
  ],

  reglasCreativas: [
    "Nombre del creativo: angulo_identificacion_producto (ej. ClientaEnfadada_LuciaVar1_GLP1)",
    "Nunca mencionar Ozempic ni decir la marca en voz alta",
    "GLP-1: decir «compras uno y te llevas dos gratis» (texto en pantalla «1+2 GRATIS»)",
    "Drenaje: decir «oferta 2+1 gratis»",
    "Usar «menos de treinta euros»; evitar «fortuna» (el TTS lo lee mal)",
    "GLP-1: mostrar el paquete cerrado del producto, sin pastillas ni botes",
    "Devolución: «30 días para devolverlo» (producto precintado). Nada de «te devolvemos el dinero si no funciona»",
    "Público: mujeres de +45/50 años, que la clienta se sienta identificada",
    "Lanzamientos martes y jueves; no escalar ni pausar viernes, sábado ni domingo"
  ]
};
