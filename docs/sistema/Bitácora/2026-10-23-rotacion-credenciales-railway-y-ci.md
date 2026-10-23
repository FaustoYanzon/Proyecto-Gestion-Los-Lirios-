---
fecha: 2026-10-23
tags: [sistema, bitacora, seguridad, railway, ci]
---

# Bitácora 2026-10-23: rotación de credenciales (incidente Railway) y CI rojo en main

## Rotación de credenciales

Railway avisó el 2026-10-21 (mail "Rotate Credentials", incidente `QH8L8B3E`) que un tercero pudo leer variables de entorno cifradas. Se rotó todo lo que vivía en el proyecto `adequate-cooperation` (producción).

- **Postgres** (`ALTER ROLE postgres` + `POSTGRES_PASSWORD`, `PGPASSWORD`, `DATABASE_URL`, `DATABASE_PUBLIC_URL`), **`SECRET_KEY`** y **password del super admin**. Se hizo con un script que genera los secretos en memoria, actualiza DB y variables y dispara un solo deploy. Efecto: se cerraron todas las sesiones (JWT firmados con la clave vieja).
- **WhatsApp** (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`), **Cloudinary** (API key + secret) y **Sentry** (DSN): rotados a mano por Fausto en cada panel y cargados desde el dashboard de Railway. Las credenciales viejas se revocaron en cada servicio.
- Pendiente: `WHATSAPP_VERIFY_TOKEN` (hay que cambiarlo también en el webhook de Meta).
- Sin claves de IA (Anthropic/OpenAI/etc.) en el código ni en Railway.

Cosas que no son obvias:

- `SUPER_ADMIN_PASSWORD` **solo se usa al sembrar** el admin (`app/core/seed.py` sale si el usuario ya existe). Cambiar la variable no cambia la password real: hay que actualizar `users.hashed_password`.
- `railway login` caduca; tras `invalid_grant` hay que volver a loguearse.
- `railway variable set K --stdin` no sirve desde la terminal `!` de Claude Code (no hay TTY para `read`). Para valores sueltos, el dashboard web de Railway.
- Desde Python, `subprocess` no encuentra `railway` (es un `.cmd` en `%APPDATA%\npm`): usar `shutil.which`.

## CI rojo en main (14/10 y 22/10)

No era un bug de la app. `tests/test_cheques_aviso.py` usaba `date.today()` (UTC en GitHub) y `app/core/cheques_aviso.py` calcula "hoy" en `FINCA_TZ` (America/Argentina/San_Juan). Entre las 21 y las 24 hs de Argentina el cheque con `f_pago = hoy` queda en el futuro para la app y el test falla. Las tres corridas rojas fueron entre 00:51 y 02:32 UTC.

- Reproducido en Linux/Python 3.12 con `faketime '2026-10-22 02:03:00'`; con el arreglo (`_hoy()` en hora de la finca) la suite pasa a las 02:03 UTC y a las 15:00 UTC.
- Regla: los tests que dependen de "hoy" deben usar la zona de la finca, no `date.today()`.
