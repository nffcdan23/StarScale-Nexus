import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import {
  Bold,
  Code,
  ExternalLink,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  SquareCode,
  type LucideIcon,
} from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { cx } from '../../../lib/cx'
import { isSafeLink } from './extensions'
import { toLinkAddress } from './links'
import styles from './FormatToolbar.module.css'

interface ButtonSpec {
  label: string
  icon: LucideIcon
  active: (editor: Editor) => boolean
  run: (editor: Editor) => void
}

const buttons: Array<ButtonSpec | 'divider'> = [
  { label: 'Heading 1', icon: Heading1, active: (e) => e.isActive('heading', { level: 1 }), run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: 'Heading 2', icon: Heading2, active: (e) => e.isActive('heading', { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: 'Heading 3', icon: Heading3, active: (e) => e.isActive('heading', { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  'divider',
  { label: 'Bold', icon: Bold, active: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  { label: 'Italic', icon: Italic, active: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
  { label: 'Inline code', icon: Code, active: (e) => e.isActive('code'), run: (e) => e.chain().focus().toggleCode().run() },
  'divider',
  { label: 'Bulleted list', icon: List, active: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: 'Numbered list', icon: ListOrdered, active: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: 'Checklist', icon: ListTodo, active: (e) => e.isActive('taskList'), run: (e) => e.chain().focus().toggleTaskList().run() },
  'divider',
  { label: 'Quote', icon: Quote, active: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: 'Code block', icon: SquareCode, active: (e) => e.isActive('codeBlock'), run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { label: 'Divider', icon: Minus, active: () => false, run: (e) => e.chain().focus().setHorizontalRule().run() },
]

/** The formatting bar above a note. Every control works from the keyboard. */
export function FormatToolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      states: buttons.map((button) => (button === 'divider' ? false : button.active(current))),
      link: current.isActive('link'),
      href: (current.getAttributes('link').href as string | undefined) ?? '',
    }),
  })
  const [linkOpen, setLinkOpen] = useState(false)

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
        {buttons.map((button, index) =>
          button === 'divider' ? (
            <span key={index} className={styles.divider} aria-hidden="true" />
          ) : (
            <button
              key={button.label}
              type="button"
              className={cx(styles.button, active.states[index] && styles.active)}
              aria-label={button.label}
              aria-pressed={active.states[index]}
              title={button.label}
              onClick={() => button.run(editor)}
            >
              <button.icon className={styles.icon} aria-hidden="true" />
            </button>
          ),
        )}
        <span className={styles.divider} aria-hidden="true" />
        <button
          type="button"
          className={cx(styles.button, (active.link || linkOpen) && styles.active)}
          aria-label="Link"
          aria-pressed={active.link}
          aria-expanded={linkOpen}
          title="Link"
          onClick={() => setLinkOpen((open) => !open)}
        >
          <Link className={styles.icon} aria-hidden="true" />
        </button>
      </div>
      {linkOpen && (
        <LinkForm
          key={active.href}
          editor={editor}
          currentHref={active.link ? active.href : ''}
          onClose={() => setLinkOpen(false)}
        />
      )}
    </div>
  )
}

interface LinkFormProps {
  editor: Editor
  currentHref: string
  onClose: () => void
}

function LinkForm({ editor, currentHref, onClose }: LinkFormProps) {
  const [address, setAddress] = useState(currentHref)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()

  const apply = (event: FormEvent) => {
    event.preventDefault()
    const href = toLinkAddress(address)
    if (!href) {
      setError('Use a web address (such as example.com or https://…) or an email link (mailto:…).')
      return
    }
    const chain = editor.chain().focus().extendMarkRange('link')
    if (editor.state.selection.empty && !editor.isActive('link')) {
      // Nothing selected: insert the address itself as the link text.
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
    } else {
      chain.setLink({ href }).run()
    }
    onClose()
  }

  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    onClose()
  }

  return (
    <form className={styles.linkForm} onSubmit={apply}>
      <label className={styles.linkLabel} htmlFor={inputId}>
        Link address
      </label>
      <input
        id={inputId}
        className={styles.linkInput}
        value={address}
        autoFocus
        placeholder="example.com"
        onChange={(event) => {
          setAddress(event.target.value)
          setError(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      />
      <button className={styles.linkButton} type="submit">
        {currentHref ? 'Update link' : 'Add link'}
      </button>
      {currentHref && isSafeLink(currentHref) && (
        <a className={styles.linkAction} href={currentHref} target="_blank" rel="noopener noreferrer">
          <ExternalLink className={styles.smallIcon} aria-hidden="true" />
          Open
        </a>
      )}
      {currentHref && (
        <button className={styles.linkAction} type="button" onClick={remove}>
          Remove link
        </button>
      )}
      <button className={styles.linkAction} type="button" onClick={onClose}>
        Cancel
      </button>
      {error && (
        <p className={styles.linkError} role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
