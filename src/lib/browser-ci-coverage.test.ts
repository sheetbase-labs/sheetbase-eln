import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every browser test file runs in CI. The acceptance job lists its files by
 * hand (a file or a folder), and for a long while most files were left off, so
 * click-through tests ran for nobody. A new file under tests/browser that no
 * job names fails here, with the line to add.
 */
const ROOT = process.cwd()
const BROWSER_DIR = join(ROOT, 'tests', 'browser')

function browserTests(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) return browserTests(path)

    return entry.name.endsWith('.test.ts')
      ? [path.slice(ROOT.length + 1).replaceAll('\\', '/')]
      : []
  })
}

describe('browser tests in CI', () => {
  it('names every tests/browser file, or the folder it is in, in the acceptance job', () => {
    const workflow = readFileSync(
      join(ROOT, '.github', 'workflows', 'ci.yml'),
      'utf8',
    )

    const named = workflow.match(/tests\/browser\/[\w./-]*/g) ?? []

    const missing = browserTests(BROWSER_DIR).filter(
      (file) =>
        !named.some((name) =>
          name.endsWith('/') ? file.startsWith(name) : file === name,
        ) &&
        // The signing journeys run from their own config.
        file !== 'tests/browser/rev-03-signing.test.ts',
    )

    expect(missing).toEqual([])
  })

  it('runs the signing journeys in CI', () => {
    const workflow = readFileSync(
      join(ROOT, '.github', 'workflows', 'ci.yml'),
      'utf8',
    )

    expect(workflow).toMatch(
      /^\s+run: pnpm exec playwright test --config playwright\.signatures\.config\.ts/m,
    )
  })
})
