// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDataClient } from './data-client'
import {
  applyAppBadge,
  disablePush,
  enablePush,
  PushUnavailableError,
  readPushState,
  syncPushSubscription,
} from './push-client'

const KEY = Buffer.alloc(65, 4).toString('base64url')

function fakeSubscription() {
  return {
    endpoint: 'https://push.example.test/abc',
    toJSON: () => ({ keys: { p256dh: 'P', auth: 'A' } }),
    unsubscribe: vi.fn(async () => true),
  }
}

function install(options: {
  permission: NotificationPermission
  request?: NotificationPermission
  existing?: ReturnType<typeof fakeSubscription> | null
}) {
  const created = fakeSubscription()

  const pushManager = {
    getSubscription: vi.fn(async () => options.existing ?? null),
    subscribe: vi.fn(async () => created),
  }

  const registration = { pushManager }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: vi.fn(async () => registration),
      getRegistration: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    },
  })
  vi.stubGlobal('PushManager', class {})

  const notification = {
    permission: options.permission,
    requestPermission: vi.fn(async () => options.request ?? options.permission),
  }

  vi.stubGlobal('Notification', notification)

  return { pushManager, created, notification }
}

/**
 * A real data client over a recorded RPC boundary: the calls below are the
 * requests the push code actually makes, not a stub of its collaborator.
 */
function client(publicKey: string | null = KEY) {
  const rpcCalls: Array<{ name: string; args: unknown }> = []

  const data = createDataClient(async (input, init) => {
    const request = new Request(
      new URL(input instanceof Request ? input.url : input, 'http://app.test'),
      init,
    )

    const name = request.url.replace('http://app.test/api/db/rpc/', '')

    rpcCalls.push({ name, args: await request.json() })

    return Response.json(name === 'get_push_public_key' ? publicKey : null)
  })

  return { client: data, rpcCalls }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readPushState', () => {
  it('says unsupported when the browser has no Web Push', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: undefined,
    })
    vi.stubGlobal('PushManager', undefined)
    // jsdom has no PushManager, so 'PushManager' in window is false.
    expect(await readPushState()).toBe('unsupported')
  })

  it('reports blocked, off and on', async () => {
    install({ permission: 'denied' })
    expect(await readPushState()).toBe('blocked')
    install({ permission: 'default' })
    expect(await readPushState()).toBe('off')
    install({ permission: 'granted', existing: fakeSubscription() })
    expect(await readPushState()).toBe('on')
  })
})

describe('enablePush', () => {
  it('asks permission, subscribes with the server key and saves the device', async () => {
    const { pushManager, notification } = install({
      permission: 'default',
      request: 'granted',
    })

    const { client: data, rpcCalls } = client()
    expect(await enablePush(data)).toBe('on')
    expect(notification.requestPermission).toHaveBeenCalled()
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    )
    expect(rpcCalls).toContainEqual({
      name: 'save_push_subscription',
      args: {
        p_endpoint: 'https://push.example.test/abc',
        p_p256dh: 'P',
        p_auth: 'A',
        p_user_agent: expect.any(String),
      },
    })
  })

  it('does not subscribe when the person says no', async () => {
    const { pushManager } = install({
      permission: 'default',
      request: 'denied',
    })

    expect(await enablePush(client().client)).toBe('blocked')
    expect(pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('says so when the server has no key yet', async () => {
    install({ permission: 'granted' })
    await expect(enablePush(client(null).client)).rejects.toBeInstanceOf(
      PushUnavailableError,
    )
  })
})

describe('disablePush and syncPushSubscription', () => {
  it('forgets the device on the server and in the browser', async () => {
    const existing = fakeSubscription()
    install({ permission: 'granted', existing })
    const { client: data, rpcCalls } = client()
    expect(await disablePush(data)).toBe('off')
    expect(rpcCalls).toContainEqual({
      name: 'remove_push_subscription',
      args: { p_endpoint: existing.endpoint },
    })
    expect(existing.unsubscribe).toHaveBeenCalled()
  })

  it('re-saves an existing device for whoever is signed in, and does nothing without one', async () => {
    install({ permission: 'granted', existing: fakeSubscription() })
    const first = client()
    await syncPushSubscription(first.client)
    expect(first.rpcCalls).toContainEqual({
      name: 'save_push_subscription',
      args: expect.objectContaining({
        p_endpoint: 'https://push.example.test/abc',
      }),
    })
    install({ permission: 'default' })
    const second = client()
    await syncPushSubscription(second.client)
    expect(second.rpcCalls).toEqual([])
  })
})

describe('applyAppBadge', () => {
  it('sets the count, or clears it at zero', () => {
    const setAppBadge = vi.fn(async () => undefined)
    const clearAppBadge = vi.fn(async () => undefined)
    Object.assign(navigator, { setAppBadge, clearAppBadge })
    applyAppBadge(4)
    expect(setAppBadge).toHaveBeenCalledWith(4)
    applyAppBadge(0)
    expect(clearAppBadge).toHaveBeenCalled()
  })
})
