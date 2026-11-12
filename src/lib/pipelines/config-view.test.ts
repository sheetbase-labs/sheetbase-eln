import { describe, expect, it } from 'vitest'

import { validatePipelineConfig } from './config'
import type { PipelineConfig } from './config'
import {
  configFromView,
  configView,
  shownStepName,
  viewConfigErrors,
  viewSupported,
} from './config-view'
import type { PipelineConfigView } from './config-view'

const SUBSCRIPTION = '11111111-1111-4111-8111-111111111111'

const ask = {
  fields: [{ key: 'ok', label: 'OK', type: 'text' as const, required: true }],
  askedUserIds: ['u-1'],
}

function stored(): PipelineConfig {
  return {
    configVersion: 2,
    mode: 'standard',
    parameters: [],
    inputs: [{ name: 'plates', required: true }],
    steps: [
      { name: 'analysis', kind: 'sql', statement: 'SELECT * FROM plates' },
      {
        name: 'flag',
        kind: 'sql',
        statement: 'SELECT * FROM previous WHERE od > 1',
        onlyIfRows: true,
        note: 'Only when the plate read.',
      },
      {
        name: 'join',
        kind: 'plugin',
        plugin: { operation: 'plugin.plate-tools.join', arguments: {} },
      },
      { name: 'check_flags', kind: 'ask', ask },
      {
        name: 'post_note',
        kind: 'action',
        action: {
          operation: 'plugin.example.step',
          arguments: { text: 'done' },
        },
        note: 'Tell the record.',
      },
      {
        name: 'tell_team',
        kind: 'notify',
        notify: { subscriptionId: SUBSCRIPTION },
      },
    ],
    output: { mode: 'none', datasetLabel: '' },
  }
}

describe('configView', () => {
  it('reads the first SQL step as the analysis and the rest as editor steps', () => {
    const view = configView(stored())

    expect(view.transform).toEqual({
      language: 'sql',
      statement: 'SELECT * FROM plates',
      name: 'analysis',
    })
    expect(view.steps?.map((step) => step.name)).toEqual([
      'flag',
      'check_flags',
    ])
    expect(view.steps?.[0]).toMatchObject({
      onlyIfRows: true,
      note: 'Only when the plate read.',
    })
    expect(view.steps?.[1]).toMatchObject({
      language: 'plugin',
      dataName: 'join',
      confirm: ask,
    })
    expect(view.actions).toEqual([
      {
        name: 'post_note',
        operation: 'plugin.example.step',
        arguments: { text: 'done' },
        note: 'Tell the record.',
      },
    ])
    expect(view.notifications).toEqual([
      { name: 'tell_team', subscriptionId: SUBSCRIPTION },
    ])
  })

  it('writes back exactly what it read', () => {
    expect(configFromView(configView(stored()))).toEqual(stored())
  })

  it('keeps a first step that pauses as an editor step', () => {
    const config = stored()
    config.steps = [config.steps[0], { name: 'check', kind: 'ask', ask }]
    const view = configView(config)

    expect(view.transform.language).toBe('none')
    expect(view.steps?.[0]).toMatchObject({
      name: 'check',
      dataName: 'analysis',
    })
    expect(configFromView(view)).toEqual(config)
  })
})

describe('configFromView', () => {
  it('names a new analysis step and the data step in front of a new pause', () => {
    const view: PipelineConfigView = {
      configVersion: 2,
      mode: 'standard',
      parameters: [],
      inputs: [],
      transform: { language: 'sql', statement: 'SELECT 1 AS n' },
      steps: [
        {
          name: 'confirm_units',
          language: 'sql',
          statement: 'SELECT * FROM previous',
          confirm: ask,
        },
      ],
      notifications: [{ subscriptionId: SUBSCRIPTION }],
      output: { mode: 'none', datasetLabel: '' },
    }

    const config = configFromView(view)

    expect(config.steps.map((step) => [step.name, step.kind])).toEqual([
      ['analysis', 'sql'],
      [shownStepName('confirm_units'), 'sql'],
      ['confirm_units', 'ask'],
      ['notify_1', 'notify'],
    ])
    expect(validatePipelineConfig(config)).toEqual([])
  })

  it('points each error at the part of the editor it came from', () => {
    const view = configView(stored())

    const broken: PipelineConfigView = {
      ...view,
      transform: { ...view.transform, statement: ' ' },
      steps: view.steps?.map((step) =>
        step.confirm
          ? { ...step, confirm: { ...ask, askedUserIds: [] } }
          : step,
      ),
    }

    expect(viewConfigErrors(broken).map((error) => error.field)).toEqual([
      'transform.statement',
      'steps[1].confirm.askedUserIds',
    ])

    const action = view.actions?.[0]

    expect(
      viewConfigErrors({
        ...view,
        actions: action ? [{ ...action, operation: 'nope' }] : [],
      }).map((error) => error.field),
    ).toEqual(['actions'])
  })
})

describe('viewSupported', () => {
  it('shows data steps with their pauses, then actions and notifications', () => {
    expect(viewSupported(stored())).toBe(true)
  })

  it('cannot show an action between data steps, or a pause with no step before it', () => {
    const config = stored()
    const [first, ...rest] = config.steps
    const action = rest[3]

    expect(viewSupported({ ...config, steps: [first, action, ...rest] })).toBe(
      false,
    )
    expect(
      viewSupported({
        ...config,
        steps: [{ name: 'check', kind: 'ask', ask }, first],
      }),
    ).toBe(false)
  })
})
