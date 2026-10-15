import type { Extensions } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'

// The note editor's formatting, in one place. Only Notes imports this (and,
// from Phase 3b-2, only through a lazily loaded route), so the editor is
// never part of what Mission Control, Tasks or the TV download. The build
// check fails if it ever is.
//
// Approved formatting: headings (three levels), bold, italic, bulleted and
// numbered lists, checklists, links, quotes, dividers, inline code and code
// blocks. Strikethrough and underline are off. Every format here is accepted
// by the database's note checks (migration 20261017090000_notes), which
// derive the searchable text from it; security check NOTE-23 proves that for
// the same sample document the editor tests use.

/** The database's rule (migration 20261017090000_notes): only web and email links. */
export function isSafeLink(href: unknown): boolean {
  return typeof href === 'string' && /^(https?:\/\/|mailto:)/i.test(href)
}

export function createNoteExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      strike: false,
      underline: false,
      link: {
        // Clicking a link while writing places the cursor; opening is a
        // separate, deliberate action in the editor.
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        // "example.com" becomes https://example.com.
        defaultProtocol: 'https',
        // TipTap applies this when a link is made, pasted, loaded and shown;
        // an unsafe address is never turned into a working link.
        isAllowedUri: (url) => isSafeLink(url),
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: 'Start writing…' }),
  ]
}
