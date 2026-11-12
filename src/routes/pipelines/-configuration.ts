import { z } from 'zod'

import {
  PARAMETER_TYPES,
  CONFIRM_NO_ANSWER_OUTCOMES,
  PIPELINE_CONFIG_VERSION,
  PIPELINE_MODES,
  PIPELINE_STEP_KINDS,
} from '#/lib/pipelines/config'
import type { ConfigError, PipelineConfig } from '#/lib/pipelines/config'
import { t } from '#/copy'
import {
  configFromView,
  configView,
  viewConfigErrors,
  viewSupported,
} from '#/lib/pipelines/config-view'
import type { PipelineConfigView } from '#/lib/pipelines/config-view'
import {
  pipelineJsonObjectSchema,
  pipelineJsonValueSchema,
} from '#/lib/pipelines/types'
import { PYTHON_COLUMN_TYPES } from '#/lib/pipelines/python'

/** Zod's object clone omits own __proto__ keys; keep the original JSON entries. */
function configurationObject<T extends Record<string, z.ZodType>>(fields: T) {
  const schema = z.object(fields)

  return pipelineJsonObjectSchema.transform(
    (value): z.output<typeof schema> => {
      const decoded: z.output<typeof schema> = {
        ...value,
        ...schema.parse(value),
      }

      for (const [key, cell] of Object.entries(decoded)) {
        if (cell === undefined) Reflect.deleteProperty(decoded, key)
      }

      return decoded
    },
  )
}

function configurationMap<T extends z.ZodType>(entry: T) {
  return pipelineJsonObjectSchema.transform(
    (value): Record<string, z.output<T>> =>
      Object.fromEntries(
        Object.entries(value).map(([name, cell]) => [name, entry.parse(cell)]),
      ),
  )
}

const optionalDescription = z
  .string()
  .nullable()
  .transform((value) => value ?? undefined)
  .optional()

const requiredFlag = z
  .boolean()
  .nullish()
  .transform((value) => value ?? false)

const column = configurationObject({
  name: z.string(),
  type: z.enum(PYTHON_COLUMN_TYPES),
  nullable: z.boolean().optional(),
})

const contract = configurationObject({
  inputs: configurationMap(z.array(column)).optional(),
  output: configurationObject({
    columns: z.array(column),
    additionalColumns: z.boolean().optional(),
  }).optional(),
})

const storedStep = z.looseObject({
  name: z.string(),
  kind: z.enum(PIPELINE_STEP_KINDS),
})

const storedVersionFields = z.looseObject({
  configVersion: z.literal(PIPELINE_CONFIG_VERSION),
  steps: z.array(storedStep),
})

/** A stored version: its format and a list of named, typed steps. */
const storedConfig = z.custom<PipelineConfig>(
  (value) => storedVersionFields.safeParse(value).success,
)

type JsonObject = z.output<typeof pipelineJsonObjectSchema>

/** A typed value as plain JSON, keeping own `__proto__` keys and dropping unset ones. */
function asJson(value: PipelineConfig | PipelineConfigView): JsonObject {
  return pipelineJsonObjectSchema.parse(JSON.parse(JSON.stringify(value)))
}

/**
 * A stored version is one ordered step list; the editor works in its older
 * four-part shape. Turn a stored version into that shape, keeping any other
 * top-level keys (extension configuration) as they are.
 */
function storedToEditor(value: JsonObject): JsonObject {
  const stored = storedConfig.safeParse(value)

  if (!stored.success) return value

  const editor = { ...value }

  Reflect.deleteProperty(editor, 'steps')

  return { ...editor, ...asJson(configView(stored.data)) }
}

/**
 * Whether the step editor can show a stored version as it is. One it cannot
 * (an ELN action between data steps, say) is not changed here, so saving never
 * reorders it.
 */
export function editorShowsVersion(value: JsonObject): boolean {
  const stored = storedConfig.safeParse(value)

  return !stored.success || viewSupported(stored.data)
}

