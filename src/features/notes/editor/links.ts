import { isSafeLink } from './extensions'

/**
 * Turns what the owner typed into a link address, or null if it is not a
 * web or email address. "example.com" becomes "https://example.com".
 */
export function toLinkAddress(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  if (isSafeLink(text)) return text
  // A bare address such as example.com or www.example.com/page.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text) && /^[^\s/]+\.[^\s/]+(\/\S*)?$/.test(text)) return `https://${text}`
  return null
}
