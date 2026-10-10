/**
 * EXP-05.2 — the device's offline edit store, created once per tab.
 *
 * `createIndexedDbStorage()` opens the same IndexedDB database and object
 * store the app shell's sign-out retention reads, keyed by the same
 * (user, record) scheme, so the two singletons see one set of drafts. Lazy:
 * SSR and builds never touch IndexedDB.
 */

import {
  createIndexedDbStorage,
  createOfflineEditStore,
} from '#/lib/offline/store'
import type { OfflineEditStore } from '#/lib/offline/store'

let deviceStore: OfflineEditStore | null = null

export function deviceOfflineEditStore(): OfflineEditStore {
  deviceStore ??= createOfflineEditStore(createIndexedDbStorage())
  return deviceStore
}
