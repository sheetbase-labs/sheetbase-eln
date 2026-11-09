import { z } from 'zod'

import { extractJsonObject } from './ai-import-mapping'
import { PARAMETER_TYPES, validatePipelineConfig } from './pipelines/config'
import type {
  ParameterType,
  PipelineInput,
  PipelineParameter,
  PipelineStep,
} from './pipelines/config'
import { isStarterStatement } from './pipelines/python'

/**
 * Plain-English pipelines: a description becomes the inputs, parameters, SQL
 * steps and output a person would otherwise fill in by hand. The model only
 * sees the schemas and datasets the workspace really has, named by short keys
 * (s1, d1) so a long id is never copied wrongly; the answer is checked against
 * them and against the shared pipeline contract before anything is offered.
 * The result is a draft: it is shown as a card, the person applies it to the
 * draft version, and publishing stays a separate human step.
 */

const MAX_SCHEMAS = 40
const MAX_DATASETS = 40
const MAX_FIELDS_PER_SCHEMA = 40
const MAX_STEPS = 10

/** A Dataset Schema the draft may read from or write to. */
export interface DraftSchemaOption {
  /** Dataset Schema id (what an input's `schemaId` holds). */
  definitionId: string
  /** The active Dataset Schema Version a new dataset would be created from. */
  versionId: string
  name: string
  fields: Array<{ key: string; type: string }>
}

/** An existing dataset an append output could extend. */
export interface DraftDatasetOption {
  id: string
  name: string
  schemaVersionId: string
}

export interface PipelineDraftContext {
  schemas: DraftSchemaOption[]
  datasets: DraftDatasetOption[]
}

/** The editable parts of the pipeline configuration a draft can set. */
export interface PipelineDraftConfig {
  description: string | null
  inputs: PipelineInput[]
  parameters: PipelineParameter[]
  /** The first step. */
  transform: { language: 'sql'; statement: string }
  /** Every step after the first. */
  steps: PipelineStep[]
  output: {
    mode: 'create' | 'append' | 'none'
    datasetName?: string
    schemaVersionId?: string
    datasetId?: string
    datasetLabel?: string
  }
}

export interface PipelineDraftProposal {
  config: PipelineDraftConfig
  /** One plain sentence on what the pipeline does. */
  summary: string
  /** Plain-English lines for the card: one per part the draft sets. */
  lines: string[]
  /** Parts of the answer that did not check out and were left out. */
  skipped: string[]
}

/** What the page already holds, so a follow-up asks for a revision. */
export interface CurrentPipelineDraft {
  description?: string | null
  inputs?: PipelineInput[]
  parameters?: PipelineParameter[]
  statement?: string
  language?: string
  steps?: PipelineStep[]
  output?: { mode?: string; datasetName?: string }
}

const answerSchema = z.object({
  summary: z.string().nullish(),
  inputs: z
    .array(
      z.object({
        name: z.string(),
        schema: z.string().nullish(),
        description: z.string().nullish(),
      }),
    )
    .default([]),
  parameters: z
    .array(
      z.object({
        name: z.string(),
        type: z.string().nullish(),
        default: z.unknown().optional(),
        description: z.string().nullish(),
      }),
    )
    .default([]),
  steps: z
    .array(z.object({ name: z.string().nullish(), sql: z.string() }))
    .default([]),
  output: z
    .object({
      mode: z.string().nullish(),
      schema: z.string().nullish(),
      dataset: z.string().nullish(),
      datasetName: z.string().nullish(),
      label: z.string().nullish(),
    })
    .nullish(),
})

const schemaKey = (index: number) => `s${index + 1}`
const datasetKey = (index: number) => `d${index + 1}`

function describeSchema(option: DraftSchemaOption, index: number): string {
  const fields = option.fields
    .slice(0, MAX_FIELDS_PER_SCHEMA)
    .map((f) => `${f.key} (${f.type})`)
    .join(', ')

  return `- ${schemaKey(index)} | ${option.name} | columns: ${fields || 'none'}`
}

