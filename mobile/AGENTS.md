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
