import { z } from 'zod'
import { t } from '#/copy'
import { nameList } from '#/lib/experiment-gates'
import type {
  GateBlockLike,
  GateCondition,
  GateContext,
  GatePartLike,
} from '#/lib/experiment-gates'

/** The named targets a gate's wording and editor can refer to. */
export interface GateTargets {
  tables: ReadonlyArray<{
    id: string
    label: string
    columns: readonly string[]
  }>
  steps: ReadonlyArray<{ id: string; number: number; text: string }>
  parts: ReadonlyArray<{ id: string; number: number; title: string }>
}

export const FIELD_LABELS = new Map(
  Object.entries({
    reviewer: () => t('notebook.gates.dialog.fieldReviewer'),
    assignee: () => t('notebook.gates.dialog.fieldAssignee'),
    planned_end: () => t('notebook.gates.dialog.fieldPlannedEnd'),
  }),
)

export function blockTitle(
  block: GateBlockLike | undefined,
  fallbackNumber: number,
): string {
  const title = z.string().catch('').parse(block?.payload.title).trim()

  return (
    title ||
    t('notebook.gates.dialog.untitledTable', { number: String(fallbackNumber) })
  )
}

function dateWords(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function describeCondition(
  condition: GateCondition,
  context: GateContext,
): string {
  switch (condition.kind) {
    case 'table_filled': {
      const block = context.blocks.find((b) => b.id === condition.blockId)

      const tables = context.blocks.filter(
        (b) => b.type === 'table' || b.type === 'sheet',
      )

      const table =
        condition.label?.trim() ||
        blockTitle(
          block,
          tables.findIndex((b) => b.id === condition.blockId) + 1,
        )

      if (condition.column && condition.minRows)
        return t('notebook.gates.describe.table_filled_column_rows', {
          table,
          column: condition.column,
          count: condition.minRows,
        })

      if (condition.column)
        return t('notebook.gates.describe.table_filled_column', {
          table,
          column: condition.column,
        })

      if (condition.minRows)
        return t('notebook.gates.describe.table_filled_rows', {
          table,
          count: condition.minRows,
        })

      return t('notebook.gates.describe.table_filled_any', { table })
    }

    case 'step_done': {
      const steps = context.blocks.filter((b) => b.type === 'procedure_step')

      const block = steps.find(
        (b) =>
          b.id === condition.blockId ||
          b.payload.sourceStepBlockId === condition.blockId,
      )

      const number = block
        ? steps.filter(
            (s) =>
              (s.partId ?? null) === (block.partId ?? null) &&
              s.order <= block.order,
          ).length
        : 0

      return t('notebook.gates.describe.step_done', { number: String(number) })
    }

    case 'part_done': {
      const part = context.parts.find(
        (p) => p.id === condition.partId || p.sourcePartId === condition.partId,
      )

      return part
        ? t('notebook.gates.describe.part_done', {
            number: String(part.number),
          })
        : t('notebook.gates.describe.thePart')
    }

    case 'samples_linked':
      return t('notebook.gates.describe.samples_linked', {
        count: condition.min ?? 1,
      })
    case 'field_set':
      return t('notebook.gates.describe.field_set', {
        field:
          condition.label?.trim() ||
          FIELD_LABELS.get(condition.field)?.() ||
          condition.field,
      })
    case 'date_reached':
      return t('notebook.gates.describe.date_reached', {
        date: dateWords(condition.date),
      })
    case 'qc_in_control':
      return condition.seriesId && condition.label?.trim()
        ? t('notebook.gates.describe.qc_in_control_series', {
            series: condition.label.trim(),
          })
        : t('notebook.gates.describe.qc_in_control_any')
    case 'plugin_flag':
      return t('notebook.gates.describe.plugin_flag', {
        flag: condition.label?.trim() || condition.extensionKey,
      })
    case 'plugin_check': {
      const block = context.blocks.find((b) => b.id === condition.blockId)

      return t('notebook.gates.describe.plugin_check', {
        check: condition.label?.trim() || condition.checkId,
        table: blockTitle(block, 1),
      })
    }
  }
}

/** "A and B", "A, B and C": the conditions of a gate in one phrase. */
export function describeConditions(
  conditions: readonly GateCondition[],
  context: GateContext,
): string {
  return nameList(conditions.map((c) => describeCondition(c, context)))
}

/** Name only targets earlier than the gate or part being configured. */
export function gateTargetsFrom(
  blocks: readonly (GateBlockLike & { tableColumns?: readonly string[] })[],
  parts: readonly GatePartLike[],
  options: {
    beforeOrder?: number
    beforePart?: number
    sheetColumns?: ReadonlyMap<string, readonly string[]>
  } = {},
): GateTargets {
  const above = [...blocks]
    .filter(
      (b) => options.beforeOrder === undefined || b.order < options.beforeOrder,
    )
    .sort((a, b) => a.order - b.order)

  const tables = above
    .filter((b) => b.type === 'table' || b.type === 'sheet')
    .map((b, index) => ({
      id: b.id,
      label: blockTitle(b, index + 1),
      columns:
        b.type === 'table'
          ? Array.isArray(b.payload.columns)
            ? z
                .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
                .parse(b.payload.columns)
                .map(String)
            : []
          : (options.sheetColumns?.get(b.id) ?? []),
    }))

  const steps = above
    .filter((b) => b.type === 'procedure_step')
    .map((b) => ({
      id: b.id,
      number: above.filter(
        (s) =>
          s.type === 'procedure_step' &&
          (s.partId ?? null) === (b.partId ?? null) &&
          s.order <= b.order,
      ).length,
      text: z.string().catch('').parse(b.payload.text),
    }))

  return {
    tables,
    steps,
    parts: parts.flatMap((p) =>
      options.beforePart === undefined || p.number < options.beforePart
        ? [{ id: p.id, number: p.number, title: p.title }]
        : [],
    ),
  }
}
