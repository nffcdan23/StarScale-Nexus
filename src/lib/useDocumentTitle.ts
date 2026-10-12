import { useEffect } from 'react'
import { brand } from '../app/brand'

/** Sets the browser tab title for a page. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · ${brand.name}`
  }, [title])
}
