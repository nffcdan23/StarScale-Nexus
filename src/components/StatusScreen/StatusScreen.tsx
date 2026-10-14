import type { ReactNode } from 'react'
import { brand } from '../../app/brand'
import { Backdrop } from '../Backdrop/Backdrop'
import { GlassPanel } from '../GlassPanel/GlassPanel'
import { NexusMark } from '../NexusMark/NexusMark'
import styles from './StatusScreen.module.css'

interface StatusScreenProps {
  title: string
  children?: ReactNode
}

/**
 * A centred panel on the backdrop, outside the sidebar shell. Used for
 * sign-in and for messages shown before anyone is signed in.
 */
export function StatusScreen({ title, children }: StatusScreenProps) {
  return (
    <div className={styles.screen}>
      <Backdrop />
      <GlassPanel as="section" padding="none" className={styles.panel}>
        <p className={styles.eyebrow}>
          <NexusMark className={styles.mark} />
          {brand.name}
        </p>
        <h1 className={styles.title}>{title}</h1>
        {children && <div className={styles.body}>{children}</div>}
      </GlassPanel>
    </div>
  )
}
