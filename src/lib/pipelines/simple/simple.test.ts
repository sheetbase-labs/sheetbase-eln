import { describe, expect, it } from 'vitest'

import { validatePipelineConfig } from '../config'
import { PIPELINE_TEMPLATES, templateById } from '../templates'
import {
  allRowsConfig,
  compileRecipe,
  convertToStandard,
  matchOnlyConfig,
  recipeOf,
  simpleConfig,
  stripConfig,
} from './compile'
import { emptyRecipe, recipeProblems } from './recipe'
import type { PipelineRecipe } from './recipe'

const DATASET = '11111111-1111-4111-8111-111111111111'
const FIELD = '22222222-2222-4222-8222-222222222222'
const PERSON = '33333333-3333-4333-8333-333333333333'

const recipe: PipelineRecipe = {
  when: { datasetId: DATASET },
  join: 'and',
  conditions: [{ column: 'turbidity', operator: 'above', value: 10 }],
  actions: [
    { kind: 'flag_rows', column: 'turbidity', fieldId: FIELD },
    { kind: 'append', datasetId: DATASET },
  ],
}

describe('compiling a recipe', () => {
  it('makes a match step, one step per action and a keep step last', () => {
    const { steps, parameters, inputs } = compileRecipe(recipe)

    expect(inputs).toEqual([{ name: 'source', required: true }])
    expect(steps[0]).toMatchObject({ name: 'match', kind: 'sql' })
    expect(steps.some((step) => step.kind === 'action')).toBe(true)
    expect(steps.at(-1)).toMatchObject({ name: 'keep_rows', kind: 'sql' })
    expect(parameters.map((p) => p.name)).toEqual(['condition_1'])
    expect(parameters[0].default).toBe(10)
  })

  it('keeps values out of the SQL text', () => {
    const { steps } = compileRecipe(recipe)
    const match = steps[0]

    expect(match.kind === 'sql' && match.statement).not.toContain('10')
    expect(match.kind === 'sql' && match.statement).toContain('{{condition_1}}')
  })

  it('matches every row when there are no conditions', () => {
    const { steps } = compileRecipe({ ...recipe, conditions: [] })

    expect(steps[0].kind === 'sql' && steps[0].statement).toBe(
      'SELECT * FROM source',
    )
  })

  it('compiles to a configuration the contract accepts', () => {
    expect(validatePipelineConfig(simpleConfig(recipe))).toEqual([])
  })

  it('gives the dry run steps that write nothing', () => {
    const match = matchOnlyConfig(recipe)

    expect(match.steps.every((step) => step.kind === 'sql')).toBe(true)
    expect(match.output.mode).toBe('none')
    expect(allRowsConfig().steps).toHaveLength(1)
  })
})

describe('Convert to Standard', () => {
  it('drops the recipe, keeps the steps and the parameters', () => {
    const simple = simpleConfig(recipe)
    const converted = convertToStandard({ ...simple })

    expect(converted.mode).toBe('standard')
    expect('recipe' in converted).toBe(false)
    expect(converted.steps).toEqual(simple.steps)
    expect(converted.parameters).toEqual(simple.parameters)
    expect(validatePipelineConfig(converted)).toEqual([])
  })

  it('reads the recipe only from a Simple configuration', () => {
    const simple = simpleConfig(recipe)

    expect(recipeOf(simple)).toEqual(recipe)
    expect(recipeOf(convertToStandard({ ...simple }))).toBeNull()
    expect(recipeOf(null)).toBeNull()
  })
})

describe('recipe problems', () => {
  it('says what is left to choose', () => {
    expect(recipeProblems(emptyRecipe()).length).toBeGreaterThan(0)
  })

  it('accepts a complete recipe', () => {
    expect(recipeProblems(recipe)).toEqual([])
  })

  it('wants a number for a numeric comparison', () => {
    const problems = recipeProblems({
      ...recipe,
      conditions: [{ column: 'turbidity', operator: 'above', value: 'lots' }],
    })

    expect(problems).toHaveLength(1)
  })

  it('wants someone to ask', () => {
    const problems = recipeProblems({
      ...recipe,
      actions: [
        {
          kind: 'ask',
          mode: 'confirm',
          userId: '',
          hours: 24,
          noAnswer: 'reask',
        },
      ],
    })

    expect(problems.length).toBeGreaterThan(0)
    expect(
      recipeProblems({
        ...recipe,
        actions: [
          {
            kind: 'ask',
            mode: 'confirm',
            userId: PERSON,
            hours: 24,
            noAnswer: 'reask',
          },
        ],
      }),
    ).toEqual([])
  })
})