function describeCurrent(current: CurrentPipelineDraft | undefined): string[] {
  if (!current) return []
  const lines: string[] = []
  const steps: string[] = []

  if (current.statement && !isStarterStatement(current.statement))
    steps.push(current.statement.trim())

  for (const step of current.steps ?? [])
    if (!isStarterStatement(step.statement)) steps.push(step.statement.trim())

  if (steps.length === 0 && !(current.inputs ?? []).length) return []
  lines.push(
    'The pipeline as it stands now (revise it rather than start over):',
  )

  if ((current.inputs ?? []).length)
    lines.push(`Inputs: ${current.inputs?.map((i) => i.name).join(', ')}`)
  steps.forEach((sql, index) => lines.push(`Step ${index + 1}: ${sql}`))

  return lines
}

export function pipelineDraftInstruction(
  description: string,
  context: PipelineDraftContext,
  current?: CurrentPipelineDraft,
): string {
  return [
    `Pipeline description: ${JSON.stringify(description.trim())}`,
    'Dataset schemas you may read from or write to (key | name | columns):',
    ...context.schemas.slice(0, MAX_SCHEMAS).map(describeSchema),
    context.schemas.length === 0 ? '(none yet)' : '',
    'Existing datasets an output could add to (key | name | schema key):',
    ...context.datasets.slice(0, MAX_DATASETS).map((dataset, index) => {
      const schemaIndex = context.schemas.findIndex(
        (s) => s.versionId === dataset.schemaVersionId,
      )

      return `- ${datasetKey(index)} | ${dataset.name} | ${
        schemaIndex >= 0 ? schemaKey(schemaIndex) : 'unknown'
      }`
    }),
    context.datasets.length === 0 ? '(none yet)' : '',
    ...describeCurrent(current),
    '',
    'Reply with JSON only: {"summary":"<one sentence>","inputs":[{"name":"<lower_snake_case>","schema":"<schema key or empty>","description":"<short>"}],"parameters":[{"name":"<lower_snake_case>","type":"text|integer|decimal|boolean|date|timestamp","default":<value or omit>,"description":"<short>"}],"steps":[{"name":"<lower_snake_case>","sql":"<one SELECT statement>"}],"output":{"mode":"none|create|append","schema":"<schema key, for create>","dataset":"<dataset key, for append>","datasetName":"<name, for create>","label":"<version label>"}}.',
    'Rules: SQL only, PostgreSQL, one SELECT per step, no semicolons. The first step reads inputs by their name (select ... from <input name>); every later step reads the one before it as previous. Refer to a parameter as {{name}} (double curly braces). Only use column names listed for a schema and give each input the schema whose columns it needs. Use mode "none" unless the description says to keep or add the result somewhere. When you cannot match a name to the lists above, leave it out instead of guessing.',
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n')
}

function cleanText(value: string | null | undefined, max: number) {
  const text = (value ?? '').trim().replace(/\s+/g, ' ')

  return text ? text.slice(0, max) : undefined
}

function snakeName(raw: string | null | undefined): string {
  return (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]/, 'x$&')
    .slice(0, 48)
}

function cleanSql(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:sql)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/;+\s*$/, '')
    .trim()
}

function coerceDefault(type: ParameterType, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined

  if (type === 'integer') {
    const n = Number(value)

    return Number.isInteger(n) ? n : undefined
  }

  if (type === 'decimal') {
    const n = Number(value)

    return Number.isFinite(n) ? n : undefined
  }

  if (type === 'boolean')
    return value === true || value === 'true'
      ? true
      : value === false || value === 'false'
        ? false
        : undefined

  return typeof value === 'string' ? value : undefined
}

/**
 * Turn the model's answer into a draft, keeping only what checks out. Returns
 * null when nothing usable (no SQL step, or a configuration the contract would
 * refuse) came back.
 */
