/**
 * Plain text from a note document, by the same rule as the database's
 * private.note_text (migration 20261017090000_notes): the text of every text
 * node, with line breaks between blocks. Used to preview notes that exist
 * only as local drafts; the database derives its own copy on every save.
 */
export function noteText(node: unknown): string {
  if (typeof node !== 'object' || node === null) return ''
  const { type, text, content } = node as { type?: string; text?: string; content?: unknown }
  if (type === 'text') return text ?? ''
  if (type === 'hardBreak') return '\n'
  if (!Array.isArray(content)) return ''
  const inline = content.every((child) => ['text', 'hardBreak'].includes((child as { type?: string })?.type ?? ''))
  return content.map(noteText).join(inline ? '' : '\n')
}
