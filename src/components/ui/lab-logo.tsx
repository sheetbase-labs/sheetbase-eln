import { useRouterState } from '@tanstack/react-router'

import { BrandMark } from '#/components/ui/brand-mark'
import { cn } from '#/lib/utils'

/** The lab's logo version from the root route, or null when it has none. */
export function useLabLogoVersion(): string | null {
  return useRouterState({
    select: (state) =>
      (state.matches.at(0)?.context as { labLogo?: string | null } | undefined)
        ?.labLogo ?? null,
  })
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
