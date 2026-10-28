import { useSyncExternalStore } from 'react'

import { currentPlatform } from '#/lib/shortcuts'
import type { Platform } from '#/lib/shortcuts'

const subscribe = () => () => {}

/**
 * The keyboard the reader has, for text that names keys. The server render has
 * no navigator, so it says `other` and the browser corrects it after hydration
 * without a mismatch.
 */
export function usePlatform(): Platform {
  return useSyncExternalStore(subscribe, currentPlatform, () => 'other')
}
