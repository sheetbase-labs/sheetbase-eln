/**
 * Convert the vendored UI system v3 tokens to the OKLCH values used in
 * `src/styles.css`, so the implementation is generated from the design source
 * rather than hand-typed (DSYS-02, ADR-0007 keeps OKLCH as the format).
 *
 *   pnpm tsx scripts/design-tokens.mts            # every colour token
 *   pnpm tsx scripts/design-tokens.mts --theme dark
 *   pnpm tsx scripts/design-tokens.mts --token accent-strong
 *
 * The design source is `design/ui-system-v3/design-system/tokens.json`. Re-run
 * this whenever the design snapshot changes, then update `src/styles.css`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { hexToSrgb, srgbToOklch } from '../src/lib/contrast'
import type { Oklch } from '../src/lib/contrast'

type TokenValue = { light: string; dark: string }
type ColourToken = { name: string; value: TokenValue; usage?: string }

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const tokensPath = resolve(
  root,
  'docs/knowledge/design/ui-system-v3/design-system/tokens.json',
)

function rgbaToOklch(value: string): { color: Oklch; alpha: number } | null {
  const match =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
      value,
    )
  if (!match) return null
  const [r, g, b] = [match[1], match[2], match[3]].map((c) => Number(c) / 255)
  const alpha = match[4] === undefined ? 1 : Number(match[4])
  return { color: srgbToOklch([r, g, b]), alpha }
}

function formatOklch(color: Oklch, alpha = 1): string {
  const L = Number(color.L.toFixed(3))
  const C = Number(color.C.toFixed(3))
  const h = Number(color.h.toFixed(1))
  const base = `oklch(${L} ${C} ${h}`
  return alpha >= 1 ? `${base})` : `${base} / ${alpha})`
}

function convert(value: string): string {
  const rgba = rgbaToOklch(value)
  if (rgba) return formatOklch(rgba.color, rgba.alpha)
  return formatOklch(srgbToOklch(hexToSrgb(value)))
}

function main() {
  const args = process.argv.slice(2)
  const themeArg = args[args.indexOf('--theme') + 1]
  const themes: Array<'light' | 'dark'> =
    themeArg === 'light' || themeArg === 'dark' ? [themeArg] : ['light', 'dark']
  const tokenArg = args.includes('--token')
    ? args[args.indexOf('--token') + 1]
    : undefined

  const document = JSON.parse(readFileSync(tokensPath, 'utf8')) as {
    color: { tokens: ColourToken[] }
  }
  const tokens = tokenArg
    ? document.color.tokens.filter((token) => token.name === tokenArg)
    : document.color.tokens
  if (tokens.length === 0) {
    console.error(`No colour token matched: ${tokenArg}`)
    process.exitCode = 1
    return
  }

  for (const theme of themes) {
    console.log(`/* ${theme} */`)
    for (const token of tokens) {
      console.log(`--${token.name}: ${convert(token.value[theme])};`)
    }
    console.log('')
  }
}

main()
