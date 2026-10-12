import { brand } from '../../app/brand'
import { cx } from '../../lib/cx'
import { publicAsset } from '../../lib/publicAsset'
import styles from './Backdrop.module.css'

interface BackdropProps {
  variant?: 'desktop' | 'tv'
}

/**
 * The full-screen background behind every page: the image named in brand.ts
 * over a built-in gradient, darkened so text stays readable over any photo.
 */
export function Backdrop({ variant = 'desktop' }: BackdropProps) {
  const image = variant === 'tv' ? (brand.tvBackdrop ?? brand.backdrop) : brand.backdrop

  return (
    <div className={cx(styles.backdrop, variant === 'tv' && styles.tv)} aria-hidden="true">
      {image && (
        <div className={styles.image} style={{ backgroundImage: `url("${publicAsset(image)}")` }} />
      )}
      <div className={styles.scrim} />
    </div>
  )
}
