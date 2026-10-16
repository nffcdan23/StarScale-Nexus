/**
 * True inside the StarScale Nexus desktop app (Tauri), false in a browser.
 * Tauri adds this marker to the window before the app's own code runs.
 */
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
