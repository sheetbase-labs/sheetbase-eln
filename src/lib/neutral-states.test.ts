import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Hover, focus, selected, active and pressed states are neutral grey, never the
 * old blue. A state variant may not paint a ring, border, outline or tint with
 * `primary`, `link` or `info`:
 *   - surface      -> bg-selection / bg-selection-subtle / hover:bg-row-hover
 *   - focus ring   -> ring-ring (neutral)
 *   - edge         -> border-ring or border-border-strong
 *   - label        -> text-fg
 * Solid primary fills (a primary button, a checked box) and plain link
 * colour on hover are not states of this kind and stay allowed.
 */
const STATE_VARIANT =
  /(?:hover|focus|focus-visible|focus-within|active|aria-selected|aria-current|aria-pressed|aria-expanded|aria-checked|data-active|data-selected|data-open|data-pressed|data-highlighted|data-\[[a-z-]*(?:selected|active|focused|highlighted|open|pressed|fill-target)[^\]]*\])$/

const PAINT =
  /^(ring|outline|border|shadow|decoration|accent|from|to|via)-(?:primary|link|info|blue|sky|indigo|cyan|violet)(?:\/\d+)?$/

const TINT = /^bg-(?:primary|link|info|blue|sky|indigo|cyan|violet)\/(\d+)$/

const LABEL = /^text-(?:primary|link|info|blue|sky|indigo|cyan|violet)$/

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)

    if (statSync(path).isDirectory()) {
      files(path, out)
    } else if (/\.(tsx?|css)$/.test(name) && !/\.(test|stories)\./.test(name)) {
      out.push(path)
    }
  }

  return out
}

/** Splits a class token into its variant chain and its utility, honouring [...] */
interface ClassToken {
  variants: string[]
  utility: string
}

function split(token: string): ClassToken {
  const parts: string[] = []
  let depth = 0
  let cur = ''

  for (const ch of token) {
    if (ch === '[') depth++

    if (ch === ']') depth--

    if (ch === ':' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }

  return { variants: parts, utility: cur }
}

/** Plain links turn link-coloured on hover; that is a link, not a selection. */
function isPlainLinkHover(variants: string[], utility: string): boolean {
  return (
    utility === 'text-link' &&
    variants.every((v) => v === 'hover' || v.startsWith('group-hover'))
  )
}

function isBlueState(token: string): boolean {
  const { variants, utility } = split(token)

  if (!variants.some((v) => STATE_VARIANT.test(v))) return false

  const tint = TINT.exec(utility)

  const blue =
    PAINT.test(utility) ||
    LABEL.test(utility) ||
    (tint && Number(tint[1]) <= 40)

  return Boolean(blue) && !isPlainLinkHover(variants, utility)
}

describe('neutral interaction states', () => {
  it('paints no hover, focus, selected or active state with primary, link or info', () => {
    const root = join(__dirname, '..')
    const bad = new Set<string>()

    for (const file of files(root)) {
      const text = readFileSync(file, 'utf8')

      for (const [token] of text.matchAll(/[A-Za-z0-9_\-:/.[\]=()%,]+/g)) {
        if (
          token.includes(':') &&
          !token.includes('//') &&
          isBlueState(token)
        ) {
          bad.add(`${relative(root, file)}: ${token}`)
        }
      }
    }

    expect(
      [...bad],
      'State styles must be neutral. Use bg-selection for a selected surface, ring-ring or border-ring for focus and edges, text-fg for the label. The old blue (primary, link, info) stays for solid primary buttons and plain links only.',
    ).toEqual([])
  })
})
