---
tags: [sistema, mobile, deploy, playstore]
---

# Play Store — checklist de publicación

> Decisión tomada el 2026-07-27: publicar `Los Lirios SA` (mobile) en Google Play, track **Internal testing** (no producción pública) — resuelve la fricción de sideload de APK y las actualizaciones OTA que a veces necesitaban cerrar/reabrir la app dos veces. Detalle de la decisión: [[2026-07-27-duplicados-web-mapa-mobile-y-cumplimiento-riego]].

## Estado (2026-07-29, avance de Claude in Chrome en Play Console)

- ✅ **Verificación de identidad de Google completada** — Fausto la confirmó al arrancar esta sesión.
- ✅ **App creada en Play Console** vía Claude in Chrome (Play Console → Crear app): nombre `Los Lirios SA`, paquete `com.loslirios.app` (coincide con `mobile/app.json`), idioma Español (Latinoamérica) es-419 — no existe "Español (Argentina)" como opción en Play Console, es-419 es la más cercana. Tipo Aplicación, Gratis, las 3 declaraciones (políticas, Play App Signing, leyes de exportación) aceptadas.
  - **Bug encontrado y corregido:** el campo "Nombre de la app" del formulario de creación quedó con un autocompletado no pedido ("ERP Los Lirios SA" en vez de "Los Lirios SA") — probablemente autofill del navegador. Corregido en la ficha de Play Store (ver abajo), pero el nombre "ERP Los Lirios SA" **sigue apareciendo en el encabezado/selector de cuenta de la consola** porque ese título solo se actualiza cuando la ficha se envía a revisión, no al guardar como borrador. No es bloqueante, se corrige solo al publicar — no hace falta que Fausto haga nada por esto.
- ✅ **Ficha de Play Store (borrador guardado):** nombre corregido a `Los Lirios SA`, descripción breve y completa cargadas (texto exacto del checklist de abajo).
  - ⚠️ **Pendiente — Fausto tiene que subir 5 archivos a mano:** el ícono (`icon-512.png`), el feature graphic (`feature-graphic-1024x500.png`) y las 3 capturas (Mapa, Inicio, Riego). El botón "Agregar recursos" de Play Console abre un selector de archivos nativo de Windows que la automatización del navegador no puede completar de forma segura (no hay un `<input type=file>` accesible en el DOM hasta que se hace clic, y en ese momento se abre un diálogo del sistema operativo que Claude no puede ver ni controlar). Los 5 archivos están en `mobile/assets/play-store/` (ícono y feature graphic) y `C:\Users\faust\OneDrive\Pictures\Fotos App Mobile\` (capturas — usar Mapa, Inicio, Riego; la 4ª de Tareas tiene sueldos reales, no subir sin confirmar).
- ✅ **Configuración de la tienda:** categoría "Negocios", email de contacto `administracion@losliriossa.com`, sitio web `https://frontend-six-jade-79.vercel.app`.
- ✅ **Contenido de la app — las 10 declaraciones completadas** (antes bloqueaban cualquier track, incluido internal testing):
  - Política de Privacidad: URL cargada.
  - Anuncios: No.
  - Detalles de acceso: Sí (la app requiere login) — cuenta de prueba cargada para el equipo de revisión de Google (usuario `administracion@losliriossa.com`, la cuenta de super_admin de producción, con la contraseña que Fausto pasó en el chat). **Nota de seguridad:** esa contraseña quedó en el historial de este chat — evaluar si conviene rotarla más adelante ya que ahora también vive en los sistemas de Google como credencial de testing.
  - Clasificación del contenido (cuestionario IARC): completado, resultado "Todas las edades" en todas las autoridades clasificadoras (L / E / 3+ / USK 0 / IARC 3+), como se esperaba.
  - Público objetivo: Mayores de 18 años únicamente.
  - Seguridad de los datos (Data Safety form): recopila Nombre + Email + ID de dispositivo, todos "necesarios" (no opcionales), no efímeros, para "funciones de la app" y "administración de la cuenta"; nada compartido con terceros; sin ubicación/salud/mensajes/financiero. Confirmado con Fausto antes de guardar (es declaración pública ante Google). URL de eliminación de cuenta: la página de política de privacidad (borrado a pedido por email, ya descripto ahí).
  - ID de publicidad: No.
  - Apps gubernamentales: No.
  - Funciones financieras: "Mi app no ofrece ninguna función financiera" (los módulos de ingresos/egresos son registros internos de la empresa, no una función financiera regulada de cara al usuario).
  - Apps de salud: "Ninguna función de salud".
