/**
 * The TypeScript sequence tool still gives the answers the Python port is tested
 * against. `plugins/sequence-tools/test-vectors/vectors.json` is written by
 * `generate.ts` from this code; `plugins/sequence-tools/tests/test_vectors.py`
 * replays the same file against the Python.
 */
import { describe, expect, it } from 'vitest'

import fingerprints from '../../../plugins/sequence-tools/test-vectors/fingerprints.json'
import vectors from '../../../plugins/sequence-tools/test-vectors/vectors.json'
import { canonicalSequence } from '../sequence-fingerprint'
import { runSequenceTool, sequenceToolSchema } from './tools'

interface Vector {
  name: string
  input: unknown
  expected?: { ok: boolean; result: unknown }
  rejected?: string
}

/** Equal, except that numbers may differ in the last bits (the maths library differs by machine). */
function expectClose(got: unknown, want: unknown, path = 'result'): void {
  if (typeof want === 'number') {
    expect(typeof got, path).toBe('number')
    const diff = Math.abs((got as number) - want)
    expect(
      diff <= 1e-9 * Math.max(1, Math.abs(want)),
      `${path}: ${got} vs ${want}`,
    ).toBe(true)
  } else if (Array.isArray(want)) {
    expect(Array.isArray(got), path).toBe(true)
    expect((got as unknown[]).length, path).toBe(want.length)
    want.forEach((w, i) =>
      expectClose((got as unknown[])[i], w, `${path}[${i}]`),
    )
  } else if (want !== null && typeof want === 'object') {
    const g = got as Record<string, unknown>
    expect(Object.keys(g).sort(), path).toEqual(Object.keys(want).sort())
    for (const [k, w] of Object.entries(want))
      expectClose(g[k], w, `${path}.${k}`)
  } else {
    expect(got, path).toEqual(want)
  }
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
      expectClose(got, v.expected)
    })
  }
})

describe('shared fingerprint vectors', () => {
  fingerprints.forEach((f, i) => {
    it(`canonical form ${i}`, () => {
      expect(
        canonicalSequence(
          f.input.residues,
          f.input.molecule as 'dna' | 'rna' | 'protein',
          f.input.topology as 'linear' | 'circular',
        ),
      ).toBe(f.canonical)
    })
  })
})
