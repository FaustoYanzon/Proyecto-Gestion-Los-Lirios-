'use client'

import { useEffect, useRef, useState } from 'react'

interface RotationState {
  idx: number
  ts: number
}

function readRotation(key: string): RotationState {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as RotationState
  } catch {
    /* localStorage unavailable (SSR, privacy mode) — fall back to sentinel */
  }
  return { idx: -1, ts: 0 }
}

function writeRotation(key: string, state: RotationState) {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    /* non-critical: rotation just won't persist across reloads */
  }
}

/**
 * Rotating index persisted in localStorage, so a single item from a list
 * (e.g. one phenology notification at a time) advances instead of showing
 * everything at once. Advances on:
 *   1. Mount (covers "inicia sesión" / "vuelve a la página de inicio" —
 *      each page visit mounts this hook fresh).
 *   2. Every `intervalMs` while the component stays mounted (covers staying
 *      on the same page for a long stretch).
 * The index is stored globally under `storageKey`, so it keeps advancing
 * across page reloads / logins instead of resetting to 0 every time.
 */
export function useRotatingIndex(
  length: number,
  storageKey: string,
  intervalMs: number = 15 * 60 * 1000,
): number {
  const [idx, setIdx] = useState(0)
  const advancedOnMount = useRef(false)

  useEffect(() => {
    if (length === 0) return

    if (!advancedOnMount.current) {
      advancedOnMount.current = true
      const state = readRotation(storageKey)
      const next = (state.idx + 1 + length) % length
      writeRotation(storageKey, { idx: next, ts: Date.now() })
      setIdx(next)
    }

    const interval = setInterval(() => {
      const state = readRotation(storageKey)
      const next = (state.idx + 1) % length
      writeRotation(storageKey, { idx: next, ts: Date.now() })
      setIdx(next)
    }, intervalMs)

    return () => clearInterval(interval)
  }, [length, storageKey, intervalMs])

  return idx
}
