# Aurialo CRM

Centro de operaciones interno de Aurialo. Es una web sin instalación (HTML + JavaScript) que guarda los datos en Supabase, así que todo el equipo ve lo mismo en tiempo real.

## Módulos

| Módulo | Para qué sirve |
|---|---|
| **Panel** | Resumen del día: gasto y ROAS de creativos, ganadores, lo que no hay que relanzar, producción, incidencias, tareas y tasa de confirmación. Muestra avisos según el día (reporte lunes, miércoles y viernes; lanzamiento martes y jueves; no escalar de viernes a domingo). |
| **Meta Ads** | Métricas de cada creativo (gasto, hook, CTR, CPC, compras, CPA, ROAS) con estado automático: *Ganador, Prometedor, Vigilar, No relanzar, En test*. Importa el CSV del Administrador de anuncios y corrige el ROAS con las compras reales de Shopify. Incluye vistas agrupadas por ángulo y por formato. |
| **Director creativo** | Pipeline Idea → Guion → Producción → Listo → Lanzado. Genera el nombre estándar `angulo_identificacion_producto`. Al pulsar «Lanzar», el creativo pasa a Meta Ads. Reúne las reglas creativas y los ángulos validados con un botón para iterarlos. |
| **Equipo logístico** | **Resultados (Beeping):** % confirmación, % entrega, beneficio y % beneficio por día y por periodo, leídos del Google Sheet «Control Contable de Tienda Aurialo» (pestaña Registro-Base, sincronizada con Beeping cada 30 min). Además: registro diario de confirmaciones COD por WhatsApp (tasa por persona), incidencias de envío con enlace directo a WhatsApp, y tablero de tareas. |
| **Competencia** | Competidores por producto con enlace a la Ads Library, anuncios vistos (ángulo, formato y días activo) y un análisis de los ángulos que usa la competencia y que Aurialo aún no ha probado. |

## Estructura

```
index.html   → página principal
app.js       → lógica de la app
styles.css   → diseño
config.js    → equipo, productos, competidores, reglas de Meta Ads y reglas creativas (edítalo aquí)
netlify.toml → configuración de publicación
```

## Datos

Usa el proyecto de Supabase **Aurialo Workly Hub** (tabla `aurialo`, columnas `clave` / `valor` / `actualizado`), el mismo del Logistics Hub. Cada registro del CRM se guarda como una fila con clave `crm:<colección>:<id>`, así que no interfiere con los datos del Hub.

Si Supabase no responde, la app sigue funcionando en local (en ese navegador) y lo indica abajo a la izquierda. En **Ajustes** puedes copiar y restaurar una copia de seguridad.

## Publicar en Netlify (una sola vez)

