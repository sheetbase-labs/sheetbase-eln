/**
 * WCAG 2.2 contrast utilities. Converts OKLCH design tokens (the format
 * used in src/styles.css) to sRGB, then to relative luminance, then to the
 * WCAG contrast ratio. Used by the contrast test so the AA check is a real
 * measurement of the tokens rather than a hand-written assertion.
 */

export interface Oklch {
  L: number
  C: number
  h: number
}

/** Inverse of the OKLab → linear sRGB transform from Björn Ottosson's spec. */
export function oklchToSrgb({ L, C, h }: Oklch): [number, number, number] {
  const hr = (h * Math.PI) / 180
  const a = C * Math.cos(hr)
  const b = C * Math.sin(hr)

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b

  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_

  const rLin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const gLin = -1.2684380041 * l + 2.6097574011 * m - 0.3413193965 * s
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

  return [linearToSrgb(rLin), linearToSrgb(gLin), linearToSrgb(bLin)]
}

function linearToSrgb(c: number): number {
  const v = Math.min(1, Math.max(0, c))
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

/** Convert a gamma-encoded sRGB channel (0..1) to linear light. */
function srgbToLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance of an sRGB colour (gamma-encoded channels 0..1). */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  )
}

/** WCAG 2.2 contrast ratio between two sRGB colours (channels 0..1). */
export function contrastRatio(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Convert an sRGB channel (0..1, gamma-encoded) to linear light. */
function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/**
 * Inverse of {@link oklchToSrgb}: gamma-encoded sRGB (channels 0..1) to OKLCH.
 * Used by `scripts/design-tokens.mts` to convert the design's hex values
 * without hand-typing them.
 */
export function srgbToOklch([r, g, b]: [number, number, number]): Oklch {
  const rl = srgbChannelToLinear(r)
  const gl = srgbChannelToLinear(g)
  const bl = srgbChannelToLinear(b)

  const l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl
  const m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl
  const s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl

  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_

  const C = Math.sqrt(a * a + bb * bb)
  const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360
  return { L, C, h }
}

/** Parse `#rgb`/`#rrggbb` to gamma-encoded sRGB channels (0..1). */
export function hexToSrgb(hex: string): [number, number, number] {
  const value = hex.trim().replace(/^#/, '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value
  if (!/^[0-9a-fA-F]{6}$/.test(full))
    throw new Error(`Unsupported colour: ${hex}`)
  const int = Number.parseInt(full, 16)
  return [
    ((int >> 16) & 255) / 255,
    ((int >> 8) & 255) / 255,
    (int & 255) / 255,
  ]
}
