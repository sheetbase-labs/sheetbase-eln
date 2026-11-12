import { describe, expect, it } from 'vitest'

import type { PipelineConfig, PipelineParameter } from './config'
import type { FilterForm } from './no-code/forms'
import { DEFAULT_START_RULES } from './start-rules'
import type { StartRules } from './start-rules'
import { noCodeStatement } from './no-code/generate'
import {
  applyFix,
  checkVersionFile,
  formatVersionFile,
  versionFileText,
} from './version-file'

const RUNTIME = `sheetbase-python:3.12@sha256:${'a'.repeat(64)}`

const check = (
  text: string,
  target: Parameters<typeof checkVersionFile>[1] = {},
) => checkVersionFile(text, { pythonRuntime: RUNTIME, ...target })

const META = { pipeline: 'PL-0021', version: 5, title: 'Titre trend' }

function filterStep(): PipelineConfig['steps'][number] {
  const form: FilterForm = {
    match: 'all',
    conditions: [{ column: 'turbidity', op: 'gt', value: '50' }],
  }

  const made = noCodeStatement('filter', form)

  if (!made.ok) throw new Error(made.reason)

  return {
    name: 'keep',
    kind: 'filter',
    form: structuredClone(form),
    statement: made.statement,
  }
}

function everything(): PipelineConfig {
  return {
    configVersion: 2,
    mode: 'advanced',
    pythonRuntime: RUNTIME,
    description: 'Fit a trend',
    parameters: [
      { name: 'window_days', type: 'integer', required: false, default: 90 },
      {
        name: 'trains',
        type: 'text',
        required: true,
        description: 'Which trains',
      },
    ],
    inputs: [
      { name: 'plate', required: true, description: 'The plate' },
      {
        name: 'loads',
        required: false,
        schemaId: '11111111-1111-4111-8111-111111111111',
      },
    ],
    steps: [
      {
        name: 'first',
        kind: 'sql',
        statement: 'SELECT *\nFROM plate\nWHERE x > {{window_days}}',
      },
      filterStep(),
      {
        name: 'fit',
        kind: 'python',
        statement:
          'def transform(inputs, parameters):\n    return inputs["previous"]\n',
        note: 'fits it',
        onlyIfRows: true,
      },
      {
        name: 'confirm',
        kind: 'ask',
        ask: {
          fields: [{ key: 'ok', label: 'OK', type: 'text', required: true }],
          askedUserIds: ['u-1'],
          skipSteps: ['fit'],
          expiresHours: 24,
        },
      },
      {
        name: 'tell',
        kind: 'notify',
        notify: {
          subscriptionId: '22222222-2222-4222-8222-222222222222',
          payload: { a: 1 },
        },
      },
    ],
    output: {
      mode: 'create',
      schemaVersionId: '11111111-1111-4111-8111-111111111111',
      datasetName: 'Fits',
      datasetLabel: 'run',
    },
  }
}