- ✅ **Ficha de Play Store enviada** — Fausto subió las 5 imágenes (ícono, feature graphic, 3 capturas de teléfono) a mano el mismo día, se revisaron y se confirmó "Guardar" — el nombre de la app en toda la consola pasó de mostrar "ERP Los Lirios SA" a "Los Lirios SA" apenas se confirmó (se actualiza recién ahí, no al guardar como borrador).
- ✅ **Internal testing publicado (2026-07-29):**
  - Lista de testers "Testers internos" creada con `administracion@losliriossa.com` y `ri3215015@gmail.com`. **`camiloyanzon@hotmail.com` no se pudo agregar — Play Console tiró "Este correo electrónico no existe"**, es decir esa dirección no tiene ninguna cuenta de Google asociada. Camilo necesita crear o vincular una cuenta de Google con ese mail (o dar otra dirección) antes de poder sumarlo como tester.
  - **Resuelto 2026-07-29 (sesión aparte, más tarde el mismo día):** el email de login de Camilo en el sistema se cambió de `camiloyanzon@hotmail.com` a `camilotrabajofinca@gmail.com` (cuenta de Google real que sí puede usarse para Play Store). Cambio hecho directo en la base de datos de producción (`users.email`, UPDATE puntual, verificado antes y después) — el endpoint `PUT /users/{id}` de la app **no soporta cambiar email todavía** (solo `full_name`/`role`/`is_active`/`password`), quedó identificado como gap real si hace falta repetir esto para otro usuario. **Pendiente que haga Fausto:** agregar `camilotrabajofinca@gmail.com` a la lista de testers en Play Console y mandarle el link de opt-in a Camilo (con su email nuevo también le cambia el usuario/login de la app — avisarle).
  - `.aab` (`los-lirios-v1.0.0-2.aab`, versionCode 2) subido a mano por Fausto — pesa 38 MB, por encima del límite de 10 MB de la herramienta de carga del navegador, así que no se pudo automatizar.
  - Notas de la versión cargadas, 1 advertencia menor sin bloquear (falta archivo de mapeo R8/Proguard, solo afecta legibilidad de crash reports).
  - **Release publicado y confirmado por Fausto antes de publicar** (declaración pública/acción irreversible). Estado: "Disponible para verificadores internos".
  - **Link de opt-in para mandar a los testers:** `https://play.google.com/apps/internaltest/4701122264001326317`
- **Pendiente:** nada bloqueante del lado técnico. Fausto tiene que 1) mandarles el link de opt-in a los testers (Rafael, y a sí mismo) para que instalen desde ahí, 2) resolver el tema de la cuenta de Google de Camilo si lo quiere sumar como tester, 3) esperar la revisión de Google de la ficha/contenido (puede tardar horas/días, no bloquea que los testers ya invitados instalen mientras tanto).

## Actualización 2026-08-05 — la ficha nunca se había enviado a revisión

Al revisar Play Console se encontró que todo el contenido armado el 07-29 (ficha, las 10 declaraciones de "Contenido de la app", categoría de tienda) había quedado guardado como borrador — **nunca se había hecho clic en "Enviar a revisión"**. Por eso la app seguía mostrando `com.loslirios.app (unreviewed)` una semana después: no era Google demorado, el proceso nunca había arrancado (no bloqueaba a los testers ya invitados, sí bloquea pasar a producción pública).

Con confirmación explícita de Fausto, se enviaron los 8 cambios pendientes a revisión (ficha es-419, calificación de contenido/IARC, público objetivo 18+, política de privacidad, declaración de anuncios, Data Safety, apps de salud, categoría de tienda). Play Console confirma "Tus cambios están en proceso de revisión" — plazo típico de Google: hasta 7 días.

Lista de testers verificada en la misma sesión: solo `administracion@losliriossa.com` y `ri3215015@gmail.com` (Rafael), 2 usuarios. Camilo (`camilotrabajofinca@gmail.com`) todavía no estaba — Fausto se encargó de agregarlo él mismo.

