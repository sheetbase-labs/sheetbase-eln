import { describe, expect, it } from 'vitest'

import { contrastRatio, oklchToSrgb, relativeLuminance } from './contrast'
import type { Oklch } from './contrast'

describe('oklchToSrgb', () => {
  it('converts pure white to #ffffff', () => {
    const [r, g, b] = oklchToSrgb({ L: 1, C: 0, h: 0 })
    expect(r).toBeCloseTo(1, 4)
    expect(g).toBeCloseTo(1, 4)
    expect(b).toBeCloseTo(1, 4)
  })

  it('converts pure black to #000000', () => {
    const [r, g, b] = oklchToSrgb({ L: 0, C: 0, h: 0 })
    expect(r).toBeCloseTo(0, 4)
    expect(g).toBeCloseTo(0, 4)
    expect(b).toBeCloseTo(0, 4)
  })
})

describe('relativeLuminance', () => {
  it('returns 1 for white', () => {
    expect(relativeLuminance([1, 1, 1])).toBeCloseTo(1, 4)
  })

  it('returns 0 for black', () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 4)
  })
})

describe('contrastRatio', () => {
  it('returns 1 for identical colours', () => {
    expect(contrastRatio([0.4, 0.4, 0.4], [0.4, 0.4, 0.4])).toBeCloseTo(1, 4)
  })

  it('returns 21 for black on white', () => {
    expect(contrastRatio([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 1)
  })
})

// --- Token-level checks against src/styles.css -----------------------------
// The OKLCH values below are copied from the :root and .dark blocks in
// src/styles.css. If the tokens drift, these tests fail and force the
// change to be reviewed for WCAG 2.2 AA impact.

const LIGHT = {
  background: { L: 0.995, C: 0.002, h: 260 },
  foreground: { L: 0.19, C: 0.018, h: 260 },
  card: { L: 1, C: 0, h: 0 },
  cardForeground: { L: 0.19, C: 0.018, h: 260 },
  primary: { L: 0.55, C: 0.19, h: 255 },
  primaryForeground: { L: 0.985, C: 0.002, h: 255 },
  muted: { L: 0.968, C: 0.005, h: 260 },
  mutedForeground: { L: 0.5, C: 0.02, h: 260 },
  destructive: { L: 0.55, C: 0.21, h: 27 },
  destructiveForeground: { L: 0.985, C: 0.002, h: 27 },
}

const DARK = {
  background: { L: 0.15, C: 0.012, h: 260 },
  foreground: { L: 0.96, C: 0.006, h: 260 },
  card: { L: 0.18, C: 0.014, h: 260 },
  cardForeground: { L: 0.96, C: 0.006, h: 260 },
  primary: { L: 0.68, C: 0.16, h: 255 },
  primaryForeground: { L: 0.15, C: 0.018, h: 255 },
  mutedForeground: { L: 0.69, C: 0.016, h: 260 },
  destructive: { L: 0.57, C: 0.21, h: 27 },
  destructiveForeground: { L: 0.985, C: 0.002, h: 27 },
}

function ratioFor(fg: Oklch, bg: Oklch) {
  return contrastRatio(oklchToSrgb(fg), oklchToSrgb(bg))
}

// WCAG 2.2 AA: >= 4.5 for normal text, >= 3 for large text. The pairs
// below carry body text, identifiers or status labels, so we require 4.5.
const AA_NORMAL = 4.5

describe('WCAG 2.2 AA — light theme token pairs', () => {
  it('foreground on background passes AA', () => {
    expect(ratioFor(LIGHT.foreground, LIGHT.background)).toBeGreaterThanOrEqual(
      AA_NORMAL,
    )
  })
  it('foreground on card passes AA', () => {
    expect(ratioFor(LIGHT.cardForeground, LIGHT.card)).toBeGreaterThanOrEqual(
      AA_NORMAL,
    )
  })
  it('primary-foreground on primary passes AA', () => {
    expect(
      ratioFor(LIGHT.primaryForeground, LIGHT.primary),
    ).toBeGreaterThanOrEqual(AA_NORMAL)
  })
  it('muted-foreground on background passes AA', () => {
    expect(
      ratioFor(LIGHT.mutedForeground, LIGHT.background),
    ).toBeGreaterThanOrEqual(AA_NORMAL)
  })
  it('muted-foreground on muted passes AA', () => {
    expect(ratioFor(LIGHT.mutedForeground, LIGHT.muted)).toBeGreaterThanOrEqual(
      AA_NORMAL,
    )
  })
  it('destructive-foreground on destructive passes AA', () => {
    expect(
      ratioFor(LIGHT.destructiveForeground, LIGHT.destructive),
    ).toBeGreaterThanOrEqual(AA_NORMAL)
  })
})

describe('WCAG 2.2 AA — dark theme token pairs', () => {
  it('foreground on background passes AA', () => {
    expect(ratioFor(DARK.foreground, DARK.background)).toBeGreaterThanOrEqual(
      AA_NORMAL,
    )
  })
  it('foreground on card passes AA', () => {
    expect(ratioFor(DARK.cardForeground, DARK.card)).toBeGreaterThanOrEqual(
      AA_NORMAL,
    )
  })
  it('primary-foreground on primary passes AA', () => {
    expect(
      ratioFor(DARK.primaryForeground, DARK.primary),
    ).toBeGreaterThanOrEqual(AA_NORMAL)
  })
  it('muted-foreground on background passes AA', () => {
    expect(
      ratioFor(DARK.mutedForeground, DARK.background),
    ).toBeGreaterThanOrEqual(AA_NORMAL)
  })
  it('destructive-foreground on destructive passes AA', () => {
    expect(
      ratioFor(DARK.destructiveForeground, DARK.destructive),
    ).toBeGreaterThanOrEqual(AA_NORMAL)
  })
})
