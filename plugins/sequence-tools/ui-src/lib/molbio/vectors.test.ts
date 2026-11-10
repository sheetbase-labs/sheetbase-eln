/**
 * The TypeScript sequence tool still gives the answers the Python port is tested
 * against. `plugins/sequence-tools/test-vectors/vectors.json` is written by
 * `generate.ts` from this code; `plugins/sequence-tools/tests/test_vectors.py`
 * replays the same file against the Python.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import fingerprints from '../../../test-vectors/fingerprints.json'
import vectors from '../../../test-vectors/vectors.json'
import { canonicalSequence } from '../../../../../src/lib/sequence-fingerprint'
import { runSequenceTool, sequenceToolSchema } from './tools'

const json = z.json()

type JsonValue = z.infer<typeof json>

const vectorCases = z
  .array(
    z.object({
      name: z.string(),
      input: json,
      expected: json.optional(),
      rejected: z.string().optional(),
    }),
  )
  .parse(vectors)

const jsonArray = z.array(json)
const jsonObject = z.record(z.string(), json)

/** Equal, except that numbers may differ in the last bits (the maths library differs by machine). */
function expectClose(got: JsonValue, want: JsonValue, path = 'result'): void {
  const number = z.number().safeParse(want)

  if (number.success) {
    const actual = z.number().safeParse(got)
    expect(actual.success, path).toBe(true)

    if (!actual.success) return
    const diff = Math.abs(actual.data - number.data)
    expect(
      diff <= 1e-9 * Math.max(1, Math.abs(number.data)),
      `${path}: ${actual.data} vs ${number.data}`,
    ).toBe(true)

    return
  }

  const array = jsonArray.safeParse(want)

  if (array.success) {
    const actual = jsonArray.safeParse(got)
    expect(actual.success, path).toBe(true)

    if (!actual.success) return
    expect(actual.data.length, path).toBe(array.data.length)
    array.data.forEach((item, i) =>
      expectClose(actual.data[i], item, `${path}[${i}]`),
    )

    return
  }

  const object = jsonObject.safeParse(want)

  if (object.success) {
    const actual = jsonObject.safeParse(got)
    expect(actual.success, path).toBe(true)

    if (!actual.success) return
    expect(Object.keys(actual.data).sort(), path).toEqual(
      Object.keys(object.data).sort(),
    )

    for (const [key, value] of Object.entries(object.data))
      expectClose(actual.data[key], value, `${path}.${key}`)

    return
  }

  expect(got, path).toEqual(want)
}

describe('shared test vectors', () => {
  for (const v of vectorCases) {
    it(v.name, () => {
      const parsed = sequenceToolSchema.safeParse(v.input)

      if (v.rejected !== undefined) {
        expect(parsed.success).toBe(false)

        return
      }

      expect(parsed.success).toBe(true)
      expect(v.expected).toBeDefined()

      if (!parsed.success || v.expected === undefined) return
      // Compare the JSON representation shared with the Python port.
      const serialized = JSON.stringify(runSequenceTool(parsed.data))
      const got = json.parse(JSON.parse(serialized))
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
          z.enum(['dna', 'rna', 'protein']).parse(f.input.molecule),
          z.enum(['linear', 'circular']).parse(f.input.topology),
        ),
      ).toBe(f.canonical)
    })
  })
})
