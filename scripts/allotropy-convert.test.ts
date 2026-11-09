/**
 * The Allotrope converter runs inside the Python runtime image; these tests run
 * the same script with the host's Python. They are skipped when the host has no
 * Python with `allotropy` installed.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const WORKER = 'docker/pipeline-python/worker.py'

const SCRIPT = readFileSync(
  'docker/pipeline-python/converters/allotropy_convert.py',
  'utf8',
)

const FIXTURE = readFileSync('tests/fixtures/instrument-data/qubit4-dsdna.csv')

const available =
  spawnSync('python3', ['-c', 'import allotropy, pandas']).status === 0

function run(
  inputs: { file?: Array<{ name: string; content_b64: string }> },
  parameters: { mode: 'vendors' | 'convert'; vendor?: string },
) {
  // Not isolated mode: that ignores PYTHONPATH, which a host install may need.
  const result = spawnSync('python3', [WORKER], {
    input: JSON.stringify({ statement: SCRIPT, inputs, parameters }),
    encoding: 'utf8',
  })

  return z
    .object({
      rows: z
        .array(
          z.object({
            key: z.string().optional(),
            technique: z.string().optional(),
            measurements: z.number().optional(),
            manifest: z.string().optional(),
            converter: z.string().optional(),
            device: z.record(z.string(), z.json()).optional(),
            table: z.array(z.record(z.string(), z.json())).optional(),
            columns: z.array(z.string()).optional(),
          }),
        )
        .optional(),
      error: z.string().optional(),
    })
    .parse(JSON.parse(result.stdout))
}

describe.skipIf(!available)('Allotrope converter script', () => {
  it('lists the converters the image offers, without the example one', () => {
    const { rows } = run({}, { mode: 'vendors' })
    const keys = rows!.map((row) => row.key)
    expect(keys).toContain('THERMO_FISHER_QUBIT4')
    expect(keys).toContain('MOLDEV_SOFTMAX_PRO')
    expect(keys.some((key) => String(key).startsWith('EXAMPLE'))).toBe(false)
    expect(rows![0]).toHaveProperty('technique')
  })

  it('converts a Qubit export to an ASM document and a flat table', () => {
    const { rows } = run(
      {
        file: [
          {
            name: 'qubit4-dsdna.csv',
            content_b64: FIXTURE.toString('base64'),
          },
        ],
      },
      { mode: 'convert', vendor: 'THERMO_FISHER_QUBIT4' },
    )

    const row = rows![0]
    expect(row.technique).toBe('spectrophotometry')
    expect(row.measurements).toBe(2)
    expect(row.manifest).toContain('allotrope.org')
    expect(row.converter).toBe('allotropy')
    expect(row.device).toMatchObject({ 'model number': 'Qubit 4' })
    const table = row.table!
    expect(table).toHaveLength(2)
    expect(table[0]).toMatchObject({
      'sample document sample identifier': 'Control A',
      fluorescence: '5432.1',
      'fluorescence unit': 'RFU',
    })
    // Identifiers that change on every conversion stay out of the table, so
    // converting a file twice gives the same rows.
    expect(row.columns).not.toContain('measurement identifier')
  })

  it('recognises the vendor when none is chosen', () => {
    const { rows } = run(
      {
        file: [{ name: 'q.csv', content_b64: FIXTURE.toString('base64') }],
      },
      { mode: 'convert' },
    )

    expect(rows![0].technique).toBe('spectrophotometry')
  })

  it('fails with the converter’s own words for a file it cannot read', () => {
    const { error } = run(
      {
        file: [
          {
            name: 'x.csv',
            content_b64: Buffer.from('a,b\n1,2\n').toString('base64'),
          },
        ],
      },
      { mode: 'convert', vendor: 'THERMO_FISHER_QUBIT4' },
    )

    expect(error).toBeTruthy()
  })

  it('refuses more or fewer than one file', () => {
    expect(run({ file: [] }, { mode: 'convert' }).error).toMatch(/exactly one/)
  })
})