describe('the version file', () => {
  it('reads back the version it wrote', () => {
    const config = everything()
    const text = versionFileText(config, META)

    const read = checkVersionFile(text, {
      pipeline: ['PL-0021'],
      pythonRuntime: RUNTIME,
    })

    expect(read.problems).toEqual([])
    expect(read.config).toEqual(config)
  })

  it('writes the board’s layout: a title, the pipeline, maps for parameters and inputs', () => {
    const text = versionFileText(everything(), {
      ...META,
      versionNote: 'draft; v4 is published',
    })

    expect(text.split('\n').slice(0, 4)).toEqual([
      '# Titre trend',
      'pipeline: PL-0021',
      'version: 5 # draft; v4 is published',
      'mode: advanced',
    ])
    expect(text).toContain(
      'window_days: { type: integer, required: false, default: 90 }',
    )
    expect(text).toContain('  - id: first\n    sql: |-')
  })

  it('stays the same text when it is written, read and written again', () => {
    const once = versionFileText(everything(), META)
    const read = checkVersionFile(once, { pythonRuntime: RUNTIME })

    expect(read.config).not.toBeNull()

    if (read.config) expect(versionFileText(read.config, META)).toBe(once)
  })

  it('puts a mistyped key on its line, with the key it probably meant', () => {
    const text = versionFileText(everything(), META).replace(
      'only_if_rows',
      'only_if_row',
    )

    const { problems, config } = check(text)

    const line =
      text.split('\n').findIndex((l) => l.includes('only_if_row:')) + 1

    expect(config).toBeNull()
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ line, length: 'only_if_row'.length })
    expect(problems[0].message).toContain('Did you mean `only_if_rows`?')
    expect(problems[0].fix && applyFix(text, problems[0].fix)).toContain(
      'only_if_rows: true',
    )
  })

  it('points a skipped step that does not exist at the name, and offers the real one', () => {
    const text = versionFileText(everything(), META).replace(
      '- fit\n',
      '- fitt\n',
    )

    const { problems } = check(text)

    expect(problems.at(0)?.message).toContain('No step is called fitt')
    expect(problems.at(0)?.fix?.text).toBe('fit')
  })

  it('finds what the shared validator refuses, on the line it is on', () => {
    const text = versionFileText(everything(), META).replace(
      'trains:',
      'Trains:',
    )

    const { problems } = check(text)

    expect(problems).toHaveLength(1)
    expect(text.split('\n')[problems[0].line - 1]).toContain('Trains:')
  })

  it('reports broken YAML with its line', () => {
    const { problems, config } = checkVersionFile(
      'pipeline: PL-0021\nsteps:\n  - id: a\n   sql: x\n',
    )

    expect(config).toBeNull()
    expect(problems.length).toBeGreaterThan(0)
    expect(problems[0].line).toBeGreaterThanOrEqual(3)
  })

  it('refuses a file for another pipeline, another mode, and keys it has no place for', () => {
    const base = versionFileText(everything(), META)

    expect(
      check(base, { pipeline: ['PL-0001'] }).problems[0].message,
    ).toContain('This file is for PL-0021, not PL-0001')
    expect(
      check(base.replace('mode: advanced', 'mode: simple')).problems[0].message,
    ).toContain('cannot change')
    expect(check(`${base}stats:\n  any: []\n`).problems[0].message).toContain(
      'stats',
    )
  })

  it('refuses a step with two kinds or none', () => {
    const none = checkVersionFile('steps:\n  - id: a\n')

    const two = checkVersionFile(
      'steps:\n  - id: a\n    sql: SELECT 1\n    python: x\n',
    )

    expect(none.problems[0].message).toContain('needs one kind of work')
    expect(two.problems[0].message).toContain('does one kind of work')
  })

  it('lists sections and steps for the outline, with their lines', () => {
    const text = versionFileText(everything(), META)
    const { outline } = check(text)

    expect(outline.map((o) => o.label)).toEqual([
      'Parameters',
      'Inputs',
      'Steps',
      'first',
      'keep',
      'fit',
      'confirm',
      'tell',
      'Output',
    ])
    expect(outline.find((o) => o.label === 'fit')).toMatchObject({
      kind: 'Python',
      depth: 1,
    })
    expect(
      text.split('\n')[
        (outline.find((o) => o.label === 'Steps')?.line ?? 1) - 1
      ],
    ).toBe('steps:')
  })

  it('formats text without losing comments', () => {
    const tidy = formatVersionFile(
      '# hi\nsteps:\n    - id: a   # why\n      sql:   SELECT 1\n',
    )

    expect(tidy).toContain('# hi')
    expect(tidy).toContain('# why')
    expect(tidy).toContain('  - id: a')
  })
})

