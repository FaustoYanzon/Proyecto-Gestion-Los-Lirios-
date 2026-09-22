'use client'

import { useState } from 'react'
import { useChangedList } from './useChanged'

/**
 * Client-side pagination over `items`, resetting to page 1 whenever the
 * list itself changes (new data loaded, filter applied) — same convention
 * used across every table in the app (10/page, "X–Y de Z", Anterior/
 * Siguiente). Built on `useChangedList` instead of a `useEffect` that calls
 * `setPage(1)`, which React Compiler flags as an anti-pattern.
 */
export function usePaginatedList<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(1)
  if (useChangedList(items)) setPage(1)

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const paged = items.slice((page - 1) * pageSize, page * pageSize)

  return { page, setPage, totalPages, paged }
}
