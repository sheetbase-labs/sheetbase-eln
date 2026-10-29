/**
 * Dev toolbar settings: what the toolbar can change and the CSS that applies it.
 *
 * Pure on purpose. The store (`dev-store.ts`) persists and applies these; the
 * panel (`dev-toolbar.tsx`) edits them.
 */

export const densities = ['compact', 'default', 'comfortable'] as const
export type Density = (typeof densities)[number]

/** Row and control heights per density; `default` is the shipped look. */
export const densityTokens: Record<Density, Record<string, string> | null> = {
  compact: { '--row-height': '26px', '--control-height': '24px' },
  default: null,
  comfortable: { '--row-height': '40px', '--control-height': '34px' },
}

/** Design tokens the colour tool can tune, in the order the panel lists them. */
export const tunableTokens = [
  'primary',
  'background',
  'foreground',
  'border',
  'destructive',
  'success',
] as const
export type TunableToken = (typeof tunableTokens)[number]

export type Mode = 'light' | 'dark'

export interface Oklch {
  l: number
  c: number
  h: number
}

export type TokenOverrides = Partial<Record<TunableToken, Oklch>>

export interface DevSettings {
  density: Density
  /** Off suspends every override at once, to compare against the shipped look. */
  overridesOn: boolean
  outlines: boolean
  reduceMotion: boolean
  tokens: Record<Mode, TokenOverrides>
}

export const defaultDevSettings: DevSettings = {
  density: 'default',
  overridesOn: true,
  outlines: false,
  reduceMotion: false,
  tokens: { light: {}, dark: {} },
}

const round = (n: number, places: number) => {
  const f = 10 ** places
  return Math.round(n * f) / f
}

export function formatOklch({ l, c, h }: Oklch): string {
  return `oklch(${round(l, 3)} ${round(c, 3)} ${round(h, 1)})`
}

/** Read `oklch(L C H)` (optionally `L%` and `/ alpha`); null for anything else. */
export function parseOklch(value: string): Oklch | null {
  const match =
    /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/[^)]*)?\)$/i.exec(
      value.trim(),
    )
  if (!match) return null
  const l = Number(match[1]) / (match[2] ? 100 : 1)
  const c = Number(match[3])
  const h = Number(match[4])
  return [l, c, h].every(Number.isFinite) ? { l, c, h } : null
}

export function hasOverrides(settings: DevSettings): boolean {
  return (
    settings.density !== 'default' ||
    settings.outlines ||
    settings.reduceMotion ||
    Object.keys(settings.tokens.light).length > 0 ||
    Object.keys(settings.tokens.dark).length > 0
  )
}

function rule(selector: string, declarations: [string, string][]): string {
  return declarations.length
    ? `${selector}{${declarations.map(([k, v]) => `${k}:${v}`).join(';')}}`
    : ''
}

/** The stylesheet that applies the settings; empty when nothing is overridden. */
export function buildDevCss(settings: DevSettings): string {
  if (!settings.overridesOn) return ''
  const parts: string[] = []
  const density = densityTokens[settings.density]
  if (density) parts.push(rule('html:root', Object.entries(density)))
  // Doubled class and element selectors beat the theme's `:root` and `.dark`.
  const selectors: Record<Mode, string> = {
    light: 'html:root',
    dark: 'html.dark:root',
  }
  for (const mode of ['light', 'dark'] as const) {
    const entries = Object.entries(settings.tokens[mode]).map(
      ([token, value]): [string, string] => [`--${token}`, formatOklch(value)],
    )
    parts.push(rule(selectors[mode], entries))
  }
  if (settings.outlines) {
    parts.push(
      '*:not([data-dev-toolbar],[data-dev-toolbar] *){outline:1px solid oklch(0.7 0.2 20 / 0.4)!important;outline-offset:-1px}',
    )
  }
  if (settings.reduceMotion) {
    parts.push(
      '*,*::before,*::after{animation-duration:0.001ms!important;animation-delay:0s!important;transition-duration:0.001ms!important;transition-delay:0s!important;scroll-behavior:auto!important}',
    )
  }
  return parts.filter(Boolean).join('\n')
}

/** The tuned tokens as JSON, for pasting into a design tool or a commit. */
export function exportTokens(settings: DevSettings): string {
  const out: Record<Mode, Record<string, string>> = { light: {}, dark: {} }
  for (const mode of ['light', 'dark'] as const) {
    for (const [token, value] of Object.entries(settings.tokens[mode])) {
      out[mode][`--${token}`] = formatOklch(value)
    }
  }
  return JSON.stringify(out, null, 2)
}

export function parseStoredSettings(raw: string | null): DevSettings {
  if (!raw) return defaultDevSettings
  try {
    const value = JSON.parse(raw) as Partial<DevSettings>
    return {
      density: densities.includes(value.density as Density)
        ? (value.density as Density)
        : 'default',
      overridesOn: value.overridesOn !== false,
      outlines: value.outlines === true,
      reduceMotion: value.reduceMotion === true,
      tokens: {
        light: cleanOverrides(value.tokens?.light),
        dark: cleanOverrides(value.tokens?.dark),
      },
    }
  } catch {
    return defaultDevSettings
  }
}

function cleanOverrides(value: TokenOverrides | undefined): TokenOverrides {
  const out: TokenOverrides = {}
  for (const token of tunableTokens) {
    const o = value?.[token]
    if (
      o &&
      Number.isFinite(o.l) &&
      Number.isFinite(o.c) &&
      Number.isFinite(o.h)
    ) {
      out[token] = { l: o.l, c: o.c, h: o.h }
    }
  }
  return out
}

/**
 * Who may see the toolbar, given whether it is switched on. Development builds
 * show it to anyone running them; a production build only to workspace owners
 * and admins.
 */
export function devToolbarAvailable({
  dev,
  role,
  enabled,
}: {
  dev: boolean
  role: string | null | undefined
  enabled: boolean
}): boolean {
  if (dev) return enabled
  return enabled && (role === 'owner' || role === 'admin')
}
