---
name: frontend-nextjs
description: Use for frontend work in the Los Lirios project — new/changed dashboard pages, components, forms, tables, or API client modules under frontend/. Not for backend routes/models (use backend-fastapi) and not for the mobile app (use mobile-expo).
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
---

You work on the Next.js dashboard (`frontend/`) of the Los Lirios agricultural management system — the web app used by gerencial/encargado roles.

## Before writing any code
This project pins a Next.js version that **may have breaking changes from your training data** (`frontend/AGENTS.md` says so explicitly). Read the relevant guide in `node_modules/next/dist/docs/` before writing code that touches routing, data fetching, or App Router conventions — don't assume APIs you remember from an older Next.js still work the same way here.

## Stack
Next.js 16 (App Router) · React 19 · TypeScript · TanStack Query v5 · Zustand v5 · Axios · Zod v4 · React Hook Form v7 · Recharts v3 · Leaflet (finca map) · Lucide React icons · Tailwind.

## Structure and conventions
- Pages: `frontend/app/dashboard/<area>/<feature>/page.tsx`. Check `PROJECT_MAP.md` (auto-generated, regenerate with `scripts/generate_project_map.py`) for the current full route list, component inventory, and API client module list before assuming something doesn't exist yet.
- API calls go through `frontend/lib/api/<domain>.ts` modules (axios), not inline fetch — mirror the pattern of an existing module in the same domain.
- Tables: paginate at 10 rows/page with the established pattern (`useState` page, `useEffect` reset to page 1 on filter/data change, `Anterior`/`Siguiente` buttons with `ChevronLeft`/`ChevronRight` from lucide-react, "`X–Y de Z`" label) — see `components/finanzas/IngresosTable.tsx` or `app/dashboard/finanzas/cheques/page.tsx` for the reference implementation, don't invent a new pagination pattern.
- Forms: React Hook Form + Zod schema, matching an existing `*Form.tsx` in the same domain for field layout/labels/validation style.

## Known sharp edges (real bugs already hit in this project — don't reintroduce them)
- **`Decimal` backend fields arrive as strings in JSON**, not numbers. Convert explicitly with `Number(...)` in the API client layer (not scattered at each use site) before `.toFixed()`, charting, or arithmetic — this has caused `$NaN` totals and `.toFixed is not a function` crashes more than once.
- **List endpoints have a `limit` parameter with a real ceiling** (raised to 10,000 after a season exceeded the old 1,000 cap and silently dropped older months from a client-side-aggregated view). If you're fetching "everything for a season" to aggregate client-side, check the endpoint's actual `limit`/pagination behavior rather than assuming an unbounded fetch.
- **z-index inside the Leaflet map** competes with the app header/sidebar unless contained. The map's `<main>` wrapper uses CSS `isolate` to create its own stacking context — any new floating UI inside the map (chips, legends, popups) should stay within that containment, not reach for ad-hoc high z-index values that can leak out and cover the header again.
- Mobile-responsive headers: use `flex-wrap`/`overflow-x-auto`, not fixed widths, on filter bars and page headers — several pages needed retrofitting for this.

## Deploy
**Vercel does NOT auto-deploy on push in this project.** After any push that touches `frontend/`, run `vercel --prod` (or `npx vercel --prod --yes`) from `frontend/` — otherwise production can sit on a stale build for days without anyone noticing.

## Verify before calling it done
Test the actual feature in a browser (Claude in Chrome) against a running local dev server — type-checking and `tsc --noEmit` catch syntax errors, not broken UX. This project's convention is local click-through before commit/push/deploy, not just after.
