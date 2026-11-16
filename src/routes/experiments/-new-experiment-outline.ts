import { BLOCK_PICKER_OPTIONS, blockDescriptor } from '#/lib/blocks/registry'
import type { BlockPayloadFields } from '#/lib/blocks/validators'
import type { NotebookTemplateConfiguration } from '#/lib/notebook-template'
import { t } from '#/copy'

/** What a template will make, cut to a readable length. */
export interface TemplateOutline {
  lines: OutlineLine[]
  /** How many lines the cut left out. */
  more: number
}

/** One line of what a template will put in the new notebook. */
export interface OutlineLine {
  id: string
  /** `part` heads a day; `item` is a block, sheet or section under it. */
  kind: 'part' | 'item'
  label: string
  /** The kind of block, for the small mark after the label. */
  note?: string
}

const SHOWN = 14

function blockLabel(type: string): string {
  const label = BLOCK_PICKER_OPTIONS.find((opt) => opt.type === type)?.label

  if (label) return label

  const words = type.replace(/_/g, ' ')

  return words.charAt(0).toUpperCase() + words.slice(1)
}

function narrativeLabel(
  blockType: string,
  payload: BlockPayloadFields,
): string {
  const summary = blockDescriptor(blockType)?.summary?.(payload)
  const text = (summary ?? '').split('\n')[0]?.trim() ?? ''

  if (!text || text === '(empty)') return blockLabel(blockType)

  return text.length > 70 ? `${text.slice(0, 69)}…` : text
}

/**
 * What a published template makes: its days (parts), then its sections, steps
 * and sheets in order. Long templates are cut with a count of what is left.
 */
export function templateOutline(
  configuration: NotebookTemplateConfiguration | null | undefined,
): TemplateOutline {
  if (!configuration) return { lines: [], more: 0 }

  const parts = configuration.parts ?? []
  const lines: OutlineLine[] = []

  const placements = [...configuration.placements].sort(
    (a, b) => a.order - b.order,
  )

  const itemOf = (placement: (typeof placements)[number]): OutlineLine => {
    const line = rawItemOf(placement)

    // A mark that only repeats the label says nothing.
    return line.note?.toLowerCase() === line.label.toLowerCase()
      ? { ...line, note: undefined }
      : line
  }

  const rawItemOf = (placement: (typeof placements)[number]): OutlineLine => {
    if (placement.kind === 'sheet') {
      return {
        id: placement.id,
        kind: 'item',
        label: placement.title || blockLabel('sheet'),
        note: blockLabel('sheet'),
      }
    }

    if (placement.kind === 'section_placeholder') {
      return { id: placement.id, kind: 'item', label: placement.label }
    }

    return {
      id: placement.id,
      kind: 'item',
      label: narrativeLabel(placement.blockType, placement.payload),
      note:
        placement.blockType === 'rich_text'
          ? undefined
          : placement.blockType === 'procedure_step'
            ? t('projects.newExperiment.outline.step')
            : blockLabel(placement.blockType),
    }
  }

  const partIds = new Set(parts.map((part) => part.id))

  const loose = placements.filter(
    (placement) =>
      !(
        'partId' in placement &&
        placement.partId &&
        partIds.has(placement.partId)
      ),
  )

  for (const placement of loose) lines.push(itemOf(placement))

  for (const part of [...parts].sort((a, b) => a.dayOffset - b.dayOffset)) {
    lines.push({
      id: part.id,
      kind: 'part',
      label: part.title,
      note: t('projects.newExperiment.outline.day', {
        day: part.dayOffset + 1,
      }),
    })

    for (const placement of placements) {
      if ('partId' in placement && placement.partId === part.id) {
        lines.push(itemOf(placement))
      }
    }
  }

  return {
    lines: lines.slice(0, SHOWN),
    more: Math.max(lines.length - SHOWN, 0),
  }
}
