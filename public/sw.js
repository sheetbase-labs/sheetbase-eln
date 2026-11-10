// Sheetbase service worker.
//
// Sections: app shell caching (open offline), background sync for the offline
// edit queue, and timer notifications. Keep each section self-contained: other
// features add to this file too.

// ---------------------------------------------------------------------------
// App shell: the app opens with no connection.
//
// Built files under /assets/ have content-hashed names, so a cached copy is
// never stale and is served first. Pages come from the server, so they go
// network-first and the last good copy is the fallback when offline. Data,
// sign-in and live-event requests are never cached here.
//
// Updating is safe because nothing is ever replaced in place: a new deploy has
// new hashed names, older pages keep working from the copies they already
// loaded, and the page cache is versioned and dropped on activate.
// ---------------------------------------------------------------------------
const ASSET_CACHE = 'sheetbase-assets'
const PAGE_CACHE = 'sheetbase-pages-v1'
const MAX_ASSETS = 400
const MAX_PAGES = 30
const PAGE_TIMEOUT_MS = 5000

const OFFLINE_PAGE =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Sheetbase</title><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#444">' +
  '<div style="text-align:center;padding:24px"><h1 style="font-size:20px">You are offline</h1>' +
  '<p>This page has not been opened on this device yet. Reconnect and try again.</p>' +
  '<button onclick="location.reload()" style="padding:8px 16px">Try again</button></div>'

function isCacheableStatic(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    /^\/(favicon(-dark)?\.svg|favicon(-dark)?-32\.png|icon-\d+\.png|apple-touch-icon\.png|manifest\.webmanifest)$/.test(
      url.pathname,
    )
  )
}

function isNeverCached(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_serverFn') ||
    url.pathname.startsWith('/sign-in') ||
    url.pathname.startsWith('/auth')
  )
}

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  // Oldest entries go first; deleting them concurrently would race the eviction order.
  // react-doctor-disable-next-line react-doctor/async-await-in-loop
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i])
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) {
    await cache.put(request, response.clone())
    trim(ASSET_CACHE, MAX_ASSETS)
  }
  return response
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE)
  const key = new URL(request.url).pathname + new URL(request.url).search
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS)
    const response = await fetch(request, { signal: controller.signal })
    clearTimeout(timer)
    if (
      response.ok &&
      !response.redirected &&
      !response.headers.get('content-type')?.includes('json')
    ) {
      await cache.put(key, response.clone())
      trim(PAGE_CACHE, MAX_PAGES)
    }
    return response
  } catch {
    return (
      (await cache.match(key)) ||
      (await cache.match('/')) ||
      new Response(OFFLINE_PAGE, {
        status: 503,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    )
  }
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('sheetbase-pages-') && name !== PAGE_CACHE) {
          // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Cache deletes run one at a time so a failed delete stops before the next cache is dropped.
          await caches.delete(name)
        }
      }
      await self.clients.claim()
    })(),
  ),
)

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || isNeverCached(url)) return
  if (isCacheableStatic(url)) {
    event.respondWith(cacheFirst(request).catch(() => Response.error()))
  } else if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request))
  }
})

self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'sheetbase:warm' && Array.isArray(data.urls)) {
    // Files the page loaded before this worker controlled it.
    event.waitUntil(
      (async () => {
        const cache = await caches.open(ASSET_CACHE)
        for (const raw of data.urls) {
          try {
            const url = new URL(raw, self.location.origin)
            if (url.origin !== self.location.origin || !isCacheableStatic(url))
              continue
            // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Each URL is checked then fetched in turn; overlapping would hammer the server with the whole precache list.
            if (await cache.match(url.pathname)) continue
            const response = await fetch(url.pathname)
            if (response.ok) await cache.put(url.pathname, response)
          } catch {
            // Skipped files are cached the next time they are used.
          }
        }
        await trim(ASSET_CACHE, MAX_ASSETS)
      })(),
    )
  } else if (data.type === 'sheetbase:clear-pages') {
    // Sign-out: pages hold one person's data, so they do not stay on the device.
    event.waitUntil(caches.delete(PAGE_CACHE))
  }
})

// ---------------------------------------------------------------------------
// Background sync: send edits made offline once the connection returns.
//
// Writing an edit needs the signed-in page, so this wakes an open window to
// replay. With no window open it fails, and the browser tries again later.
// ---------------------------------------------------------------------------
self.addEventListener('sync', (event) => {
  if (event.tag !== 'sheetbase-replay') return
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        if (clients.length === 0)
          throw new Error('No window open to send edits')
        for (const client of clients)
          client.postMessage({ type: 'sheetbase:replay' })
      }),
  )
})

// ---------------------------------------------------------------------------
// Timer notifications: shown on phones, where a page cannot create a
// notification itself, and bring the app forward when one is tapped.
// ---------------------------------------------------------------------------
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ('focus' in client) {
            if ('navigate' in client) client.navigate(target).catch(() => {})
            return client.focus()
          }
        }
        return self.clients.openWindow(target)
      }),
  )
})

// ---------------------------------------------------------------------------
// Share target: "Share to Sheetbase" from another app on a phone.
//
// The share arrives as a POST with the files in a form. The files are parked in
// a cache (the page cannot read a POST body), then the person is sent to the
// page that asks which experiment they belong to. Keep the cache name and key
// shape in step with src/lib/pwa/shared-inbox.ts.
// ---------------------------------------------------------------------------
const SHARE_CACHE = 'sheetbase-share-v1'

async function receiveShare(request) {
  const params = new URLSearchParams()
  try {
    const form = await request.formData()
    await caches.delete(SHARE_CACHE)
    const cache = await caches.open(SHARE_CACHE)
    let index = 0
    for (const value of form.getAll('files')) {
      if (typeof value === 'string') continue
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- The index counter assigns each file its slot, so the puts must stay in form order.
      await cache.put(
        '/__shared/' + index++,
        new Response(value, {
          headers: {
            'content-type': value.type || 'application/octet-stream',
            'x-file-name': encodeURIComponent(value.name || 'shared-file'),
          },
        }),
      )
    }
    for (const key of ['title', 'text', 'url']) {
      const value = form.get(key)
      if (typeof value === 'string' && value.trim())
        params.set(key, value.trim())
    }
  } catch {
    // Fall through: the page explains that nothing came through.
  }
  const query = params.toString()
  return Response.redirect('/share-target' + (query ? '?' + query : ''), 303)
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'POST') return
  if (new URL(request.url).pathname !== '/share-target') return
  event.respondWith(receiveShare(request))
})

// ---------------------------------------------------------------------------
// Phone alerts (Web Push). The server sends { title, body, url, tag, badge };
// the same tag replaces an alert the open page already raised for the same
// thing. Browsers require a visible notification for every push.
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let message = {}
  try {
    message = event.data ? event.data.json() : {}
  } catch (error) {
    message = { title: event.data ? event.data.text() : '' }
  }
  const title = message.title || 'Sheetbase'
  const work = [
    self.registration.showNotification(title, {
      body: message.body || '',
      tag: message.tag || undefined,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: message.url || '/' },
      renotify: Boolean(message.tag),
      requireInteraction: Boolean(
        message.tag && message.tag.indexOf('step-timer-') === 0,
      ),
    }),
  ]
  if (
    typeof message.badge === 'number' &&
    self.navigator &&
    self.navigator.setAppBadge
  ) {
    work.push(
      (message.badge > 0
        ? self.navigator.setAppBadge(message.badge)
        : self.navigator.clearAppBadge()
      ).catch(() => {}),
    )
  }
  event.waitUntil(Promise.all(work))
})