describe('leaving an Inbox item', () => {
  const inbox: PipelineRecipe = {
    ...recipe,
    actions: [
      {
        kind: 'inbox',
        mode: 'task',
        userId: PERSON,
        text: 'Check the readings',
      },
    ],
  }

  it('compiles to the create_inbox_item action and a contract the database accepts', () => {
    const { steps } = compileRecipe(inbox)
    const step = steps.find((s) => s.kind === 'action')

    expect(step).toMatchObject({
      action: { operation: 'create_inbox_item' },
    })
    expect(validatePipelineConfig(simpleConfig(inbox))).toEqual([])
  })

  it('wants someone to leave it with and, for a task, what to do', () => {
    expect(recipeProblems(inbox)).toEqual([])

    const blank = { ...inbox, actions: [{ ...inbox.actions[0], userId: '' }] }

    // SAFETY: the spread keeps the inbox action's shape; only userId is blank.
    expect(recipeProblems(blank as PipelineRecipe).length).toBeGreaterThan(0)
  })
})

describe('recipes that start without a snapshot', () => {
  const failed: PipelineRecipe = {
    when: { datasetId: '', event: 'run_failed' },
    join: 'and',
    conditions: [],
    actions: [
      { kind: 'inbox', mode: 'task', userId: '@event', text: 'A run failed' },
    ],
  }

  it('reads nothing, takes the event’s person as a parameter and tells them once', () => {
    const { inputs, parameters, steps } = compileRecipe(failed)

    expect(inputs).toEqual([])
    expect(parameters.map((p) => p.name)).toEqual([
      'event_person',
      'event_subject',
    ])
    expect(steps[0].kind).toBe('sql')
    expect(steps[1]).toMatchObject({
      action: {
        operation: 'create_inbox_item',
        forEach: { $ref: 'previous' },
        arguments: { p_user_id: { $ref: 'row.person' } },
      },
    })
    expect(validatePipelineConfig(simpleConfig(failed))).toEqual([])
    expect(recipeProblems(failed)).toEqual([])
  })

  it('lists expiring stock for a person', () => {
    const weekly: PipelineRecipe = {
      when: { datasetId: '', event: 'weekly', weekday: 1 },
      join: 'and',
      conditions: [],
      actions: [{ kind: 'expiring', userId: PERSON, days: 30 }],
    }

    const step = compileRecipe(weekly).steps.at(-1)

    expect(step).toMatchObject({
      action: {
        operation: 'list_expiring_materials',
        arguments: { p_user_id: PERSON, p_days: 30 },
      },
    })
    expect(validatePipelineConfig(simpleConfig(weekly))).toEqual([])
  })

  it('refuses actions that need rows to work on', () => {
    const bad: PipelineRecipe = {
      ...failed,
      actions: [{ kind: 'flag_rows', column: 'a', fieldId: FIELD }],
    }

    expect(recipeProblems(bad).length).toBeGreaterThan(0)
  })
})

describe('templates', () => {
  // These two name no dataset, column or person of the lab's: they go to whoever the event is about.
  const ABOUT_THE_EVENT = ['review-decided', 'run-failed']

  it('start unfinished while a choice is the lab’s to make', () => {
    for (const template of PIPELINE_TEMPLATES.filter(
      (t) => !ABOUT_THE_EVENT.includes(t.id),
    ))
      expect(
        recipeProblems(template.recipe).length,
        template.id,
      ).toBeGreaterThan(0)
  })

  it('compile to a contract the database accepts', () => {
    for (const template of PIPELINE_TEMPLATES.filter((t) =>
      ABOUT_THE_EVENT.includes(t.id),
    )) {
      expect(recipeProblems(template.recipe), template.id).toEqual([])
      expect(
        validatePipelineConfig(simpleConfig(template.recipe)),
        template.id,
      ).toEqual([])
    }
  })

  it('are found by id', () => {
    for (const template of PIPELINE_TEMPLATES)
      expect(templateById(template.id)).toBe(template)
    expect(templateById('nope')).toBeUndefined()
  })
})

describe('the dry run strip', () => {
  it('samples the first numeric condition and keeps every row it matches', () => {
    const strip = stripConfig(recipe)

    expect(strip?.steps).toHaveLength(1)
    expect(
      strip?.steps[0].kind === 'sql' && strip.steps[0].statement,
    ).toContain('LIMIT 50')
  })

  it('is left out when no condition has a number', () => {
    expect(stripConfig({ ...recipe, conditions: [] })).toBeNull()
  })
})
