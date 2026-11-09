import { useRouter } from '@tanstack/react-router'

import { BrandMark } from '#/components/ui/brand-mark'
import { cn } from '#/lib/utils'

/** The lab's logo version from the root route, or null when it has none. */
export function useLabLogoVersion(): string | null {
  // Read without a subscription and without requiring a router, so a page
  // rendered outside one (a story, a test) simply shows no lab logo. The root
  // context re-resolves on a shell refresh, which re-renders these pages.
  const router = useRouter({ warn: false }) as
    { state?: { matches?: { context?: unknown }[] } } | undefined

  const context = router?.state?.matches?.[0]?.context as
    { labLogo?: string | null } | undefined

  return context?.labLogo ?? null
}

/** The URL the lab logo is served from; the version busts the cache. */
export function labLogoUrl(version: string): string {
  return `/api/workspace-logo?v=${encodeURIComponent(version)}`
}

/**
 * The lab's own logo, in place of the Sheetbase mark wherever a page says whose
 * lab it is. With no logo uploaded it shows the Sheetbase mark (or nothing,
 * when `fallback` is "none").
 */
export function LabLogo({
  height = 26,
  className,
  fallback = 'mark',
}: {
  height?: number
  className?: string
  fallback?: 'mark' | 'none'
}) {
  const version = useLabLogoVersion()

  if (!version) {
    return fallback === 'mark' ? (
      <BrandMark size={height} className={className} />
    ) : null
  }

  return (
    <img
      src={labLogoUrl(version)}
      alt=""
      style={{ height }}
      className={cn('w-auto max-w-[180px] object-contain', className)}
    />
  )
}
