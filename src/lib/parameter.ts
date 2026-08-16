import { z } from 'zod'

import { FIELD_LOGICAL_TYPES } from './field-definition'

export const parameterUuidSchema = z
  .string()
  .regex(
    /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )

const key = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/)
const label = z.string().trim().min(1).max(200)

function isCalendarDate(year: number, month: number, day: number) {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]
}

const isoDate = z
  .string()
  .regex(/^(\d{4})-(\d{2})-(\d{2})$/)
  .refine((value) => {
    const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) ?? []
    return Boolean(
      year && isCalendarDate(Number(year), Number(month), Number(day)),
    )
  }, 'Invalid calendar date.')

/** RFC3339 timestamps, including Postgres six-digit fractional seconds. */
export const rfc3339TimestampSchema = z
  .string()
  .regex(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/,
  )
  .refine((value) => {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
        value,
      )
    if (!match) return false
    const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] =
      match
    return (
      isCalendarDate(Number(year), Number(month), Number(day)) &&
      Number(hour) <= 23 &&
      Number(minute) <= 59 &&
      Number(second) <= 59 &&
      (value.endsWith('Z') ||
        (Number(offsetHour) <= 23 && Number(offsetMinute) <= 59))
    )
  }, 'Invalid RFC3339 timestamp.')

export function scalarParameterValueSchema(
  valueType: (typeof FIELD_LOGICAL_TYPES)[number],
) {
  switch (valueType) {
    case 'text':
      return z.string()
    case 'integer':
      return z.number().int().safe()
    case 'decimal':
      return z.number().finite()
    case 'boolean':
      return z.boolean()
    case 'date':
      return isoDate
    case 'timestamp':
      return rfc3339TimestampSchema
    case 'category':
    case 'reference':
      return parameterUuidSchema
  }
}

export const datasetParameterContractSchema = z.discriminatedUnion('mode', [
  z
    .object({ mode: z.literal('exact'), schemaVersionId: parameterUuidSchema })
    .strict(),
  z
    .object({
      mode: z.literal('lineage'),
      baselineSchemaVersionId: parameterUuidSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('semantic'),
      baselineSchemaVersionId: parameterUuidSchema.optional(),
      requiredFieldIds: z
        .array(parameterUuidSchema)
        .min(1)
        .max(64)
        .refine((ids) => new Set(ids).size === ids.length, {
          message: 'Required field IDs must be unique.',
        }),
    })
    .strict(),
])

const constraintsSchema = z
  .object({
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    minLength: z.number().int().min(0).max(100_000).optional(),
    maxLength: z.number().int().min(0).max(100_000).optional(),
    pattern: z.string().max(1_000).optional(),
    allowedValues: z.array(z.unknown()).max(256).optional(),
  })
  .strict()

type ParameterConstraints = z.infer<typeof constraintsSchema>

function scalarSatisfiesConstraints(
  valueType: (typeof FIELD_LOGICAL_TYPES)[number],
  value: unknown,
  constraints: ParameterConstraints,
) {
  if (!scalarParameterValueSchema(valueType).safeParse(value).success)
    return false
  if (
    constraints.allowedValues !== undefined &&
    !constraints.allowedValues.some((allowed) => allowed === value)
  )
    return false
  if (typeof value === 'number') {
    if (constraints.min !== undefined && value < constraints.min) return false
    if (constraints.max !== undefined && value > constraints.max) return false
  }
  if (typeof value === 'string' && valueType === 'text') {
    if (
      constraints.minLength !== undefined &&
      value.length < constraints.minLength
    )
      return false
    if (
      constraints.maxLength !== undefined &&
      value.length > constraints.maxLength
    )
      return false
    if (
      constraints.pattern !== undefined &&
      !new RegExp(constraints.pattern).test(value)
    )
      return false
  }
  return true
}

