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
import { requestBackgroundSync } from '#/lib/offline/service-worker'
import type { OfflineEditStore } from '#/lib/offline/store'

let deviceStore: OfflineEditStore | null = null

export function deviceOfflineEditStore(): OfflineEditStore {
  if (!deviceStore) {
    const store = createOfflineEditStore(createIndexedDbStorage())
    deviceStore = {
      ...store,
      // A queued edit also asks the browser to send it when back online.
      async putEdit(scope, draft) {
        const edit = await store.putEdit(scope, draft)
        void requestBackgroundSync()

        return edit
      },
    }
  }

  return deviceStore
}