## Estado (2026-07-27, fin de sesión)

- ✅ Build de producción terminado (`versionCode 2`, `.aab`). Descargado en `C:\Users\faust\Downloads\los-lirios-v1.0.0-2.aab`, listo para subir a Play Console. También queda en `https://expo.dev/artifacts/eas/BgoOZs2pWr63ibS0_2_PswVFC6w9MC9uOdQFXGSnCnc.aab` por si se pierde el local.
- ✅ Capturas recibidas en `C:\Users\faust\OneDrive\Pictures\Fotos App Mobile\` (4 fotos, cuenta de Camilo). 3 sirven tal cual para la ficha: Mapa (confirma que el fix del mapa mobile quedó bien — se ven los polígonos), Inicio, Riego. **La cuarta (Tareas) muestra nombres y sueldos reales de empleados** (Franco $61.875, Javier $86.625, etc.) — no la subiría a la ficha de la store sin que Fausto lo decida a propósito. Como es "Internal testing" (no público, solo visible para los testers invitados vía link), el riesgo es bajo, pero es una decisión suya, no mía.
- 🕓 Cuenta de Google Play Developer creada (`administracion@losliriossa.com`), **verificación de identidad en curso** — Google puede tardar de horas a algunos días. Mientras tanto se puede seguir armando la ficha de la app (nombre, descripción, capturas, content rating, data safety) — lo que probablemente quede bloqueado hasta que la verificación termine es el paso final de publicar el release a Internal testing.

## Ya hecho (lado código/CI)

- `mobile/eas.json` — profile `production` con `EXPO_PUBLIC_API_URL` explícito (mismo bug que el de login OTA del 2026-07-20 si se omite: `eas build` sí lee `eas.json`, pero sin el `env` cae al `.env` local con la IP LAN de desarrollo).
- `mobile/app.json` — permisos Android duplicados limpiados.
- Primer build de producción (`.aab`, distribución `store`, firma con el keystore ya gestionado por EAS desde builds anteriores) lanzado el 2026-07-27: `eas build --profile production --platform android`. Ver estado: `eas build:list` o `https://expo.dev/accounts/faustoyanzon2411/projects/los-lirios/builds`.
- Política de privacidad publicada y pública (la exige Play Console incluso para testing interno): **`https://frontend-six-jade-79.vercel.app/privacy`**.
- Assets gráficos para la ficha generados (`mobile/assets/play-store/`): `icon-512.png` (ícono hi-res) y `feature-graphic-1024x500.png` (banner). Mismo logo/estilo que el ícono de la app — se pueden regenerar con `python gen_playstore_assets.py` desde la raíz del repo si cambia el logo.

## Pendiente (lado Fausto — cuenta y consola)

