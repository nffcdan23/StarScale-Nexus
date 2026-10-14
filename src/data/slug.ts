/**
 * The short internal name the database requires for a context: lowercase
 * letters, digits and dashes, starting with a letter, at most 40 characters.
 * The owner never sees it; it stays the same if the context is renamed.
 */
export function slugFor(name: string, suffix = 1): string {
  let base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!base) base = 'context'
  if (!/^[a-z]/.test(base)) base = `c-${base}`

  const ending = suffix > 1 ? `-${suffix}` : ''
  return `${base.slice(0, 40 - ending.length).replace(/-+$/, '')}${ending}`
}
