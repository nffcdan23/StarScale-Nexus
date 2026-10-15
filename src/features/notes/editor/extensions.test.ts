import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import richNote from '../../../../tests/security/lib/rich-note.json'
import { fakeNoteText } from '../../../test/fakeData'
import { createNoteExtensions, isSafeLink } from './extensions'

// The editor's formatting, tested without any screen: the commands the
// toolbar will call, what the editor saves, and link safety.

let editor: Editor | undefined
const open = (content?: JSONContent) => (editor = new Editor({ extensions: createNoteExtensions(), content }))
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

/** Every node and mark name used anywhere in a document. */
function typesIn(node: JSONContent, found = new Set<string>()) {
  if (node.type) found.add(node.type)
  for (const mark of node.marks ?? []) found.add(mark.type)
  for (const child of node.content ?? []) typesIn(child, found)
  return found
}

/** Opens a one-paragraph note, selects its text and applies one change. */
function formatted(apply: (editor: Editor) => boolean) {
  const current = open({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Some text' }] }] })
  current.commands.selectAll()
  const applied = apply(current)
  return { applied, types: typesIn(current.getJSON()), json: current.getJSON() }
}

describe('note editor formatting', () => {
  it('reopens a note using every approved format exactly as it was saved', () => {
    expect(open(richNote.doc as JSONContent).getJSON()).toEqual(richNote.doc)
  })

  it('derives the same searchable text as the database does (security check NOTE-23)', () => {
    expect(fakeNoteText(richNote.doc).trim()).toBe(richNote.text)
  })

  it.each([
    ['heading', (e: Editor) => e.commands.toggleHeading({ level: 2 })],
    ['bold', (e: Editor) => e.commands.toggleBold()],
    ['italic', (e: Editor) => e.commands.toggleItalic()],
    ['code', (e: Editor) => e.commands.toggleCode()],
    ['bulletList', (e: Editor) => e.commands.toggleBulletList()],
    ['orderedList', (e: Editor) => e.commands.toggleOrderedList()],
    ['taskList', (e: Editor) => e.commands.toggleTaskList()],
    ['blockquote', (e: Editor) => e.commands.toggleBlockquote()],
    ['codeBlock', (e: Editor) => e.commands.toggleCodeBlock()],
    ['horizontalRule', (e: Editor) => e.commands.setHorizontalRule()],
    ['link', (e: Editor) => e.commands.setLink({ href: 'https://example.com' })],
  ])('applies %s', (type, apply) => {
    const { applied, types } = formatted(apply)
    expect(applied).toBe(true)
    expect(types.has(type)).toBe(true)
  })

  it('offers three heading levels only', () => {
    expect(formatted((e) => e.commands.toggleHeading({ level: 3 })).applied).toBe(true)
    expect(formatted((e) => e.commands.toggleHeading({ level: 4 as 1 })).applied).toBe(false)
  })

  it('leaves strikethrough and underline switched off', () => {
    const commands = open().commands as unknown as Record<string, unknown>
    expect(commands.toggleStrike).toBeUndefined()
    expect(commands.toggleUnderline).toBeUndefined()
  })
})

describe('note editor links', () => {
  it('accepts only web and email addresses, the same rule as the database', () => {
    for (const href of ['https://example.com', 'http://example.com/a?b=c', 'mailto:me@example.com', 'HTTPS://EXAMPLE.COM']) {
      expect(isSafeLink(href)).toBe(true)
    }
    for (const href of ['javascript:alert(1)', ' javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '/relative', 'ftp://x', '', undefined, 42]) {
      expect(isSafeLink(href)).toBe(false)
    }
  })

  it('refuses to make an unsafe link', () => {
    const { applied, types } = formatted((e) => e.commands.setLink({ href: 'javascript:alert(1)' }))
    expect(applied).toBe(false)
    expect(types.has('link')).toBe(false)
  })

  it('never shows a stored unsafe link as a working link', () => {
    const current = open({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }],
    })
    expect(current.getHTML()).not.toContain('javascript:')
  })

  it('opens safe links in a new tab without passing on this page', () => {
    const { json } = formatted((e) => e.commands.setLink({ href: 'https://example.com' }))
    const html = open(json).getHTML()
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
  })
})
