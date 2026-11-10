import { useSyncExternalStore } from 'react'

export const passkeysQueryKey = ['passkeys'] as const

const subscribe = () => () => {}

/** True once the browser is known to create and use passkeys, never on the server. */
export function usePasskeysSupported(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => 'PublicKeyCredential' in window,
    () => false,
  )
}
