/**
 * Phone checks: run the app the way an iPhone shows it and fail when a menu,
 * popover or sheet lands somewhere the person cannot see it.
 *
 * Chromium cannot open a real on-screen keyboard, so the keyboard is simulated
 * the way iOS behaves: the *visual* viewport shrinks (and can pan down) while
 * the layout viewport stays the full screen height. Anything the app positions
 * from `window.innerHeight` instead of the visual viewport ends up "behind" the
 * keyboard, and these checks catch it. Safe areas (the status bar and the home
 * indicator) are emulated through the DevTools protocol, and the installed-app
 * display mode is switched on by rewriting the app's `display-mode: standalone`
 * media rules, which Chromium only honours for an installed web app.
 */
import { expect } from 'playwright/test'
import type { Locator, Page } from 'playwright/test'

/** iPhone 15/16/17 Pro portrait, in CSS pixels. */
export const PHONE = {
  viewport: { width: 393, height: 852 },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
} as const

/** Dynamic Island status bar and home indicator. */
export const SAFE_AREA = { top: 59, bottom: 34, left: 0, right: 0 }
/** The keyboard's height on an iPhone in portrait (QuickType row included). */
export const KEYBOARD_PX = 336
/** The previous / next / done bar iOS floats over the top of the keyboard. */
export const IOS_ACCESSORY_PX = 56

declare global {
  interface Window {
    __phone?: {
      keyboard: number
      pan: number
      setKeyboard: (px: number, pan?: number) => void
    }
  }
}

/**
 * Replace `window.visualViewport` with one whose height the test controls.
 * Installed before any app script runs, so every reader (the app's own hooks
 * and Base UI's positioning) sees the same simulated keyboard.
 */
function installKeyboard() {
  const target = new EventTarget()
  const state = { keyboard: 0, pan: 0 }
  const fake = {
    get width() {
      return window.innerWidth
    },
    get height() {
      return window.innerHeight - state.keyboard
    },
    get offsetTop() {
      return state.pan
    },
    get offsetLeft() {
      return 0
    },
    get pageTop() {
      return window.scrollY + state.pan
    },
    get pageLeft() {
      return window.scrollX
    },
    scale: 1,
    onresize: null,
    onscroll: null,
    onscrollend: null,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  }
  // Running as the installed app, as on Gareth's phone.
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = (query: string) => {
    const result = matchMedia(query)
    if (!query.includes('display-mode: standalone')) return result
    return Object.assign(Object.create(result) as MediaQueryList, {
      matches: true,
      media: query,
    })
  }
  Object.defineProperty(navigator, 'standalone', { get: () => true })
  // Development-only overlay that no one sees on a phone.
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style')
    style.textContent =
      'button[aria-label="Open TanStack Devtools"]{display:none!important}'
    document.head.appendChild(style)
  })
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    get: () => fake,
  })
  window.__phone = {
    get keyboard() {
      return state.keyboard
    },
    get pan() {
      return state.pan
    },
    setKeyboard(px: number, pan = 0) {
      state.keyboard = px
      state.pan = pan
      target.dispatchEvent(new Event('resize'))
      target.dispatchEvent(new Event('scroll'))
    },
  }
}

/** Emulate the iPhone's safe areas and simulated keyboard on this page. */
export async function emulatePhone(page: Page): Promise<void> {
  await page.addInitScript(installKeyboard)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: SAFE_AREA })
}

/**
 * Turn on the app's installed-app (`standalone`) styles, which is how Gareth
 * runs Sheetbase on his phone: the page draws under the status bar and must
 * pad for it itself. Re-run after a navigation that loads new styles.
 */
export async function emulateInstalledApp(page: Page): Promise<void> {
  await page.evaluate(() => {
    const visit = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSMediaRule) {
          if (rule.media.mediaText.includes('display-mode: standalone')) {
            rule.media.mediaText = 'all'
          }
          visit(rule.cssRules)
        } else if ('cssRules' in rule) {
          visit((rule as CSSGroupingRule).cssRules)
        }
      }
    }
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        visit(sheet.cssRules)
      } catch {
        // A cross-origin sheet (fonts) cannot be read and has no such rules.
      }
    }
  })
}

/** Open (or close, with 0) the simulated keyboard. */
export async function setKeyboard(
  page: Page,
  px: number,
  pan = 0,
): Promise<void> {
  await page.evaluate(([k, p]) => window.__phone?.setKeyboard(k, p), [px, pan])
  // Let resize listeners and their re-measures settle.
  await page.waitForTimeout(150)
}

export interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * The part of the screen the person can actually see, in the coordinates
 * `position: fixed` and `getBoundingClientRect` use: below the status bar,
 * above the home indicator or the keyboard and its accessory bar.
 */
