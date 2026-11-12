import { z } from 'zod'

import type {
  PipelineActionStep,
  PipelineConfig,
  PipelineInput,
  PipelineNotifyStep,
  PipelineOutput,
  PipelineParameter,
  PipelineStep,
} from '../config'
import { PIPELINE_CONFIG_VERSION } from '../config'
import { RECIPE_SOURCE_INPUT, recipeSchema } from './recipe'
import type { PipelineRecipe, RecipeAction, RecipeCondition } from './recipe'

/** Where the recipe lives on a stored version, beside the steps it compiled to. */
export type SimpleConfig = PipelineConfig & { recipe: PipelineRecipe }

const SQL_OPERATORS = {
  above: '>',
  at_least: '>=',
  below: '<',
  at_most: '<=',
  equals: '=',
  not_equals: '<>',
} as const

/** One condition as SQL, with its value left to a parameter so it is quoted safely. */
function conditionSql(condition: RecipeCondition, parameter: string): string {
  const { column, operator } = condition

  if (operator === 'is_empty') return `${column} IS NULL`

  if (operator === 'contains')
    return `position(lower({{${parameter}}}) in lower(${column})) > 0`

  return `${column} ${SQL_OPERATORS[operator]} {{${parameter}}}`
}

function conditionParameter(
  condition: RecipeCondition,
  index: number,
): PipelineParameter | null {
  if (condition.operator === 'is_empty' || condition.value === undefined)
    return null

  const numeric = z.number().safeParse(condition.value).success

  return {
    name: `condition_${index + 1}`,
    type: numeric ? 'decimal' : 'text',
    required: false,
    default: condition.value,
    description: `${condition.column} ${condition.operator.replaceAll('_', ' ')}`,
  }
}

function rangeSql(
  action: Extract<RecipeAction, { kind: 'check_range' }>,
  n: number,
) {
  const parts: string[] = []

  if (action.min !== undefined)
    parts.push(`${action.column} < {{range_${n}_min}}`)

  if (action.max !== undefined)
    parts.push(`${action.column} > {{range_${n}_max}}`)

  return `SELECT * FROM previous WHERE ${parts.join(' OR ')}`
}

function actionStep(
  action: Extract<RecipeAction, { kind: 'eln_action' }>,
  name: string,
): PipelineActionStep {
  const args: Record<string, string | number | boolean | { $ref: string }> = {}

  for (const [key, mapped] of Object.entries(action.arguments))
    args[key] =
      'column' in mapped ? { $ref: `row.${mapped.column}` } : mapped.value

  return {
    name,
    kind: 'action',
    action: {
      operation: action.operation,
      arguments: args,
      mode: action.mode,
      forEach: { $ref: 'previous' },
    },
  }
}

/**
 * The steps, inputs, parameters and output a recipe stands for. A recipe line
 * becomes one step, in order: the condition is a SQL step that keeps the
 * matching rows, each action a step after it, and a keep-results line the
 * version's output. Values are parameters, so they stay editable on the
 * compiled steps after Convert.
 */
export function compileRecipe(
  recipe: PipelineRecipe,
): Pick<PipelineConfig, 'inputs' | 'parameters' | 'steps' | 'output'> {
  const parameters: PipelineParameter[] = []

  const inputs: PipelineInput[] = [
    { name: RECIPE_SOURCE_INPUT, required: true },
  ]

  const steps: PipelineStep[] = []

  const where = recipe.conditions.map((condition, index) => {
    const parameter = conditionParameter(condition, index)

    if (parameter) parameters.push(parameter)

    return conditionSql(condition, `condition_${index + 1}`)
  })

  steps.push({
    name: 'match',
    kind: 'sql',
    statement: where.length
      ? `SELECT * FROM ${RECIPE_SOURCE_INPUT} WHERE ${where.join(recipe.join === 'or' ? ' OR ' : ' AND ')}`
      : `SELECT * FROM ${RECIPE_SOURCE_INPUT}`,
  })

  let output: PipelineOutput = { mode: 'none', datasetLabel: 'pipeline output' }

  recipe.actions.forEach((action, index) => {
    const n = index + 1

    switch (action.kind) {
      case 'flag_rows':
        steps.push({
          name: `flag_${n}`,
          kind: 'action',
          action: {
            operation: 'flag_dataset_value',
            arguments: {
              p_dataset_id: recipe.when.datasetId,
              p_row_id: { $ref: 'row._sb_row_id' },
              p_field_id: action.fieldId,
              p_kind: 'out_of_range',
              p_reason:
                action.reason || `Flagged by a rule on ${action.column}`,
            },
            mode: 'execute',
            forEach: { $ref: 'previous' },
          },
        })
        break
      case 'check_range':
        if (action.min !== undefined)
          parameters.push({
            name: `range_${n}_min`,
            type: 'decimal',
            required: false,
            default: action.min,
          })

        if (action.max !== undefined)
          parameters.push({
            name: `range_${n}_max`,
            type: 'decimal',
            required: false,
            default: action.max,
          })

        steps.push({
          name: `check_${n}`,
          kind: 'sql',
          statement: rangeSql(action, n),
        })
        break
      case 'ask':
        steps.push({
          name: `ask_${n}`,
          kind: 'ask',
          ask: {
            fields:
              action.mode === 'confirm'
                ? [
                    {
                      key: 'ok',
                      label: 'Confirm these rows',
                      type: 'boolean',
                      required: true,
                    },
                  ]
                : [
                    {
                      key: 'choice',
                      label: 'Choose one',
                      type: 'text',
                      required: true,
                      options: action.options,
                    },
                  ],
            askedUserIds: [action.userId],
            expiresHours: action.hours,
            noAnswer: action.noAnswer,
          },
        })
        break
      case 'notify': {
        const step: PipelineNotifyStep = {
          name: `notify_${n}`,
          kind: 'notify',
          notify: { subscriptionId: action.subscriptionId },
        }

        steps.push(step)
        break
      }

      case 'eln_action':
        steps.push(actionStep(action, `action_${n}`))
        break
      case 'inbox':
        steps.push({
          name: `inbox_${n}`,
          kind: 'action',
          action: {
            operation: 'create_inbox_item',
            mode: 'execute',
            arguments: {
              p_user_id: action.userId,
              p_title: action.text.trim() || 'Review the new snapshot',
              p_dataset_id: recipe.when.datasetId,
            },
          },
        })
        break
      case 'append':
        output = {
          mode: 'append',
          datasetId: action.datasetId,
          datasetLabel: 'pipeline output',
        }
        break
      case 'create':
        output = {
          mode: 'create',
          schemaVersionId: action.schemaVersionId,
          datasetName: action.datasetName,
          datasetLabel: 'pipeline output',
        }
        break
    }
  })

  // Keeping results keeps every row of the snapshot, not only the ones the
  // conditions matched: the output takes the last data step, so this goes last.
  if (output.mode !== 'none')
    steps.push({
      name: 'keep_rows',
      kind: 'sql',
      statement: `SELECT * FROM ${RECIPE_SOURCE_INPUT}`,
    })

  return { inputs, parameters, steps, output }
}

