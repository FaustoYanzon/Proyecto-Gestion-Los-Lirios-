---
tags: [sistema, spec, mobile, offline, pendiente]
---

# Spec — Cola de envíos offline (mobile)

> **Estado: spec, NO implementado.** Escrito el 2026-08-06 a pedido explícito de Fausto para que una sesión futura arranque directo a implementar en vez de re-investigar el problema desde cero. Decisión tomada esa sesión (ver [[2026-08-05-login-username-biometria-clima]]): explicar el comportamiento actual y documentar el plan, sin tocar código todavía.

## Motivación

Los operarios de campo (encargado/regador) usan datos móviles en Media Agua, con señal intermitente. Preguntó Fausto explícitamente cómo se comporta hoy el cache offline antes de decidir el login — la respuesta reveló un gap real que quedó pendiente de resolver.

## Comportamiento actual (verificado en código, 2026-08-05)

- Los selectores de parcela/trabajador **sí funcionan sin conexión** — `getCache`/`setCache` (`mobile/lib/cache.ts`) cachean localmente con TTL (parcelas y trabajadores: 1h) y se muestran igual sin señal.
- El **`POST` final de "Confirmar" en los 3 wizards con este patrón (`tareas.tsx`, `riego.tsx`, `fito.tsx`) necesita conexión en el momento exacto en que se toca el botón.** Si falla por falta de señal, se muestra un `Alert` de error genérico y **el formulario no se guarda en ningún lado** — si el usuario sale de la pantalla, pierde lo tipeado.
- No existe `@react-native-community/netinfo` ni ninguna librería de detección de conectividad en el proyecto (confirmado, no está en `package.json`/`package-lock.json`).
- No existe ninguna cola de reintento offline en ningún lugar del código (confirmado por búsqueda global de "offline"/"queue"/"pending" — las únicas coincidencias son comentarios `catch { /* offline */ }` que simplemente silencian el catch, no encolan nada).
- **A favor:** los 6 endpoints de creación de producción (`trabajo/`, `trabajo/masivo`, `riego/`, `riego/iniciar`, `fitosanitarios/`, `cosecha/`) ya soportan `idempotency_key` (cerrado el 2026-07-29, ver [[2026-07-29-duplicados-cuarta-vez-idempotencia-real]]) — un reintento con la misma key devuelve el registro ya creado en vez de duplicar. Esto es lo que hace viable una cola real sin riesgo de duplicar.
- El interceptor de retry de `mobile/lib/api.ts` (líneas ~54-91 al momento de esta nota) ya reintenta automáticamente, una vez, cualquier request sin `error.response` si es GET o si es una escritura con `idempotency_key` en el body — pero es un retry inmediato de un solo intento, no una cola persistente que espere a que vuelva la señal.

## Alcance propuesto

**Wizards a cubrir (orden sugerido por volumen de uso real):**
1. `mobile/app/(tabs)/tareas.tsx` — `StepConfirmar` → `POST /produccion/trabajo/masivo`
2. `mobile/app/(tabs)/riego.tsx` — `StepConfirmar` → `POST /produccion/riego/`
3. `mobile/app/fito.tsx` — `StepConfirmar` → `POST /produccion/fitosanitarios/`

`cosecha.tsx`/`campana.tsx` quedan fuera del alcance inicial (decisión a confirmar con Fausto al arrancar — menor volumen, se cargan con menos urgencia de campo).

**Fuera de alcance a propósito:** operaciones de `UPDATE`/`DELETE` (no tienen `idempotency_key` hoy, reintentarlas a ciegas sí sería riesgoso). Solo las 3 creaciones de arriba.

## Arquitectura propuesta

### 1. Detección de conectividad
Instalar `@react-native-community/netinfo` (`npx expo install @react-native-community/netinfo` — confirmar que es compatible con Expo SDK 54 antes de instalar). Usar `NetInfo.addEventListener` para saber cuándo vuelve la señal, y `NetInfo.fetch()` para chequear el estado antes de decidir si encolar o intentar directo.

