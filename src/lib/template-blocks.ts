/**
 * A template read as a notebook: each placement becomes the block an
 * experiment made from it would hold, so the template page can draw and edit
 * it with the notebook's own components. Edits come back as a new
 * configuration; nothing here writes.
 */
import { z } from 'zod'

import { isRichTextPayload } from '#/lib/blocks'
import { defaultPayloadFor } from '#/lib/blocks/registry'
import type { NotebookBlock } from '#/lib/notebook-data'
import { TEMPLATE_NARRATIVE_BLOCK_TYPES } from '#/lib/notebook-template'
import type {
  NotebookTemplateConfiguration,
  NotebookTemplatePlacement,
  TemplateNarrativeBlockType,
} from '#/lib/notebook-template'

/** A sheet the template places: drawn by the template page, not the notebook. */
export const TEMPLATE_SHEET_BLOCK = 'template_sheet'

/** An empty section each notebook fills in: drawn by the template page. */
export const TEMPLATE_SECTION_BLOCK = 'template_section'

type Payload = NotebookBlock['payload']

const narrativeTypes: ReadonlySet<string> = new Set(
  TEMPLATE_NARRATIVE_BLOCK_TYPES,
)

/** Whether a block of this type can be kept in a template as it is. */
export function isTemplateBlockType(
  type: string,
): type is TemplateNarrativeBlockType {
  return narrativeTypes.has(type)
}

const payloadSchema = z.record(z.string(), z.unknown())
const nonEmptyText = z.string().trim().min(1)
const listSchema = z.array(z.unknown())

/** A JSON object read as a block payload, or null when it is not one. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A stored placement's payload and its nested nodes are JSONB; this is where they are parsed.
function asPayload(value: unknown): Payload | null {
  const parsed = payloadSchema.safeParse(value)

  return parsed.success ? parsed.data : null
}

/** A block as a notebook holds it: its type and its payload. */
export interface TemplateBlock {
  type: string
  payload: Payload
}

function textNode(text: string) {
  return { type: 'text', text }
}

/**
 * The block a narrative placement becomes in a new experiment. Mirrors
 * `internal.template_block` in the database: a title beside the text turns
 * into a heading, a materials list keeps only its items, and a metric that
 * only names its fields becomes a short list to fill in.
 */
export function templateBlockOf(placement: {
  blockType: string
  payload: Payload
}): TemplateBlock {
  const payload: Payload = asPayload(placement.payload) ?? {}
  const type = placement.blockType
  const title = nonEmptyText.safeParse(payload.title)

  const heading = title.success
    ? {
        type: 'heading',
        attrs: { level: 2 },
        content: [textNode(title.data)],
      }
    : null

  if (type === 'rich_text') {
    if (heading === null && isRichTextPayload(payload)) {
      return { type, payload }
    }

    const doc = asPayload(payload.doc) ?? { type: 'doc', content: [] }
    const content = listSchema.safeParse(doc.content).data ?? []
    const startsWithHeading = asPayload(content[0])?.type === 'heading'

    const withHeading =
      heading && !startsWithHeading ? [heading, ...content] : content

    return {
      type,
      payload: {
        doc: {
          ...doc,
          content: withHeading.length ? withHeading : [{ type: 'paragraph' }],
        },
      },
    }
  }

  if (type === 'materials') {
    return {
      type,
      payload: { items: listSchema.safeParse(payload.items).data ?? [] },
    }
  }

  if (type === 'protocol_reference' && !('protocolRecordId' in payload)) {
    return { type, payload: {} }
  }

  if (type === 'chart' && !('spec' in payload)) {
    return { type, payload: {} }
  }

  if (type === 'metric' && !('label' in payload && 'value' in payload)) {
    const fields = (listSchema.safeParse(payload.fields).data ?? []).flatMap(
      (field) => {
        const name = nonEmptyText.safeParse(field)

        return name.success ? [name.data] : []
      },
    )

    const list = fields.length
      ? [
          {
            type: 'bulletList',
            content: fields.map((field) => ({
              type: 'listItem',
              content: [{ type: 'paragraph', content: [textNode(field)] }],
            })),
          },
        ]
      : [{ type: 'paragraph' }]

    return {
      type: 'rich_text',
      payload: {
        doc: { type: 'doc', content: [...(heading ? [heading] : []), ...list] },
      },
    }
  }

  return { type, payload }
}

/** The placements in the order a notebook shows them. */
export function orderedPlacements(
  placements: readonly NotebookTemplatePlacement[],
): NotebookTemplatePlacement[] {
  return [...placements].sort((a, b) => a.order - b.order)
}

/** A placement's part, if it can have one. */
export function placementPartId(
  placement: NotebookTemplatePlacement,
): string | null {
  return placement.kind === 'section_placeholder'
    ? null
    : (placement.partId ?? null)
}

/**
 * The template's placements as notebook blocks, in order. `versions` counts
 * the edits to each block so the notebook knows a payload changed.
 */