/**
 * The data steps up to the rows the conditions leave, for the dry run: the
 * same steps a run would start with, writing nothing and asking no one.
 */
export function matchOnlyConfig(recipe: PipelineRecipe): PipelineConfig {
  const compiled = compileRecipe(recipe)

  return {
    configVersion: PIPELINE_CONFIG_VERSION,
    mode: 'standard',
    ...compiled,
    steps: compiled.steps.filter(
      (step) => step.kind === 'sql' && step.name !== 'keep_rows',
    ),
    output: { mode: 'none', datasetLabel: 'dry run' },
  }
}

/**
 * Up to 50 points of the first numeric condition's column, for the dry run's
 * strip: every row the condition keeps, and an even sample of the rest, with
 * each row's place in the snapshot. Null when there is no such condition.
 */
export function stripConfig(recipe: PipelineRecipe): PipelineConfig | null {
  const index = recipe.conditions.findIndex(
    (condition) =>
      condition.operator !== 'is_empty' &&
      condition.operator !== 'contains' &&
      z.number().safeParse(condition.value).success,
  )

  if (index < 0) return null

  const condition = recipe.conditions[index]
  const where = conditionSql(condition, `condition_${index + 1}`)
  const match = matchOnlyConfig(recipe)

  return {
    ...match,
    steps: [
      {
        name: 'strip',
        kind: 'sql',
        statement: `SELECT ${condition.column} AS v, (${where}) AS hit, rn, n FROM (SELECT *, row_number() OVER () AS rn, count(*) OVER () AS n FROM ${RECIPE_SOURCE_INPUT}) s WHERE (${where}) OR rn % GREATEST(1, CEIL(n / 40.0)::int) = 0 ORDER BY rn LIMIT 50`,
      },
    ],
  }
}

/** Every row of the snapshot, for the dry run's total. */
export function allRowsConfig(): PipelineConfig {
  return {
    configVersion: PIPELINE_CONFIG_VERSION,
    mode: 'standard',
    parameters: [],
    inputs: [{ name: RECIPE_SOURCE_INPUT, required: true }],
    steps: [
      {
        name: 'all_rows',
        kind: 'sql',
        statement: `SELECT * FROM ${RECIPE_SOURCE_INPUT}`,
      },
    ],
    output: { mode: 'none', datasetLabel: 'dry run' },
  }
}

/** A Simple configuration for a recipe: the recipe and what it compiles to. */
export function simpleConfig(
  recipe: PipelineRecipe,
  description?: string,
): SimpleConfig {
  const config: SimpleConfig = {
    configVersion: PIPELINE_CONFIG_VERSION,
    mode: 'simple',
    recipe,
    ...compileRecipe(recipe),
  }

  if (description) config.description = description

  return config
}

/** A stored version's configuration, as the data layer returns it. */
export interface StoredConfiguration {
  mode?: unknown
  recipe?: unknown
}

const storedSimple = z.object({
  mode: z.literal('simple'),
  recipe: recipeSchema,
})

/** The recipe of a stored configuration, when it is a Simple one that holds it. */
export function recipeOf(
  configuration: StoredConfiguration | null | undefined,
): PipelineRecipe | null {
  const parsed = storedSimple.safeParse(configuration)

  return parsed.success ? parsed.data.recipe : null
}

/**
 * Convert Simple to Standard: the compiled steps stay exactly as they are and
 * become the Standard version's steps; the recipe, and with it the sentence
 * editor and the dry run, go. One way: the database refuses a later version
 * that goes back to Simple.
 */
export function convertToStandard<T extends { recipe?: PipelineRecipe }>(
  configuration: T,
): Omit<T, 'recipe'> & { mode: 'standard' } {
  const { recipe: _recipe, ...rest } = configuration

  return { ...rest, mode: 'standard' }
}
