/**
 * Regenerate vectors.json from the TypeScript sequence tool:
 *   bun plugins/sequence-tools/test-vectors/generate.ts
 * Run this when the TypeScript maths changes on purpose, then make the Python match.
 */
import { writeFileSync } from 'node:fs'

import { runSequenceTool, sequenceToolSchema } from '../../../src/lib/molbio/tools'
import { buildCases } from './cases'

const out = buildCases().map(({ name, input }) => {
  const parsed = sequenceToolSchema.safeParse(input)
  if (!parsed.success) {
    return { name, input, rejected: parsed.error.issues[0]?.message ?? 'invalid' }
  }
  return { name, input, expected: runSequenceTool(parsed.data) }
})
writeFileSync(
  new URL('./vectors.json', import.meta.url),
  JSON.stringify(out, null, 1) + '\n',
)
console.log(`${out.length} cases`)
