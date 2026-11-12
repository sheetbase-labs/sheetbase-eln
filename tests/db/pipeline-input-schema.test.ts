/**
 * AUTO — a pipeline input may name the Dataset Schema it expects. The Inputs
 * editor and the TypeScript contract allow `schemaId`; the database validator
 * must too, and must still refuse a value that is not a schema id.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validatePipelineConfig } from '#/lib/pipelines/config'

import { prepareTestDatabase } from './helpers'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
})

afterAll(async () => {
  await migrator.end()
})

const SCHEMA_ID = '00000000-0000-4000-8000-0000000000b1'

function config(input: Record<string, unknown>) {
  return {
    configVersion: 2,
    mode: 'standard',
    parameters: [],
    inputs: [input],
    steps: [{ name: 'analysis', kind: 'sql', statement: 'select 1 as x' }],
    output: { mode: 'none' },
  }
}

async function errors(value: unknown) {
  const { rows } = await migrator.query<{ e: Array<{ message: string }> }>(
    'SELECT api.pipeline_config_errors($1::jsonb) AS e',
    [JSON.stringify(value)],
  )
  return rows[0]!.e
}

describe('pipeline input schemaId', () => {
  it('accepts an input that names a Dataset Schema', async () => {
    const value = config({ name: 'plate', required: true, schemaId: SCHEMA_ID })
    expect(await errors(value)).toEqual([])
    expect(validatePipelineConfig(value)).toEqual([])
  })

  it('refuses a schemaId that is not an id, and unknown input keys', async () => {
    expect(
      (await errors(config({ name: 'plate', required: true, schemaId: 'x' })))
        .length,
    ).toBe(1)
    expect(
      (await errors(config({ name: 'plate', required: true, colour: 'red' })))
        .length,
    ).toBe(1)
  })
})
