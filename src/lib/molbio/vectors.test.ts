/**
 * The TypeScript sequence tool still gives the answers the Python port is tested
 * against. `plugins/sequence-tools/test-vectors/vectors.json` is written by
 * `generate.ts` from this code; `plugins/sequence-tools/tests/test_vectors.py`
 * replays the same file against the Python.
 */
import { describe, expect, it } from 'vitest'

import vectors from '../../../plugins/sequence-tools/test-vectors/vectors.json'
import { runSequenceTool, sequenceToolSchema } from './tools'

interface Vector {
  name: string
  input: unknown
  expected?: { ok: boolean; result: unknown }
  rejected?: string
}

describe('shared test vectors', () => {
  for (const v of vectors as Vector[]) {
    it(v.name, () => {
      const parsed = sequenceToolSchema.safeParse(v.input)
      if (v.rejected !== undefined) {
        expect(parsed.success).toBe(false)
        return
      }
      expect(parsed.success).toBe(true)
      if (!parsed.success) return
      const got = JSON.parse(JSON.stringify(runSequenceTool(parsed.data)))
      expect(got).toEqual(v.expected)
    })
  }
})
