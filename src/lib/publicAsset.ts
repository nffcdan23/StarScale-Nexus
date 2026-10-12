/** Builds the address of a file in /public, wherever the app ends up being hosted. */
export function publicAsset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
}
