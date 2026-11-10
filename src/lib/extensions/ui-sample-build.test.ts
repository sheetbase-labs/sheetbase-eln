// @vitest-environment node
/**
 * The sample plugin's checked-in `ui/` folder is exactly what its `ui-src/`
 * builds to, so the two cannot drift apart. Skipped where the sample's npm
 * libraries are not installed.
 */
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('the sample is built from its source', () => {
  const dir = path.resolve(
    __dirname,
    '../../../sdks/plugin-python/examples/sequence-tools',
  )

  const ready = existsSync(path.join(dir, 'ui-src/node_modules/d3-shape'))
  it.skipIf(!ready)(
    'rebuilding ui-src gives the checked-in ui folder',
    async () => {
      const work = mkdtempSync(path.join(tmpdir(), 'seq-tools-'))

      try {
        cpSync(path.join(dir, 'ui-src'), path.join(work, 'ui-src'), {
          recursive: true,
          dereference: true,
        })

        const {
          buildPluginUi,
        }: {
          buildPluginUi: (options: { dir: string }) => Promise<void>
        } = await import(
          // @ts-expect-error the build tool is plain JavaScript
          '../../../sdks/plugin-ui/build.mjs'
        )

        await buildPluginUi({ dir: work })
        const built = readdirSync(path.join(work, 'ui')).sort()
        expect(built).toEqual(readdirSync(path.join(dir, 'ui')).sort())

        for (const file of built)
          expect(readFileSync(path.join(work, 'ui', file), 'utf8'), file).toBe(
            readFileSync(path.join(dir, 'ui', file), 'utf8'),
          )
      } finally {
        rmSync(work, { recursive: true, force: true })
      }
    },
    60_000,
  )
})
