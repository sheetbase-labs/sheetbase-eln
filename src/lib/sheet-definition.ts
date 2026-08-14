import { z } from 'zod'

import {
  FIELD_LOGICAL_TYPES,
  validateFieldDefinition,
} from './field-definition'

export const SHEET_DEFINITION_CONFIGURATION_FORMAT_VERSION = 1 as const

const uuid = z
  .string()
  .regex(
    /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
const key = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/)
const label = z.string().trim().min(1).max(200)
const jsonObject = z.record(z.string(), z.unknown())

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
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return false
    const [, year, month, day] = match
    return isCalendarDate(Number(year), Number(month), Number(day))
  }, 'Invalid calendar date.')
const isoTimestamp = z
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

function scalarValueSchema(valueType: (typeof FIELD_LOGICAL_TYPES)[number]) {
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
      return isoTimestamp
    case 'category':
    case 'reference':
      return uuid
  }
}

const optionSchema = z
  .object({
    id: uuid,
    key,
    label,
    displayOrder: z.number().int().min(0).max(10_000),
    lifecycle: z.enum(['active', 'retired']),
  })
  .strict()

const categorySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('embedded'),
      options: z.array(optionSchema).max(256),
    })
    .strict(),
  z.object({ kind: z.literal('vocabulary'), vocabularyId: uuid }).strict(),
])

const relationshipSchema = z
  .object({
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('model'), modelKey: key }).strict(),
      z.object({ kind: z.literal('dataset-schema'), schemaId: uuid }).strict(),
    ]),
    cardinality: z.enum(['one', 'many']),
  })
  .strict()

const fieldDefinitionSchema = z
  .object({
    fieldId: uuid,
    key,
    label,
    description: z.string().max(2_000).nullable(),
    logicalType: z.enum(FIELD_LOGICAL_TYPES),
    nullable: z.boolean(),
    defaultValue: z.unknown(),
    cardinality: z.enum(['one', 'many']),
    quantity: z
      .object({
        kind: label,
        dimension: label,
        storageUnit: label,
        allowedInputUnits: z.array(label).max(32).optional(),
        preferredDisplayUnit: label.optional(),
      })
      .strict()
      .nullable(),
    validation: z
      .object({
        min: z.number().finite().optional(),
        max: z.number().finite().optional(),
        minLength: z.number().int().min(0).max(100_000).optional(),
        maxLength: z.number().int().min(0).max(100_000).optional(),
        pattern: z.string().max(1_000).optional(),
        extensions: jsonObject.optional(),
      })
      .strict(),
    category: categorySchema.nullable(),
    relationship: relationshipSchema.nullable(),
    computation: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('stored') }).strict(),
      z.object({ mode: z.literal('computed'), expressionId: uuid }).strict(),
    ]),
    lifecycle: z.enum(['draft', 'backfilling', 'active', 'retired']),
  })
  .strict()
  .superRefine((field, context) => {
    for (const issue of validateFieldDefinition(field)) {
      context.addIssue({
        code: 'custom',
        path: [issue.path],
        message: issue.message,
      })
    }
    if (
      field.category?.kind === 'embedded' &&
      (new Set(field.category.options.map((item) => item.id)).size !==
        field.category.options.length ||
        new Set(field.category.options.map((item) => item.key)).size !==
          field.category.options.length)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['category'],
        message: 'Category option IDs and keys must be unique.',
      })
    }
    if (
      field.validation.min !== undefined &&
      field.validation.max !== undefined &&
      field.validation.min > field.validation.max
    ) {
      context.addIssue({
        code: 'custom',
        path: ['validation'],
        message: 'Validation min must not exceed max.',
      })
    }
    if (
      field.validation.minLength !== undefined &&
      field.validation.maxLength !== undefined &&
      field.validation.minLength > field.validation.maxLength
    ) {
      context.addIssue({
        code: 'custom',
        path: ['validation'],
        message: 'Validation minLength must not exceed maxLength.',
      })
    }
    if (field.validation.pattern !== undefined) {
      try {
        new RegExp(field.validation.pattern)
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['validation', 'pattern'],
          message: 'Validation pattern must be a valid regular expression.',
        })
      }
    }
    if (field.quantity?.allowedInputUnits) {
      const units = field.quantity.allowedInputUnits
      if (new Set(units).size !== units.length) {
        context.addIssue({
          code: 'custom',
          path: ['quantity', 'allowedInputUnits'],
          message: 'Allowed input units must be unique.',
        })
      }
      if (
        field.quantity.preferredDisplayUnit !== undefined &&
        field.quantity.preferredDisplayUnit !== field.quantity.storageUnit &&
        !units.includes(field.quantity.preferredDisplayUnit)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['quantity', 'preferredDisplayUnit'],
          message: 'Preferred display unit must be a storage or input unit.',
        })
      }
    } else if (
      field.quantity?.preferredDisplayUnit !== undefined &&
      field.quantity.preferredDisplayUnit !== field.quantity.storageUnit
    ) {
      context.addIssue({
        code: 'custom',
        path: ['quantity', 'preferredDisplayUnit'],
        message: 'Preferred display unit must be the storage unit.',
      })
    }
    if (
      field.defaultValue !== null &&
      !scalarValueSchema(field.logicalType).safeParse(field.defaultValue)
        .success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'Default value must match the field logical type.',
      })
    }
    if (
      field.defaultValue !== null &&
      field.logicalType === 'category' &&
      field.category?.kind === 'embedded' &&
      !field.category.options.some(
        (option) =>
          option.id === field.defaultValue && option.lifecycle === 'active',
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'Category default must name an active embedded option.',
      })
    }
  })

const datasetContractSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('exact'), schemaVersionId: uuid }).strict(),
  z
    .object({
      mode: z.literal('semantic'),
      requiredFieldIds: z
        .array(uuid)
        .min(1)
        .max(64)
        .refine((ids) => new Set(ids).size === ids.length, {
          message: 'Required field IDs must be unique.',
        }),
    })
    .strict(),
])

const parameterSchema = z
  .object({
    id: uuid,
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
        .object({ kind: z.literal('dataset'), contract: datasetContractSchema })
        .strict(),
      z
        .object({
          kind: z.literal('dataset-version'),
          contract: datasetContractSchema,
        })
        .strict(),
    ]),
    defaultValue: z.unknown().optional(),
    constraints: jsonObject,
  })
  .strict()
  .superRefine((parameter, context) => {
    if (
      parameter.defaultValue !== undefined &&
      parameter.type.kind !== 'scalar'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'Only scalar parameters may define defaults.',
      })
    }
    if (
      parameter.defaultValue !== undefined &&
      parameter.type.kind === 'scalar' &&
      !scalarValueSchema(parameter.type.valueType).safeParse(
        parameter.defaultValue,
      ).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'Scalar default must match its declared value type.',
      })
    }
  })

const configurationSchema = z
  .object({
    formatVersion: z.literal(SHEET_DEFINITION_CONFIGURATION_FORMAT_VERSION),
    parameters: z.array(parameterSchema).max(64),
    bindings: z
      .array(z.object({ id: uuid, key, parameterId: uuid }).strict())
      .max(64),
    rowIdentity: z
      .object({
        kind: z.enum(['source', 'composite', 'local']),
        columnIds: z.array(uuid).min(1).max(8),
      })
      .strict(),
    joins: z
      .array(
        z
          .object({
            id: uuid,
            leftBindingId: uuid,
            rightBindingId: uuid,
            leftColumnId: uuid,
            rightColumnId: uuid,
            joinType: z.enum(['inner', 'left']),
            cardinality: z.enum(['one-to-one', 'many-to-one']),
          })
          .strict(),
      )
      .max(16),
    columns: z
      .array(
        z
          .object({
            id: uuid,
            field: fieldDefinitionSchema,
            source: z.discriminatedUnion('kind', [
              z.object({ kind: z.literal('declared') }).strict(),
              z
                .object({
                  kind: z.literal('bound'),
                  bindingId: uuid,
                  sourceFieldId: uuid,
                })
                .strict(),
              z
                .object({ kind: z.literal('calculated'), calculationId: uuid })
                .strict(),
            ]),
          })
          .strict(),
      )
      .max(256),
    calculations: z
      .array(
        z
          .object({
            id: uuid,
            key,
            label,
            outputColumnId: uuid,
            inputColumnIds: z.array(uuid).max(64),
            expression: z
              .object({
                language: z.literal('sheetbase-formula-v1'),
                source: z.string().trim().min(1).max(8_192),
              })
              .strict(),
          })
          .strict(),
      )
      .max(128),
    writeBackRules: z
      .array(
        z
          .object({
            id: uuid,
            bindingId: uuid,
            mode: z.literal('update'),
            mappings: z
              .array(z.object({ columnId: uuid, targetFieldId: uuid }).strict())
              .min(1)
              .max(128),
          })
          .strict(),
      )
      .max(64),
    actions: z
      .array(
        z
          .object({
            id: uuid,
            key,
            label,
            kind: z.enum(['create-record', 'link-record', 'open-record']),
            bindingId: uuid.optional(),
            parameterId: uuid.optional(),
          })
          .strict(),
      )
      .max(64),
    presentation: z
      .object({
        columnOrder: z.array(uuid).max(256),
        hiddenColumnIds: z.array(uuid).max(256),
        columnWidths: z.record(uuid, z.number().int().min(40).max(1_000)),
        frozenColumnCount: z.number().int().min(0).max(256),
        density: z.enum(['compact', 'standard', 'comfortable']),
      })
      .strict(),
  })
  .strict()
  .superRefine((configuration, context) => {
    const unique = (items: Array<{ id: string }>, path: string) => {
      if (new Set(items.map((item) => item.id)).size !== items.length) {
        context.addIssue({
          code: 'custom',
          path: [path],
          message: `${path} IDs must be unique.`,
        })
      }
    }
    const uniqueKeys = (items: Array<{ key: string }>, path: string) => {
      if (new Set(items.map((item) => item.key)).size !== items.length) {
        context.addIssue({
          code: 'custom',
          path: [path],
          message: `${path} keys must be unique.`,
        })
      }
    }
    unique(configuration.parameters, 'parameters')
    unique(configuration.bindings, 'bindings')
    unique(configuration.joins, 'joins')
    unique(configuration.columns, 'columns')
    unique(configuration.calculations, 'calculations')
    unique(configuration.writeBackRules, 'writeBackRules')
    unique(configuration.actions, 'actions')
    uniqueKeys(configuration.parameters, 'parameters')
    uniqueKeys(configuration.bindings, 'bindings')
    uniqueKeys(
      configuration.columns.map((column) => column.field),
      'columns',
    )
    uniqueKeys(configuration.calculations, 'calculations')
    uniqueKeys(configuration.actions, 'actions')

    const parameterIds = new Set(
      configuration.parameters.map((item) => item.id),
    )
    const bindingIds = new Set(configuration.bindings.map((item) => item.id))
    const columnIds = new Set(configuration.columns.map((item) => item.id))
    const calculationIds = new Set(
      configuration.calculations.map((item) => item.id),
    )
    const columnsById = new Map(
      configuration.columns.map((column) => [column.id, column]),
    )
    const requireRef = (
      ok: boolean,
      path: (string | number)[],
      message: string,
    ) => {
      if (!ok) context.addIssue({ code: 'custom', path, message })
    }

    configuration.bindings.forEach((item, index) =>
      requireRef(
        parameterIds.has(item.parameterId),
        ['bindings', index, 'parameterId'],
        'Unknown parameter ID.',
      ),
    )
    configuration.rowIdentity.columnIds.forEach((id, index) =>
      requireRef(
        columnIds.has(id),
        ['rowIdentity', 'columnIds', index],
        'Unknown column ID.',
      ),
    )
    configuration.columns.forEach((item, index) => {
      requireRef(
        item.id === item.field.fieldId,
        ['columns', index, 'field', 'fieldId'],
        'Column and FieldDefinition IDs must match.',
      )
      if (item.source.kind === 'bound')
        requireRef(
          bindingIds.has(item.source.bindingId),
          ['columns', index, 'source', 'bindingId'],
          'Unknown binding ID.',
        )
      if (item.source.kind === 'calculated') {
        requireRef(
          calculationIds.has(item.source.calculationId),
          ['columns', index, 'source', 'calculationId'],
          'Unknown calculation ID.',
        )
        requireRef(
          item.field.computation.mode === 'computed' &&
            item.field.computation.expressionId === item.source.calculationId,
          ['columns', index, 'field', 'computation'],
          'Calculated fields must reference their calculation ID.',
        )
      } else
        requireRef(
          item.field.computation.mode === 'stored',
          ['columns', index, 'field', 'computation'],
          'Non-calculated fields must use stored computation semantics.',
        )
    })
    configuration.joins.forEach((item, index) => {
      const leftColumn = columnsById.get(item.leftColumnId)
      const rightColumn = columnsById.get(item.rightColumnId)
      requireRef(
        bindingIds.has(item.leftBindingId) &&
          bindingIds.has(item.rightBindingId),
        ['joins', index],
        'Join references an unknown binding ID.',
      )
      requireRef(
        columnIds.has(item.leftColumnId) && columnIds.has(item.rightColumnId),
        ['joins', index],
        'Join references an unknown column ID.',
      )
      requireRef(
        leftColumn?.source.kind === 'bound' &&
          leftColumn.source.bindingId === item.leftBindingId &&
          rightColumn?.source.kind === 'bound' &&
          rightColumn.source.bindingId === item.rightBindingId,
        ['joins', index],
        'Join columns must belong to their corresponding bindings.',
      )
    })
    configuration.calculations.forEach((item, index) => {
      requireRef(
        columnIds.has(item.outputColumnId),
        ['calculations', index, 'outputColumnId'],
        'Unknown output column ID.',
      )
      const outputs = configuration.columns.filter(
        (column) =>
          column.source.kind === 'calculated' &&
          column.source.calculationId === item.id,
      )
      requireRef(
        outputs.length === 1 && outputs[0].id === item.outputColumnId,
        ['calculations', index, 'outputColumnId'],
        'Calculation must have exactly one corresponding output column.',
      )
      item.inputColumnIds.forEach((id) =>
        requireRef(
          columnIds.has(id),
          ['calculations', index, 'inputColumnIds'],
          'Unknown input column ID.',
        ),
      )
    })
    configuration.writeBackRules.forEach((item, index) => {
      requireRef(
        bindingIds.has(item.bindingId),
        ['writeBackRules', index, 'bindingId'],
        'Unknown binding ID.',
      )
      item.mappings.forEach((mapping) =>
        requireRef(
          columnIds.has(mapping.columnId),
          ['writeBackRules', index, 'mappings'],
          'Unknown column ID.',
        ),
      )
    })
    configuration.actions.forEach((item, index) => {
      if (item.bindingId)
        requireRef(
          bindingIds.has(item.bindingId),
          ['actions', index, 'bindingId'],
          'Unknown binding ID.',
        )
      if (item.parameterId)
        requireRef(
          parameterIds.has(item.parameterId),
          ['actions', index, 'parameterId'],
          'Unknown parameter ID.',
        )
    })
    for (const [path, ids] of [
      ['columnOrder', configuration.presentation.columnOrder],
      ['hiddenColumnIds', configuration.presentation.hiddenColumnIds],
    ] as const) {
      requireRef(
        new Set(ids).size === ids.length,
        ['presentation', path],
        'Column IDs must be unique.',
      )
      ids.forEach((id) =>
        requireRef(
          columnIds.has(id),
          ['presentation', path],
          'Unknown column ID.',
        ),
      )
    }
    Object.keys(configuration.presentation.columnWidths).forEach((id) =>
      requireRef(
        columnIds.has(id),
        ['presentation', 'columnWidths'],
        'Unknown column ID.',
      ),
    )
    requireRef(
      configuration.presentation.columnOrder.length ===
        configuration.columns.length &&
        configuration.presentation.columnOrder.every((id) => columnIds.has(id)),
      ['presentation', 'columnOrder'],
      'Column order must contain every column exactly once.',
    )
  })

export type SheetDefinitionConfiguration = z.infer<typeof configurationSchema>

export function parseSheetDefinitionConfiguration(
  value: unknown,
): SheetDefinitionConfiguration {
  return configurationSchema.parse(value)
}

export function safeParseSheetDefinitionConfiguration(value: unknown) {
  return configurationSchema.safeParse(value)
}
