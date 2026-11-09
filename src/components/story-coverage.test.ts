import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Storybook coverage guard (ADR-0055).
 *
 * Every component module under src/components must be exercised by a story, or be recorded as a
 * deliberate skip in `docs/development/storybook-coverage.md`. Storybook is
 * checked nowhere else: a component with no story renders nowhere, and before
 * this guard the only way to notice was to read the catalogue by hand.
 *
 * Two things are deliberately *not* how this works:
 *
 * - A story file whose *name* matches the component is not coverage. The check
 *   is on the module a story imports.
 * - A support import counts. A story that composes `Button` as a fixture is
 *   exercising `button.tsx` in Storybook, which is what this guard is for.
 *
 * The unit is the module, not each export: a module is what a story covers and
 * what the record names.
 */

const ROOT = process.cwd()
const RECORD = join(ROOT, 'docs/development/storybook-coverage.md')

/** The surfaces this guard owns: every component under src/components. */
const SCOPE = ['src/components']

const ICON_MODULES: string[] = []

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

      if (repoPath === THIS_FILE) continue

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
 * The skips in the record: the rows of every `| Module | Why no story |` table,
 * in any section, keyed by the module's repo-relative path. Other tables are
 * notes for readers and are not read here.
 */
function recordedSkips(): Map<string, string> {
  const record = readFileSync(RECORD, 'utf8')
  const skips = new Map<string, string>()
  let inSkipTable = false

  for (const line of record.split('\n')) {
    if (!line.startsWith('|')) {
      inSkipTable = false
      continue
    }

    if (/^\|\s*Module\s*\|\s*Why no story\s*\|\s*$/.test(line)) {
      inSkipTable = true
      continue
    }

    if (!inSkipTable) continue
    const row = line.match(/^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|\s*$/)

    if (row) skips.set(row[1], row[2])
  }

  return skips
}

const REMEDIATION = [
  'Add a story for it, or record why it needs none.',
  '',
  '  A story goes in src/stories/<Name>.stories.tsx and must import the module:',
  "      import { Thing } from '#/components/ui/thing'",
  '  A story that merely has the same file name as the component is not',
  "  coverage. Give a kit story the title 'UI/<Name>' and a registry copy",
  "  'UI/Registry <Name>'.",
  '',
  `  A recorded skip goes in ${relative(ROOT, RECORD)}, in the section`,
  '  for its area, as one row of a "| Module | Why no story |" table:',
  '      | `src/components/…/thing.tsx` | Why nothing renders. |',
  '  Hooks, providers that render children unchanged, type-only modules and',
  '  pure helpers are the skips that belong there.',
].join('\n')

describe('storybook coverage', () => {
  const modules = componentModules()
  const covered = modulesWithStories()
  const skips = recordedSkips()

  it('covers every component module', () => {
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
    expect(modules.length).toBeGreaterThan(400)
  })
})
