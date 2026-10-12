import type { HTMLAttributes } from 'react'
import { cx } from '../../lib/cx'
import styles from './GlassPanel.module.css'

interface GlassPanelProps extends HTMLAttributes<HTMLElement> {
  /** Which HTML element to render, so the panel can be a section, a header and so on. */
  as?: 'div' | 'section' | 'article' | 'aside' | 'header'
  /** "regular" for content; "strong" is more opaque, for navigation. */
  tone?: 'regular' | 'strong'
  /**
   * "blur" frosts whatever sits behind the panel. "tint" looks the same over
   * a still backdrop but skips the live blur, which is costly on a screen
   * that stays on all day (the TV).
   */
  surface?: 'blur' | 'tint'
  padding?: 'none' | 'md' | 'lg'
}

const paddingClass = {
  none: undefined,
  md: styles.padMd,
  lg: styles.padLg,
}

/** The translucent glass card every Nexus surface is built from. */
export function GlassPanel({
  as: Element = 'div',
  tone = 'regular',
  surface = 'blur',
  padding = 'md',
  className,
  ...rest
}: GlassPanelProps) {
  return (
    <Element
      className={cx(
        styles.panel,
        tone === 'strong' && styles.strong,
        surface === 'blur' ? styles.blur : styles.tint,
        paddingClass[padding],
        className,
      )}
      {...rest}
    />
  )
}
