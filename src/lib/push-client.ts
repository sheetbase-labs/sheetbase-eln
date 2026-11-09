/**
 * Phone alerts, from the device's side: ask for permission on a tap, subscribe
 * through the service worker, tell the server, and keep the app icon's badge in
 * step with what is unread. Everything is best effort; a browser without Web
 * Push just reports that it can't.
 */
import type { DataClient } from './data-client'
import { createDataClient } from './data-client'

export type PushState =
  /** This browser can't do it (an iPhone needs the app added to the home screen first). */
  | 'unsupported'
  /** The person said no in the browser; only the browser's settings can undo that. */
  | 'blocked'
  | 'off'
  | 'on'

export const pushQueryKeys = {
  state: () => ['push', 'state'] as const,
}

function canPush(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  )
}

/** The subscription this device already holds, if any. */
async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration('/sw.js')

  return (await registration?.pushManager.getSubscription()) ?? null
}

export async function readPushState(): Promise<PushState> {
  if (!canPush()) return 'unsupported'

  if (Notification.permission === 'denied') return 'blocked'

  try {
    return (await currentSubscription()) ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

function applicationServerKey(publicKey: string): Uint8Array<ArrayBuffer> {
  const padded = publicKey.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))

  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)

  return bytes
}

async function saveSubscription(
  subscription: PushSubscription,
  client: DataClient,
): Promise<void> {
  const json = subscription.toJSON()
  await client.rpc('save_push_subscription', {
    p_endpoint: subscription.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
    p_user_agent: navigator.userAgent,
  })
}

export class PushUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PushUnavailableError'
  }
}

/**
 * Turn alerts on for this device. Call it straight from a tap: browsers only
 * show the permission prompt for a person's own action.
 */
export async function enablePush(
  client: DataClient = createDataClient(),
): Promise<PushState> {
  if (!canPush()) return 'unsupported'

  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission

  if (permission === 'denied') return 'blocked'

  if (permission !== 'granted') return 'off'

  const publicKey = await client.rpc<string | null>('get_push_public_key', {})

  if (!publicKey) {
    throw new PushUnavailableError(
      'The server is not ready to send alerts yet.',
    )
  }

  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()

  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(publicKey),
    }))

  await saveSubscription(subscription, client)

  return 'on'
}

/** Turn alerts off for this device and forget it on the server. */
export async function disablePush(
  client: DataClient = createDataClient(),
): Promise<PushState> {
  if (!canPush()) return 'unsupported'
  const subscription = await currentSubscription()

  if (subscription) {
    await client
      .rpc('remove_push_subscription', { p_endpoint: subscription.endpoint })
      .catch(() => undefined)
    await subscription.unsubscribe().catch(() => undefined)
  }

  return Notification.permission === 'denied' ? 'blocked' : 'off'
}

/**
 * Keep the server's record of this device right: when alerts are on here, say
 * so again for whoever is signed in now (a shared phone, a renewed subscription).
 */
export async function syncPushSubscription(
  client: DataClient = createDataClient(),
): Promise<void> {
  try {
    if (!canPush() || Notification.permission !== 'granted') return
    const subscription = await currentSubscription()

    if (subscription) await saveSubscription(subscription, client)
  } catch {
    // Alerts keep working with what the server already has.
  }
}

/** Show the unread count on the installed app's icon, or clear it. */
export function applyAppBadge(count: number): void {
  try {
    if (!('setAppBadge' in navigator)) return

    const result =
      count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()

    void result.catch(() => undefined)
  } catch {
    // Not every browser has badges.
  }
}
