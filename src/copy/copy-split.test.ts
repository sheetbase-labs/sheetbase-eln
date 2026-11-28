import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sectionsIn } from '../../scripts/lib/copy-split.mjs'
import { en } from './en'

/**
 * The browser build ships each catalogue section with the modules that name
 * it (scripts/lib/copy-split.mjs). These checks keep every key findable.
 */
const SRC = join(import.meta.dirname, '..')

const sections = new Set(
  Object.entries(en).flatMap(([namespace, tree]) =>
    namespace === 'common'
      ? []
      : Object.keys(tree).map((section) => `${namespace}.${section}`),
  ),
)

function sourceFiles(dir: string): Array<string> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory())
      return path.endsWith('/copy') ? [] : sourceFiles(path)

    return /\.tsx?$/.test(entry.name) &&
      !/\.(test|stories|d)\.tsx?$/.test(entry.name)
      ? [path]
      : []
  })
}

const KEY_CALL = /\b(?:t|rich)\(\s*`([^`]*)`/g

describe('copy split', () => {
  it('keeps every section to plain data the build can copy', () => {
    expect(JSON.parse(JSON.stringify(en))).toEqual(en)
  })

  it('names the section of every key built from parts', () => {
    const unnamed: Array<string> = []

    for (const file of sourceFiles(SRC)) {
      const code = readFileSync(file, 'utf8')

      for (const [, key] of code.matchAll(KEY_CALL)) {
        const head = key.split('${')[0]

        if (head.startsWith('common.')) continue

        const named =
          head === ''
            ? // `${PREFIX}.rest`: the prefix is a constant written out in the file.
              sectionsIn(code, sections).size > 0
            : sectionsIn(`'${head}`, sections).size > 0

        if (!named) unnamed.push(`${relative(SRC, file)}: \`${key}\``)
      }
    }

    expect(unnamed).toEqual([])
  })
})
