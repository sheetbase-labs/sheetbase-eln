import { z } from 'zod'

import { parameterSchema, parameterUuidSchema } from './parameter'

export const NOTEBOOK_TEMPLATE_CONFIGURATION_FORMAT_VERSION = 1 as const

const uuid = parameterUuidSchema
const key = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/)
const label = z.string().trim().min(1).max(200)
const order = z.number().int().positive()

/**
 * What a template can ask of a part before it opens. A template has no tables
 * or steps of its own to point at yet, so it waits on an earlier part, on
 * samples being linked or on a field being set.
 */
export const templateGateConditionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('part_done'), partId: uuid }),
  z.strictObject({
    kind: z.literal('samples_linked'),
    min: z.number().int().min(1).max(10000).optional(),
  }),
  z.strictObject({
    kind: z.literal('field_set'),
    field: z.enum(['reviewer', 'assignee', 'planned_end']),
    label: z.string().trim().max(200).optional(),
  }),
])

/** A part of the experiment a template makes: one day of a longer notebook. */
export const notebookTemplatePartSchema = z.strictObject({
  id: uuid,
  title: label,
  dayOffset: z.number().int().min(0).max(3650),
  /** The part opens when all of these hold. Stays on every experiment made from the template. */
  opensWhen: z.array(templateGateConditionSchema).max(12).optional(),
  gateMode: z.enum(['warn', 'block']).optional(),
  /** The steps of the part are done in order. */
  stepsInOrder: z.boolean().optional(),
})

const narrativePlacementSchema = z.strictObject({
  id: uuid,
  partId: uuid.optional(),
  kind: z.literal('narrative'),
  order,
  blockType: z.enum([
    'rich_text',
    'checklist',
    'linked_record',
    'callout',
    'table',
    'chart',
    'plate_map',
    'file',
    'metric',
    'procedure_step',
    'protocol_reference',
    'materials',
    'gate',
  ]),
  payload: z.record(z.string(), z.unknown()),
})

const sheetPlacementSchema = z.strictObject({
  id: uuid,
  kind: z.literal('sheet'),
  partId: uuid.optional(),
  order,
  definitionVersionId: uuid,
  title: z.string().trim().max(200).optional(),
  parameterMappings: z
    .array(
      z.strictObject({
        templateParameterId: uuid,
        definitionParameterId: uuid,
      }),
    )
    .max(64),
})

const sectionPlaceholderSchema = z.strictObject({
  id: uuid,
  kind: z.literal('section_placeholder'),
  order,
  key,
  label,
})

export const notebookTemplatePlacementSchema = z.discriminatedUnion('kind', [
  narrativePlacementSchema,
  sheetPlacementSchema,
  sectionPlaceholderSchema,
])

export const notebookTemplateConfigurationSchema = z
  .strictObject({
    formatVersion: z.literal(NOTEBOOK_TEMPLATE_CONFIGURATION_FORMAT_VERSION),
    parameters: z.array(parameterSchema).max(64),
    parts: z.array(notebookTemplatePartSchema).max(60).optional(),
    /** Each part is signed when its steps are done. Unset follows Regulated lab. */
    signOffParts: z.boolean().optional(),
    placements: z.array(notebookTemplatePlacementSchema).max(256),
  })
  .superRefine((config, context) => {
    const parameterIds = new Set<string>()
    const parameterKeys = new Set<string>()

    for (const parameter of config.parameters) {
      if (parameterIds.has(parameter.id) || parameterKeys.has(parameter.key)) {
        context.addIssue({
          code: 'custom',
          message: 'Template parameter identities must be unique.',
        })

        return
      }

      parameterIds.add(parameter.id)
      parameterKeys.add(parameter.key)
    }

    const partIds = new Set<string>()

    for (const part of config.parts ?? []) {
      if (partIds.has(part.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Template part identities must be unique.',
        })

        return
      }

      partIds.add(part.id)
    }

    const placementIds = new Set<string>()
    const orders = new Set<number>()

    for (const placement of config.placements) {
      if (placementIds.has(placement.id) || orders.has(placement.order)) {
        context.addIssue({
          code: 'custom',
          message: 'Template placement identities and order must be unique.',
        })

        return
      }

      placementIds.add(placement.id)
      orders.add(placement.order)

      if ('partId' in placement && placement.partId) {
        if (!partIds.has(placement.partId)) {
          context.addIssue({
            code: 'custom',
            message: 'A placement names a part the Template does not have.',
          })
        }
      }

      if (placement.kind !== 'sheet') continue

      for (const mapping of placement.parameterMappings) {
        if (!parameterIds.has(mapping.templateParameterId)) {
          context.addIssue({
            code: 'custom',
            message: 'parameter mapping names an unknown Template parameter',
          })
        }
      }
    }
  })

export type NotebookTemplateConfiguration = z.infer<
  typeof notebookTemplateConfigurationSchema
>

export type NotebookTemplatePlacement = z.infer<
  typeof notebookTemplatePlacementSchema
>

export function parseNotebookTemplateConfiguration(
  value: unknown,
): NotebookTemplateConfiguration {
  return notebookTemplateConfigurationSchema.parse(value)
}
