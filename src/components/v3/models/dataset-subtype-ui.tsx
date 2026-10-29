import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { Textarea } from '#/components/v3/inventory/list'
import { toast } from '#/components/v3/ui/sonner'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { describeTypeError } from './model-subtype-data'
import { subtypeKey } from './model-subtype-ui'
import type { InheritedGroup } from './inherited-fields-table'
import { rich, t } from '#/copy'

/**
 * Measurement table subtypes. A subtype holds its parent's columns in each of
 * its versions, so data recorded against it has every column of the tables
 * above it; the database refuses a version that drops or retypes one.
 */
export interface MeasurementTable {
  id: string
  name: string
  parentId: string | null
}

export const measurementTableKeys = {
  all: ['ui-port', 'measurement-tables'] as const,
  inherited: (id: string) =>
    ['ui-port', 'measurement-tables', 'inherited', id] as const,
}

export async function fetchMeasurementTables(
  client: DataClient,
): Promise<MeasurementTable[]> {
  const rows = await client.list<{
    id: string
    name: string
    parent_id: string | null
  }>('dataset_schema_definitions', '?select=id,name,parent_id&order=name.asc')
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
  }))
}

export function useMeasurementTables() {
  return useQuery({
    queryKey: measurementTableKeys.all,
    queryFn: () => fetchMeasurementTables(notebookDataClient),
    staleTime: 30_000,
  })
}

/** The tables above `id`, nearest first. */
export function tableAncestors(
  tables: readonly MeasurementTable[],
  id: string,
): MeasurementTable[] {
  const byId = new Map(tables.map((table) => [table.id, table]))
  const out: MeasurementTable[] = []
  const seen = new Set([id])
  let parent = byId.get(id)?.parentId ?? null
  while (parent && !seen.has(parent)) {
    seen.add(parent)
    const table = byId.get(parent)
    if (!table) break
    out.push(table)
    parent = table.parentId
  }
  return out
}

/** Tables `id` can sit under: any other table except its own subtypes. */
export function tableParentChoices(
  tables: readonly MeasurementTable[],
  id: string,
): MeasurementTable[] {
  return tables.filter(
    (table) =>
      table.id !== id &&
      !tableAncestors(tables, table.id).some((above) => above.id === id),
  )
}

export interface InheritedColumn {
  key: string
  label: string
  type: string
  unit: string | null
  nullable: boolean
}

export interface InheritedColumns {
  tableId: string
  tableName: string
  columns: InheritedColumn[]
}

const COLUMN_TYPES: Record<string, string> = {
  text: t('library.models.datasetSubtypeUi.text'),
  integer: t('library.models.datasetSubtypeUi.numberWhole'),
  decimal: t('library.models.datasetSubtypeUi.number'),
  boolean: t('library.models.datasetSubtypeUi.yesNo'),
  date: t('library.models.datasetSubtypeUi.date'),
  timestamp: t('library.models.datasetSubtypeUi.dateAndTime'),
  category: t('library.models.datasetSubtypeUi.choice'),
  reference: t('library.models.datasetSubtypeUi.reference'),
}

/** A column's type as a scientist reads it, with its unit: "Number · µm". */
export function columnTypeLabel(
  logicalType: string,
  quantity: unknown,
): string {
  const q =
    quantity && typeof quantity === 'object'
      ? (quantity as { symbol?: unknown; unit?: unknown })
      : {}
  const unit = [q.symbol, q.unit].find(
    (value): value is string => typeof value === 'string' && value !== '',
  )
  const type = COLUMN_TYPES[logicalType] ?? logicalType
  return unit ? `${type} · ${unit}` : type
}

/** Each ancestor's published columns, from the top of the chain down. */
export async function fetchInheritedColumns(
  client: DataClient,
  tables: readonly MeasurementTable[],
  id: string,
): Promise<InheritedColumns[]> {
  const chain = tableAncestors(tables, id).reverse()
  return Promise.all(
    chain.map(async (table) => {
      const published = (
        await client.list<{ id: string }>(
          'dataset_schema_versions',
          `?schema_id=eq.${table.id}&lifecycle=eq.active&order=version.desc&limit=1&select=id`,
        )
      ).at(0)
      const fields = published
        ? await client.list<{
            key: string
            label: string
            logical_type: string
            nullable: boolean
            quantity: unknown
          }>(
            'dataset_schema_version_fields',
            `?schema_version_id=eq.${published.id}&lifecycle=eq.active&order=display_order.asc&select=key,label,logical_type,nullable,quantity`,
          )
        : []
      return {
        tableId: table.id,
        tableName: table.name,
        columns: fields.map((field) => ({
          key: field.key,
          label: field.label,
          type: columnTypeLabel(field.logical_type, field.quantity),
          unit: null,
          nullable: field.nullable,
        })),
      }
    }),
  )
}

/** "Subtype of ViCell", linked, for a measurement table's header. */
export function TableSubtypeOf({ id }: { id: string }) {
  const tables = useMeasurementTables().data ?? []
  const parent = tableAncestors(tables, id).at(0)
  if (!parent) return null
  return (
    <span>
      {rich('library.models.datasetSubtypeUi.subtypeOf', {
        name: parent.name,
        link: (text) => (
          <Link
            to="/models/$modelId"
            params={{ modelId: parent.id }}
            className="text-link hover:underline"
          >
            {text}
          </Link>
        ),
      })}
    </span>
  )
}

