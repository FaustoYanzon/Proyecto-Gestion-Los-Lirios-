# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

## `eas update` siempre con `--environment preview`

`eas build` toma `EXPO_PUBLIC_API_URL` de `eas.json` (`build.preview.env`), pero
`eas update` NO lee ese bloque — lee el `.env` local (uso de desarrollo, apunta a
una IP LAN) salvo que se le pase `--environment preview` explícitamente, que
ahora sí trae la URL correcta desde las variables de entorno hosteadas en EAS
(`eas env:list --environment preview`). Publicar sin ese flag rompe el
conectividad de la build instalada apenas aplica el OTA (root cause real de un
bug de login del 2026-07-20 — el bundle nativo funcionaba, pero se rompía al
cerrar/reabrir la app y aplicarse el update con la URL equivocada).

Comando correcto:
```
eas update --branch preview --environment preview -m "mensaje"
```

## `--environment` no salva si no hay variables hosteadas en ese entorno

`--environment production` solo sirve si existe una variable `EXPO_PUBLIC_API_URL`
creada con `eas env:create --environment production ...` (verificar con
`eas env:list --environment production`). Si no existe (pasó el 2026-07-29,
nunca se creó para "production", solo para "preview"), el comando cae al
`.env` local — y si además hay un `EXPO_PUBLIC_API_URL` **exportado en la
shell** (quedó de una sesión de dev con la IP LAN), esa variable de entorno
gana sobre el `.env` del repo sin ningún aviso. Un `eas update` así publicó
en producción un bundle con la IP LAN grabada adentro, rompiendo la
conectividad para cualquiera que lo recibiera — se detectó recién bajando el
bundle publicado y haciendo `grep` (no alcanza con mirar el `.env` del repo:
ese sí tenía la URL correcta, la shell del que publica es la que manda).

**Forma robusta, no depende de la shell de quien publica:**
```
EXPO_PUBLIC_API_URL=https://proyecto-gestion-los-lirios-production.up.railway.app npx eas update --branch production --environment production -m "mensaje"
```

**Verificación real después de publicar** (no alcanza con mirar el código fuente):
```
npx eas update:view <update-group-id> --json   # confirma el commit publicado
grep -a -o "https://proyecto-gestion-los-lirios-production[a-zA-Z0-9./_-]*" dist/_expo/static/js/android/entry-*.hbc
grep -aoE "192\.168\.[0-9]+\.[0-9]+" dist/_expo/static/js/android/entry-*.hbc   # debe salir vacío
```

**Fix de fondo pendiente:** crear `EXPO_PUBLIC_API_URL` como variable hosteada
en EAS para el entorno `production` (`eas env:create --environment production
--name EXPO_PUBLIC_API_URL --value https://proyecto-gestion-los-lirios-production.up.railway.app`),
igual que ya existe para `preview` — así deja de depender de qué haya en la
shell de quien corre el publish.
