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

  equipo: ["Cristian", "Florencia", "Mayra"],

  productos: [
    { code: "GLP1", nombre: "Parches GLP-1" },
    { code: "MENO", nombre: "MENO" },
    { code: "DRENAJE", nombre: "Drenaje Linfático" },
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
