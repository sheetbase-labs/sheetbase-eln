import { describe, expect, it } from 'vitest'

import {
  contrastRatio,
  hexToSrgb,
  oklchToSrgb,
  relativeLuminance,
  srgbToOklch,
} from './contrast'
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

describe('srgbToOklch', () => {
  // DSYS-02: the token conversion in scripts/design-tokens.mts is only trusted
  // if hex → OKLCH → sRGB returns the same colour to within one 8-bit step.
  it.each(['#006EDC', '#0F141C', '#FDFDFF'])(
    'round-trips %s within one 8-bit step',
    (hex) => {
      const source = hexToSrgb(hex)
      const roundTrip = oklchToSrgb(srgbToOklch(source))
      const step = 1 / 255
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs(roundTrip[channel] - source[channel])).toBeLessThan(
          step,
        )
      }
    },
  )
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
// The OKLCH values below are the UI system v3 tokens from
// scripts/design-tokens.mts, copied into the :root and .dark blocks of
// src/styles.css. If a token drifts, these tests fail and force the change to
// be reviewed for WCAG 2.2 AA impact.

const LIGHT = {
  bg: { L: 0.995, C: 0.003, h: 286.4 },
  surface: { L: 1, C: 0, h: 89.9 },
  surfaceMuted: { L: 0.979, C: 0.003, h: 264.5 },
  text: { L: 0.19, C: 0.018, h: 259.7 },
  textMuted: { L: 0.501, C: 0.02, h: 259.4 },
  textFaint: { L: 0.55, C: 0.019, h: 259.4 },
  accent: { L: 0.551, C: 0.188, h: 256 },
  accentStrong: { L: 0.551, C: 0.188, h: 256 },
  onAccent: { L: 1, C: 0, h: 89.9 },
  dangerText: { L: 0.5, C: 0.182, h: 29.5 },
  dangerWash: { L: 0.959, C: 0.017, h: 17.5 },
  warningText: { L: 0.508, C: 0.108, h: 73.3 },
  warningWash: { L: 0.976, C: 0.031, h: 91 },
  successText: { L: 0.457, C: 0.108, h: 154 },
  successWash: { L: 0.954, C: 0.022, h: 164.5 },
  inverseBg: { L: 0.19, C: 0.018, h: 259.7 },
  inverseText: { L: 1, C: 0, h: 89.9 },
} satisfies Record<string, Oklch>

const DARK = {
  bg: { L: 0.177, C: 0.011, h: 260.6 },
  surface: { L: 0.216, C: 0.016, h: 256.8 },
  surfaceMuted: { L: 0.241, C: 0.018, h: 255.7 },
  text: { L: 0.933, C: 0.007, h: 260.7 },
  textMuted: { L: 0.712, C: 0.02, h: 255.6 },
  textFaint: { L: 0.66, C: 0.022, h: 257.5 },
  accent: { L: 0.687, C: 0.167, h: 255.6 },
  accentStrong: { L: 0.553, C: 0.175, h: 257.1 },
  onAccent: { L: 1, C: 0, h: 89.9 },
  dangerText: { L: 0.76, C: 0.143, h: 23.5 },
  dangerWash: { L: 0.237, C: 0.037, h: 20.2 },
  warningText: { L: 0.846, C: 0.125, h: 86.6 },
  warningWash: { L: 0.263, C: 0.032, h: 88.9 },
  successText: { L: 0.797, C: 0.129, h: 158.7 },
  successWash: { L: 0.259, C: 0.034, h: 163.1 },
  inverseBg: { L: 0.933, C: 0.007, h: 260.7 },
  inverseText: { L: 0.177, C: 0.011, h: 260.6 },
} satisfies Record<string, Oklch>

function ratioFor(fg: Oklch, bg: Oklch) {
  return contrastRatio(oklchToSrgb(fg), oklchToSrgb(bg))
}

// WCAG 2.2 AA: >= 4.5 for normal text, >= 3 for large text. The pairs below
// carry body text, identifiers, links or status labels, so we require 4.5.
const AA_NORMAL = 4.5

const PAIRS: Array<[keyof typeof LIGHT, keyof typeof LIGHT]> = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surfaceMuted'],
  ['textMuted', 'bg'],
  ['textMuted', 'surface'],
  ['textMuted', 'surfaceMuted'],
  ['textFaint', 'bg'],
  ['textFaint', 'surface'],
  ['textFaint', 'surfaceMuted'],
  ['onAccent', 'accentStrong'],
  ['accent', 'surface'],
  ['dangerText', 'surface'],
  ['dangerText', 'dangerWash'],
  ['warningText', 'surface'],
  ['warningText', 'warningWash'],
  ['successText', 'successWash'],
  ['inverseText', 'inverseBg'],
]

for (const [theme, tokens] of [
  ['light', LIGHT],
  ['dark', DARK],
] as const) {
  describe(`WCAG 2.2 AA — ${theme} theme token pairs`, () => {
    for (const [fg, bg] of PAIRS) {
      it(`${fg} on ${bg} passes AA`, () => {
        expect(ratioFor(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(
          AA_NORMAL,
        )
      })
    }
  })
}