export const parameterSchema = z
  .object({
    id: parameterUuidSchema,
    key,
    label,
    required: z.boolean(),
    type: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('scalar'),
          valueType: z.enum(FIELD_LOGICAL_TYPES),
        })
        .strict(),
      z.object({ kind: z.literal('record'), modelKey: key }).strict(),
      z
        .object({
          kind: z.literal('dataset'),
          contract: datasetParameterContractSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('dataset-version'),
          contract: datasetParameterContractSchema,
        })
        .strict(),
    ]),
    defaultValue: z.unknown().optional(),
    constraints: constraintsSchema,
  })
  .strict()
  .superRefine((parameter, context) => {
    if (parameter.type.kind !== 'scalar') {
      if (parameter.defaultValue !== undefined)
        context.addIssue({
          code: 'custom',
          path: ['defaultValue'],
          message: 'Only scalar parameters may define defaults.',
        })
      if (Object.keys(parameter.constraints).length > 0)
        context.addIssue({
          code: 'custom',
          path: ['constraints'],
          message:
            'Object-reference parameters do not accept scalar constraints.',
        })
      return
    }

    const scalar = scalarParameterValueSchema(parameter.type.valueType)
    const numeric = ['integer', 'decimal'].includes(parameter.type.valueType)
    const text = parameter.type.valueType === 'text'
    if (
      !numeric &&
      (parameter.constraints.min !== undefined ||
        parameter.constraints.max !== undefined)
    )
      context.addIssue({
        code: 'custom',
        path: ['constraints'],
        message: 'Min and max constraints apply only to numeric parameters.',
      })
    if (
      !text &&
      (parameter.constraints.minLength !== undefined ||
        parameter.constraints.maxLength !== undefined ||
        parameter.constraints.pattern !== undefined)
    )
      context.addIssue({
        code: 'custom',
        path: ['constraints'],
        message:
          'Length and pattern constraints apply only to text parameters.',
      })
    if (
      parameter.defaultValue !== undefined &&
      !scalar.safeParse(parameter.defaultValue).success
    )
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'Scalar default must match its declared value type.',
      })
    if (
      parameter.constraints.allowedValues?.some(
        (value) => !scalar.safeParse(value).success,
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['constraints', 'allowedValues'],
        message: 'Allowed values must match the declared scalar type.',
      })
    if (
      parameter.constraints.min !== undefined &&
      parameter.constraints.max !== undefined &&
      parameter.constraints.min > parameter.constraints.max
    )
      context.addIssue({
        code: 'custom',
        path: ['constraints'],
        message: 'Constraint min must not exceed max.',
      })
    if (
      parameter.constraints.minLength !== undefined &&
      parameter.constraints.maxLength !== undefined &&
      parameter.constraints.minLength > parameter.constraints.maxLength
    )
      context.addIssue({
        code: 'custom',
        path: ['constraints'],
        message: 'Constraint minLength must not exceed maxLength.',
      })
    if (parameter.constraints.pattern !== undefined) {
      try {
        new RegExp(parameter.constraints.pattern)
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['constraints', 'pattern'],
          message: 'Constraint pattern must be a valid regular expression.',
        })
      }
    }
    if (
      parameter.defaultValue !== undefined &&
      scalar.safeParse(parameter.defaultValue).success
    ) {
      try {
        if (
          !scalarSatisfiesConstraints(
            parameter.type.valueType,
            parameter.defaultValue,
            parameter.constraints,
          )
        )
          context.addIssue({
            code: 'custom',
            path: ['defaultValue'],
            message: 'Scalar default must satisfy its declared constraints.',
          })
      } catch {
        // The invalid pattern issue above owns malformed regular expressions.
      }
    }
  })

export type Parameter = z.infer<typeof parameterSchema>

export function parseParameter(value: unknown): Parameter {
  return parameterSchema.parse(value)
}

export function safeParseParameter(value: unknown) {
  return parameterSchema.safeParse(value)
}
