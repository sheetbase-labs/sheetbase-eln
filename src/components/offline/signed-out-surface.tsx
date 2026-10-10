import { useEffect, useState } from 'react'

import { Notice } from '#/components/v3/ui/alert'
import { webSignOutRetentionStorage } from '#/lib/offline/retention'
import type { SignOutRetentionStorage } from '#/lib/offline/retention'

/**
 * EXP-05.5 — the `SignedOut` surface (canvas/SignedOut.dc.html).
 *
 * Signing out ends the session on this browser but leaves the device store
 * untouched, so the user is told what happened to their unsynced work. The
 * wording only promises retention when the retention marker actually reports
 * drafts waiting; a plain sign-out does not claim edits that do not exist.
 */
export function SignedOutSurface({
  retained,
  className,
}: {
  retained: number
  className?: string
}) {
  if (retained > 0) {
    return (
      <Notice icon="signOut" className={className}>
        Unsaved edits on this device were kept and will sync when you sign in
        again. Signing out ends your session on this browser only.
      </Notice>
    )
  }
  return (
    <Notice icon="signOut" className={className}>
      You signed out of this browser. Signing out ends your session on this
      browser only.
    </Notice>
  )
}

/**
 * How many unsynced drafts this device kept when its last user signed out.
 * Read from the retention marker after mount, so SSR renders the plain
 * sign-out copy and hydration cannot mismatch. Zero when the marker is absent
 * (a device that never signed out, or storage that is denied).
 */
export function useRetainedDrafts(storage?: SignOutRetentionStorage): number {
  const [retained, setRetained] = useState(0)
  useEffect(() => {
    const source =
      storage ??
      (typeof window === 'undefined'
        ? null
        : webSignOutRetentionStorage(window.localStorage))
    setRetained(source?.read()?.retained ?? 0)
  }, [storage])
  return retained
}
