// Generates a client-side key for one logical form submission, sent with
// create requests so a duplicated/retried submit (e.g. a double-click, or
// the user resubmitting after a slow response) is absorbed by the backend
// instead of creating a second row. Call once per submission (e.g. via a
// lazy useRef initializer), never regenerate it across retries of the same
// attempt.
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
