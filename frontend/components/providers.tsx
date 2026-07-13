// Deprecated: this file was an orphaned duplicate never imported by the app,
// which meant its initAuth() call never ran — root cause of the F5/new-tab
// session bugs (see app/providers.tsx, which now owns this logic).
// Kept as a re-export only in case anything still imports from this path.
export { default } from '@/app/providers'
