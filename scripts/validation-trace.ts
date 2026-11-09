/**
 * Builds the requirements-to-test trace for the validation pack.
 *
 * Test files name the requirements they exercise with a line near the top:
 *
 *     // @requirement VAL-SIG-01, VAL-SIG-03
 *
 * This reads those lines and writes src/lib/validation/trace.generated.json, so
 * an installed copy (which has no tests/ folder) can still say which automated
 * tests cover each requirement. `--check` fails when the committed file is out
 * of date, which CI runs.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { REQUIREMENTS } from '../src/lib/validation/requirements'

const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, 'src/lib/validation/trace.generated.json')
const TAG = /^\s*(?:\/\/|\*)\s*@requirement\s+([A-Z0-9, -]+?)\s*$/m

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const path = join(dir, name)

    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.test\.tsx?$/.test(name)) out.push(path)
  }

  return out
}

export interface TraceEntry {
  requirement: string
  file: string
  layer: 'database' | 'browser' | 'unit'
  title: string
}

export function buildTrace(): TraceEntry[] {
  const known = new Set(REQUIREMENTS.map((r) => r.id))
  const entries: TraceEntry[] = []

  for (const root of ['tests', 'src']) {
    for (const file of walk(join(ROOT, root))) {
      const text = readFileSync(file, 'utf8')
      const head = text.split('\n').slice(0, 60).join('\n')
      const tag = TAG.exec(head)

      if (!tag) continue
      const rel = relative(ROOT, file)

      const title =
        /(?:describe|test)(?:\.\w+)?\(\s*['"`]([^'"`]+)['"`]/.exec(text)?.[1] ??
        rel

      const layer = rel.startsWith('tests/db/')
        ? 'database'
        : rel.startsWith('tests/browser/')
          ? 'browser'
          : 'unit'

      for (const id of tag[1].split(',').map((s) => s.trim())) {
        if (!known.has(id)) {
          throw new Error(`${rel} names an unknown requirement: ${id}`)
        }

        entries.push({ requirement: id, file: rel, layer, title })
      }
    }
  }

  return entries.sort(
    (a, b) =>
      a.requirement.localeCompare(b.requirement) ||
      a.file.localeCompare(b.file),
  )
}

if (process.argv[1]?.endsWith('validation-trace.ts')) {
  const next = JSON.stringify({ entries: buildTrace() }, null, 2) + '\n'

  if (process.argv.includes('--check')) {
    let current = ''

    try {
      current = readFileSync(OUT, 'utf8')
    } catch {
      // Missing counts as out of date.
    }

    if (current !== next) {
      console.error(
        'src/lib/validation/trace.generated.json is out of date: run `pnpm validation:trace`.',
      )
      process.exit(1)
    }

    console.log('validation trace is current')
  } else {
    writeFileSync(OUT, next)
    console.log(`wrote ${OUT}`)
  }
}
