// In the desktop app, links that leave Nexus (for example a link in a note)
// open in the owner's default browser. The app window itself never goes to
// another site (the Rust side refuses that too), and only web and email links
// are opened at all: the same rule as notes (isSafeLink) and the database.

const allowed = new Set(['http:', 'https:', 'mailto:'])

/**
 * Catches clicks on links to anywhere outside the app and hands web and
 * email links to open() instead. Returns a function that stops it.
 */
export function handleExternalLinks(open: (url: string) => Promise<void>, root: Document = document) {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return
    const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!link) return
    let url: URL
    try {
      url = new URL(link.getAttribute('href') ?? '', root.location.href)
    } catch {
      event.preventDefault()
      return
    }
    // Links within Nexus are handled by the app's own navigation.
    if (url.origin === root.location.origin && (url.protocol === 'http:' || url.protocol === 'https:')) return
    event.preventDefault()
    if (allowed.has(url.protocol)) void open(url.href).catch(() => {})
  }
  root.addEventListener('click', onClick, true)
  root.addEventListener('auxclick', onClick, true)
  return () => {
    root.removeEventListener('click', onClick, true)
    root.removeEventListener('auxclick', onClick, true)
  }
}
