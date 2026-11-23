/**
 * The pipeline configuration rules live twice: in `src/lib/pipelines/config.ts`
 * (the authoring page and the executor) and in the database
 * (`api.pipeline_config_errors`, `api.pipeline_run_request_errors` and the
 * `runs` column of `internal.pipeline_step_kinds`). This suite puts the same
 * configurations and run requests through both and fails, naming the case,
 * when one accepts what the other refuses.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  PIPELINE_STEP_KINDS,
  stepRuns,
  validatePipelineConfig,
  validatePipelineRunRequest,
} from '#/lib/pipelines/config'
import type { PipelineConfig } from '#/lib/pipelines/config'
import { prepareTestDatabase } from './helpers'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
})

afterAll(async () => {
  await migrator?.end()
})

function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    configVersion: 2,
    mode: 'standard',
    parameters: [],
    inputs: [],
    steps: [{ name: 'analysis', kind: 'sql', statement: 'select 1 as x' }],
    output: { mode: 'none' },
    ...over,
  }
}

describe('step kinds', () => {
  it('stepRuns gives what the registry says for every kind', async () => {
    const { rows } = await migrator.query<{ kind: string; runs: string }>(
      `select kind, runs from internal.pipeline_step_kinds`,
    )
    const registry = new Map(rows.map((row) => [row.kind, row.runs]))

    for (const kind of PIPELINE_STEP_KINDS) {
      expect(
        registry.get(kind),
        `step kind ${kind}: add it to internal.pipeline_step_kinds, or fix stepRuns in src/lib/pipelines/config.ts`,
      ).toBe(stepRuns(kind))
    }
  })

  it('the registry holds no kind the page does not know', async () => {
    const { rows } = await migrator.query<{ kind: string }>(
      `select kind from internal.pipeline_step_kinds`,
    )
    const known = new Set<string>(PIPELINE_STEP_KINDS)

    expect(
      rows.map((row) => row.kind).filter((kind) => !known.has(kind)),
      'internal.pipeline_step_kinds has kinds missing from PIPELINE_STEP_KINDS (src/lib/pipelines/config.ts)',
    ).toEqual([])
  })
})

describe('a configuration is accepted by the page exactly when the database accepts it', () => {
  const cases: Array<[string, unknown]> = [
    ['a plain SQL step', base()],
    [
      'a text parameter',
      base({ parameters: [{ name: 'label', type: 'text', required: true }] }),
    ],
    [
      'an unknown parameter type',
      base({ parameters: [{ name: 'label', type: 'uuid', required: true }] }),
    ],
    [
      'a badly named parameter',
      base({ parameters: [{ name: 'Label', type: 'text', required: true }] }),
    ],
    [
      'two parameters with one name',
      base({
        parameters: [
          { name: 'label', type: 'text', required: true },
          { name: 'label', type: 'integer', required: false },
        ],
      }),
    ],
    ['an input', base({ inputs: [{ name: 'plate', required: true }] })],
    [
      'a badly named input',
      base({ inputs: [{ name: 'Plate', required: true }] }),
    ],
    [
      'two inputs with one name',
      base({
        inputs: [
          { name: 'plate', required: true },
          { name: 'plate', required: true },
        ],
      }),
    ],
    ['no steps', base({ steps: [] })],
    [
      'an unknown step kind',
      base({ steps: [{ name: 'a', kind: 'teleport', statement: 'select 1' }] }),
    ],
    [
      'two steps with one name',
      base({
        steps: [
          { name: 'a', kind: 'sql', statement: 'select 1 as x' },
          { name: 'a', kind: 'sql', statement: 'select 2 as x' },
        ],
      }),
    ],
    [
      'an empty statement',
      base({ steps: [{ name: 'a', kind: 'sql', statement: '' }] }),
    ],
    ['a wrong config version', base({ configVersion: 1 })],
    ['not an object', []],
  ]

  for (const [label, value] of cases) {
    it(label, async () => {
      const page = validatePipelineConfig(value).length === 0
      const { rows } = await migrator.query<{ e: unknown[] }>(
        `select api.pipeline_config_errors($1::jsonb) as e`,
        [JSON.stringify(value)],
      )
      const database = rows[0].e.length === 0

      expect(
        database,
        `${label}: the page ${page ? 'accepts' : 'refuses'} it and the database ${database ? 'accepts' : 'refuses'} it. validatePipelineConfig (src/lib/pipelines/config.ts) and api.pipeline_config_errors have drifted`,
      ).toBe(page)
    })
  }
})

describe('a run request is accepted by the page exactly when the database accepts it', () => {
  const config = base({
    parameters: [
      { name: 'label', type: 'text', required: true },
      { name: 'count', type: 'integer', required: false },
      { name: 'ratio', type: 'decimal', required: false },
      { name: 'flag', type: 'boolean', required: false },
      { name: 'day', type: 'date', required: false },
      { name: 'at', type: 'timestamp', required: false },
    ],
  })
  const cases: Array<[string, unknown]> = [
    ['only the required parameter', { label: 'a' }],
    ['the required one missing', {}],
    ['an undeclared parameter', { label: 'a', extra: 1 }],
    ['text given a number', { label: 1 }],
    ['an integer', { label: 'a', count: 3 }],
    ['an integer given a fraction', { label: 'a', count: 3.5 }],
    ['an integer given text', { label: 'a', count: '3' }],
    ['a decimal given a fraction', { label: 'a', ratio: 0.5 }],
    ['a decimal given text', { label: 'a', ratio: '0.5' }],
    ['a boolean', { label: 'a', flag: true }],
    ['a boolean given text', { label: 'a', flag: 'true' }],
    ['a date', { label: 'a', day: '2026-11-23' }],
    ['a date written another way', { label: 'a', day: '23/11/2026' }],
    ['a timestamp', { label: 'a', at: '2026-11-23T09:00:00Z' }],
    ['a timestamp given a number', { label: 'a', at: 5 }],
    ['parameters that are a list', []],
  ]

  for (const [label, parameters] of cases) {
    it(label, async () => {
      const page =
        validatePipelineRunRequest(
          config as unknown as PipelineConfig,
          parameters,
          {},
        ).length === 0
      const { rows } = await migrator.query<{ e: unknown[] }>(
        `select api.pipeline_run_request_errors($1::jsonb, $2::jsonb, '{}'::jsonb) as e`,
        [JSON.stringify(config), JSON.stringify(parameters)],
      )
      const database = rows[0].e.length === 0

      expect(
        database,
        `${label}: the page ${page ? 'accepts' : 'refuses'} it and the database ${database ? 'accepts' : 'refuses'} it. validatePipelineRunRequest (src/lib/pipelines/config.ts) and api.pipeline_run_request_errors have drifted`,
      ).toBe(page)
    })
  }

  it('a declared input with no version', async () => {
    const withInput = base({ inputs: [{ name: 'plate', required: true }] })
    const page =
      validatePipelineRunRequest(withInput as unknown as PipelineConfig, {}, {})
        .length === 0
    const { rows } = await migrator.query<{ e: unknown[] }>(
      `select api.pipeline_run_request_errors($1::jsonb, '{}'::jsonb, '{}'::jsonb) as e`,
      [JSON.stringify(withInput)],
    )

    expect(rows[0].e.length === 0).toBe(page)
  })
})
