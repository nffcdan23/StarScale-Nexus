interface Brand {
  name: string
  byline: string
  tagline: string
  signature: string
  /** Background image for the desktop app, as a path inside /public. Null shows the built-in gradient. */
  backdrop: string | null
  /** Background image for the TV dashboard. Null reuses the desktop one. */
  tvBackdrop: string | null
  /** Logo image, as a path inside /public. Null shows the built-in star. */
  logo: string | null
}

/**
 * Names, wording and artwork in one place.
 *
 * The backdrop and logo are temporary. To use your own:
 *   1. Put the image in /public, for example public/backdrops/dusk.jpg
 *   2. Change the matching path below, for example backdrop: 'backdrops/dusk.jpg'
 */
export const brand: Brand = {
  name: 'Nexus',
  byline: 'by StarScale',
  tagline: 'A calmer mind builds bigger things.',
  signature: 'StarScale Nexus',
  backdrop: 'backdrops/placeholder-dusk.svg',
  tvBackdrop: null,
  logo: null,
}
