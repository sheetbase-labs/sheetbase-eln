import { z } from 'zod'

import { words } from './words'

const w = words('problems')

/**
 * A Simple pipeline is a recipe: When a new snapshot arrives, if some rows
 * match, then do these things. The recipe is stored on the version beside the
 * steps it compiles to (`compile.ts`), so the runner only ever runs steps and
 * Convert to Standard keeps the steps and drops the recipe.
 */

export const RECIPE_SOURCE_INPUT = 'source'
export const MAX_RECIPE_CONDITIONS = 8
export const MAX_RECIPE_ACTIONS = 12

const SLUG = /^[a-z][a-z0-9_]{0,59}$/
const UUID = /^[0-9a-f-]{36}$/i

// The shape is loose about what is chosen: a recipe being written has empty
// pickers, and `recipeProblems` says which. A saved version has none.
const slug = z.string().max(60)

/** How a condition compares a column with a value. */
export const CONDITION_OPERATORS = [
  'above',
  'at_least',
  'below',
  'at_most',
  'equals',
  'not_equals',
  'contains',
  'is_empty',
] as const

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number]

/** The operators that compare numbers; the others compare text. */
export const NUMERIC_OPERATORS: readonly ConditionOperator[] = [
  'above',
  'at_least',
  'below',
  'at_most',
]

export const conditionSchema = z.object({
  column: slug,
  operator: z.enum(CONDITION_OPERATORS),
  /** Numbers for the numeric operators; text otherwise. Unused by `is_empty`. */
  value: z.union([z.number(), z.string().max(200)]).optional(),
  /** What the value is measured in, said beside it. Never run. */
  unit: z.string().max(40).optional(),
})

export type RecipeCondition = z.infer<typeof conditionSchema>

const mappedArgumentSchema = z.union([
  z.object({ column: slug }),
  z.object({ value: z.union([z.string().max(2000), z.number(), z.boolean()]) }),
])

export type RecipeArgument = z.infer<typeof mappedArgumentSchema>

export const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('flag_rows'),
    /** The column whose value is flagged on each matching row. */
    column: slug,
    /** That column's field id in the dataset, which the flag needs. */
    fieldId: z.string(),
    reason: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal('check_range'),
    column: slug,
    min: z.number().optional(),
    max: z.number().optional(),
    unit: z.string().max(40).optional(),
  }),
  z.object({
    kind: z.literal('ask'),
    mode: z.enum(['confirm', 'choose']),
    userId: z.string(),
    hours: z.number().int().min(1).max(168),
    noAnswer: z.enum(['reask', 'fail']),
    options: z.array(z.string().min(1).max(80)).max(10).optional(),
  }),
  z.object({
    kind: z.literal('notify'),
    channel: z.enum(['teams', 'email', 'webhook']),
    subscriptionId: z.string(),
  }),
  z.object({
    kind: z.literal('inbox'),
    /** A task to do, or the snapshot to look at. */
    mode: z.enum(['task', 'review']),
    userId: z.string(),
    /** What they should do; the review line has its own words when empty. */
    text: z.string().max(200),
  }),
  z.object({
    kind: z.literal('eln_action'),
    operation: z.string().max(120),
    mode: z.enum(['execute', 'propose']),
    arguments: z.record(z.string(), mappedArgumentSchema),
  }),
  z.object({
    kind: z.literal('append'),
    datasetId: z.string(),
  }),
  z.object({
    kind: z.literal('create'),
    schemaVersionId: z.string(),
    datasetName: z.string().max(200),
  }),
])

export type RecipeAction = z.infer<typeof actionSchema>

export type RecipeActionKind = RecipeAction['kind']

export const recipeSchema = z.object({
  when: z.object({
    /** The dataset whose new snapshot starts the run. */
    datasetId: z.string(),
  }),
  /** Joined by `join`. Empty: every row goes on. */
  conditions: z.array(conditionSchema).max(MAX_RECIPE_CONDITIONS),
  join: z.enum(['and', 'or']),
  actions: z.array(actionSchema).max(MAX_RECIPE_ACTIONS),
})

export type PipelineRecipe = z.infer<typeof recipeSchema>

/** The first recipe of a new Simple pipeline: nothing chosen yet. */
export function emptyRecipe(datasetId = ''): PipelineRecipe {
  return { when: { datasetId }, conditions: [], join: 'and', actions: [] }
}

/** Keep-results actions: a recipe has at most one. */
export const KEEP_KINDS: readonly RecipeActionKind[] = ['append', 'create']

export interface RecipeProblem {
  field: string
  message: string
}

/**
 * What is wrong with a recipe, in words for the person writing it. A recipe
 * the schema refuses is reported as one problem; the rest are about what the
 * compiled steps could not do.
 */
export function recipeProblems(value: PipelineRecipe): RecipeProblem[] {
  const parsed = recipeSchema.safeParse(value)

  if (!parsed.success)
    return [
      {
        field: 'recipe',
        message: w('refused'),
      },
    ]

  const recipe = parsed.data
  const problems: RecipeProblem[] = []

  const pick = (field: string, what: string) =>
    problems.push({
      field,
      message: w('pick', { what }),
    })

  if (!UUID.test(recipe.when.datasetId)) pick('recipe.when', w('dataset'))

  recipe.conditions.forEach((condition, index) => {
    const field = `recipe.conditions[${index}]`

    if (!SLUG.test(condition.column)) pick(field, w('column'))

    if (
      condition.operator !== 'is_empty' &&
      (condition.value === undefined || condition.value === '')
    )
      problems.push({
        field,
        message: w('conditionNeedsValue', {
          column: condition.column,
        }),
      })

    if (
      NUMERIC_OPERATORS.includes(condition.operator) &&
      !z.number().safeParse(condition.value).success
    )
      problems.push({
        field,
        message: w('conditionNeedsNumber', {
          column: condition.column,
        }),
      })
  })

  recipe.actions.forEach((action, index) => {
    const field = `recipe.actions[${index}]`

    if (
      action.kind === 'flag_rows' &&
      (!SLUG.test(action.column) || !UUID.test(action.fieldId))
    )
      pick(field, w('column'))

    if (action.kind === 'check_range' && !SLUG.test(action.column))
      pick(field, w('column'))

    if (action.kind === 'ask' && !action.userId) pick(field, w('person'))

    if (action.kind === 'notify' && !UUID.test(action.subscriptionId))
      pick(field, w('channel'))

    if (action.kind === 'append' && !UUID.test(action.datasetId))
      pick(field, w('dataset'))

    if (
      action.kind === 'create' &&
      (!UUID.test(action.schemaVersionId) || !action.datasetName.trim())
    )
      pick(field, w('newDataset'))

    if (action.kind === 'inbox' && !UUID.test(action.userId))
      pick(field, w('person'))

    if (
      action.kind === 'inbox' &&
      action.mode === 'task' &&
      !action.text.trim()
    )
      pick(field, w('taskText'))

    if (action.kind === 'eln_action' && !action.operation)
      pick(field, w('action'))

    if (
      action.kind === 'check_range' &&
      action.min === undefined &&
      action.max === undefined
    )
      problems.push({
        field,
        message: w('rangeNeedsLimit'),
      })

    if (
      action.kind === 'ask' &&
      action.mode === 'choose' &&
      (action.options?.length ?? 0) < 2
    )
      problems.push({
        field,
        message: w('chooseNeedsOptions'),
      })
  })

  if (recipe.actions.filter((a) => KEEP_KINDS.includes(a.kind)).length > 1)
    problems.push({
      field: 'recipe.actions',
      message: w('oneKeep'),
    })

  return problems
}