1. **Crear cuenta de Google Play Developer** (USD 25, pago único) en [play.google.com/console](https://play.google.com/console) con tu cuenta de Google.
2. **Crear la app** dentro de Play Console:
   - Nombre: `Los Lirios SA`
   - Idioma predeterminado: Español (Argentina)
   - Tipo: App · Gratuita
   - Declaración de app/juego, apps oficiales de gobierno, apps de noticias → No a todo.
3. **Completar "Presencia en la tienda"** (Play Console → Crecer → Presencia en la tienda → Ficha principal):
   - **Descripción breve** (máx. 80 caracteres): `Gestión agrícola de Los Lirios SA: tareas, riego, fitosanitarios y más.`
   - **Descripción completa** (borrador abajo).
   - **Ícono de la app**: subir `mobile/assets/play-store/icon-512.png`.
   - **Gráfico destacado (feature graphic)**: subir `mobile/assets/play-store/feature-graphic-1024x500.png`.
   - **Capturas de pantalla** (mínimo 2, teléfono): ✅ recibidas — usar Mapa, Inicio y Riego de `C:\Users\faust\OneDrive\Pictures\Fotos App Mobile\`. La cuarta (Tareas) tiene sueldos/nombres reales de empleados, decisión tuya si la subís o no (ver nota arriba).
   - **Categoría**: Negocios (Business).
   - **Datos de contacto**: `administracion@losliriossa.com`.
   - **Política de privacidad**: `https://frontend-six-jade-79.vercel.app/privacy`
4. **Completar "Contenido de la app"** (Play Console → Política → Contenido de la app) — obligatorio para poder publicar cualquier track, incluido internal testing:
   - **Clasificación de contenido**: cuestionario IARC — sin violencia, sin contenido sexual, sin lenguaje ofensivo, sin sustancias controladas, sin apuestas, sin contenido generado por usuarios visible públicamente (los datos que carga cada usuario son privados de la empresa, no se comparten entre usuarios ni son públicos). Debería salir "Apto para todo público"/PEGI 3.
   - **Público objetivo**: no dirigida a niños (herramienta de uso interno para empleados adultos de la empresa).
   - **Anuncios**: No, la app no tiene publicidad.
   - **Seguridad de los datos (Data safety form)** — borrador de respuestas abajo, **revisalo antes de enviarlo**, es una declaración pública tuya ante Google y los usuarios, no la mandes sin confirmar que es exacta.
5. **Internal testing** (Play Console → Testing → Internal testing):
   - Crear la lista de testers (tu email + Camilo + Rafael + quien más pruebe) — se puede armar como lista de emails directa o un Google Group.
   - Subir el `.aab` que generó el build de EAS (se descarga desde el link de `eas build:view`, o `eas build:list` para ver todos).
   - Una vez publicado el release, Play Console te da un **link de opt-in** para mandarles a los testers — lo instalan desde ahí, sin sideload, con actualizaciones automáticas reales de ahí en adelante.

## Después de la primera publicación

- Los cambios de **puro JS/UI** se siguen publicando con `eas update --branch production --environment production` (nunca sin `--environment`, mismo motivo que en `preview`) — no hace falta pasar por Play Console de nuevo para esos.
- Los cambios que toquen **módulos nativos** (una librería nueva que use código nativo, por ejemplo) sí necesitan un build nuevo (`eas build --profile production`) y volver a subir el `.aab` a Play Console (versionCode se autoincrementa solo, gracias a `autoIncrement: true` en `eas.json`).

## Borrador — descripción completa

```
Los Lirios SA es una herramienta interna de gestión agrícola y financiera para la
operación diaria de la finca (Mendoza, Argentina).

Permite al equipo de campo y administración registrar y consultar, desde el
celular:

• Tareas diarias de campo, por parcela y trabajador
• Riego — incluida la carga de riegos "en curso" mientras están sucediendo
• Aplicaciones fitosanitarias, con cálculo automático de fechas de habilitación
  de cosecha y reingreso
• Cosecha por parcela y variedad
• Ciclo de campaña y estado fenológico de cada variedad
• Mapa interactivo de la finca con capas de tipo de parcela, variedad,
  cosecha, riego y cumplimiento de riego por estado
• Panel de dirección con indicadores de producción y finanzas

Acceso restringido a personal autorizado de Los Lirios SA mediante usuario y
contraseña — no es una aplicación de uso público.
```

## Borrador — Data safety form (revisar antes de enviar)

| Tipo de dato | ¿Se recolecta? | ¿Se comparte con terceros? | Uso |
|---|---|---|---|
| Nombre | Sí | No | Funcionalidad de la app, gestión de cuenta |
| Email | Sí | No | Funcionalidad de la app, gestión de cuenta, autenticación |
| ID de dispositivo / token de push | Sí (solo mobile) | No | Notificaciones dentro de la app |
| Ubicación | No | — | — |
| Fotos/videos/audio | No | — | — |
| Contactos | No | — | — |
| Información financiera | Depende — si vas a declarar que sí: son registros de **la empresa** (ingresos/egresos), no datos financieros personales de quien usa la app. Confirmar cómo lo quiere clasificar Fausto antes de enviar. | No | Funcionalidad de la app |

- **¿Los datos viajan cifrados?** Sí (HTTPS/TLS).
- **¿El usuario puede pedir que se borren sus datos?** Sí, por email (ver política de privacidad).
- **¿Cumple con las políticas de "Familias" de Google Play?** No aplica — la app no está dirigida a niños.

## Ver también

- [[2026-07-27-duplicados-web-mapa-mobile-y-cumplimiento-riego]]
- [[Sistema de Gestión Agrícola]]
- [[Bugs Conocidos]]