export async function visibleArea(page: Page): Promise<Box> {
  return page.evaluate(
    ([safe, accessory]) => {
      const kb = window.__phone?.keyboard ?? 0
      const pan = window.__phone?.pan ?? 0
      const height = window.innerHeight - kb
      return {
        top: pan + safe.top,
        bottom: pan + height - (kb > 0 ? accessory : safe.bottom),
        left: safe.left,
        right: window.innerWidth - safe.right,
      }
    },
    [SAFE_AREA, IOS_ACCESSORY_PX] as const,
  )
}

/**
 * Assert a floating surface sits wholly inside the visible area and is not
 * hidden under a fixed bar: every corner (inset a little) hit-tests to the
 * surface itself, not to a header, tab strip or another layer.
 */
export async function expectFullyVisible(
  page: Page,
  surface: Locator,
  what: string,
): Promise<void> {
  const area = await visibleArea(page)
  const box = await surface.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
  })
  const off: string[] = []
  // Half a pixel of slack for sub-pixel layout.
  if (box.top < area.top - 0.5)
    off.push(`top ${Math.round(area.top - box.top)}px above the visible area`)
  if (box.bottom > area.bottom + 0.5)
    off.push(
      `bottom ${Math.round(box.bottom - area.bottom)}px below the visible area`,
    )
  if (box.left < area.left - 0.5)
    off.push(`${Math.round(area.left - box.left)}px off the left edge`)
  if (box.right > area.right + 0.5)
    off.push(`${Math.round(box.right - area.right)}px off the right edge`)
  const covered = await surface.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const inset = 4
    const points: Array<[number, number]> = [
      [r.left + inset, r.top + inset],
      [r.right - inset, r.top + inset],
      [r.left + inset, r.bottom - inset],
      [r.right - inset, r.bottom - inset],
    ]
    const hits: string[] = []
    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight)
        continue
      const hit = document.elementFromPoint(x, y)
      if (hit && !el.contains(hit) && !hit.contains(el)) {
        const name =
          hit.getAttribute('aria-label') ??
          hit.closest('[role]')?.getAttribute('role') ??
          hit.tagName.toLowerCase()
        hits.push(`(${Math.round(x)},${Math.round(y)}) under ${name}`)
      }
    }
    return hits
  })
  off.push(...covered)
  expect(
    off,
    `${what} at top ${Math.round(box.top)}, bottom ${Math.round(box.bottom)} ` +
      `(visible ${Math.round(area.top)}–${Math.round(area.bottom)})`,
  ).toEqual([])
}

/**
 * Elements whose content is cut off at the screen's edge: the page scrolls
 * sideways, or a visible element with text runs past the right edge without
 * sitting inside something that scrolls sideways on purpose.
 */
export async function findOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const problems: string[] = []
    if (document.documentElement.scrollWidth > width + 1) {
      problems.push(
        `page scrolls sideways (${document.documentElement.scrollWidth}px wide on a ${width}px screen)`,
      )
    }
    const scrollsSideways = (el: Element | null): boolean => {
      for (let node = el; node && node !== document.body;) {
        const style = getComputedStyle(node)
        if (
          (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
          node.scrollWidth > node.clientWidth
        )
          return true
        if (style.overflowX === 'hidden' || style.overflowX === 'clip') {
          // Clipped on purpose by an ancestor (truncate, carousels): only a
          // problem when that ancestor itself overflows the screen.
          const r = node.getBoundingClientRect()
          if (r.right <= width + 1) return true
        }
        node = node.parentElement
      }
      return false
    }
    const describe = (el: Element) => {
      const label =
        el.getAttribute('aria-label') ??
        (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
      return `${el.tagName.toLowerCase()} "${label}"`
    }
    const seen = new Set<Element>()
    for (const el of Array.from(
      document.querySelectorAll('main *, header *, nav *, [role="dialog"] *'),
    )) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right <= width + 1 && r.left >= -1) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.position === 'fixed') continue
      // Only leaves that show something: text, a control or an image.
      const showsSomething =
        Array.from(el.childNodes).some(
          (n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '',
        ) || /^(BUTTON|INPUT|SELECT|TEXTAREA|IMG|SVG|A)$/i.test(el.tagName)
      if (!showsSomething) continue
      if (scrollsSideways(el.parentElement)) continue
      if (Array.from(seen).some((s) => s.contains(el))) continue
      seen.add(el)
      problems.push(
        `${describe(el)} runs from ${Math.round(r.left)} to ${Math.round(r.right)}px`,
      )
    }
    return problems.slice(0, 15)
  })
}