1. Entra en [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project → GitHub**.
2. Elige el repositorio `aurialo/Aurialo-`. No hace falta comando de build; la carpeta de publicación es la raíz (`.`).
3. Pulsa **Deploy**. Cada cambio que se suba a GitHub se publica solo.

Para probarlo sin publicar, basta con abrir `index.html` en el navegador.

## Cambiar reglas o listas

Todo se edita en `config.js`: miembros del equipo, productos, formatos, herramientas, competidores iniciales, umbrales del estado automático (ROAS, compras y días mínimos) y reglas creativas.

## Agente de Meta Ads

`scripts/meta_sync.py` vuelca al CRM las métricas acumuladas de cada anuncio de la cuenta **Aurialo 1** (gasto, impresiones, clics, compras y valor de compras, más campaña, conjunto y estado en Meta). Una tarea programada de Claude lo ejecuta los lunes, miércoles y viernes por la mañana: consulta Meta Ads, actualiza el CRM y deja un resumen de qué creativos escalar, cuáles vigilar y cuáles no relanzar.

Cada anuncio se guarda como `crm:creativos:meta_<id>`. Lo que el equipo escriba a mano en el CRM (notas, compras reales de Shopify, ticket medio, estado forzado o ángulo/formato corregidos) no se sobrescribe.

## Resultados de Beeping (Google Sheet)

El CRM lee la pestaña **Registro-Base** del Sheet «Control Contable de Tienda Aurialo», que solo contiene totales diarios (sin datos de clientes). Para que se actualice solo:

1. En el Sheet: **Archivo → Compartir → Publicar en la web**.
2. En «Enlace», elige la pestaña **Registro-Base** (no «Todo el documento») y el formato **Valores separados por comas (.csv)**. Pulsa **Publicar**.
3. Copia el enlace y ponlo en `beepingCsvUrl` dentro de `config.js`.

Fórmulas (iguales que el Informe Contable): % Confirmación = confirmados / generados · % Entrega = entregados / confirmados · Beneficio = importe entregado − costes de producto y logística − publicidad · % Beneficio = beneficio / importe entregado.

Mientras no haya enlace, el CRM muestra la última copia guardada en Supabase.

## Incidencias de Beeping

`incidencias.html` (dentro de Equipo logístico → Incidencias) es el panel de incidencias de Beeping: alertas, embudo de gestión, dinero cobrado / en juego / perdido, mes a mes, desglose por motivo, mensajería y acción, tabla con historial de gestiones y registro de cambios.

Los datos llegan con un **marcador de Chrome** que se ejecuta en `newapp.gobeeping.com` con tu sesión iniciada: lee las incidencias, sus gestiones y el tracking, y las envía directamente a Supabase (`beeping:inc:raw`). El CRM las procesa, calcula los cambios desde la última vez y guarda el resultado en `beeping:inc:data`, así que todo el equipo ve lo mismo. El código del marcador está en el botón «Actualizar desde Beeping». Si el envío directo fallara, el marcador permite copiar los datos y pegarlos en el CRM.

## Motivos de rechazo

`scripts/motivos_sync.py` clasifica las observaciones del Sheet **PEDIDOS E INCIDENCIAS** (pestañas Pedidos cancelados, Incidencias devueltas, Carritos recuperados y Pedidos confirmados) en motivos: ya no lo quiere (sin motivo), no contactable, sin dinero, desconfianza, consejo médico, duplicado, error, cambio de circunstancias y devuelto automático por Beeping. También marca si el cliente rechazó el descuento. El resultado se ve en Equipo logístico → Motivos de rechazo. Un agente programado («Motivos de rechazo») lee el Sheet cada día, ejecuta el script y deja un resumen.

## Panel del equipo logístico y PIN

- **aurialo.github.io/Aurialo-/equipo.html** es el panel de Florencia y Mayra: «Mi panel» (KPIs con objetivos, feedback automático, evolución por semanas, sus tareas y notas) y «Logística» (resultados de Beeping sin datos de dinero, motivos de rechazo, confirmaciones, incidencias, tareas y notas). No pide PIN.
- **Notas del equipo**: observaciones, incidencias de pedidos, ideas y dudas para Cristian. Cristian responde desde el CRM (Equipo logístico → Notas del equipo) y puede dejar «Feedback de Cristian», que aparece arriba en el panel del equipo. Las dudas sin responder salen en Panel → Hoy.
- **El CRM completo** pide un PIN (hash en `config.js` → `pinHash`). Es un cierre sencillo para separar accesos, no una seguridad fuerte: los datos siguen en una base compartida.
- Los objetivos del equipo están en `config.js` → `objetivos`.

## Alojamiento

Desde el 27/11/2026 la web se publica con **GitHub Pages** (gratis, sin límite de publicaciones): **https://aurialo.github.io/Aurialo-/** (CRM) y **https://aurialo.github.io/Aurialo-/equipo.html** (equipo). Cada cambio subido a `main` se publica solo en 1–2 minutos. La copia antigua en Netlify (aurialo.netlify.app) ya no recibe cambios porque el plan gratuito agotó sus créditos de publicación.

## 💸 Gastos y cashflow (solo Cristian)

Pestaña **Gastos** del CRM (no aparece en el panel del equipo). Cada gasto guarda concepto, importe, categoría, frecuencia (único, semanal, mensual, trimestral, anual), fecha del próximo cobro, forma de pago y con cuántos días avisar (4 por defecto). Muestra lo que sale en 7/30/60 días, el gasto fijo mensual y las salidas por semana. Al pulsar «✔ Pagado» en un recurrente, su fecha pasa al siguiente periodo.

Recordatorios: aparecen en Panel → Hoy y el agente programado «Recordatorio de gastos» ejecuta cada día a las 8:00 `scripts/gastos_aviso.py` y manda una notificación cuando un cargo cae dentro de 4 días, mañana, hoy o está vencido sin marcar.

## 💶 Nómina del equipo logístico (solo Cristian)

Pestaña **Equipo logístico → Nómina** (oculta en el panel del equipo). El agente «Nómina equipo» lee cada mañana el Sheet de horas (`11IApLuadKNigUwTXNyCVXjnxbXm9pMj7xHrPm2X83EA`) y la pestaña Carritos recuperados de PEDIDOS E INCIDENCIAS, y ejecuta `scripts/nomina_sync.py horas.txt pedidos.txt`:
- 3 €/hora → pago el día 12 del mes siguiente.
- 0,50 € por carrito recuperado que pasa a ENTREGADO (cuenta en el mes en que se ve entregado), a partes iguales.
- Bonus sobre el neto mensual de Beeping: confirmación ≥ 80 % → 5 %, ≥ 88 % → 10 %; entrega ≥ 80 % → 5 %, ≥ 85 % → 10 %; a partes iguales. Bonus y carritos → pago el día 25 del mes siguiente.
Crea o actualiza en Gastos los pagos `nomina_horas_<mes>` y `nomina_bonus_<mes>` (no toca los ya marcados como pagados). Las reglas están al principio del script.
