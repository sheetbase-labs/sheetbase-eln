import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Run button posts to an API route; it once pointed at a path no route
 * served, and the page answered with HTML instead of the result.
 */
describe('analysis from a plugin', () => {
  it('posts to a route that exists', () => {
    const source = readFileSync(
      join(__dirname, 'extension-analysis.tsx'),
      'utf8',
    )

    const paths = [...source.matchAll(/fetch\('(\/api\/[^']+)'/g)].map(
      (match) => match[1],
    )

    expect(paths).toEqual(['/api/plugins/run'])

    for (const path of paths) {
      const file = path.replace('/api/', '').replaceAll('/', '.')
      expect(
        existsSync(join(__dirname, '../../routes/api', `${file}.ts`)),
      ).toBe(true)
    }
  })
})
