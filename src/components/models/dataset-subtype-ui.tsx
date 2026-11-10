import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { Textarea } from '#/components/inventory/list'
import { toast } from '#/components/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'
import { describeTypeError } from './model-subtype-data'
import { subtypeKey } from './model-subtype-choices'
import type { InheritedGroup } from './inherited-fields-data'
import { rich, t } from '#/copy'
import {
  measurementTableKeys,
  fetchMeasurementTables,
  tableAncestors,
  tableParentChoices,
  fetchInheritedColumns,
} from './dataset-subtype-data'

/**
 * Measurement table subtypes. A subtype holds its parent's columns in each of
 * its versions, so data recorded against it has every column of the tables
 * above it; the database refuses a version that drops or retypes one.
 */
export function useMeasurementTables() {
  return useQuery({
    queryKey: measurementTableKeys.all,
    queryFn: () => fetchMeasurementTables(notebookDataClient),
    staleTime: 30_000,
  })
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
      toast(t('library.models.shared.nameCreated', { name: name.trim() }), {
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
