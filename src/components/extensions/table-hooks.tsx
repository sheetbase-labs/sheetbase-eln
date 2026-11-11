/**
 * What plugins add to a model's record list: cell displays (by field type,
 * model, field or a plugin's own field type), computed columns with a header
 * menu, and actions for the chosen rows.
 *
 * The browser only asks; every function runs on the server through
 * `/api/plugins/run`, as the signed-in person, and each answer is checked
 * there before it comes back.
 */
import * as React from 'react'
import { z } from 'zod'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'

import { Button } from '#/components/ui/button'
import { Spinner } from '#/components/ui/spinner'
import { toast } from '#/components/ui/sonner'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Icon } from '#/components/icons'
import type { DataTableFeatures } from '#/components/scientific/data-table'
import type { RecordModelRecord } from '#/components/models/models-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { downloadTextFile } from '#/lib/download'
import type { ModelFieldDefinition } from '#/lib/model-fields'
import type { CellDisplaySpec } from '#/lib/extensions/cell-display'
import { runPluginHook } from '#/lib/extensions/run-client'
import type { PluginHookAnswer } from '#/lib/extensions/run-client'
import type { ActionResult } from '#/lib/extensions/screens'
import type { RunnerItem } from '#/lib/extensions/runner-points'
import type {
  ExtensionColumnDeclaration,
  ExtensionRowActionDeclaration,
} from '#/lib/extensions/hooks'
import { t } from '#/copy'
import { CellDisplayView } from './cell-display'
import { PluginView } from './plugin-view'
import { pluginRow } from './plugin-row'
import { usePluginPoints } from './use-plugin-points'

/** The most rows one call carries; the server refuses more. */
const MAX_ROWS = 5000

interface FieldTypeLink {
  field_name: string
  plugin_key: string
  type_id: string
}

/** Which model fields a person has given a plugin's field type. */
export function useFieldPluginTypes(modelKey: string) {
  return useQuery({
    queryKey: ['plugin-hooks', 'field-types', modelKey],
    queryFn: () =>
      notebookDataClient.list<FieldTypeLink>(
        'field_plugin_types',
        `?kind=eq.${encodeURIComponent(modelKey)}&select=field_name,plugin_key,type_id`,
      ),
    staleTime: 30_000,
  })
}

const applies = (models: string[] | undefined, modelKey: string) =>
  !models || models.includes(modelKey)