export function parsePipelineDraftAnswer(
  text: string,
  context: PipelineDraftContext,
): PipelineDraftProposal | null {
  const parsed = answerSchema.safeParse(extractJsonObject(text))

  if (!parsed.success) return null
  const answer = parsed.data
  const skipped: string[] = []

  const schemaByKey = new Map(
    context.schemas.slice(0, MAX_SCHEMAS).map((s, i) => [schemaKey(i), s]),
  )

  const datasetByKey = new Map(
    context.datasets.slice(0, MAX_DATASETS).map((d, i) => [datasetKey(i), d]),
  )

  const takenNames = new Set<string>()
  const inputs: PipelineInput[] = []

  for (const raw of answer.inputs) {
    const name = snakeName(raw.name)

    if (!name || name === 'previous' || takenNames.has(name)) {
      skipped.push(`input ${raw.name}`)
      continue
    }

    takenNames.add(name)
    const schema = raw.schema ? schemaByKey.get(raw.schema) : undefined
    inputs.push({
      name,
      required: true,
      ...(cleanText(raw.description, 300)
        ? { description: cleanText(raw.description, 300) }
        : {}),
      ...(schema ? { schemaId: schema.definitionId } : {}),
    })
  }

  const parameters: PipelineParameter[] = []

  for (const raw of answer.parameters) {
    const name = snakeName(raw.name)
    const type = (raw.type ?? 'text') as ParameterType

    if (
      !name ||
      name === 'previous' ||
      takenNames.has(name) ||
      !(PARAMETER_TYPES as readonly string[]).includes(type)
    ) {
      skipped.push(`parameter ${raw.name}`)
      continue
    }

    takenNames.add(name)
    const value = coerceDefault(type, raw.default)
    parameters.push({
      name,
      type,
      required: value === undefined,
      ...(value !== undefined ? { default: value } : {}),
      ...(cleanText(raw.description, 300)
        ? { description: cleanText(raw.description, 300) }
        : {}),
    })
  }

  const sqlSteps = answer.steps
    .map((step) => ({ name: snakeName(step.name), sql: cleanSql(step.sql) }))
    .filter((step) => step.sql.length > 0)
    .slice(0, MAX_STEPS)

  if (sqlSteps.length === 0) return null
  const [first, ...rest] = sqlSteps
  const stepNames = new Set<string>()

  const steps: PipelineStep[] = rest.map((step, index) => {
    let name = step.name || `step_${index + 2}`

    while (stepNames.has(name)) name = `${name}_x`
    stepNames.add(name)

    return { name, language: 'sql', statement: step.sql }
  })

  const out = answer.output
  let output: PipelineDraftConfig['output'] = { mode: 'none' }

  if (out?.mode === 'create') {
    const schema = out.schema ? schemaByKey.get(out.schema) : undefined
    const datasetName = cleanText(out.datasetName, 120)

    if (schema && datasetName) {
      output = {
        mode: 'create',
        datasetName,
        schemaVersionId: schema.versionId,
        datasetLabel: cleanText(out.label, 120) ?? datasetName,
      }
    } else skipped.push('where to save the result')
  } else if (out?.mode === 'append') {
    const dataset = out.dataset ? datasetByKey.get(out.dataset) : undefined

    if (dataset) {
      output = {
        mode: 'append',
        datasetId: dataset.id,
        datasetName: dataset.name,
        datasetLabel: cleanText(out.label, 120) ?? dataset.name,
      }
    } else skipped.push('where to save the result')
  }

  const summary = cleanText(answer.summary, 500) ?? ''

  const config: PipelineDraftConfig = {
    description: summary || null,
    inputs,
    parameters,
    transform: { language: 'sql', statement: first.sql },
    steps,
    output,
  }

  // A placeholder for a parameter nobody declared would fail on the first run.
  const declared = new Set(parameters.map((p) => p.name))

  for (const sql of sqlSteps.map((step) => step.sql)) {
    for (const match of sql.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g))
      if (!declared.has(match[1])) return null
  }

  // The same contract the server applies: a draft it would refuse is not offered.
  const errors = validatePipelineConfig({
    configVersion: 1,
    description: config.description,
    parameters: config.parameters,
    inputs: config.inputs,
    transform: config.transform,
    steps: config.steps.length ? config.steps : undefined,
    output: {
      ...config.output,
      datasetLabel: config.output.datasetLabel ?? 'Result',
    },
  })

  if (errors.length > 0) return null

  const lines: string[] = []

  if (inputs.length) lines.push(`Reads ${inputs.map((i) => i.name).join(', ')}`)

  if (parameters.length)
    lines.push(`Asks for ${parameters.map((p) => p.name).join(', ')} when run`)
  lines.push(
    sqlSteps.length === 1 ? '1 SQL step' : `${sqlSteps.length} SQL steps`,
  )
  lines.push(
    output.mode === 'create'
      ? `Saves a new dataset: ${output.datasetName}`
      : output.mode === 'append'
        ? `Adds each result to ${output.datasetName}`
        : 'Shows the result without saving it',
  )

  return { config, summary, lines, skipped }
}
