---
tags: [sistema, checklist, whatsapp]
---

# WhatsApp Business — checklist de activación

Chatbot para cargar gastos por WhatsApp (mandás "5000 nafta camioneta no pagado" o una foto de un comprobante, el sistema lo registra como `MensajeWhatsappPendiente` pendiente de clasificar). Backend, DB y pantalla de administración (`/dashboard/admin/whatsapp`) ya están construidos y en producción desde el 2026-08-28 — lo único que faltaba era un número de teléfono real para registrar en Meta. Ver [[2026-08-28-estetica-v1-rediseno-web-mobile]].

**Número activo:** 2646207558 (confirmado por Fausto el 2026-09-09).

## Pasos en Meta (los hace Fausto — requieren su cuenta/identidad)

- [x] 1. Entrar a [developers.facebook.com](https://developers.facebook.com/apps) con la cuenta de Facebook que va a administrar el chatbot → **Crear app** → tipo "Business". (App **"Los Lirios Egresos Bot"**, App ID `934763366338287`, ya existía desde el 08-27.)
- [x] 2. Dentro de la app, agregar el producto **WhatsApp**.
- [x] 3. En la configuración de WhatsApp → **Agregar número de teléfono**, cargar 2646207558 y verificarlo (Meta manda un código por SMS o llamada a ese chip — tiene que estar con señal a mano). **Hecho 2026-09-14** — Fausto verificó el código él mismo; el registro final (PIN de 6 dígitos de dos pasos) se completó vía Claude in Chrome en Meta for Developers → Use cases → Connect on WhatsApp → Step 2 → "Register your WhatsApp phone number". Estado en el panel: **Registered**.
- [x] 4. Una vez verificado, anotar el **Phone Number ID** y el **WhatsApp Business Account ID (WABA ID)** que muestra el panel. → **Phone Number ID: `1341294379061933`** · **WABA ID: `899518322994696`** (business "Los Lirios SA").
- [x] 5. Generar un **token permanente**: Business Settings → System Users → crear un System User (rol Admin) → asignarle la app de WhatsApp → generar token con permisos `whatsapp_business_messaging` + `whatsapp_business_management`, sin fecha de expiración. (El token que aparece por default en la pantalla de "API Setup" expira a las 24hs — no sirve para producción.) **Ya hecho desde el 08-27** — system user "Egresos Backend", token generado sin vencimiento ("Never"). Falta confirmar que ese token siga siendo válido ahora que el número real quedó registrado (probarlo en el paso 12).
- [ ] 6. Copiar el **App Secret** de la app (Configuración básica de la app).
- [ ] 7. Inventar un **Verify Token** propio (cualquier string, ej. una contraseña larga random) — no lo da Meta, lo definís vos y lo repetís en el paso del webhook.
- [ ] 8. Configurar el webhook en la app → WhatsApp → Configuration → Webhook:
  - **Callback URL:** `https://proyecto-gestion-los-lirios-production.up.railway.app/whatsapp/webhook`
  - **Verify token:** el mismo string inventado en el paso 7
  - Suscribirse al campo **messages**

## Pasos técnicos (los hace Claude Code, una vez que Fausto tenga los 4 datos de arriba)

- [ ] 9. Setear en Railway (`railway variables --set` sobre el servicio del backend): `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
- [ ] 10. Confirmar que Meta pudo verificar el webhook (el GET de verificación de Meta pega justo después de guardar la config en el paso 8 — si las env vars de Railway no están seteadas todavía, va a fallar y hay que reintentar "Verify and save" desde Meta después del paso 9).
- [ ] 11. Vincular el/los números de teléfono reales de quienes van a cargar gastos (Fausto, encargados, etc.) desde `/dashboard/admin/whatsapp` — solo super_admin puede hacerlo.
- [ ] 12. Prueba real de punta a punta: mandar un mensaje de texto tipo `5000 nafta camioneta no pagado` desde un número vinculado al 2646207558 y confirmar que responde "✅ Registrado" y que aparece el `MensajeWhatsappPendiente` en la DB/pantalla correspondiente.

## Notas

- El webhook (`POST /whatsapp/webhook`) es la única ruta del backend sin JWT — se autentica con la firma HMAC (`X-Hub-Signature-256`, usa `WHATSAPP_APP_SECRET`). Sin ese secret configurado, el backend deja pasar cualquier request sin validar firma (con warning en logs) — no debería quedar así en producción una vez completado este checklist.
- Meta reintenta agresivamente si el webhook no responde 200 rápido — el código ya está armado para nunca propagar un 500 (loguea y responde 200 igual), no debería hacer falta tocar nada ahí.
- El primer mensaje real que llegue de un número **no vinculado todavía** en `/dashboard/admin/whatsapp` va a recibir automáticamente "Tu número no está autorizado..." — es el comportamiento esperado, no un error.

## Ver también

- [[2026-08-28-estetica-v1-rediseno-web-mobile]] (sesión donde se construyó el chatbot completo)
- [[Arquitectura]]
