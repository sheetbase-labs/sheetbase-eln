import { z } from 'zod'

import type { NotebookTemplateConfiguration } from './notebook-template'

/**
 * A notebook template as the assistant drafts it: plain steps, notes, checklists
 * and callouts, optionally grouped under named parts. The builder turns that
 * into the configuration a template version stores, with fresh identities, so
 * the model never has to produce an id.
 */
const partName = z
  .string()
  .min(1)
  .max(120)
  .optional()
  .describe('The part (a day or stage) this belongs to, by its title.')

interface ChecklistItem {
  id: string
  text: string
  checked: boolean
  durationSeconds?: number
}

export const templateDraftBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('step'),
    text: z
      .string()
      .min(1)
      .max(1500)
      .describe('One thing to do, written as an instruction.'),
    minutes: z
      .number()
      .int()
      .min(1)
      .max(10_080)
      .optional()
      .describe('How long the step takes, when it is timed.'),
    part: partName,
  }),
  z.strictObject({
    type: z.literal('note'),
    text: z
      .string()
      .min(1)
      .max(4000)
      .describe('Free text. Blank lines start new paragraphs.'),
    part: partName,
  }),
  z.strictObject({
    type: z.literal('checklist'),
    items: z.array(z.string().min(1).max(300)).min(1).max(40),
    part: partName,
  }),
  z.strictObject({
    type: z.literal('callout'),
    text: z.string().min(1).max(1000),
    variant: z.enum(['info', 'warning', 'note', 'danger']).default('info'),
    part: partName,
  }),
  z.strictObject({
    type: z.literal('plate_map'),
    part: partName,
  }),
])

export type TemplateDraftBlock = z.infer<typeof templateDraftBlockSchema>

export const templateDraftSchema = {
  parts: z
    .array(
      z.strictObject({
        title: z.string().min(1).max(120),
        dayOffset: z
          .number()
          .int()
          .min(0)
          .max(365)
          .optional()
          .describe('Days after the start. 0 for the first.'),
      }),
    )
    .max(20)
    .optional()
    .describe('Stages or days, in order. Leave out for a single-day template.'),
  blocks: z
    .array(templateDraftBlockSchema)
    .min(1)
    .max(120)
    .describe('The content, in order.'),
}

interface DraftInput {
  parts?: Array<{ title: string; dayOffset?: number | undefined }> | undefined
  blocks: TemplateDraftBlock[]
}

const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => ({
      type: 'paragraph' as const,
      content: [{ type: 'text' as const, text: paragraph }],
    }))

/** What the card shows: how many of each kind of block the draft holds. */
export function describeTemplateDraft(input: DraftInput): string[] {
  const counts = new Map<TemplateDraftBlock['type'], number>()

  for (const block of input.blocks)
    counts.set(block.type, (counts.get(block.type) ?? 0) + 1)

  const label = {
    step: ['step', 'steps'],
    note: ['note', 'notes'],
    checklist: ['checklist', 'checklists'],
    callout: ['callout', 'callouts'],
    plate_map: ['plate map', 'plate maps'],
  } as const satisfies Record<
    TemplateDraftBlock['type'],
    readonly [string, string]
  >

  const lines: string[] = []

  const partCount = input.parts?.length ?? 0

  if (partCount > 0)
    lines.push(`${partCount} ${partCount === 1 ? 'part' : 'parts'}`)

  for (const [type, count] of counts) {
    const [one, many] = label[type]
    lines.push(`${count} ${count === 1 ? one : many}`)
  }

  return lines
}

function baseFor(id: string, order: number, partId: string | undefined) {
  const base = { id, kind: 'narrative' as const, order }

  return partId ? { ...base, partId } : base
}

/**
 * The configuration for a template version. `newId` is injected so a test can
 * make the ids predictable.
 */
export function buildTemplateConfiguration(
  input: DraftInput,
  newId: () => string = () => crypto.randomUUID(),
): NotebookTemplateConfiguration {
  const partIds = new Map<string, string>()
  const parts: NonNullable<NotebookTemplateConfiguration['parts']> = []

  const partFor = (title: string, dayOffset?: number): string => {
    const known = partIds.get(title.toLowerCase())

    if (known) return known
    const id = newId()
    partIds.set(title.toLowerCase(), id)
    parts.push({ id, title, dayOffset: dayOffset ?? 0 })

    return id
  }

  for (const part of input.parts ?? []) partFor(part.title, part.dayOffset)

  const placements: NotebookTemplateConfiguration['placements'] = []

  let stepList: { partId: string | undefined; items: ChecklistItem[] } | null =
    null

  for (const block of input.blocks) {
    const partId = block.part ? partFor(block.part) : undefined

    if (block.type !== 'step') stepList = null

    const base = baseFor(newId(), placements.length + 1, partId)

    switch (block.type) {
      case 'step': {
        // A notebook template cannot hold procedure steps: those belong to a
        // protocol record, and an experiment only takes them from a pinned
        // protocol. Steps become a checklist, each item timed when it has a
        // length, so the template can start an experiment.
        const item: ChecklistItem = {
          id: newId(),
          text: block.text,
          checked: false,
        }

        if (block.minutes) item.durationSeconds = block.minutes * 60

        if (stepList && stepList.partId === partId) {
          stepList.items.push(item)
        } else {
          const items = [item]

          placements.push({
            ...base,
            blockType: 'checklist',
            payload: { items },
          })

          stepList = { partId, items }
        }

        continue
      }

      case 'note':
        placements.push({
          ...base,
          blockType: 'rich_text',
          payload: { doc: { type: 'doc', content: paragraphs(block.text) } },
        })
        break
      case 'checklist':
        placements.push({
          ...base,
          blockType: 'checklist',
          payload: {
            items: block.items.map((text) => ({ text, checked: false })),
          },
        })
        break
      case 'callout':
        placements.push({
          ...base,
          blockType: 'callout',
          payload: { text: block.text, variant: block.variant },
        })
        break
      case 'plate_map':
        placements.push({ ...base, blockType: 'plate_map', payload: {} })
        break
    }
  }

  const configuration: NotebookTemplateConfiguration = {
    formatVersion: 1,
    parameters: [],
    placements,
  }

  if (parts.length > 0) configuration.parts = parts

  return configuration
}
