# Aurialo CRM

Centro de operaciones interno de Aurialo. Es una web sin instalación (HTML + JavaScript) que guarda los datos en Supabase, así que todo el equipo ve lo mismo en tiempo real.

## Módulos

| Módulo | Para qué sirve |
|---|---|
| **Panel** | Resumen del día: gasto y ROAS de creativos, ganadores, lo que no hay que relanzar, producción, incidencias, tareas y tasa de confirmación. Muestra avisos según el día (reporte lunes, miércoles y viernes; lanzamiento martes y jueves; no escalar de viernes a domingo). |
| **Meta Ads** | Métricas de cada creativo (gasto, hook, CTR, CPC, compras, CPA, ROAS) con estado automático: *Ganador, Prometedor, Vigilar, No relanzar, En test*. Importa el CSV del Administrador de anuncios y corrige el ROAS con las compras reales de Shopify. Incluye vistas agrupadas por ángulo y por formato. |
| **Director creativo** | Pipeline Idea → Guion → Producción → Listo → Lanzado. Genera el nombre estándar `angulo_identificacion_producto`. Al pulsar «Lanzar», el creativo pasa a Meta Ads. Reúne las reglas creativas y los ángulos validados con un botón para iterarlos. |
| **Equipo logístico** | Registro diario de confirmaciones COD por WhatsApp (tasa por persona), incidencias de envío con enlace directo a WhatsApp, y tablero de tareas. |
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
