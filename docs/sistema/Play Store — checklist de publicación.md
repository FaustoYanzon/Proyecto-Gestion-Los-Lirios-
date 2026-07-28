---
tags: [sistema, mobile, deploy, playstore]
---

# Play Store — checklist de publicación

> Decisión tomada el 2026-07-27: publicar `Los Lirios SA` (mobile) en Google Play, track **Internal testing** (no producción pública) — resuelve la fricción de sideload de APK y las actualizaciones OTA que a veces necesitaban cerrar/reabrir la app dos veces. Detalle de la decisión: [[2026-07-27-duplicados-web-mapa-mobile-y-cumplimiento-riego]].

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
