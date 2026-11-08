# Renovación V2 — identidad, juegos y personalización

Este proyecto **no** debe transformarse en una aplicación genérica de apuestas: la identidad actual combina bitácora transparente, deporte, comunidad, minijuegos, mascota y una interfaz que cada persona puede modificar.

## Principios que no se deben romper
- Mantener el nombre y la identidad de **Bitácora de apuestas — sin humo**; una marca alternativa solo se adoptaría tras una decisión explícita.
- Conservar minijuegos y progreso (incluidos fútbol 3, Dokudoku, mascota/corral, quinielas, retos y modo práctica); evitar reiniciar o perder datos de usuarios.
- Conservar **🎨 Mi diseño** y su sincronización con la cuenta: presets, color libre, modo claro/oscuro/automático, fondos de club/estadio, tipografía, esquinas, menú favorito, ocultación y orden de portada.
- Los nuevos temas son **opcionales**. El tema Original sigue siendo el predeterminado; no reemplazar configuraciones existentes.
- Mantener Telegram, las automatizaciones, la bitácora y la integración con Supabase durante las migraciones.
- No vincular recompensas de los minijuegos con cantidades apostadas, pérdidas ni gasto de dinero.

## Primer lote implementado en esta rama
1. Seguridad: las rutas autenticadas de Telegram rechazan cabeceras vacías cuando no hay un secreto configurado; el webhook y su configuración necesitan un WEBHOOK_SECRET no vacío.
2. Personalización: presets opcionales **🕹️ Arcade** y **🏆 Tribuna** dentro de *Mi diseño*.
3. Interfaz: microinteracciones de tarjetas compatibles con dispositivos que tienen hover; opción de movimiento reducido respetada para accesibilidad.

## Siguientes entregas
1. Pruebas automatizadas para acceso, sesiones, minijuegos y persistencia de *Mi diseño*.
2. Extraer CSS y JavaScript del HTML de forma incremental, sin romper selectores, eventos ni almacenamiento.
3. Diseño responsive para el área de juegos, mascota, personalización y portada; revisar contrastes en todos los temas.
4. Eliminar variables globales de formato de momios y verificar concurrencia entre usuarios.
5. Validación temporal de modelos predictivos sin usar registros de prueba en la calibración.
6. Seguimiento de errores, chequeos de CI y vista previa de Vercel antes de unir la rama.

## Validación manual requerida antes de publicar
- Abrir la aplicación en escritorio y móvil; cambiar entre Original, Arcade, Tribuna, Estadio, Neón y presets propios.
- Cambiar color, tipo de letra, fondo y modo, recargar y confirmar que se conservan.
- Iniciar sesión en otro dispositivo y confirmar sincronización por Supabase.
- Jugar un minijuego y comprobar continuidad del progreso.
- Comprobar notificaciones, quiniela, mascota, marcador y navegación.
- Confirmar que las rutas protegidas rechazan secretos ausentes/incorrectos.

No fusionar con `main` ni desplegar cambios de bases de datos antes de completar las pruebas.
