import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Storybook coverage guard (ADR-0055).
 *
 * Every component module in the forward kit, in the adopted registry directory
 * and in the two icon surfaces must be exercised by a story, or be recorded as a
 * deliberate skip in `docs/development/storybook-coverage.md`. Storybook is
 * checked nowhere else: a component with no story renders nowhere, and before
 * this guard the only way to notice was to read the catalogue by hand.
 *
 * Two things are deliberately *not* how this works:
 *
 * - A story file whose *name* matches the component is not coverage. The legacy
 *   kit and the forward kit both have a Sheet, a Table, a Dialog and a Kbd, so
 *   `Sheet.stories.tsx` importing `#/components/ui/sheet` says nothing about
 *   `#/components/v3/ui/sheet`. The check is on the module a story imports.
 * - A support import counts. A story that composes `Button` as a fixture is
 *   exercising `button.tsx` in Storybook, which is what this guard is for.
 *
 * The unit is the module, not each export: a module is what a story covers and
 * what the record names.
 */

const ROOT = process.cwd()
const RECORD = join(ROOT, 'docs/development/storybook-coverage.md')

/** The surfaces this guard owns: the forward kit, the registry copies, the icons. */
const SCOPE = [
  'src/components/v3/ui',
  'src/components/reui',
  'src/components/icons',
]
const ICON_MODULES = ['src/components/v3/icons.tsx']

/** Where every skip is recorded, as the heading the guard reads. */
const RECORD_HEADING = '## Forward kit, registry and icons'

const ADOPTION_GUARD = 'src/components/v3/ui/component-adoption.test.ts'
const THIS_FILE = 'src/components/story-coverage.test.ts'

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path)
  }
  return out
}

/**
 * The names a module exports as values. Type-only exports are dropped: a type
 * has no rendered surface, so `export interface DataGridI18nLabels` is not a
 * component and `export type { Foo }` is not a re-export of one.
 */
function exportedValueNames(source: string): string[] {
  const names = new Set<string>()
  const declaration =
    /^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm
  for (const match of source.matchAll(declaration)) names.add(match[1])
  for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(',')) {
      const clause = part.trim()
      if (!clause || clause.startsWith('type ')) continue
      const name = clause
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
      if (name) names.add(name)
    }
  }
  return [...names]
}

/** A module in scope that renders something: it exports a component-shaped value. */
function isComponentModule(path: string): boolean {
  const source = readFileSync(join(ROOT, path), 'utf8')
  return exportedValueNames(source).some((name) => /^[A-Z]/.test(name))
}

/** Every story file the Storybook config picks up. */
function storyFiles(): string[] {
  const stories: string[] = []
  for (const root of ['src/stories', 'src/components']) {
    for (const path of walk(join(ROOT, root))) {
      if (path.endsWith('.stories.tsx')) stories.push(relative(ROOT, path))
    }
  }
  return stories
}

/**
 * The module specifiers a story imports. Bare `#/…` and repo-relative forms are
 * both accepted; an index module is reachable by its directory, because
 * `import { Icon } from '#/components/icons'` resolves to `icons/index.tsx`.
 */
function importedSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    specifiers.push(match[1])
  }
  return specifiers
}

function specifierForms(path: string): string[] {
  const withoutExtension = path.replace(/\.tsx?$/, '')
  const forms = new Set<string>([`#/${withoutExtension}`])
  if (withoutExtension.startsWith('src/')) {
    forms.add(`#/${withoutExtension.slice('src/'.length)}`)
  }
  if (withoutExtension.endsWith('/index')) {
    forms.add(`#/${withoutExtension.slice(0, -'/index'.length)}`)
    if (withoutExtension.startsWith('src/')) {
      forms.add(`#/${withoutExtension.slice('src/'.length, -'/index'.length)}`)
    }
  }
  return [...forms]
}

/** The component modules this guard owns, as repo-relative paths, sorted. */
function componentModules(): string[] {
  const modules = new Set<string>()
  for (const root of SCOPE) {
    for (const path of walk(join(ROOT, root))) {
      const repoPath = relative(ROOT, path)
      if (/\.test\.tsx?$|\.stories\.tsx$/.test(repoPath)) continue
      if (repoPath === ADOPTION_GUARD || repoPath === THIS_FILE) continue
      if (isComponentModule(repoPath)) modules.add(repoPath)
    }
  }
  for (const path of ICON_MODULES) {
    if (isComponentModule(path)) modules.add(path)
  }
  return [...modules].sort()
}

