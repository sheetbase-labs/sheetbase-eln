// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { EDGE_GAP_PX, placeBeside, readVisibleArea } from './visible-area'

const screen = { top: 59, bottom: 460, left: 0, right: 393 }

describe('placeBeside', () => {
  it('opens below the anchor when it fits there', () => {
    const placed = placeBeside({
      anchor: { top: 100, bottom: 120, left: 40 },
      size: { width: 288, height: 200 },
      area: screen,
    })

    expect(placed.side).toBe('bottom')
    expect(placed.top).toBe(126)
    expect(placed.top + 200).toBeLessThanOrEqual(screen.bottom)
  })

  it('flips above a caret near the keyboard', () => {
    const placed = placeBeside({
      anchor: { top: 400, bottom: 420, left: 40 },
      size: { width: 288, height: 320 },
      area: screen,
    })

    expect(placed.side).toBe('top')
    expect(placed.top).toBeGreaterThanOrEqual(screen.top + EDGE_GAP_PX)
    expect(placed.top + Math.min(320, placed.maxHeight)).toBe(394)
  })

  it('shrinks to the larger side when it fits on neither', () => {
    const placed = placeBeside({
      anchor: { top: 300, bottom: 320, left: 40 },
      size: { width: 288, height: 320 },
      area: screen,
    })

    expect(placed.side).toBe('top')
    expect(placed.maxHeight).toBe(300 - 6 - (screen.top + EDGE_GAP_PX))
    expect(placed.top).toBe(screen.top + EDGE_GAP_PX)
  })

  it('keeps clear of the status bar when flipping', () => {
    const placed = placeBeside({
      anchor: { top: 90, bottom: 110, left: 40 },
      size: { width: 288, height: 320 },
      area: screen,
      prefer: 'top',
    })

    expect(placed.side).toBe('bottom')
    expect(placed.top).toBe(116)
  })

  it('stays on screen when the keyboard covers the caret', () => {
    const placed = placeBeside({
      anchor: { top: 700, bottom: 720, left: 40 },
      size: { width: 288, height: 320 },
      area: screen,
    })

    expect(placed.side).toBe('top')
    expect(placed.top + Math.min(320, placed.maxHeight)).toBeLessThanOrEqual(
      screen.bottom,
    )
  })

  it('shifts back on screen sideways', () => {
    const placed = placeBeside({
      anchor: { top: 100, bottom: 120, left: 300 },
      size: { width: 288, height: 100 },
      area: screen,
    })

    expect(placed.left).toBe(393 - EDGE_GAP_PX - 288)
  })
})

describe('readVisibleArea', () => {
  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', {
      value: null,
      configurable: true,
    })
  })

  it('is the visual viewport, panned and shrunk by the keyboard', () => {
    Object.defineProperty(window, 'innerHeight', {
      value: 852,
      configurable: true,
    })
    Object.defineProperty(window, 'visualViewport', {
      value: { height: 516, width: 393, offsetTop: 120, offsetLeft: 0 },
      configurable: true,
    })
    const area = readVisibleArea()
    expect(area.top).toBe(120)
    expect(area.bottom).toBe(636)
    expect(area.right).toBe(393)
  })
})
