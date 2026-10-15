import { lazy, Suspense } from 'react'

// Notes, with its editor, loads only when opened: nothing else downloads it
// (the build check enforces this).
const NotesPage = lazy(() => import('./NotesPage').then((module) => ({ default: module.NotesPage })))

export function LazyNotesPage() {
  return (
    <Suspense fallback={<p className="visually-hidden">Loading Notes…</p>}>
      <NotesPage />
    </Suspense>
  )
}
