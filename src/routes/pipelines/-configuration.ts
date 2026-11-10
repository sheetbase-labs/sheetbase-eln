import { z } from 'zod'

import {
  PARAMETER_TYPES,
  CONFIRM_NO_ANSWER_OUTCOMES,
} from '#/lib/pipelines/config'
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

/** Decode persisted editor fields while retaining extension configuration. */
export const editorConfiguration = configurationObject({
  configVersion: z.number().optional(),
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

export type PipelineConfiguration = z.infer<typeof editorConfiguration>

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

export function configurationForWire(configuration: PipelineConfiguration) {
  return pipelineJsonObjectSchema.parse(editorJsonValue(configuration))
}
