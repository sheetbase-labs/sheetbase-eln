/** Where the workspace logo is served from; the version busts the cache. */
export function labLogoUrl(version: string): string {
  return `/api/workspace-logo?v=${encodeURIComponent(version)}`
}
