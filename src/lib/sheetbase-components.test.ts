import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * COMP-05: the ELN drives the `@sheetbase-labs/*` packages from its own v3
 * tokens. Nothing is forked — the packages' variables are pointed at the ELN
 * variables by the host mapping in `src/styles.css` — so this test pins the
 * mapping and the import order that makes it win. See
 * docs/development/sheetbase-components.md.
 */
const styles = readFileSync('src/styles.css', 'utf8')

const MAPPING_MARKER = 'Sheetbase components host mapping (COMP-05).'

function mappingBlock(): string {
  const start = styles.indexOf(MAPPING_MARKER)
  if (start === -1) {
    throw new Error(
      'the sheetbase components host mapping is missing from src/styles.css',
    )
  }
  const end = styles.indexOf('@theme inline', start)
  // The marker sits inside the mapping's own comment, so slice from the
  // comment's opening. Comments are prose, not declarations: `--border:
  // var(--border)` appears in the explanation of why that binding is invalid.
  const commentStart = styles.lastIndexOf('/*', start)
  const block = styles.slice(
    commentStart === -1 ? start : commentStart,
    end === -1 ? undefined : end,
  )
  return block.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Package variable → the ELN token (or host alias) it must resolve to. */
const EXPECTED_BINDINGS: Record<string, string> = {
  '--font-sans': '--sb-host-font-sans',
  '--font-mono': '--sb-host-font-mono',
  '--app': '--background',
  '--canvas': '--background',
  '--panel': '--card',
  '--panel-2': '--sb-host-muted-surface',
  '--surface': '--card',
  '--surface-muted': '--sb-host-muted-surface',
  '--surface-hover': '--sb-host-hover-surface',
  '--text': '--foreground',
  '--muted': '--muted-foreground',
  '--faint': '--faint-foreground',
  '--accent': '--primary',
  '--accent-dark': '--primary-hover',
  '--accent-ink': '--primary',
  '--accent-soft': '--selection',
  '--accent-soft-2': '--selection-subtle',
  '--focus': '--ring',
  '--on-accent': '--primary-foreground',
  '--green': '--success',
  '--green-text': '--success-text',
  '--green-soft': '--success-wash',
  '--orange': '--warning',
  '--orange-text': '--warning-text',
  '--orange-soft': '--warning-wash',
  '--blue': '--info',
  '--purple': '--review',
  '--purple-soft': '--review-wash',
  '--danger': '--destructive',
  '--danger-soft': '--danger-wash',
  '--series-a': '--chart-1',
  '--series-b': '--chart-2',
  '--series-c': '--chart-3',
  '--chart-label': '--muted-foreground',
  '--chart-anchor': '--foreground',
  '--shadow': '--shadow-overlay',
}

describe('sheetbase components stylesheet consumption (COMP-05)', () => {
  it('loads the package stylesheet before the v3 preset it must follow', () => {
    const tableStyles = styles.indexOf(
      "@import '@sheetbase-labs/sheetbase-table/styles.css'",
    )
    const filterStyles = styles.indexOf(
      "@import '@sheetbase-labs/sheetbase-advanced-search/styles.css' layer(sheetbase)",
    )
    const v3Preset = styles.indexOf(
      "@import '@sheetbase-labs/sheetbase-shared/themes/v3.css'",
    )

    expect(tableStyles).toBeGreaterThan(-1)
    expect(filterStyles).toBeGreaterThan(tableStyles)
    expect(v3Preset).toBeGreaterThan(filterStyles)
    expect(v3Preset).toBeGreaterThan(tableStyles)
  })

  it('binds every package variable onto an ELN token', () => {
    const block = mappingBlock()

    for (const [variable, token] of Object.entries(EXPECTED_BINDINGS)) {
      expect(block).toMatch(new RegExp(`${variable}:\\s*var\\(${token}\\)`))
    }
  })

  it('reads ELN values the package scope reshapes through host aliases', () => {
    // `--muted` and `--accent` are rebound on the scope (package meaning:
    // text colour, interaction colour), so their ELN values are captured on
    // :root where the scope cannot shadow them.
    expect(styles).toMatch(/--sb-host-muted-surface:\s*var\(--muted\)/)
    expect(styles).toMatch(/--sb-host-hover-surface:\s*var\(--accent\)/)
    expect(styles).toMatch(/--sb-host-font-sans:\s*var\(--font-sans\)/)
    expect(styles).toMatch(/--sb-host-font-mono:\s*var\(--font-mono\)/)
  })

  it('never self-references a variable (which is invalid CSS)', () => {
    const block = mappingBlock()
    const pairs = block.matchAll(/(--[a-z0-9-]+):\s*var\((--[a-z0-9-]+)\)/g)

    for (const [, variable, token] of pairs) {
      expect(token).not.toBe(variable)
    }
  })

  it('only references tokens declared in this stylesheet', () => {
    const block = mappingBlock()
    const referenced = new Set(
      [...block.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(([, token]) => token),
    )

    expect(referenced.size).toBeGreaterThan(0)
    for (const token of referenced) {
      expect(styles).toContain(`${token}:`)
    }
  })

  it('applies at higher specificity than the package presets', () => {
    const block = mappingBlock()

    expect(block).toMatch(/:root \.sheetbase-scope,/)
    expect(block).toMatch(/:root \.sheetbase-explorer \{/)
  })
})
