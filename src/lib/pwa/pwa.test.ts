// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { z } from 'zod'
import { readFileSync } from 'node:fs'

import {
  INSTALL_SNOOZE_KEY,
  INSTALL_SNOOZE_MS,
  installSnoozed,
  isIos,
  isIosSafari,
  snoozeInstall,
} from './install'
import {
  classifySwipe,
  startsAtLeftEdge,
  touchOwnsHorizontalDrag,
} from './edge-swipe'
import { canNativeShare, shareLink } from './share'
import { SPLASH_SIZES, splashLinks } from './splash'
import { useWakeLock, wakeLockSupported } from './wake-lock'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('install offer', () => {
  it('recognises iPhones, iPads posing as Macs, and other browsers on iOS', () => {
    expect(isIos(IPHONE, 'iPhone', 5)).toBe(true)
    expect(isIos('Mozilla/5.0 (Macintosh)', 'MacIntel', 5)).toBe(true)
    expect(isIos('Mozilla/5.0 (Macintosh)', 'MacIntel', 0)).toBe(false)
    expect(isIosSafari(IPHONE)).toBe(true)
    expect(isIosSafari(IPHONE.replace('Version/18.0', 'CriOS/130'))).toBe(false)
  })

  it('stays quiet for a month after Not now', () => {
    const store = new Map<string, string>()

    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    }

    expect(installSnoozed(storage, 1000)).toBe(false)
    snoozeInstall(storage, 1000)
    expect(store.get(INSTALL_SNOOZE_KEY)).toBe(String(1000 + INSTALL_SNOOZE_MS))
    expect(installSnoozed(storage, 2000)).toBe(true)
    expect(installSnoozed(storage, 1000 + INSTALL_SNOOZE_MS + 1)).toBe(false)
  })

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }

    expect(installSnoozed(broken, 1)).toBe(false)
    expect(() => snoozeInstall(broken, 1)).not.toThrow()
  })
})

describe('edge swipe', () => {
  it('opens only from the left edge, sideways, far enough', () => {
    expect(startsAtLeftEdge({ x: 10, y: 300 })).toBe(true)
    expect(startsAtLeftEdge({ x: 120, y: 300 })).toBe(false)
    expect(classifySwipe({ x: 8, y: 300 }, { x: 120, y: 310 })).toBe('right')
    expect(classifySwipe({ x: 200, y: 300 }, { x: 80, y: 300 })).toBe('left')
    expect(classifySwipe({ x: 8, y: 300 }, { x: 30, y: 300 })).toBeNull()
    // A scroll that drifts sideways is not a swipe.
    expect(classifySwipe({ x: 8, y: 300 }, { x: 80, y: 420 })).toBeNull()
  })

  it('leaves canvases, dialogs and scrolled sideways scrollers alone', () => {
    const canvas = document.createElement('div')
    canvas.setAttribute('data-no-edge-swipe', '')
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const plain = document.createElement('div')
    const scroller = document.createElement('div')
    scroller.style.overflowX = 'auto'
    Object.defineProperty(scroller, 'scrollWidth', { value: 900 })
    Object.defineProperty(scroller, 'clientWidth', { value: 300 })
    const cell = document.createElement('span')
    scroller.append(cell)
    document.body.append(canvas, dialog, plain, scroller)
    expect(touchOwnsHorizontalDrag(canvas)).toBe(true)
    expect(touchOwnsHorizontalDrag(dialog)).toBe(true)
    expect(touchOwnsHorizontalDrag(plain)).toBe(false)
    // At its left end a scroller cannot move right, so the swipe is free.
    expect(touchOwnsHorizontalDrag(cell)).toBe(false)
    scroller.scrollLeft = 120
    expect(touchOwnsHorizontalDrag(cell)).toBe(true)
  })
})

describe('share', () => {
  it('uses the share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share })
    const nav = navigator
    expect(canNativeShare(nav)).toBe(true)
    await expect(
      shareLink({ title: 'A', url: 'https://x/y' }, nav),
    ).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: 'A', url: 'https://x/y' })
  })

  it('treats closing the sheet as a choice, not a failure', async () => {
    vi.stubGlobal('navigator', {
      share: vi.fn().mockRejectedValue(new DOMException('x', 'AbortError')),
    })
    const nav = navigator

    await expect(shareLink({ title: 'A', url: 'u' }, nav)).resolves.toBe(
      'cancelled',
    )
  })

  it('copies the link where there is no share sheet, and says when it cannot', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const nav = navigator
    await expect(shareLink({ title: 'A', url: 'u' }, nav)).resolves.toBe(
      'copied',
    )
    expect(writeText).toHaveBeenCalledWith('u')

    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) },
    })
    const none = navigator

    await expect(shareLink({ title: 'A', url: 'u' }, none)).resolves.toBe(
      'failed',
    )
  })

  it('copies the link after a non-cancellation share refusal', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      share: vi
        .fn()
        .mockRejectedValue(new DOMException('denied', 'NotAllowedError')),
      clipboard: { writeText },
    })

    await expect(
      shareLink({ title: 'B', url: 'https://sheetbase.test/record' }),
    ).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith('https://sheetbase.test/record')
  })
})

describe('wake lock', () => {
  it('reports support from the navigator', () => {
    vi.stubGlobal('navigator', {})
    expect(wakeLockSupported(navigator)).toBe(false)
    vi.stubGlobal('navigator', { wakeLock: {} })
    expect(wakeLockSupported(navigator)).toBe(true)
  })

  it('releases the lock without delivering callbacks after unmount', async () => {
    const lock = new (class extends EventTarget {
      releases = 0
      deliveries = 0

      release() {
        this.releases++
        this.dispatchEvent(new Event('release'))

        return Promise.resolve()
      }

      override addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) {
        super.addEventListener(
          type,
          (event) => {
            this.deliveries++

            if (!listener) return

            if ('handleEvent' in listener) listener.handleEvent(event)
            else listener.call(this, event)
          },
          options,
        )
      }
    })()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.stubGlobal('navigator', {
      wakeLock: { request: () => Promise.resolve(lock) },
    })
    const hook = await act(async () => renderHook(() => useWakeLock(true)))
    hook.unmount()
    expect(lock.releases).toBe(1)
    expect(lock.deliveries).toBe(0)
  })
})

describe('splash screens', () => {
  it('lists one dark image per size, each of which exists', () => {
    const links = splashLinks()
    expect(links).toHaveLength(SPLASH_SIZES.length)

    for (const link of links) {
      expect(() => readFileSync(`public${link.href}`)).not.toThrow()
      expect(link.media).not.toMatch(/prefers-color-scheme/)
    }
  })
})

describe('manifest', () => {
  const manifest = z
    .object({
      shortcuts: z.array(z.object({ url: z.string() })),
      share_target: z.object({ action: z.string(), method: z.string() }),
      file_handlers: z.array(z.object({ action: z.string() })),
    })
    .parse(JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')))

  it('offers the three shortcuts', () => {
    expect(manifest.shortcuts.map((shortcut) => shortcut.url)).toEqual([
      '/scan',
      '/experiments/new',
      '/schedule',
    ])
  })

  it('receives shares and opened files on the share page', () => {
    expect(manifest.share_target).toMatchObject({
      action: '/share-target',
      method: 'POST',
    })
    expect(manifest.file_handlers[0]?.action).toBe('/share-target')
  })

  it('has the service worker take shares at the same address', () => {
    const worker = readFileSync('public/sw.js', 'utf8')
    expect(worker).toContain("'/share-target'")
  })
})
