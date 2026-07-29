// Generates a client-side key for one logical form submission (wizard/form
// instance), sent with create requests so a retried/duplicated request (e.g.
// the user re-tapping "Guardar" after a slow response, once the useRef
// double-tap guard has already reset) is absorbed by the backend instead of
// creating a second row. Call once per submission (e.g. via a lazy useRef
// initializer), never regenerate it across retries of the same attempt.
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
