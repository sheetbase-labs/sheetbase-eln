import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Base UI's `Menu.GroupLabel` reads `MenuGroupContext` and throws without it —
 * "MenuGroupContext is missing" — which unmounts the page. The Projects
 * Fields/Filter menus and the export menu both died that way, and the crash is
 * only reachable by *opening* the menu, so a test that renders a surface
 * without opening its menus cannot see it. This scan is the guard.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, out)
    else if (/\.tsx$/.test(path) && !/\.test\.tsx$/.test(path)) out.push(path)
  }
  return out
}

/** Line numbers of labels rendered outside a `<DropdownMenuGroup>` in the file. */
function ungroupedLabels(source: string): number[] {
  const offenders: number[] = []
  const token =
    /<DropdownMenuGroup\b|<\/DropdownMenuGroup>|<DropdownMenuLabel\b/g
  let depth = 0
  for (const match of source.matchAll(token)) {
    const text = match[0]
    if (text.startsWith('</')) {
      depth -= 1
      continue
    }
    if (text.startsWith('<DropdownMenuGroup')) {
      depth += 1
      continue
    }
    if (depth <= 0) {
      offenders.push(source.slice(0, match.index).split('\n').length)
    }
  }
  return offenders
}

describe('dropdown menu labels', () => {
  it('keeps every label inside a group, so opening the menu cannot throw', () => {
    const offenders = sourceFiles('src').flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return ungroupedLabels(source).map((line) => `${file}:${line}`)
    })

    expect(offenders).toEqual([])
  })
})
