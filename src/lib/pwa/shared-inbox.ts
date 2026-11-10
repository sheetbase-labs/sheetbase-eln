/**
 * Files handed to Sheetbase from outside: the phone's share sheet ("Share to
 * Sheetbase") and the desktop's "Open with" both land on /share-target. The
 * service worker (public/sw.js) receives a share as a POST and parks the files
 * in this cache before sending the person to the page; opened files arrive
 * through the launch queue. Keep the cache name and key shape in step with the
 * worker.
 */
export const SHARE_CACHE = 'sheetbase-share-v1'
export const SHARE_KEY_PREFIX = '/__shared/'

interface LaunchParamsLike {
  files?: ReadonlyArray<{ getFile: () => Promise<File> }>
}

declare global {
  interface Window {
    launchQueue?: {
      setConsumer: (consumer: (params: LaunchParamsLike) => void) => void
    }
  }
}

/** Files the service worker parked for this page, oldest share first. */
export async function readSharedFiles(): Promise<File[]> {
  if (typeof caches === 'undefined') return []

  try {
    const cache = await caches.open(SHARE_CACHE)

    const keys = [...(await cache.keys())].sort((a, b) =>
      a.url.localeCompare(b.url, undefined, { numeric: true }),
    )

    const files: File[] = []

    for (const key of keys) {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Read one parked file at a time; stop on the first failure before reading later cache entries or bodies.
      const response = await cache.match(key)

      if (!response) continue

      const name = decodeURIComponent(
        response.headers.get('x-file-name') ?? 'shared-file',
      )

      const type = response.headers.get('content-type') ?? ''
      files.push(new File([await response.blob()], name, { type }))
    }

    return files
  } catch {
    return []
  }
}

export async function clearSharedFiles(): Promise<void> {
  if (typeof caches === 'undefined') return

  try {
    await caches.delete(SHARE_CACHE)
  } catch {
    /* nothing parked */
  }
}

/**
 * Files the person opened Sheetbase with ("Open with…" on a desktop that
 * installed the app). Calls back once per launch; returns a function that
 * stops listening.
 */
export function onLaunchedWithFiles(
  callback: (files: File[]) => void,
): () => void {
  const queue = window.launchQueue

  if (!queue) return () => undefined
  let live = true
  queue.setConsumer((params) => {
    const handles = params.files ?? []

    if (!live || handles.length === 0) return
    void Promise.all(handles.map((handle) => handle.getFile())).then(
      (files) => {
        if (live) callback(files)
      },
    )
  })

  return () => {
    live = false
  }
}
