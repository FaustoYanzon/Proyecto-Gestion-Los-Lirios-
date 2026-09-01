---
tags: [sistema, sesion, deploy, playstore, ios, bug]
---

# 2026-09-01 — Primer build de iOS completo (App Store Connect + TestFlight), versionCode quemado en Play Store, 12 verificadores cargados

Continuación directa de [[2026-08-28-play-store-produccion-ios-fix-parcelas]]. Fausto llegó a la sesión avisando que ya se había inscripto en Apple Developer Program (Individual, `developer.apple.com/programs/enroll`) — arrancaba pendiente desde esa sesión. Objetivo: cerrar los 3 puntos que quedaron abiertos (credenciales iOS + primer build, build nuevo de Android por los íconos de la Fase 2 del rediseño estético, completar los 12 verificadores de Play Store).

## Diagnóstico de arranque — el deploy trabado del 08-28 en realidad sí había terminado bien

Antes de tocar nada se releyó la bóveda completa y se verificó contra `git log`/Railway en vivo (no confiar en la memoria sola). El deploy de Railway que el 28/08 parecía trabado por el incidente de plataforma (`railway status` en texto plano mostraba "Deploy failed (2d)") en realidad **sí había terminado con éxito** — confirmado con `railway status --json`: el deployment `785f71bd` (commit `ce971a6`, fix de permisos de parcelas) tenía `status: "SUCCESS"` e instancia `RUNNING`. El texto plano del CLI mostraba un estado engañoso. Sin acción de nuestra parte.

## iOS — enrollment pendiente, primer build de punta a punta

**Bloqueador real, no anticipado: el `!` de Claude Code (y también el Bash tool) no da una TTY real.** Un primer intento de `eas build --platform ios --profile production` corrido por mí mismo (Bash, no-interactivo) falló con "Distribution Certificate is not validated for non-interactive builds. Run this command again in interactive mode." Fausto lo reintentó él mismo con el prefijo `!` en el chat — mismo error exacto, confirmando que ni siquiera con un humano tipeando el comando el entorno del chat da una terminal interactiva de verdad. **Solución real: Fausto tuvo que abrir PowerShell directo en su máquina** (fuera de Claude Code) para completar el login de Apple ID + 2FA.

Ahí también se descubrió que la cuenta de Apple todavía estaba en **"Enrollment Pending"** en la app de Apple Developer del celular — la inscripción de Individual puede tardar horas (hasta ~48h hábiles según Apple). El primer intento de login falló por esto, no por el comando. Se resolvió solo unas horas después — confirmado porque el segundo intento de `eas build` ya mostró "Team FAUSTO YANZON (938VQVGWF2)" registrado.

**Build completo, corrido por Fausto en su propia PowerShell:**
1. `eas build --platform ios --profile production` → login interactivo con Apple ID (`faustoyanzonfb@gmail.com`) + contraseña + 2FA (guardado en Keychain local para la próxima).
2. Bundle identifier `com.loslirios.app` registrado en el portal de Apple, capability Push Notifications sincronizada.
3. Certificado de Distribución nuevo generado por EAS (serial `554C3E751E06F91EBC118B2700EDD5C`, expira 01/09/2027) + Provisioning Profile nuevo (`DP5FSD9664`) — ambos gestionados remotos (servidores de Expo), Fausto no tocó el portal de Apple a mano.
4. Push Notifications key de Apple generada de paso (necesaria porque el proyecto ya usa `expo-notifications`).
5. **Detalle real de proceso:** el primer `eas build` terminó de configurar las credenciales y volvió al prompt de PowerShell sin seguir al build — hubo que correr el comando una segunda vez; la segunda vez, con las credenciales ya guardadas, siguió directo a comprimir/subir/compilar.
6. Build exitoso: `eccbdbe2-e64f-4fee-af01-6731e496e9fb`, versión 1.0.0, build number 4 (~5 min).

**Fix de config aplicado antes del build (commit `8d82211`):** `app.json` no declaraba `ios.infoPlist.ITSAppUsesNonExemptEncryption` — Apple lo exige antes de poder testear en TestFlight. Seteado a `false` (la app solo usa HTTPS estándar, sin cifrado propio).

**`eas submit --platform ios --profile production` — primer intento bloqueado por un outage real de Expo**, no nuestro: "EAS Submit is experiencing a partial outage" (confirmado en status.expo.dev, incidente "Identified" el mismo día) + error secundario "Input is required, but stdin is not readable" (efecto colateral del outage rompiendo el CLI antes de llegar al prompt normal). Sin acción posible del lado nuestro — se esperó y se confirmó la resolución del incidente en status.expo.dev (~horas después) antes de reintentar.

**Segundo intento de `eas submit`, exitoso:** generó una App Store Connect API Key nueva (Key ID `QK74WJN6L3`, gestionada en servidores de Expo, sin que Fausto tuviera que crearla a mano en el portal de Apple), creó la app en App Store Connect (ASC App ID `6807586103`), creó un grupo de TestFlight interno automático ("Team (Expo)") con `faustoyanzonfb@gmail.com` invitado, y subió el `.ipa`. Apple lo procesó en minutos — build 4 quedó "Lista para enviar" en TestFlight, Fausto ya lo instaló y lo está probando en su propio celular.

**Decisión de cierre — no se armó grupo de pruebas externas todavía:** ninguno de los otros 11 verificadores de Play Store tiene cuenta de Apple. Aclarado y confirmado con Fausto: **a diferencia de Google, Apple no exige ningún mínimo de testers ni período de espera** antes de poder mandar la app a revisión de la App Store — la prueba interna (solo Fausto) ya alcanza para seguir avanzando cuando él decida. Queda pausado a propósito hasta que haga falta sumar gente real (para eso haría falta un grupo de **pruebas externas**, que sí requiere Beta App Review de Apple la primera vez, a diferencia del grupo interno).

