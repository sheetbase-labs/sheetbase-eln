import { describe, expect, it } from 'vitest'

import type { PipelineConfig } from './config'
import type { FilterForm } from './no-code/forms'
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

  it('refuses a file for another pipeline, another mode, and keys it has no place for yet', () => {
    const base = versionFileText(everything(), META)

    expect(
      check(base, { pipeline: ['PL-0001'] }).problems[0].message,
    ).toContain('This file is for PL-0021, not PL-0001')
    expect(
      check(base.replace('mode: advanced', 'mode: simple')).problems[0].message,
    ).toContain('cannot change')
    expect(check(`${base}starts:\n  any: []\n`).problems[0].message).toContain(
      'cannot be written in the file yet',
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