### 2. Cola persistente
Nuevo módulo `mobile/lib/offlineQueue.ts`:
- Estructura por item: `{ id: string, endpoint: string, payload: object, createdAt: string, retryCount: number, lastError?: string }`.
- Persistida en `AsyncStorage` (no es dato sensible) bajo una clave propia, ej. `ll_offline_queue` — **debe escribirse inmediatamente al encolar**, no solo mantenerse en memoria, para sobrevivir a que el usuario cierre la app con items pendientes.
- Funciones: `enqueue(item)`, `getQueue()`, `removeFromQueue(id)`, `markFailed(id, error)`.

### 3. Flujo de guardado (en cada `StepConfirmar`)
- Si el `POST` falla con `!error.response` (sin respuesta — mismo criterio que ya usa el interceptor de retry hoy):
  - Encolar el payload completo (ya incluye `idempotency_key`, generado una sola vez al entrar al paso, como ya funciona hoy).
  - Mostrar confirmación de que **quedó guardado localmente y se va a sincronizar solo** (no un error) — cambia la semántica de "falló" a "guardado, pendiente de subir". Esto es un cambio de UX importante: hoy un fallo de red se ve igual que un error real; con la cola, dejan de ser lo mismo.
- Si falla con `error.response` (4xx/5xx real, el servidor respondió) — sigue siendo un error real, mostrar el `Alert` de siempre. No encolar errores de validación.

### 4. Sincronización en segundo plano
- Listener de `NetInfo` que, al detectar que vuelve la conexión, procesa la cola en orden FIFO: por cada item, reintenta el `POST`; si tiene éxito, `removeFromQueue`; si vuelve a fallar sin respuesta, se queda en la cola para el próximo intento; si falla con una respuesta 4xx real (ej. la parcela referenciada ya no existe), marcar como `failed` en vez de reintentar para siempre — necesita revisión manual, no hay forma segura de resolverlo solo.
- Complementar con un intento al volver la app a foreground (`AppState`), no depender solo del evento de NetInfo.

### 5. UI de la cola
- Nuevo indicador (banner o badge) visible en las pantallas de lista (Tareas/Riego/Fitosanitarios) cuando hay items pendientes: "N registros pendientes de sincronizar" — sin esto el usuario no tiene ninguna señal de que algo quedó guardado localmente.
- Los items marcados `failed` necesitan alguna forma de que el usuario los vea y decida (reintentar a mano / descartar) — a definir el diseño exacto en la sesión de implementación.

## Preguntas abiertas para resolver al arrancar la implementación

1. ¿Cubrir los 3 wizards de una sola vez o entregar `tareas.tsx` primero, probarlo un tiempo real en el campo, y recién después extender a riego/fito?
2. ¿Los items en la cola deben ser editables/borrables por el usuario antes de sincronizar, o son de solo lectura hasta que se suben?
3. ¿Hay un límite de reintentos o de antigüedad antes de marcar un item como "necesita atención" aunque el error siga siendo "sin respuesta" (ej. 7 días sin poder subir)?
4. ¿Extender esto a `cosecha.tsx`/`campana.tsx` en la misma tanda o después?

## Cómo probarlo (no hay test automatizado posible para conectividad real)

Plan de QA manual sugerido: modo avión en el dispositivo real, completar un wizard, confirmar que se guarda localmente (no error), volver a activar los datos, confirmar que sincroniza solo sin duplicar (chequear `idempotency_key` en la fila resultante). Repetir cerrando la app por completo entre el guardado offline y la reconexión, para probar que la cola persiste en `AsyncStorage` y no se pierde.

## Ver también

- [[2026-08-05-login-username-biometria-clima]] — decisión de diferir esto, tomada en esa sesión
- [[2026-07-29-duplicados-cuarta-vez-idempotencia-real]] — infraestructura de `idempotency_key` que hace esto seguro
- [[Sistema de Gestión Agrícola]] § Próximos pasos
