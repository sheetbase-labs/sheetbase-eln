import { z } from 'zod'

const uuid = z.string().uuid()
const jsonObject = z.record(z.string(), z.unknown())

const localField = z
  .object({
    fieldId: uuid,
    key: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),
    label: z.string().trim().min(1).max(200),
    description: z.string().max(2_000).nullable(),
    logicalType: z.enum([
      'text', 'integer', 'decimal', 'boolean', 'date', 'timestamp', 'category', 'reference',
    ]),
    nullable: z.boolean(), defaultValue: z.unknown(), cardinality: z.enum(['one', 'many']),
    quantity: z.unknown().nullable(), validation: jsonObject, category: z.unknown().nullable(),
    relationship: z.unknown().nullable(), computation: z.unknown(), lifecycle: z.enum(['draft', 'backfilling', 'active', 'retired']),
  })
  .strict()

const binding = z.discriminatedUnion('kind', [
  z.object({ bindingId: uuid, parameterId: uuid, kind: z.literal('dataset'), datasetId: uuid, policy: z.discriminatedUnion('mode', [z.object({ mode: z.literal('live') }).strict(), z.object({ mode: z.literal('version'), datasetVersionId: uuid }).strict()]) }).strict(),
  z.object({ bindingId: uuid, parameterId: uuid, kind: z.literal('record'), recordId: uuid, policy: z.literal('live') }).strict(),
])

export const sheetInstanceStateSchema = z.object({
  bindings: z.array(binding).max(64),
  localFields: z.array(localField).max(256),
  localValues: z.record(uuid, jsonObject).refine((value) => Object.keys(value).length <= 10_000),
  calculationOverrides: z.record(uuid, jsonObject).refine((value) => Object.keys(value).length <= 128),
  presentation: jsonObject,
  provenance: z.object({ createdFrom: z.enum(['ad_hoc', 'definition_version', 'duplicate']), duplicatedFromInstanceId: uuid.optional() }).strict(),
}).strict().superRefine((value, context) => {
  if (new Set(value.bindings.map((item) => item.bindingId)).size !== value.bindings.length) context.addIssue({ code: 'custom', path: ['bindings'], message: 'Binding IDs must be unique.' })
  if (new Set(value.bindings.map((item) => item.parameterId)).size !== value.bindings.length) context.addIssue({ code: 'custom', path: ['bindings'], message: 'Parameter IDs must be unique.' })
  if (new Set(value.localFields.map((item) => item.fieldId)).size !== value.localFields.length) context.addIssue({ code: 'custom', path: ['localFields'], message: 'Local field IDs must be unique.' })
  if (JSON.stringify(value).length > 1_048_576) context.addIssue({ code: 'custom', message: 'Sheet Instance state exceeds 1 MiB.' })
})

export type SheetInstanceState = z.infer<typeof sheetInstanceStateSchema>
export type SheetInstanceParseResult = ReturnType<typeof safeParseSheetInstanceState>

export function safeParseSheetInstanceState(value: unknown) {
  return sheetInstanceStateSchema.safeParse(value)
}

export function parseSheetInstanceState(value: unknown): SheetInstanceState {
  return sheetInstanceStateSchema.parse(value)
}
