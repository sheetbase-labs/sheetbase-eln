import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Adoption guard (DSYS): once `src/components/v3/ui/<name>.tsx` exists, no app
 * file may import that component from the legacy `src/components/ui/<name>`,
 * either directly or through the `#/components/ui` barrel. The legacy set is
 * being removed file by file, and nothing else stops a duplicate import
 * reappearing the next time someone reaches for the familiar name.
 *
 * Test and story files are out of scope: the legacy story catalogue and the
 * legacy components' own tests are migrated by their own tasks.
 */

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const OLD_DIR = join(SRC, 'components/ui')
const V3_DIR = join(SRC, 'components/v3/ui')
const BARREL = '#/components/ui'

/**
 * Pairs deliberately left on the legacy module, each with the reason it is
 * still needed. An entry fails the test as soon as its file stops importing
 * the module, so the list cannot rot into a blanket exemption.
 */
const ALLOWED: ReadonlyArray<{
  readonly file: string
  readonly modules: readonly string[]
  readonly reason: string
}> = [
  {
    file: 'src/components/ui/input-group.tsx',
    modules: ['input'],
    reason:
      'No v3 input-group twin; the legacy group is adopted by its own task.',
  },
  {
    file: 'src/routes/foundations.tsx',
    modules: ['badge', 'tabs'],
    reason:
      'Dev-only review catalogue for the legacy kit (UI-001); the v3 Badge and Tabs are a different vocabulary and are not among the pairs this guard adopts.',
  },
]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path)
  }
  return out
}

/** Legacy modules the barrel re-exports, so a barrel import can reach them. */
function barrelModules(): Set<string> {
  const source = readFileSync(join(OLD_DIR, 'index.ts'), 'utf8')
  return new Set(
    [...source.matchAll(/export \* from '\.\/([a-z0-9-]+)'/g)].map((m) => m[1]),
  )
}

/** Names a legacy module exports, from its declarations and export lists. */
function exportedNames(source: string): Set<string> {
  const names = new Set<string>()
  for (const m of source.matchAll(
    /export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+([A-Za-z0-9_]+)/g,
  )) {
    names.add(m[1])
  }
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop()
      if (name) names.add(name.trim())
    }
  }
  return names
}

/** Legacy modules that have an adopted v3 twin and are re-exported by the barrel. */
function pairedModules(): string[] {
  const barrel = barrelModules()
  return readdirSync(V3_DIR)
    .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
    .map((f) => f.replace(/\.tsx$/, ''))
    .filter((name) => barrel.has(name))
    .filter((name) => {
      try {
        statSync(join(OLD_DIR, `${name}.tsx`))
        return true
      } catch {
        return false
      }
    })
    .sort()
}

/** name -> legacy modules (with a twin) that export it, for barrel imports. */
function buildNameIndex(pairs: readonly string[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const name of pairs) {
    const source = readFileSync(join(OLD_DIR, `${name}.tsx`), 'utf8')
    for (const exported of exportedNames(source)) {
      index.set(exported, [...(index.get(exported) ?? []), name])
    }
  }
  return index
}

type Finding = {
  readonly file: string
  readonly line: number
  readonly module: string
  readonly detail: string
}

function findDuplicates(
  pairs: readonly string[],
  nameIndex: Map<string, string[]>,
): Finding[] {
  const paired = new Set(pairs)
  const findings: Finding[] = []
  for (const path of walk(SRC)) {
    const rel = relative(ROOT, path)
    // App source only: tests and stories are migrated by their own tasks.
    if (
      rel.includes('.test.') ||
      rel.includes('.spec.') ||
      rel.endsWith('.stories.tsx')
    ) {
      continue
    }
    const source = readFileSync(path, 'utf8')
    // `import type` carries no component; named value imports are what ship.
    for (const m of source.matchAll(
      /(?<![.\w])import\s+(?!type\s)([^'"]*?)from\s+'([^']+)'/g,
    )) {
      const clause = m[1]
      const specifier = m[2]
      const line = source.slice(0, m.index).split('\n').length
      const namespace = /\*\s+as\s+/.test(clause)
      if (specifier === BARREL || specifier === `${BARREL}/index`) {
        if (namespace) {
          findings.push({
            file: rel,
            line,
            module: '*',
            detail: 'namespace import of the legacy barrel',
          })
          continue
        }
        const names = [...clause.matchAll(/([A-Za-z0-9_]+)/g)]
          .map((n) => n[1])
          .filter((n) => n !== 'as')
        for (const name of names) {
          for (const module of nameIndex.get(name) ?? []) {
            findings.push({
              file: rel,
              line,
              module,
              detail: `${name} from the legacy barrel`,
            })
          }
        }
        continue
      }
      if (!specifier.startsWith(`${BARREL}/`)) continue
      const module = specifier.slice(BARREL.length + 1)
      if (paired.has(module)) {
        findings.push({
          file: rel,
          line,
          module,
          detail: `${clause.trim()} from ${specifier}`,
        })
      }
    }
  }
  return findings
}

describe('v3 component adoption', () => {
  const pairs = pairedModules()

  it('has a legacy module to guard for every adopted twin', () => {
    expect(pairs.length).toBeGreaterThan(0)
  })

  it('keeps app code off legacy modules that have an adopted v3 twin', () => {
    const findings = findDuplicates(pairs, buildNameIndex(pairs))
    const violations = findings.filter(
      (f) =>
        !ALLOWED.some(
          (entry) => entry.file === f.file && entry.modules.includes(f.module),
        ),
    )
    const report = violations
      .map(
        (f) =>
          `${f.file}:${f.line} imports the legacy ${f.module} module (${f.detail}); use #/components/v3/ui/${f.module} or allow-list it with a reason`,
      )
      .join('\n')
    expect(report, `Legacy component imports found:\n${report}`).toBe('')
  })

  it('keeps the allow-list honest', () => {
    const findings = findDuplicates(pairs, buildNameIndex(pairs))
    const stale = ALLOWED.flatMap((entry) =>
      entry.modules
        .filter(
          (module) =>
            !findings.some((f) => f.file === entry.file && f.module === module),
        )
        .map(
          (module) =>
            `${entry.file} no longer imports the legacy ${module} module; remove that allow-list entry`,
        ),
    )
    expect(
      stale.join('\n'),
      `Stale allow-list entries:\n${stale.join('\n')}`,
    ).toBe('')
  })
})
