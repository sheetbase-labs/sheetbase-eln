import { useRouter } from '@tanstack/react-router'

import { BrandMark } from '#/components/ui/brand-mark'
import { labLogoUrl } from '#/lib/lab-logo'
import { cn } from '#/lib/utils'

/** What this hook reads of a mounted router; a page outside one has none. */
interface MountedRouter {
  state?: { matches: { context: { labLogo?: string | null } }[] }
}

/** The lab's logo version from the root route, or null when it has none. */
export function useLabLogoVersion(): string | null {
  // Read without a subscription and without requiring a router, so a page
  // rendered outside one (a story, a test) simply shows no lab logo. The root
  // context re-resolves on a shell refresh, which re-renders these pages.
  // SAFETY: `useRouter({ warn: false })` returns undefined when no router is
  // mounted (a story or a unit render), although its type names the registered
  // router; the optional read below is what keeps that render working.
  const router = useRouter({ warn: false }) as MountedRouter | undefined

  return router?.state?.matches.at(0)?.context.labLogo ?? null
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