describe('several outputs', () => {
  const two = (): PipelineConfig => {
    const base = everything()

    return {
      ...base,
      output: { mode: 'none', datasetLabel: '' },
      moreOutputs: [
        {
          mode: 'append',
          datasetId: '44444444-4444-4444-8444-444444444444',
          datasetLabel: 'Fits',
          from: base.steps[0].name,
        },
      ],
    }
  }

  it('writes more than one output as a list and reads it back', () => {
    const config = two()

    const text = versionFileText(config, {
      pipeline: 'PL-0001',
      title: 'T',
    })

    expect(text).toContain('outputs:')
    expect(text).not.toMatch(/^output:/m)
    const back = check(text)

    expect(back.problems).toEqual([])
    expect(back.config?.moreOutputs).toEqual(config.moreOutputs)
    expect(back.config?.output).toEqual(config.output)
  })

  it('says where a further output names a step that is not there', () => {
    const config = two()
    config.moreOutputs![0].from = 'nope'

    const text = versionFileText(config, { pipeline: 'PL-0001' })
    const result = check(text)
    const line = text.split('\n').findIndex((l) => l.includes('from: nope')) + 1

    expect(result.config).toBeNull()
    expect(result.problems[0]).toMatchObject({ line })
  })

  it('refuses output and outputs together', () => {
    const text = versionFileText(two(), { pipeline: 'PL-0001' }).replace(
      'outputs:',
      'output: {mode: none}\noutputs:',
    )

    expect(check(text).problems.length).toBeGreaterThan(0)
  })
})

describe('includes', () => {
  const sets = {
    'aav9-limits': [
      { name: 'ntu_limit', type: 'decimal', required: false, default: 5 },
      { name: 'yield_range', type: 'text', required: false, default: '40-100' },
    ],
  } satisfies Record<string, PipelineParameter[]>

  const target = { sets }

  const withInclude = (): string => {
    const config = everything()

    const text = versionFileText(
      {
        ...config,
        parameters: [...sets['aav9-limits'], ...config.parameters],
        include: [
          { set: 'aav9-limits', parameters: ['ntu_limit', 'yield_range'] },
        ],
      },
      { pipeline: 'PL-0001' },
    )

    return text
  }

  it('writes an include by name and leaves its parameters out of `parameters`', () => {
    const text = withInclude()

    expect(text).toContain('include:')
    expect(text).toContain('aav9-limits')
    expect(text).not.toContain('ntu_limit')
  })

  it('reads it back, copying the set into the version', () => {
    const result = checkVersionFile(withInclude(), {
      pipeline: ['PL-0001'],
      pythonRuntime: RUNTIME,
      ...target,
    })

    expect(result.problems).toEqual([])
    expect(result.config?.include).toEqual([
      { set: 'aav9-limits', parameters: ['ntu_limit', 'yield_range'] },
    ])
    expect(result.config?.parameters.map((p) => p.name)).toContain('ntu_limit')
  })

  it('names the set it cannot find, with a guess', () => {
    const text = withInclude().replace('aav9-limits', 'aav9-limit')

    const result = checkVersionFile(text, {
      pipeline: ['PL-0001'],
      pythonRuntime: RUNTIME,
      ...target,
    })

    expect(result.config).toBeNull()
    expect(result.problems[0].message).toContain('aav9-limit')
    expect(
      result.problems[0].fix?.text ?? result.problems[0].message,
    ).toContain('aav9-limits')
  })
})

describe('remote job and lakehouse steps', () => {
  const withSteps = (): PipelineConfig => {
    const config = everything()

    config.steps = [
      ...config.steps.slice(0, 1),
      {
        name: 'lake',
        kind: 'lakehouse',
        statement: 'SELECT * FROM assays',
        lake: { tables: ['assays', 'plates'] },
      },
      {
        name: 'fold',
        kind: 'remote_job',
        remoteJob: {
          connection: 'hpc-main',
          queue: 'hpc-short',
          secret: 'HPC_SUBMIT_KEY',
          script: 'python fold.py',
          limitMinutes: 120,
        },
      },
    ]
    config.output = { mode: 'none', datasetLabel: '' }

    return config
  }

  it('writes them in the file and reads the same version back', () => {
    const text = versionFileText(withSteps(), { pipeline: 'PL-0001' })
    const result = check(text, { pipeline: ['PL-0001'] })

    expect(text).toContain('remote_job:')
    expect(text).toContain('limit_minutes: 120')
    expect(text).toContain('lakehouse:')
    expect(result.problems).toEqual([])
    expect(result.config?.steps.slice(1)).toEqual(withSteps().steps.slice(1))
  })

  it('marks a bad queue on its own line', () => {
    const config = withSteps()
    const job = config.steps[2]

    if (job.kind === 'remote_job') job.remoteJob.queue = 'Bad Queue'

    const text = versionFileText(config, { pipeline: 'PL-0001' })
    const line = text.split('\n').findIndex((l) => l.includes('queue:')) + 1
    const result = check(text, { pipeline: ['PL-0001'] })

    expect(result.config).toBeNull()
    expect(result.problems[0]).toMatchObject({ line })
  })

  it('marks lakehouse tables that are not named', () => {
    const text = versionFileText(withSteps(), { pipeline: 'PL-0001' }).replace(
      /tables:[\s\S]*?\n\s+sql:/,
      'tables: []\n      sql:',
    )

    const result = check(text, { pipeline: ['PL-0001'] })
    const line = text.split('\n').findIndex((l) => l.includes('tables:')) + 1

    expect(result.config).toBeNull()
    expect(result.problems[0]).toMatchObject({ line })
  })
})

