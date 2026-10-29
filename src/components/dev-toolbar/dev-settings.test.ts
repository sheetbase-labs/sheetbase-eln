import { describe, expect, it } from 'vitest'

import {
  buildDevCss,
  defaultDevSettings,
  devToolbarAvailable,
  exportTokens,
  formatOklch,
  hasOverrides,
  parseOklch,
  parseStoredSettings,
} from './dev-settings'
import type { DevSettings } from './dev-settings'

const tuned: DevSettings = {
  ...defaultDevSettings,
  density: 'compact',
  tokens: {
    light: { primary: { l: 0.5, c: 0.2, h: 300 } },
    dark: { background: { l: 0.2, c: 0.01, h: 250 } },
  },
}

describe('oklch', () => {
  it('round-trips the values the theme authors', () => {
    expect(parseOklch('oklch(0.551 0.188 256)')).toEqual({
      l: 0.551,
      c: 0.188,
      h: 256,
    })
    expect(formatOklch({ l: 0.551, c: 0.188, h: 256 })).toBe(
      'oklch(0.551 0.188 256)',
    )
  })

  it('reads percentages and ignores alpha, and rejects other colours', () => {
    expect(parseOklch('oklch(50% 0.1 20 / 0.4)')).toEqual({
      l: 0.5,
      c: 0.1,
      h: 20,
    })
    expect(parseOklch('#fff')).toBeNull()
  })
})

describe('buildDevCss', () => {
  it('is empty when nothing is overridden', () => {
    expect(buildDevCss(defaultDevSettings)).toBe('')
    expect(hasOverrides(defaultDevSettings)).toBe(false)
  })

  it('scopes light and dark tokens separately and applies density', () => {
    const css = buildDevCss(tuned)
    expect(css).toContain('html:root{--row-height:26px;--control-height:24px}')
    expect(css).toContain('html:root{--primary:oklch(0.5 0.2 300)}')
    expect(css).toContain('html.dark:root{--background:oklch(0.2 0.01 250)}')
  })

  it('emits nothing while overrides are switched off', () => {
    expect(buildDevCss({ ...tuned, overridesOn: false })).toBe('')
  })

  it('keeps the toolbar out of the outline and motion helpers', () => {
    const css = buildDevCss({
      ...defaultDevSettings,
      outlines: true,
      reduceMotion: true,
    })
    expect(css).toContain('[data-dev-toolbar]')
    expect(css).toContain('transition-duration:0.001ms')
  })
})

describe('stored settings', () => {
  it('falls back to defaults for bad input', () => {
    expect(parseStoredSettings(null)).toEqual(defaultDevSettings)
    expect(parseStoredSettings('{nope')).toEqual(defaultDevSettings)
    expect(
      parseStoredSettings(
        '{"density":"huge","tokens":{"light":{"primary":{"l":"x"}}}}',
      ),
    ).toEqual(defaultDevSettings)
  })

  it('survives a round trip', () => {
    expect(parseStoredSettings(JSON.stringify(tuned))).toEqual(tuned)
  })

  it('exports tuned tokens as CSS variables per mode', () => {
    expect(JSON.parse(exportTokens(tuned))).toEqual({
      light: { '--primary': 'oklch(0.5 0.2 300)' },
      dark: { '--background': 'oklch(0.2 0.01 250)' },
    })
  })
})

describe('devToolbarAvailable', () => {
  it('follows the switch in development, for any role', () => {
    expect(
      devToolbarAvailable({ dev: true, role: 'viewer', enabled: true }),
    ).toBe(true)
    expect(
      devToolbarAvailable({ dev: true, role: 'viewer', enabled: false }),
    ).toBe(false)
  })

  it('needs an owner or admin who switched it on in production', () => {
    expect(
      devToolbarAvailable({ dev: false, role: 'admin', enabled: true }),
    ).toBe(true)
    expect(
      devToolbarAvailable({ dev: false, role: 'owner', enabled: true }),
    ).toBe(true)
    expect(
      devToolbarAvailable({ dev: false, role: 'admin', enabled: false }),
    ).toBe(false)
    expect(
      devToolbarAvailable({ dev: false, role: 'scientist', enabled: true }),
    ).toBe(false)
    expect(
      devToolbarAvailable({ dev: false, role: undefined, enabled: true }),
    ).toBe(false)
  })
})