export function TableSubtypesList({ id }: { id: string }) {
  const tables = useMeasurementTables().data ?? []
  const direct = tables.filter((table) => table.parentId === id)
  if (!direct.length) return null
  return (
    <span>
      {t('library.models.datasetSubtypeUi.subtypes')}{' '}
      {direct.map((table, index) => (
        <span key={table.id}>
          {index ? ', ' : ''}
          <Link
            to="/models/$modelId"
            params={{ modelId: table.id }}
            className="text-link hover:underline"
          >
            {table.name}
          </Link>
        </span>
      ))}
    </span>
  )
}

function useInheritedColumns(id: string) {
  const tables = useMeasurementTables()
  const parent = tables.data ? tableAncestors(tables.data, id).at(0) : null
  const inherited = useQuery({
    queryKey: measurementTableKeys.inherited(id),
    queryFn: () =>
      fetchInheritedColumns(notebookDataClient, tables.data ?? [], id),
    enabled: Boolean(parent),
    staleTime: 15_000,
  })
  return { parent, inherited }
}

/** The columns `id` gets from the tables above it, as fields-table groups. */
export function useInheritedColumnGroups(id: string): {
  groups: InheritedGroup[]
  keys: ReadonlySet<string>
} {
  const { data } = useInheritedColumns(id).inherited
  return useMemo(() => {
    const groups = (data ?? []).map((group) => ({
      modelId: group.tableId,
      modelName: group.tableName,
      rows: group.columns.map((column) => ({
        id: `${group.tableId}:${column.key}`,
        label: column.label,
        key: column.key,
        type: column.type,
        unit: column.unit,
        required: column.nullable
          ? t('common.states.optional')
          : t('library.models.datasetSubtypeUi.yes'),
      })),
    }))
    return {
      groups,
      keys: new Set(groups.flatMap((g) => g.rows.map((r) => r.key))),
    }
  }, [data])
}

export function NewTableSubtypeDialog({
  open,
  onOpenChange,
  parent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  parent: { id: string; name: string }
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const nameError = name.trim()
    ? undefined
    : t('library.models.datasetSubtypeUi.nameIsRequired')
  const create = useMutation({
    mutationFn: () =>
      notebookDataClient.rpc<{ schema_definition_id: string }>(
        'create_dataset_schema_subtype',
        {
          p_parent_id: parent.id,
          p_key: subtypeKey(name),
          p_name: name.trim(),
          p_description: description.trim() || null,
        },
      ),
    onSuccess: (created) => {
      void queryClient.invalidateQueries()
      onOpenChange(false)
      toast(`${name.trim()} created`, {
        description: t('library.models.datasetSubtypeUi.itHasSColumnsAdd', {
          name: parent.name,
        }),
      })
      reset()
      void navigate({
        to: '/models/$modelId/edit',
        params: { modelId: created.schema_definition_id },
      })
    },
  })
  function reset() {
    setName('')
    setDescription('')
    setSubmitted(false)
    create.reset()
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.models.datasetSubtypeUi.newSubtypeOf', {
            name: parent.name,
          })}
          description={t(
            'library.models.datasetSubtypeUi.aMeasurementTableWithEvery',
            { name: parent.name },
          )}
        />
        <DialogBody>
          <form
            id="new-table-subtype-form"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              setSubmitted(true)
              if (nameError) return
              create.mutate()
            }}
          >
            <Field
              label={t('library.models.datasetSubtypeUi.name')}
              required
              error={submitted ? nameError : undefined}
            >
              <Input
                autoFocus
                value={name}
                placeholder={t('library.models.datasetSubtypeUi.eGBlu', {
                  name: parent.name,
                })}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field
              label={t('library.models.datasetSubtypeUi.description')}
              hint={t('common.states.optional')}
            >
              <Textarea
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            {create.error ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {/duplicate key|unique/i.test(create.error.message)
                  ? t(
                      'library.models.datasetSubtypeUi.aMeasurementTableWithThat',
                    )
                  : describeTypeError(create.error)}
              </p>
            ) : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="new-table-subtype-form"
            disabled={create.isPending}
          >
            {create.isPending
              ? t('library.models.datasetSubtypeUi.creating')
              : t('library.models.datasetSubtypeUi.createSubtype')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TableBasedOnDialog({
  open,
  onOpenChange,
  table,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  table: { id: string; name: string }
}) {
  const queryClient = useQueryClient()
  const tables = useMeasurementTables().data ?? []
  const current = tables.find((item) => item.id === table.id)?.parentId ?? null
  const [choice, setChoice] = useState(current ?? '')
  const save = useMutation({
    mutationFn: () =>
      notebookDataClient.rpc('reparent_dataset_schema', {
        p_definition_id: table.id,
        p_parent_id: choice || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries()
      onOpenChange(false)
      toast(
        choice
          ? t('library.models.datasetSubtypeUi.isNowASubtypeOf', {
              name: table.name,
              name2:
                tables.find((item) => item.id === choice)?.name ?? 'that table',
            })
          : t('library.models.datasetSubtypeUi.nowStandsOnItsOwn', {
              name: table.name,
            }),
      )
    },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.models.datasetSubtypeUi.changeWhatIsBasedOn', {
            name: table.name,
          })}
          description={t(
            'library.models.datasetSubtypeUi.itsOpenDraftTakesThe',
          )}
        />
        <DialogBody>
          <div className="flex flex-col gap-3">
            <Field label={t('library.models.datasetSubtypeUi.basedOn')}>
              <Select
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
              >
                <option value="">
                  {t('library.models.datasetSubtypeUi.nothingItsOwnTable')}
                </option>
                {tableParentChoices(tables, table.id).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
            {save.error ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {describeTypeError(save.error)}
              </p>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending || choice === (current ?? '')}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('library.models.datasetSubtypeUi.moving')
              : t('library.models.datasetSubtypeUi.move')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