export function templateNotebookBlocks(
  templateId: string,
  placements: readonly NotebookTemplatePlacement[],
  versions: ReadonlyMap<string, number> = new Map(),
): NotebookBlock[] {
  return orderedPlacements(placements).map((placement) => {
    const block =
      placement.kind === 'narrative'
        ? templateBlockOf(placement)
        : {
            type:
              placement.kind === 'sheet'
                ? TEMPLATE_SHEET_BLOCK
                : TEMPLATE_SECTION_BLOCK,
            payload: {},
          }

    return {
      id: placement.id,
      recordId: templateId,
      type: block.type,
      payload: block.payload,
      payloadSchemaVersion: 1,
      order: placement.order,
      version: versions.get(placement.id) ?? 1,
      partId: placementPartId(placement),
    }
  })
}

function withOrders(
  placements: NotebookTemplatePlacement[],
): NotebookTemplatePlacement[] {
  return placements.map((placement, index) => ({
    ...placement,
    order: index + 1,
  }))
}

/** Keep a narrative block's new content; the placement takes the block's type. */
export function setPlacementBlock(
  config: NotebookTemplateConfiguration,
  id: string,
  block: { type: string; payload: Payload },
): NotebookTemplateConfiguration {
  if (!isTemplateBlockType(block.type)) return config

  const blockType = block.type

  return {
    ...config,
    placements: config.placements.map((placement) =>
      placement.id === id && placement.kind === 'narrative'
        ? { ...placement, blockType, payload: block.payload }
        : placement,
    ),
  }
}

/** Where a block goes: after one block, before another, or at an end. */
export interface BlockDestination {
  afterBlockId: string | null
  beforeBlockId: string | null
}

function placeAt(
  ordered: NotebookTemplatePlacement[],
  placement: NotebookTemplatePlacement,
  destination: BlockDestination,
): NotebookTemplatePlacement[] {
  const rest = ordered.filter((item) => item.id !== placement.id)

  if (destination.afterBlockId) {
    const at = rest.findIndex((item) => item.id === destination.afterBlockId)

    if (at >= 0)
      return [...rest.slice(0, at + 1), placement, ...rest.slice(at + 1)]
  }

  if (destination.beforeBlockId) {
    const at = rest.findIndex((item) => item.id === destination.beforeBlockId)

    if (at >= 0) return [...rest.slice(0, at), placement, ...rest.slice(at)]
  }

  return destination.afterBlockId === null && destination.beforeBlockId !== null
    ? [placement, ...rest]
    : [...rest, placement]
}

/**
 * Add a block to the template. It lands after `afterBlockId`, or at the end
 * of the part it is added to.
 */
export function insertTemplateBlock(
  config: NotebookTemplateConfiguration,
  input: {
    id: string
    type: TemplateNarrativeBlockType
    payload?: Payload
    afterBlockId?: string | null
    partId?: string | null
  },
): NotebookTemplateConfiguration {
  const ordered = orderedPlacements(config.placements)
  const after = ordered.find((item) => item.id === input.afterBlockId)
  const partId = after ? placementPartId(after) : (input.partId ?? null)

  const placement: NotebookTemplatePlacement = {
    id: input.id,
    kind: 'narrative',
    order: ordered.length + 1,
    blockType: input.type,
    payload: input.payload ?? defaultPayloadFor(input.type),
  }

  if (partId) placement.partId = partId

  // With nothing to follow, a block goes after the last one of its part.
  const lastOfPart = partId
    ? ordered.filter((item) => placementPartId(item) === partId).at(-1)
    : ordered.at(-1)

  const afterBlockId = after?.id ?? lastOfPart?.id ?? null

  return {
    ...config,
    placements: withOrders(
      placeAt(ordered, placement, {
        afterBlockId,
        beforeBlockId: afterBlockId ? null : (ordered[0]?.id ?? null),
      }),
    ),
  }
}

/** Remove a block from the template. */
export function removeTemplateBlock(
  config: NotebookTemplateConfiguration,
  id: string,
): NotebookTemplateConfiguration {
  return {
    ...config,
    placements: withOrders(
      orderedPlacements(config.placements).filter((item) => item.id !== id),
    ),
  }
}

/** Move a block between two others. */
export function moveTemplateBlock(
  config: NotebookTemplateConfiguration,
  id: string,
  destination: BlockDestination,
): NotebookTemplateConfiguration {
  const ordered = orderedPlacements(config.placements)
  const placement = ordered.find((item) => item.id === id)

  if (!placement) return config

  return {
    ...config,
    placements: withOrders(placeAt(ordered, placement, destination)),
  }
}

/** Copy a narrative block to just after itself. */
export function duplicateTemplateBlock(
  config: NotebookTemplateConfiguration,
  id: string,
  newId: string,
): NotebookTemplateConfiguration {
  const placement = config.placements.find((item) => item.id === id)

  if (!placement || placement.kind !== 'narrative') return config

  return insertTemplateBlock(config, {
    id: newId,
    type: placement.blockType,
    payload: structuredClone(placement.payload),
    afterBlockId: id,
  })
}
