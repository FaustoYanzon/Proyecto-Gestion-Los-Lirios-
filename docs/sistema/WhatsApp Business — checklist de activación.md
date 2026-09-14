---
tags: [sistema, checklist, whatsapp]
---

# WhatsApp Business — checklist de activación

Chatbot para cargar gastos por WhatsApp (mandás "5000 nafta camioneta no pagado" o una foto de un comprobante, el sistema lo registra como `MensajeWhatsappPendiente` pendiente de clasificar). Backend, DB y pantalla de administración (`/dashboard/admin/whatsapp`) ya están construidos y en producción desde el 2026-08-28 — lo único que faltaba era un número de teléfono real para registrar en Meta. Ver [[2026-08-28-estetica-v1-rediseno-web-mobile]].

**Número activo:** 2646207558 (confirmado por Fausto el 2026-09-09). **Chatbot completo y verificado en producción desde el 2026-09-14** — ver cierre al final de este archivo.

## Pasos en Meta (los hace Fausto — requieren su cuenta/identidad)

- [x] 1. Entrar a [developers.facebook.com](https://developers.facebook.com/apps) con la cuenta de Facebook que va a administrar el chatbot → **Crear app** → tipo "Business". (App **"Los Lirios Egresos Bot"**, App ID `934763366338287`, ya existía desde el 08-27.)
- [x] 2. Dentro de la app, agregar el producto **WhatsApp**.
- [x] 3. En la configuración de WhatsApp → **Agregar número de teléfono**, cargar 2646207558 y verificarlo (Meta manda un código por SMS o llamada a ese chip — tiene que estar con señal a mano). **Hecho 2026-09-14** — Fausto verificó el código él mismo; el registro final (PIN de 6 dígitos de dos pasos) se completó vía Claude in Chrome en Meta for Developers → Use cases → Connect on WhatsApp → Step 2 → "Register your WhatsApp phone number". Estado en el panel: **Registered**.
- [x] 4. Una vez verificado, anotar el **Phone Number ID** y el **WhatsApp Business Account ID (WABA ID)** que muestra el panel. → **Phone Number ID: `1341294379061933`** · **WABA ID: `899518322994696`** (business "Los Lirios SA").
- [x] 5. Generar un **token permanente**: Business Settings → System Users → crear un System User (rol Admin) → asignarle la app de WhatsApp → generar token con permisos `whatsapp_business_messaging` + `whatsapp_business_management`, sin fecha de expiración. (El token que aparece por default en la pantalla de "API Setup" expira a las 24hs — no sirve para producción.) **Ya hecho desde el 08-27** — system user "Egresos Backend", token generado sin vencimiento ("Never"). Falta confirmar que ese token siga siendo válido ahora que el número real quedó registrado (probarlo en el paso 12).
- [x] 6. Copiar el **App Secret** de la app (Configuración básica de la app). → `9e547acd9ec38f12334bbc8b3dd8638f` (requirió reingresar la contraseña de Facebook de Fausto para revelarlo — paso que Claude no puede hacer).
- [x] 7. Inventar un **Verify Token** propio (cualquier string, ej. una contraseña larga random) — no lo da Meta, lo definís vos y lo repetís en el paso del webhook. **Ya estaba hecho desde el 08-27** (`WHATSAPP_VERIFY_TOKEN` ya existía en Railway) — se reutilizó tal cual.
- [x] 8. Configurar el webhook en la app → WhatsApp → Configuration → Webhook:
  - **Callback URL:** `https://proyecto-gestion-los-lirios-production.up.railway.app/whatsapp/webhook`
  - **Verify token:** el mismo string inventado en el paso 7
  - Suscribirse al campo **messages**
  **Ya estaba cargado desde el 08-27**; solo hizo falta "Verify and save" de nuevo el 09-14 (fallaba porque el campo de token queda enmascarado y Meta pide reingresarlo a mano, no acepta el valor tal cual se ve).

## Pasos técnicos (los hace Claude Code, una vez que Fausto tenga los 4 datos de arriba)

- [x] 9. Setear en Railway (`railway variables --set` sobre el servicio del backend): `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`. **El classifier de Claude Code bloquea leer un token recién generado en Meta (clipboard o `railway variables` con grep/jq) por "Credential Materialization"** — el patrón que funcionó: Fausto copia el token en Meta, lo pega él mismo en el chat, y desde ahí sí se arma y corre el comando `railway variables --set`.
- [x] 10. Confirmar que Meta pudo verificar el webhook. **Verificó bien, pero eso NO alcanza** — ver "Hallazgo clave" abajo.
- [x] 11. Vincular el/los números de teléfono reales de quienes van a cargar gastos desde `/dashboard/admin/whatsapp` — solo super_admin puede hacerlo. **Hecho:** Fausto (5492645888400), Camilo (5492645056714), Nicolás (5492644109935), Pablo Yanzon (5492644993633, usuario nuevo creado — no existía en el sistema, rol Gerencial, email `elcauquensrl@gmail.com`).
- [x] 12. Prueba real de punta a punta: mandar un mensaje de texto tipo `5000 nafta camioneta no pagado` desde un número vinculado al 2646207558 y confirmar que responde "✅ Registrado" y que aparece el `MensajeWhatsappPendiente` en la DB/pantalla correspondiente. **Confirmado 2026-09-14** — apareció en `/dashboard/finanzas/a-pagar` parseado correctamente (monto, descripción, "No pagado", atribuido al usuario del teléfono).

### Hallazgo clave — por qué el mensaje no llegaba pese a webhook "verificado"

Verificar y guardar el webhook (paso 8/10) **no alcanza**. El WABA necesita que la app quede explícitamente en su lista `subscribed_apps` — sin eso, Meta jamás dispara el POST al webhook aunque todo lo demás esté bien configurado (`GET /{waba_id}/subscribed_apps` devolvía `{"data":[]}`). Se diagnosticó comparando contra el WABA de prueba (que sí tenía la app suscripta, por eso "Try it out" del Paso 1 siempre funcionó) vs. el WABA real "Los Lirios SA" (conectado manualmente en una sesión anterior, nunca pasó por el alta automática que sí suscribe la app).

**Solución:**
1. En Business Settings → WhatsApp accounts → Los Lirios SA → People → dar al system user "Egresos Backend" **Full access ("Everything")**, no solo "Messages" — el nivel parcial no alcanza para gestionar suscripciones.
2. En Business Settings → Accounts → Apps → Los Lirios Egresos Bot → People → dar al mismo system user **"Manage app"** (no solo "Test app") — sin esto el POST de abajo da `(#200) Permissions error` igual.
3. Recién con esos dos permisos: `curl -X POST "https://graph.facebook.com/v21.0/{waba_id}/subscribed_apps?access_token={token del system user}"` → `{"success":true}`.

Sin este paso, un WABA conectado "a mano" (no vía el alta guiada de Meta) puede pasar los pasos 1 a 3 del wizard con tilde verde y jamás recibir un mensaje real — vale la pena chequear `subscribed_apps` primero si esto se repite en otro proyecto.

## Notas

- El webhook (`POST /whatsapp/webhook`) es la única ruta del backend sin JWT — se autentica con la firma HMAC (`X-Hub-Signature-256`, usa `WHATSAPP_APP_SECRET`). Sin ese secret configurado, el backend deja pasar cualquier request sin validar firma (con warning en logs) — no debería quedar así en producción una vez completado este checklist.
- Meta reintenta agresivamente si el webhook no responde 200 rápido — el código ya está armado para nunca propagar un 500 (loguea y responde 200 igual), no debería hacer falta tocar nada ahí.
- El primer mensaje real que llegue de un número **no vinculado todavía** en `/dashboard/admin/whatsapp` va a recibir automáticamente "Tu número no está autorizado..." — es el comportamiento esperado, no un error.

## ¿Se puede leer un grupo de WhatsApp? (investigado 2026-09-14, no implementado)

Fausto preguntó si el bot podía sumarse al grupo de gerenciales (Fausto, Camilo, Pablo, Nicolás — nunca más de 8 personas) donde ya comparten gastos/facturas/remitos, para cargarlos automáticamente desde ahí. Meta lanzó una "Groups API" en 2026, pero no aplica a este caso:

- Requiere que el negocio sea **Official Business Account (OBA)** — no es un trámite de verificación más, es un criterio de mérito ("marca notable, reconocida y buscada frecuentemente"). Una empresa familiar como Los Lirios no califica, independientemente del esfuerzo que se le dedique.
- Aunque calificara, la API no permite "sumar el bot a un grupo ya existente" — solo puede *crear* un grupo nuevo desde la propia API e invitar gente (tope 8 participantes). Habría que migrar la conversación entera a un grupo nuevo.

**Decisión:** no se implementa. Alternativa que sí funciona con lo ya construido: cada gerencial vinculado individualmente (ver paso 11) reenvía al bot (2 toques: mantener presionado → Reenviar) los mensajes del grupo que quiere que se carguen — el grupo sigue existiendo tal cual para la conversación del equipo.

## Ver también

- [[2026-08-28-estetica-v1-rediseno-web-mobile]] (sesión donde se construyó el chatbot completo)
- [[Arquitectura]]
