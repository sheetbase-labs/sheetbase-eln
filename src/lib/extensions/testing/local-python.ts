/**
 * Test helper: runs a Python step through the same worker the isolated runner
 * runs (`docker/pipeline-python/worker.py`), as a local process. It gives the
 * plugin tests a real end-to-end run without Docker. Not isolated, test only.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { PipelinePythonError } from '../../pipeline-python.server'
import type {
  PythonTransformInput,
  PythonTransformResult,
} from '../../pipeline-python.server'

const root = path.resolve(__dirname, '../../../..')
const worker = path.join(root, 'docker/pipeline-python/worker.py')

export const pluginExamplesDir = path.join(root, 'sdks/plugin-python/examples')

export const pythonAvailable = (() => {
  const probe = spawnSync('python3', ['-c', 'import pandas, numpy'])
  return probe.status === 0
})()

export async function localPython(
  input: PythonTransformInput,
): Promise<PythonTransformResult> {
  const run = spawnSync('python3', ['-I', worker], {
    input: JSON.stringify({
      statement: input.statement,
      inputs: input.inputs,
      parameters: input.parameters,
      contract: input.contract,
      requirements: input.requirements,
    }),
    encoding: 'utf8',
    timeout: 30_000,
  })
  const result = JSON.parse(run.stdout) as {
    rows?: Record<string, unknown>[]
    logs?: string[]
    error?: string
  }
  if (run.status !== 0 || result.error)
    throw new PipelinePythonError(
      result.error ?? 'Python failed.',
      'transform_failed',
    )
  return {
    rows: result.rows ?? [],
    logs: result.logs ?? [],
    runtime: 'local',
  }
}

/**
 * The files of an example plugin folder that belong in a package, as
 * `{ path: text }`: the manifest, `python/`, `ui/` and the readme and licence.
 * Sources such as `ui-src/` and `node_modules` stay out, as `pack` leaves them.
 */
export function readExample(name: string): Record<string, string> {
  const base = path.join(pluginExamplesDir, name)
  const files: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (entry === '__pycache__' || entry === 'node_modules') continue
      if (statSync(full).isDirectory()) walk(full)
      else {
        const rel = path.relative(base, full).split(path.sep).join('/')
        const top = rel.split('/')[0]
        if (
          top === 'python' ||
          top === 'ui' ||
          /^(plugin\.json|README\.md|LICENSE(\.md|\.txt)?)$/.test(rel)
        )
          files[rel] = readFileSync(full, 'utf8')
      }
    }
  }
  walk(base)
  return files
}