## Android — build nuevo por los íconos (Fase 2 del rediseño) y un versionCode quemado sin querer

Build de producción nuevo corrido (`eas build --platform android`, no-interactivo, sin fricción — las credenciales de keystore ya estaban gestionadas desde antes) para llevar a producción los íconos de Lucide (`react-native-svg`, módulo nativo) de la Fase 2 del rediseño estético del 08-28, que solo estaban en el código pero nunca se habían compilado a un build nativo nuevo. `versionCode` 4→5 automático.

**Incidente real, ver [[Bugs Conocidos]] para el detalle completo:** el primer intento de subir `los-lirios-v1.0.0-5.aab` a Play Console (arrastrado por Fausto) se subió bien pero la sesión se cortó antes de completar "Siguiente" — al volver, el editor mostraba el borrador vacío como si nada se hubiera subido. Un reintento con el mismo archivo dio error real: **"Ya se usó el código de la versión 5. Prueba con otro código."** — Google había consumido el versionCode igual, pese a que el borrador nunca llegó a guardarse visiblemente. Hubo que compilar de nuevo (`versionCode` 6) y esta vez completar todo el flujo de Play Console de punta a punta (Subir → Siguiente → revisar advertencias → Guardar → Enviar a revisión) sin cortar en el medio.

Versión 6 (1.0.0) confirmada y enviada a revisión automática de Google al cierre de la sesión — Fausto dio el OK explícito para confirmar el lanzamiento.

## Play Store — 12 verificadores cargados, pero 0 aceptaron todavía

Se completó la lista de verificadores hasta los 12 requeridos, en dos tandas:

**Primera tanda (4 emails, con creación de usuarios reales en el sistema Los Lirios):** Fausto pidió crear usuarios del sistema (rol Gerencial, finca Media Agua, contraseña = usuario + `1234!`) para `elcauquensrl@hotmail.com`, `leticiayanzon@gmail.com`, `maribarcelo18@gmail.com` y `faustoyfb@gmail.com` — nombres completos inferidos del email (no confirmados con Fausto, revisar si hace falta corregirlos en Admin > Usuarios). Los mismos 4 emails se intentaron sumar también como verificadores de Play Store.

**Hallazgo real:** `elcauquensrl@hotmail.com` fue **rechazado por Google Play** con el error *"Este correo electrónico no existe"* — esa dirección de Hotmail no tiene ninguna cuenta de Google asociada (Play exige que el verificador tenga Google Account, no alcanza con cualquier email). Sacado de la lista de testers (sigue existiendo como usuario del sistema Los Lirios, eso no depende de Google).

**Segunda tanda (3 emails, solo testers, sin usuario en el sistema):** `faustoyanzonfb@gmail.com` (el mismo Apple ID de Fausto, distinto del `faustoyfb@gmail.com` de la primera tanda), `calidadturcatto@gmail.com`, `alcirayanzon@gmail.com` — completó los 12.

**Lista final de los 12 verificadores:** `administracion@losliriossa.com`, `camilotrabajofinca@gmail.com`, `faustoyfb@gmail.com`, `faustoyanzonfb@gmail.com`, `leticiayanzon@gmail.com`, `maribarcelo18@gmail.com`, `mercadoheber43@gmail.com`, `mercadolucas919@gmail.com`, `nicolasyanzoncastro@gmail.com`, `ri3215015@gmail.com`, `calidadturcatto@gmail.com`, `alcirayanzon@gmail.com`.

**Hallazgo real de cierre, importante para no dar el requisito por cumplido antes de tiempo:** el checklist oficial de Google (Play Console → Panel de la app → sección "Producción" → "Cómo solicitar acceso a producción") distingue **estar en la lista de emails** de **haber aceptado participar**. Al cierre de la sesión: 12/12 en la lista, pero **"Actualmente, 0 verificadores aceptaron participar"**. Cada uno tiene que entrar a `https://play.google.com/apps/testing/com.loslirios.app` desde el celular, logueado con esa cuenta exacta de Gmail, y tocar "Convertirme en probador" — recién ahí arrancan a contar los 14 días corridos. Fausto ya les había mandado el link a varios antes de este hallazgo — hay que confirmar en ese mismo panel cuántos aceptaron de verdad antes de asumir que el reloj de 14 días está corriendo.

## Pendiente real para la próxima sesión

1. **Play Store:** confirmar en el panel de Producción cuántos de los 12 ya aceptaron participar (no asumir que mandar el link alcanza). Recién cuando los 12 acepten arrancan los 14 días corridos.
2. **iOS:** cuando Fausto quiera sumar testers reales (ninguno tiene cuenta de Apple todavía), armar un grupo de **pruebas externas** en TestFlight (requiere Beta App Review de Apple la primera vez, a diferencia del grupo interno).
3. Confirmar con Fausto los nombres completos reales de los 4 usuarios nuevos del sistema (se usaron nombres inferidos del email: "El Cauquen SRL", "Leticia Yanzon", "Mari Barcelo", "Fausto Yanzon").
4. Sigue pendiente de sesiones previas: Misión/Visión/Valores en Documentación > Empresa (placeholder), y el chatbot de WhatsApp pausado esperando que Fausto consiga un chip prepago nuevo para registrar un número real en Meta.

## Ver también

- [[2026-08-28-play-store-produccion-ios-fix-parcelas]]
- [[Bugs Conocidos]]
- [[Play Store — checklist de publicación]]
- [[Sistema de Gestión Agrícola]]
