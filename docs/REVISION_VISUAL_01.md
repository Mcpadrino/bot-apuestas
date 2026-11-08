# Primera tanda visual sobre la aplicación real

Base revisada: `7112dc7`, rama `mejoras-v2-juegos-personalizacion`.

La capa CSS de `telegram/index.html` mejora cabecera, portada, resumen de banca,
menú, catálogo de juegos y controles de Mi diseño. Conserva los colores del usuario,
fondo de estadio, letra grande, esquinas cuadradas y movimiento reducido.
No cambia scripts, eventos, identificadores, formularios, APIs ni datos.
`demo-v2.html` no participa en esta entrega.

## Pruebas reproducibles

Desde `telegram/`, con Node.js y la historia Git de la rama disponibles:

```sh
npm ci
npx playwright install chromium
npm test
```

- Comparación exacta del HTML fuera de CSS y del JavaScript con la base.
- Comparación de API web, Telegram, ESPN, deportes y service worker con la base.
- Chromium en 320, 390 y 1280 px: acceso, seis juegos del catálogo y apertura/cierre
  de cada juego (incluidos Equipodoku y el motor de fútbol 3D).
- Mi diseño: modo oscuro, letra grande, esquinas cuadradas, configuración de foto
  del estadio, crédito, recarga, persistencia local y petición de sincronización simulada.
- Foco visible de teclado, ausencia de desbordamiento horizontal del catálogo y
  ausencia de errores JavaScript en los recorridos probados.
- Capturas en `telegram/test-results/` (no se versionan).

Todas las solicitudes del navegador se interceptan: la página y el icono son locales,
las APIs usan respuestas simuladas y los demás destinos se bloquean. No se usan
tokens reales, variables de producción ni escrituras en Supabase.

## Límites de esta validación

La comparación protege las funciones existentes de esta tanda CSS; no certifica
el funcionamiento de los servicios externos ni corrige defectos anteriores.
Quedan pendientes acceso con Telegram real, sincronización entre dos dispositivos,
partidas completas con premios/progreso y recorridos reales de ESPN, Gurú,
quinielas y retos en un entorno de pruebas con datos separados.
El Preview sin credenciales permite revisar la entrada; no permite iniciar una
sesión funcional contra producción. No fusionar ni promover a producción.
