/**
 * Regenerate vectors.json from the TypeScript sequence tool:
 *   bun plugins/sequence-tools/test-vectors/generate.ts
 * Run this when the TypeScript maths changes on purpose, then make the Python match.
 */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'

import { canonicalSequence } from '../../../src/lib/sequence-fingerprint'

import { runSequenceTool, sequenceToolSchema } from '../ui-src/lib/molbio/tools'
import { buildCases, fingerprintCases } from './cases'

const out = buildCases().map(({ name, input }) => {
  const parsed = sequenceToolSchema.safeParse(input)

  if (!parsed.success) {
    return {
      name,
      input,
      rejected: parsed.error.issues[0]?.message ?? 'invalid',
    }
  }

  return { name, input, expected: runSequenceTool(parsed.data) }
})

writeFileSync(
  new URL('./vectors.json', import.meta.url),
  JSON.stringify(out, null, 1) + '\n',
)

console.log(`${out.length} cases`)

const fingerprints = fingerprintCases().map((input) => {
  const canonical = canonicalSequence(
    input.residues,
    input.molecule,
    input.topology,
  )

  return {
    input,
    canonical,
    fingerprint: `seq:${createHash('sha256').update(canonical).digest('hex')}`,
  }
})

writeFileSync(
  new URL('./fingerprints.json', import.meta.url),
  JSON.stringify(fingerprints, null, 1) + '\n',
)

console.log(`${fingerprints.length} fingerprints`)
