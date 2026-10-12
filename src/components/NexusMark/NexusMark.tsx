import { useId } from 'react'
import { brand } from '../../app/brand'
import { publicAsset } from '../../lib/publicAsset'

/**
 * The Nexus star. This drawing is a temporary stand-in: once a logo file is
 * set in brand.ts, that image is shown instead.
 */
export function NexusMark({ className }: { className?: string }) {
  const gradientId = useId()

  if (brand.logo) {
    return <img className={className} src={publicAsset(brand.logo)} alt="" />
  }

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="5" y1="3" x2="19" y2="21" gradientUnits="userSpaceOnUse">
          <stop stopColor="#eef5ff" />
          <stop offset="1" stopColor="#7fb0ff" />
        </linearGradient>
      </defs>
      <path
        d="M12 1.5c.55 5.9 4.6 9.95 10.5 10.5-5.9.55-9.95 4.6-10.5 10.5-.55-5.9-4.6-9.95-10.5-10.5C7.4 11.45 11.45 7.4 12 1.5Z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  )
}