/** Shows an action's answer: a notice, a small view in a dialog, or a file. */
export function usePluginActionRunner() {
  const [view, setView] = React.useState<{
    title: string
    node: NonNullable<ActionResult['view']>
  } | null>(null)

  const [busy, setBusy] = React.useState<string | null>(null)

  const run = React.useCallback(
    async (
      label: string,
      body: Parameters<typeof runPluginHook>[0] & {
        kind: 'row-action' | 'column-action'
      },
    ) => {
      setBusy(label)

      try {
        const answer =
          await runPluginHook<Extract<PluginHookAnswer, { kind: 'action' }>>(
            body,
          )

        if (answer.download) {
          try {
            downloadTextFile(
              answer.download.filename,
              answer.download.text,
              answer.download.mime,
            )
          } catch (error) {
            toast(
              t('plugins.hooks.actionFailed', { action: label, reason: '' }),
              {
                description: error instanceof Error ? error.message : undefined,
              },
            )
          }
        }

        if (answer.view) setView({ title: label, node: answer.view })

        if (answer.notice) {
          const text = answer.notice.text

          if (answer.notice.tone === 'danger') toast.error(text)
          else if (answer.notice.tone === 'success') toast.success(text)
          else toast(text)
        } else if (!answer.view && !answer.download) {
          toast(t('plugins.hooks.actionDone', { action: label }))
        }
      } catch (error) {
        toast.error(
          t('plugins.hooks.actionFailed', {
            action: label,
            reason: error instanceof Error ? error.message : String(error),
          }),
        )
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  const dialog = (
    <Dialog
      open={view !== null}
      onOpenChange={(open) => !open && setView(null)}
    >
      <DialogContent>
        <DialogHeader title={view?.title} />
        <DialogBody>{view ? <PluginView view={view.node} /> : null}</DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setView(null)}>
            {t('plugins.hooks.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { run, busy, dialog }
}

function ColumnHeader({
  item,
  onAction,
}: {
  item: RunnerItem<ExtensionColumnDeclaration>
  onAction: (actionId: string, title: string) => void
}) {
  const actions = item.declaration.actions ?? []

  return (
    <span className="inline-flex items-center gap-1">
      {item.declaration.title}
      {actions.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={t('plugins.hooks.columnMenuTitle', {
                  plugin: item.declaration.title,
                })}
                className="inline-flex size-5 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
              />
            }
          >
            <Icon name="more" size={12} />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {actions.map((action) => (
              <DropdownMenuItem
                key={action.id}
                onClick={() => onAction(action.id, action.title)}
              >
                {action.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </span>
  )
}

function ColumnValue({
  item,
  value,
  state,
}: {
  item: RunnerItem<ExtensionColumnDeclaration>
  value: string | number | boolean | null | undefined
  state: 'loading' | 'error' | 'ready'
}) {
  if (state === 'loading') return <Spinner className="size-3" />

  if (state === 'error')
    return (
      <span
        className="text-fg-faint"
        title={t('plugins.hooks.columnFailed', {
          column: item.declaration.title,
          reason: '',
        })}
      >
        —
      </span>
    )

  if (value === null || value === undefined)
    return <span className="text-fg-faint">—</span>
  const declaration = item.declaration

  const display: CellDisplaySpec | undefined =
    declaration.display ??
    (declaration.value === 'svg' ? { kind: 'svg' } : undefined)

  if (display) return <CellDisplayView spec={display} value={value} />

  const yesNo = z.boolean().safeParse(value).data

  if (yesNo !== undefined)
    return <span>{yesNo ? t('plugins.hooks.yes') : t('plugins.hooks.no')}</span>

  return <span>{String(value)}</span>
}

/**
 * The cell displays plugins offer a dataset grid, by column id. A column is
 * matched on its key and type with the same rules as a model's fields. A point
 * that names particular models or plugin field types does not apply here,
 * because a dataset column belongs to neither.
 */
export function gridCellDisplays(
  tableCells: ReadonlyArray<{
    declaration: {
      appliesTo: {
        models?: string[]
        fields?: string[]
        fieldTypes?: string[]
        pluginTypes?: string[]
      }
      display?: CellDisplaySpec
    }
  }>,
  columns: ReadonlyArray<{ id: string; key: string; logicalType: string }>,
): Record<string, CellDisplaySpec> {
  const out: Record<string, CellDisplaySpec> = {}
  for (const column of columns) {
    for (const cell of tableCells) {
      const target = cell.declaration.appliesTo
      const display = cell.declaration.display
      if (!display || target.models || target.pluginTypes) continue
      if (target.fields && !target.fields.includes(column.key)) continue
      if (target.fieldTypes && !target.fieldTypes.includes(column.logicalType))
        continue
      out[column.id] = display
      break
    }
  }
  return out
}

/** The plugin cell displays for a dataset grid's columns, by column id. */
export function usePluginGridCellDisplays(
  columns: ReadonlyArray<{ id: string; key: string; logicalType: string }>,
): Record<string, CellDisplaySpec> | undefined {
  const points = usePluginPoints()
  return React.useMemo(() => {
    if (points.tableCells.length === 0) return undefined
    const found = gridCellDisplays(points.tableCells, columns)
    return Object.keys(found).length > 0 ? found : undefined
  }, [points.tableCells, columns])
}

/**
 * The record list's plugin additions. `cellDisplay(field)` gives the display
 * to draw a field with (or nothing); `columns` are the computed columns;
 * `actions` are the row actions that apply to this model.
 */
export function usePluginTableHooks({
  modelKey,
  fields,
  records,
  ready = true,
}: {
  modelKey: string
  fields: readonly ModelFieldDefinition[]
  records: readonly RecordModelRecord[]
  /** False while the model's fields or records are still loading, so nothing is sent half-formed. */
  ready?: boolean
}) {
  const points = usePluginPoints()
  const fieldTypes = useFieldPluginTypes(modelKey)
  const runner = usePluginActionRunner()

  const typeOf = React.useMemo(() => {
    const map = new Map<string, FieldTypeLink>()

    for (const link of fieldTypes.data ?? []) map.set(link.field_name, link)

    return map
  }, [fieldTypes.data])

  /** The table cell point that draws this field, if one applies. */
  const cellFor = React.useCallback(
    (field: ModelFieldDefinition) => {
      const link = typeOf.get(field.fieldName)

      for (const cell of points.tableCells) {
        const target = cell.declaration.appliesTo

        if (!applies(target.models, modelKey)) continue

        if (target.fields && !target.fields.includes(field.fieldName)) continue

        if (target.fieldTypes && !target.fieldTypes.includes(field.logicalType))
          continue

        if (
          target.pluginTypes &&
          !(
            link &&
            link.plugin_key === cell.extensionKey &&
            target.pluginTypes.includes(link.type_id)
          )
        )
          continue

        return cell
      }

      return undefined
    },
    [typeOf, points.tableCells, modelKey],
  )

  const cellDisplay = React.useCallback(
    (field: ModelFieldDefinition): CellDisplaySpec | undefined => {
      const link = typeOf.get(field.fieldName)

      if (link) {
        const type = points.fieldTypes.find(
          (item) =>
            item.extensionKey === link.plugin_key && item.id === link.type_id,
        )

        if (type?.declaration.display) return type.declaration.display
      }

      return cellFor(field)?.declaration.display
    },
    [typeOf, points.fieldTypes, cellFor],
  )

  /** A plugin renderer (a UI bundle) that draws this field's cells, if one applies. */
  const cellRenderer = React.useCallback(
    (
      field: ModelFieldDefinition,
    ): { extensionKey: string; itemId: string } | undefined => {
      const cell = cellFor(field)

      return cell?.declaration.render
        ? { extensionKey: cell.extensionKey, itemId: cell.id }
        : undefined
    },
    [cellFor],
  )

  const columnItems = React.useMemo(
    () =>
      points.columns.filter((item) =>
        applies(item.declaration.models, modelKey),
      ),
    [points.columns, modelKey],
  )

  const actions = React.useMemo(
    () =>
      points.rowActions.filter((item) =>
        applies(item.declaration.models, modelKey),
      ),
    [points.rowActions, modelKey],
  )

  const stamp = React.useMemo(
    () => records.map((r) => `${r.id}:${r.updated_at}`).join('|'),
    [records],
  )

  const fieldKey = fields.map((f) => f.fieldName).join(',')

  const columnQueries = useQueries({
    queries: columnItems.map((item) => ({
      queryKey: [
        'plugin-hooks',
        'column',
        item.extensionKey,
        item.id,
        modelKey,
        stamp,
        fieldKey,
      ],
      queryFn: async () => {
        const answer = await runPluginHook<
          Extract<PluginHookAnswer, { kind: 'column' }>
        >({
          kind: 'column',
          extensionKey: item.extensionKey,
          itemId: item.id,
          rows: records
            .slice(0, MAX_ROWS)
            .map((r) => pluginRow(r, fields, item.declaration.inputs)),
        })

        return answer.values
      },
      enabled: ready && records.length > 0,
      staleTime: 60_000,
      retry: false,
    })),
  })

  // `run` is the runner's stable callback; the rest of the runner is state and
  // JSX, which the columns do not read.
  const run = runner.run

  const columns = React.useMemo<
    ColumnDef<DataTableFeatures, RecordModelRecord, unknown>[]
  >(
    () =>
      columnItems.map((item, index) => {
        const query = columnQueries.at(index)

        const values = query?.data
        const indexOf = new Map(records.map((r, i) => [r.id, i] as const))

        return {
          id: `plugin:${item.extensionKey}:${item.id}`,
          // The header carries its own menu button, so it is not a sort button too.
          enableSorting: false,
          header: () => (
            <ColumnHeader
              item={item}
              onAction={(actionId, title) =>
                void run(title, {
                  kind: 'column-action',
                  extensionKey: item.extensionKey,
                  itemId: item.id,
                  actionId,
                  rows: records
                    .slice(0, MAX_ROWS)
                    .map((r) => pluginRow(r, fields, item.declaration.inputs)),
                })
              }
            />
          ),
          accessorFn: (record) => {
            const at = indexOf.get(record.id)

            return at === undefined ? null : (values?.[at] ?? null)
          },
          cell: ({ row }) => {
            const at = indexOf.get(row.original.id)

            return (
              <ColumnValue
                item={item}
                value={at === undefined ? null : values?.[at]}
                state={
                  query?.isError
                    ? 'error'
                    : query?.isLoading
                      ? 'loading'
                      : 'ready'
                }
              />
            )
          },
        }
      }),
    [columnItems, columnQueries, records, fields, run],
  )

  return { cellDisplay, cellRenderer, columns, actions, runner }
}

/** Appears above the table when rows are chosen and a plugin has actions for them. */
export function PluginActionBar({
  actions,
  selected,
  fields,
  runner,
}: {
  actions: Array<RunnerItem<ExtensionRowActionDeclaration>>
  selected: RecordModelRecord[]
  fields: readonly ModelFieldDefinition[]
  runner: ReturnType<typeof usePluginActionRunner>
}) {
  if (actions.length === 0 || selected.length === 0) return null

  return (
    <div
      role="toolbar"
      aria-label={t('plugins.hooks.actionsMenu')}
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-muted px-3 py-1.5"
    >
      <span className="text-label text-fg-muted">
        {t('plugins.hooks.selectionBar', { count: selected.length })}
      </span>
      {actions.map((item) => {
        const tooMany =
          item.declaration.selection === 'one' && selected.length !== 1

        return (
          <Button
            key={`${item.extensionKey}:${item.id}`}
            size="sm"
            variant="secondary"
            disabled={tooMany || runner.busy !== null}
            title={
              tooMany
                ? t('plugins.hooks.chooseOne')
                : item.declaration.description
            }
            onClick={() =>
              void runner.run(item.declaration.title, {
                kind: 'row-action',
                extensionKey: item.extensionKey,
                itemId: item.id,
                rows: selected
                  .slice(0, MAX_ROWS)
                  .map((r) => pluginRow(r, fields, item.declaration.inputs)),
              })
            }
          >
            {runner.busy === item.declaration.title
              ? t('plugins.hooks.actionRunning', {
                  action: item.declaration.title,
                })
              : item.declaration.title}
          </Button>
        )
      })}
    </div>
  )
}