/** Modules named by a story, keyed however the story spells the import. */
function modulesWithStories(): Set<string> {
  const covered = new Set<string>()
  const stories = storyFiles()
  const sources = stories.map((story) =>
    readFileSync(join(ROOT, story), 'utf8'),
  )
  for (const path of componentModules()) {
    const forms = specifierForms(path)
    if (
      sources.some((source) =>
        importedSpecifiers(source).some((s) => forms.includes(s)),
      )
    ) {
      covered.add(path)
    }
  }
  return covered
}

/**
 * The skip table in the record, under the kit/registry/icons heading: one row
 * per module, keyed by its repo-relative path in the first column.
 */
function recordedSkips(): Map<string, string> {
  const record = readFileSync(RECORD, 'utf8')
  const start = record.indexOf(RECORD_HEADING)
  if (start === -1) {
    throw new Error(
      `${RECORD} has no "${RECORD_HEADING}" heading. The guard reads its skip ` +
        'table from that section; restore the heading or update RECORD_HEADING.',
    )
  }
  const rest = record.slice(start + RECORD_HEADING.length)
  // Stop at the next heading of any level: the sub-section below this table
  // names non-component modules, which the guard never asks about.
  const end = rest.search(/\n#{2,3} /)
  const section = end === -1 ? rest : rest.slice(0, end)

  const skips = new Map<string, string>()
  for (const line of section.split('\n')) {
    const row = line.match(/^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|\s*$/)
    if (!row) continue
    const [, path, reason] = row
    if (path === 'Module' || /^-+$/.test(path)) continue
    skips.set(path, reason)
  }
  return skips
}

const REMEDIATION = [
  'Add a story for it, or record why it needs none.',
  '',
  '  A story goes in src/stories/<Name>.stories.tsx and must import the module:',
  "      import { Thing } from '#/components/v3/ui/thing'",
  '  A story that merely has the same file name as the component is not',
  '  coverage — the legacy kit and the forward kit have components of the same',
  '  name. Given the two kits, give a forward-kit story the title',
  "  'v3 kit/<Name>' and a registry story 'UI/<Name>'.",
  '',
  `  A recorded skip goes in ${relative(ROOT, RECORD)} under`,
  `  "${RECORD_HEADING}", as one row:`,
  '      | `src/components/…/thing.tsx` | Why nothing renders. |',
  '  Hooks, providers that render children unchanged, type-only modules and',
  '  pure helpers are the skips that belong there.',
].join('\n')

describe('storybook coverage', () => {
  const modules = componentModules()
  const covered = modulesWithStories()
  const skips = recordedSkips()

  it('covers every component module in the kit, the registry and the icons', () => {
    const uncovered = modules.filter(
      (path) => !covered.has(path) && !skips.has(path),
    )

    expect(
      uncovered,
      uncovered.length
        ? `${uncovered.length} component module(s) have neither a story nor a ` +
            `recorded skip:\n\n${uncovered.map((p) => `  - ${p}`).join('\n')}\n\n${REMEDIATION}`
        : undefined,
    ).toEqual([])
  })

  it('records no skip that is no longer needed', () => {
    // The same anti-rot rule as the adoption guard: a recorded skip fails as
    // soon as its reason stops being true, so the table cannot quietly become a
    // blanket exemption.
    const stale = [...skips.keys()].filter(
      (path) => covered.has(path) || !modules.includes(path),
    )

    expect(
      stale,
      stale.length
        ? `These entries in ${relative(ROOT, RECORD)} are no longer skips — ` +
            `either the module now has a story, so the entry should go, or the ` +
            `file no longer exists:\n\n${stale.map((p) => `  - ${p}`).join('\n\n')}`
        : undefined,
    ).toEqual([])
  })

  it('finds the surfaces it is meant to guard', () => {
    // A rename or a move that empties the scope would otherwise pass silently:
    // no modules means no failures.
    expect(modules.length).toBeGreaterThan(50)
  })
})
