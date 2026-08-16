import { z } from 'zod'

import { parameterSchema, parameterUuidSchema } from './parameter'

export const NOTEBOOK_TEMPLATE_CONFIGURATION_FORMAT_VERSION = 1 as const

const uuid = parameterUuidSchema
const key = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/)
const label = z.string().trim().min(1).max(200)
const order = z.number().int().positive()

const narrativePlacementSchema = z
  .object({
    id: uuid,
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
    ]),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict()

const sheetPlacementSchema = z
  .object({
    id: uuid,
    kind: z.literal('sheet'),
    order,
    definitionVersionId: uuid,
    title: z.string().trim().max(200).optional(),
    parameterMappings: z
      .array(
        z
          .object({
            templateParameterId: uuid,
            definitionParameterId: uuid,
          })
          .strict(),
      )
      .max(64),
  })
  .strict()

const sectionPlaceholderSchema = z
  .object({
    id: uuid,
    kind: z.literal('section_placeholder'),
    order,
    key,
    label,
  })
  .strict()

export const notebookTemplatePlacementSchema = z.discriminatedUnion('kind', [
  narrativePlacementSchema,
  sheetPlacementSchema,
  sectionPlaceholderSchema,
])

export const notebookTemplateConfigurationSchema = z
  .object({
    formatVersion: z.literal(NOTEBOOK_TEMPLATE_CONFIGURATION_FORMAT_VERSION),
    parameters: z.array(parameterSchema).max(64),
    placements: z.array(notebookTemplatePlacementSchema).max(256),
  })
  .strict()
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