describe('starts', () => {
  const rules = {
    conditionsMatch: 'any',
    window: {
      days: 'weekdays',
      from: '07:00',
      to: '19:00',
      timeZone: 'Europe/London',
    },
    minNewRows: 50,
    waitMinutes: 10,
    whileRunning: 'skip',
    missedRuns: 'skip',
  } as const satisfies StartRules

  it('writes only the rules that are not the defaults, and reads them back', () => {
    const text = versionFileText(everything(), {
      pipeline: 'PL-0001',
      startRules: rules,
    })

    const result = check(text, { pipeline: ['PL-0001'] })

    expect(text).toContain('starts:')
    expect(text).toContain('min_new_rows: 50')
    expect(result.problems).toEqual([])
    expect(result.startRules).toEqual(rules)
  })

  it('writes no block when the rules are the defaults, and reads none', () => {
    const text = versionFileText(everything(), {
      pipeline: 'PL-0001',
      startRules: DEFAULT_START_RULES,
    })

    expect(text).not.toContain('starts:')
    expect(check(text, { pipeline: ['PL-0001'] }).startRules).toBeUndefined()
  })

  it('marks a rule that is not valid on its own line', () => {
    const text = versionFileText(everything(), {
      pipeline: 'PL-0001',
      startRules: rules,
    }).replace('wait_minutes: 10', 'wait_minutes: 5000')

    const line =
      text.split('\n').findIndex((l) => l.includes('wait_minutes')) + 1

    const result = check(text, { pipeline: ['PL-0001'] })

    expect(result.config).toBeNull()
    expect(result.problems[0]).toMatchObject({ line })
  })

  it('names a rule it does not know, with a guess', () => {
    const text = versionFileText(everything(), {
      pipeline: 'PL-0001',
      startRules: rules,
    }).replace('min_new_rows', 'min_new_row')

    const result = check(text, { pipeline: ['PL-0001'] })

    expect(result.config).toBeNull()
    expect(result.problems[0].message).toContain('min_new_rows')
  })
})

describe('web call steps', () => {
  const withCall = (): PipelineConfig => {
    const config = everything()

    config.steps = [
      ...config.steps.slice(0, 1),
      {
        name: 'fetch',
        kind: 'web_call',
        webCall: {
          connection: 'registry',
          method: 'POST',
          path: '/v1/search',
          secret: 'REGISTRY_KEY',
          body: { query: 'abc' },
          itemsPath: 'data.items',
        },
      },
    ]
    config.output = { mode: 'none', datasetLabel: '' }

    return config
  }

  it('writes it in the file and reads the same version back', () => {
    const text = versionFileText(withCall(), { pipeline: 'PL-0001' })
    const result = check(text, { pipeline: ['PL-0001'] })

    expect(text).toContain('web_call:')
    expect(text).toContain('items: data.items')
    expect(result.problems).toEqual([])
    expect(result.config?.steps.slice(1)).toEqual(withCall().steps.slice(1))
  })

  it('marks a bad path on its own line', () => {
    const text = versionFileText(withCall(), { pipeline: 'PL-0001' }).replace(
      'path: /v1/search',
      'path: v1/search',
    )

    const line = text.split('\n').findIndex((l) => l.includes('path:')) + 1
    const result = check(text, { pipeline: ['PL-0001'] })

    expect(result.config).toBeNull()
    expect(result.problems[0]).toMatchObject({ line })
  })
})