const editorFields = configurationObject({
  configVersion: z.number().optional(),
  mode: z.enum(PIPELINE_MODES).optional(),
  description: z.string().nullish(),
  parameters: z
    .array(
      configurationObject({
        name: z.string(),
        type: z.enum(PARAMETER_TYPES),
        required: requiredFlag,
        default: pipelineJsonValueSchema.optional(),
        description: optionalDescription,
      }),
    )
    .optional(),
  inputs: z
    .array(
      configurationObject({
        name: z.string(),
        required: requiredFlag,
        description: optionalDescription,
        schemaId: z.string().optional(),
      }),
    )
    .optional(),
  transform: configurationObject({
    language: z.string().optional(),
    statement: z.string().optional(),
    contract: contract.optional(),
    name: z.string().optional(),
    note: z.string().optional(),
  }).optional(),
  steps: z
    .array(
      configurationObject({
        name: z.string(),
        language: z.enum(['sql', 'python', 'plugin']),
        statement: z.string(),
        contract: contract.optional(),
        plugin: configurationObject({
          operation: z.string(),
          arguments: pipelineJsonObjectSchema,
        }).optional(),
        dataName: z.string().optional(),
        note: z.string().optional(),
        onlyIfRows: z.boolean().optional(),
        confirm: configurationObject({
          fields: z.array(
            configurationObject({
              key: z.string(),
              label: z.string(),
              type: z.enum(PARAMETER_TYPES),
              required: z.boolean().optional(),
              options: z.array(z.string()).optional(),
            }),
          ),
          askedUserIds: z.array(z.string()),
          skipSteps: z.array(z.string()).optional(),
          noAnswer: z.enum(CONFIRM_NO_ANSWER_OUTCOMES).optional(),
          expiresHours: z.number().optional(),
        }).optional(),
      }),
    )
    .optional(),
  pythonRuntime: z.string().optional(),
  pythonRequirements: z.array(z.string()).optional(),
  actions: z
    .array(
      configurationObject({
        name: z.string(),
        operation: z.string(),
        arguments: pipelineJsonObjectSchema,
        mode: z.enum(['execute', 'propose']).optional(),
        forEach: configurationObject({ $ref: z.string() }).optional(),
        note: z.string().optional(),
      }),
    )
    .optional(),
  notifications: z
    .array(
      configurationObject({
        name: z.string().optional(),
        subscriptionId: z.string(),
        payload: pipelineJsonObjectSchema.optional(),
        note: z.string().optional(),
      }),
    )
    .optional(),
  output: configurationObject({
    mode: z.enum(['none', 'create', 'append']).optional(),
    schemaVersionId: z.string().optional(),
    datasetId: z.string().optional(),
    datasetName: z.string().optional(),
    datasetLabel: z.string().optional(),
    fieldMapping: configurationMap(z.string()).nullable().optional(),
  }).optional(),
})

/** Decode a stored version (or the editor's own shape) for the step editor. */
export const editorConfiguration = pipelineJsonObjectSchema
  .transform(storedToEditor)
  .pipe(editorFields)

export type PipelineConfiguration = z.output<typeof editorFields>

type EditorJsonValue =
  | string
  | number
  | boolean
  | null
  | EditorJsonValue[]
  | { [key: string]: EditorJsonValue | undefined }

const editorJsonObject = z.custom<Record<string, EditorJsonValue | undefined>>(
  (value) => z.record(z.string(), z.unknown()).safeParse(value).success,
)

/** Omit optional editor properties without changing scientific JSON values. */
function editorJsonValue(value: EditorJsonValue): z.core.util.JSONType {
  if (Array.isArray(value)) return value.map(editorJsonValue)

  const object = editorJsonObject.safeParse(value)

  if (object.success) {
    return Object.fromEntries(
      Object.entries(object.data).flatMap(([key, cell]) =>
        cell === undefined ? [] : [[key, editorJsonValue(cell)]],
      ),
    )
  }

  return pipelineJsonValueSchema.parse(value)
}

const editorViewFields = z.looseObject({
  configVersion: z.literal(PIPELINE_CONFIG_VERSION),
  mode: z.enum(PIPELINE_MODES),
  parameters: z.array(z.unknown()),
  inputs: z.array(z.unknown()),
  transform: z.looseObject({
    language: z.enum(['sql', 'python', 'none']),
    statement: z.string(),
  }),
})

/** The editor's shape with its defaults filled; the server checks the rest. */
const editorView = z.custom<PipelineConfigView>(
  (value) => editorViewFields.safeParse(value).success,
)

/** The parts of the editor's shape that become steps; the rest is kept as it is. */
const VIEW_PARTS = ['transform', 'steps', 'actions', 'notifications']

function wireView(configuration: PipelineConfiguration) {
  const editor = pipelineJsonObjectSchema.parse(editorJsonValue(configuration))
  const view = { ...editor }

  view.configVersion = PIPELINE_CONFIG_VERSION
  view.mode ??= 'standard'
  view.parameters ??= []
  view.inputs ??= []
  view.transform ??= { language: 'none', statement: '' }

  const rest = { ...editor }

  for (const part of VIEW_PARTS) Reflect.deleteProperty(rest, part)

  return { rest, view: editorView.safeParse(view) }
}

/** The editor's shape, written as the stored step list. */
export function configurationForWire(configuration: PipelineConfiguration) {
  const { rest, view } = wireView(configuration)

  if (!view.success) throw new Error(t('data.pipelineConfig.chooseStepKind'))

  return { ...rest, ...asJson(configFromView(view.data)) }
}

/** What the shared contract says about the editor's shape, by editor part. */
export function configurationErrors(
  configuration: PipelineConfiguration,
): ConfigError[] {
  const { view } = wireView(configuration)

  if (!view.success)
    return [
      {
        code: 'unsupported_language',
        field: 'transform',
        message: t('data.pipelineConfig.chooseStepKind'),
      },
    ]

  return viewConfigErrors(view.data)
}
