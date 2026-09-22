'use client'

import { useState } from 'react'

/**
 * True exactly on the render right after `value` changes (by `Object.is`),
 * then false again. Lets you reset/derive other state in response to a
 * changed prop/value without the "setState synchronously within an effect"
 * anti-pattern — call any setState you need directly after checking this,
 * in the render body itself, per React's own guidance ("Adjusting state
 * when a prop changes": https://react.dev/learn/you-might-not-need-an-effect).
 *
 * Must be called unconditionally like any hook. When watching more than one
 * value, call it once per value and combine the results with `||` — don't
 * short-circuit (`useChanged(a) || useChanged(b)` would skip the second
 * call whenever the first is already true, breaking the rules of hooks).
 */
export function useChanged<T>(value: T): boolean {
  const [prev, setPrev] = useState(value)
  if (!Object.is(prev, value)) {
    setPrev(value)
    return true
  }
  return false
}

// Shared reference so every empty array normalizes to the *same* identity.
const EMPTY_ARRAY: readonly never[] = []

/**
 * `useChanged` for arrays/lists, safe against the common
 * `const { data: items = [] } = useQuery(...)` idiom used throughout this
 * app: that fallback creates a brand-new `[]` on every render while `data`
 * is still `undefined` (loading, or between refetches), which would make
 * plain `useChanged` see "changed" on every single render — Object.is on
 * a fresh array literal is never true — and loop forever, since (unlike
 * the old `useEffect(() => setX(1), [items])` pattern it replaces) there's
 * no primitive-value bailout to stop it. Normalizing every empty list to
 * one shared reference fixes that without touching each query call site.
 */
export function useChangedList<T>(items: readonly T[]): boolean {
  return useChanged(items.length === 0 ? EMPTY_ARRAY : items)
}
