import type { ReactNode } from 'react'
import { GlassPanel } from '../GlassPanel/GlassPanel'
import styles from './EmptyState.module.css'

interface EmptyStateProps {
  title: string
  children?: ReactNode
}

/** A plain "nothing here yet" panel, shown until a page has real content. */
export function EmptyState({ title, children }: EmptyStateProps) {
  return (
    <GlassPanel as="section" padding="lg">
      <h2 className={styles.title}>{title}</h2>
      {children && <p className={styles.detail}>{children}</p>}
    </GlassPanel>
  )
}
