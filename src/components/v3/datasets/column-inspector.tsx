import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import {
  DescriptionList,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import { toast } from '#/components/v3/ui/sonner'
import { datasetListQueryKeys } from '#/components/v3/datasets/datasets-data'
import { setDatasetColumnUnit } from '#/lib/dataset-column-unit'
import { datasetFlagsQueryKeys } from '#/lib/dataset-flags'
import type { DatasetValueFlag } from '#/lib/dataset-flags'
import { notebookDataClient } from '#/lib/notebook-data'

interface ColumnField {
  field_id: string
  key: string
  label: string
  logical_type: string
}

const TYPE_LABEL: Record<string, string> = {
  integer: 'Number, 0 dp',
  decimal: 'Number',
  text: 'Text',
  boolean: 'Yes or no',
  date: 'Date',
  timestamp: 'Date and time',
  category: 'Choice',
  reference: 'Record link',
}

function range(values: unknown[]): string | null {
  const numbers = values
    .map((v) => (typeof v === 'number' ? v : Number(v)))
    .filter((n) => Number.isFinite(n))
  if (!numbers.length) return null
  return `${Math.min(...numbers)}–${Math.max(...numbers)}`
}

/**
 * The dataset grid's column panel: what the column is, the unit it carries and,
 * when it carries none, a way to set one. A unit is read from the dataset's
 * current schema version (a snapshot keeps the version it was taken on), and
 * setting it moves the dataset to a new schema version.
 */
export function ColumnInspector({
  datasetId,
  field,
  values,
  rowCount,
  flags,
  fields,
  canWrite,
}: {
  datasetId: string
  field: ColumnField
  /** The column's values in the rows loaded so far. */
  values: unknown[]
  /** Rows in the dataset. */
  rowCount: number
  flags: DatasetValueFlag[]
  fields: ColumnField[]
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const [unit, setUnit] = useState('')
  const [reason, setReason] = useState('')

  const current = useQuery({
    queryKey: ['ui-port', 'dataset-column-unit', datasetId, field.key],
    queryFn: async () => {
      const dataset = (
        await notebookDataClient.list<{ schema_version_id: string }>(
          'datasets',
          `?id=eq.${encodeURIComponent(datasetId)}&select=schema_version_id`,
        )
      ).at(0)
      if (!dataset) return null
      const found = (
        await notebookDataClient.list<{
          quantity: { storageUnit?: string } | null
        }>(
          'dataset_schema_version_fields',
          `?schema_version_id=eq.${dataset.schema_version_id}&key=eq.${encodeURIComponent(field.key)}&select=quantity`,
        )
      ).at(0)
      return { unit: found?.quantity?.storageUnit ?? null }
    },
  })
  const set = useMutation({
    mutationFn: () =>
      setDatasetColumnUnit(notebookDataClient, {
        datasetId,
        fieldKey: field.key,
        unit: unit.trim(),
        reason: reason.trim(),
      }),
    onSuccess: (result) => {
      toast(`Unit set on ${field.label}`, {
        description: `The dataset follows schema v${result.schemaVersion} now.`,
      })
      setUnit('')
      setReason('')
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'dataset-column-unit', datasetId],
      })
      void queryClient.invalidateQueries({
        queryKey: datasetFlagsQueryKeys.active(datasetId),
      })
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'dataset-flags', datasetId],
      })
      void queryClient.invalidateQueries({
        queryKey: datasetListQueryKeys.page,
      })
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : 'Could not set the unit.',
      ),
  })

  const missing = current.isSuccess && current.data?.unit == null
  const seen = range(values)
  const others = [
    ...new Set(
      flags
        .filter(
          (f) => f.kind === 'missing_unit' && f.fieldId !== field.field_id,
        )
        .map((f) => fields.find((x) => x.field_id === f.fieldId)?.label)
        .filter((label): label is string => Boolean(label)),
    ),
  ]
  const ready = unit.trim().length > 0 && reason.trim().length > 0

  return (
    <>
      <InspectorSection title={`Column · ${field.label}`}>
        <DescriptionList
          labelWidth={90}
          items={[
            ['Type', TYPE_LABEL[field.logical_type] ?? field.logical_type],
            [
              'Unit',
              current.isSuccess ? (
                missing ? (
                  <span className="text-warning-text">Missing</span>
                ) : (
                  current.data?.unit
                )
              ) : (
                '…'
              ),
            ],
            [
              'Values seen',
              seen ? `${seen} across ${rowCount} rows` : `${rowCount} rows`,
            ],
          ]}
        />
      </InspectorSection>

      {missing && canWrite ? (
        <InspectorSection title="Set unit">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (ready) set.mutate()
            }}
          >
            <Muted>
              The data was recorded without a unit. Setting one moves the
              dataset to a new schema version; every row keeps its value and
              snapshots already taken stay as they are.
            </Muted>
            <Field label="Unit" required>
              <Input
                value={unit}
                placeholder="e.g. mOsm/kg"
                onChange={(e) => setUnit(e.target.value)}
              />
            </Field>
            <Field label="Reason" required>
              <Input
                value={reason}
                placeholder="Why this unit"
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!ready || set.isPending}
              >
                {`Set unit for ${rowCount} rows`}
              </Button>
            </div>
          </form>
        </InspectorSection>
      ) : null}

      {others.length ? (
        <InspectorSection title="Still to fix">
          <Muted>
            {others.join(', ')} {others.length === 1 ? 'has' : 'have'} no unit
            either.
          </Muted>
        </InspectorSection>
      ) : null}
    </>
  )
}
