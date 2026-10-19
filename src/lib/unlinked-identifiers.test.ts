import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A ratchet on identifiers shown as plain text.
 *
 * An identifier on screen ("EXP-0142", "DS-0311") should open the thing it
 * names, which is what `ObjectLink` is for. Some places show one as text on
 * purpose (a picker row, a heading for the page you are already on), so this
 * does not ban the pattern: it counts the one-line `<span className="mono">`
 * identifier shapes in `src` and fails if the count grows. Converting one to an
 * `ObjectLink` lets you lower `BASELINE`; adding a new one means either linking
 * it or raising the number with a reason in review.
 */
const BASELINE = 23

const SHAPE =
  /<span[^>]*mono[^>]*>\s*\{[^}]*(identifier|display_id|displayId)[^}]*\}/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    if (!path.endsWith('.tsx')) return []
    if (/\.(test|stories)\.tsx$/.test(path) || path.includes('/stories/'))
      return []
    return [path]
  })
}

describe('identifiers shown as plain text', () => {
  it('does not grow past the recorded baseline', () => {
    const found = sourceFiles('src').flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          SHAPE.test(line) ? [`${file}:${index + 1}`] : [],
        ),
    )
    expect(
      found.length,
      `Plain-text identifiers went from ${BASELINE} to ${found.length}. Link the new one with ObjectLink:\n${found.join('\n')}`,
    ).toBeLessThanOrEqual(BASELINE)
  })
})
