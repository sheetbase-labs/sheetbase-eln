/**
 * What a pipeline Python step gets is written in three places: the TypeScript
 * limits the app checks (`src/lib/pipeline-limits.ts`), the runner broker
 * (`scripts/pipeline-python-runner.mjs`) and the worker inside the container
 * (`docker/pipeline-python/worker.py`). They must agree, or the app lets a
 * request through that the broker refuses, or the other way round.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  EXECUTION_TIMEOUT_SECONDS,
  INPUT_FIELD_LIMIT,
  INPUT_ROW_LIMIT,
  PAYLOAD_BYTE_LIMIT,
  RESULT_CELL_LIMIT,
} from '../src/lib/pipeline-limits'
import { LIMITS } from './pipeline-python-runner.mjs'

const worker = readFileSync(
  new URL('../docker/pipeline-python/worker.py', import.meta.url),
  'utf8',
)

/** A Python constant such as `32 * 1024 * 1024` or `1_000_000`, evaluated. */
function pythonConstant(name: string): number {
  const match = new RegExp(`^${name}\\s*=\\s*([0-9_ *]+)$`, 'm').exec(worker)

  expect(
    match,
    `${name} is not set in docker/pipeline-python/worker.py`,
  ).not.toBeNull()

  return match![1]
    .split('*')
    .map((part) => Number(part.trim().replaceAll('_', '')))
    .reduce((product, part) => product * part, 1)
}

describe('pipeline Python limits', () => {
  it('the runner broker uses the limits the app checks', () => {
    expect(LIMITS.bytes).toBe(PAYLOAD_BYTE_LIMIT)
    expect(LIMITS.rows).toBe(INPUT_ROW_LIMIT)
    expect(LIMITS.fields).toBe(INPUT_FIELD_LIMIT)
    expect(LIMITS.cells).toBe(RESULT_CELL_LIMIT)
    expect(LIMITS.timeoutMs).toBe(EXECUTION_TIMEOUT_SECONDS * 1000)
  })

  it('the worker in the container uses the same limits', () => {
    expect(pythonConstant('MAX_BYTES')).toBe(PAYLOAD_BYTE_LIMIT)
    expect(pythonConstant('MAX_ROWS')).toBe(INPUT_ROW_LIMIT)
    expect(pythonConstant('MAX_FIELDS')).toBe(INPUT_FIELD_LIMIT)
    expect(pythonConstant('MAX_CELLS')).toBe(RESULT_CELL_LIMIT)
  })
})
