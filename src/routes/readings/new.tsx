import { useMemo, useState } from 'react'
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { PageHeader } from '#/components/v3/ui/layout'
import { NativeSelect } from '#/components/v3/projects/select'
import { toast } from '#/components/v3/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  attachPhotoToSample,
  dilutionReadingField,
  isReadingOutOfRange,
  listReadingDatasets,
  listReadingFields,
  listReadingPlannedRows,
  listReadingSamples,
  readingCommitErrorMessage,
  readingFieldUnit,
  readingQueryKeys,
  reportedConcentration,
  sampleBindingField,
  submitBenchReading,
} from '#/lib/readings-data'

/** UI port (RM-109 / MOB-02): record a reading at the bench into a planned
 * Dataset row. The value is validated against its Schema field rules and an
 * out-of-range value becomes a system flag; the dilution factor is stored as
 * the dataset's dilution field value; an optional photo is attached to the
 * sample through the existing file routes. */
export const Route = createFileRoute('/readings/new')({
  validateSearch: (search: Record<string, unknown>): { sample?: string } => ({
    sample: typeof search.sample === 'string' ? search.sample : undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: NewReading,
})

interface PendingPhoto {
  file: File | null
  projectId: string
}

function NewReading() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const samples = useQuery({
    queryKey: readingQueryKeys.samples,
    queryFn: () => listReadingSamples(notebookDataClient),
    staleTime: 30_000,
  })
  const datasets = useQuery({
    queryKey: readingQueryKeys.datasets,
    queryFn: () => listReadingDatasets(notebookDataClient),
    staleTime: 30_000,
  })
  const plannedRows = useQuery({
    queryKey: readingQueryKeys.plannedRows,
    queryFn: () => listReadingPlannedRows(notebookDataClient),
    staleTime: 30_000,
  })

  const sampleRows = samples.data ?? []
  const datasetRows = datasets.data ?? []
  const allPlannedRows = plannedRows.data ?? []

  const [sampleId, setSampleId] = useState(search.sample ?? '')
  const [datasetId, setDatasetId] = useState('')
  const [plannedKey, setPlannedKey] = useState('')
  const [measurementFieldId, setMeasurementFieldId] = useState('')
  const [value, setValue] = useState('')
  const [dilutionValue, setDilutionValue] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [touched, setTouched] = useState(false)

  const effectiveSampleId = sampleId || sampleRows.at(0)?.id || ''
  const sample = sampleRows.find((s) => s.id === effectiveSampleId)

  // Only datasets that actually have a fillable planned row are offered, so an
  // empty selection can never pretend a reading will land somewhere.
  const datasetsWithPlans = useMemo(() => {
    const withPlan = new Set(allPlannedRows.map((row) => row.dataset_id))
    return datasetRows.filter((dataset) => withPlan.has(dataset.id))
  }, [datasetRows, allPlannedRows])

  const effectiveDatasetId = datasetId || datasetsWithPlans.at(0)?.id || ''
  const dataset = datasetRows.find((d) => d.id === effectiveDatasetId)
  const datasetPlannedRows = allPlannedRows.filter(
    (row) => row.dataset_id === effectiveDatasetId,
  )

  const fieldsQuery = useQuery({
    queryKey: readingQueryKeys.fields(dataset?.schema_version_id ?? ''),
    queryFn: () =>
      listReadingFields(notebookDataClient, dataset!.schema_version_id),
    enabled: Boolean(dataset?.schema_version_id),
  })
  const fields = fieldsQuery.data ?? []

  const numericFields = useMemo(
    () =>
      fields.filter(
        (field) =>
          field.logical_type === 'integer' || field.logical_type === 'decimal',
      ),
    [fields],
  )
  const dilutionField = useMemo(() => dilutionReadingField(fields), [fields])
  const noteField = useMemo(
    () =>
      fields.find(
        (field) =>
          field.logical_type === 'text' &&
          (/note/i.test(field.key) || /note/i.test(field.label)),
      ) ?? null,
    [fields],
  )
  const measurementOptions = numericFields.filter(
    (field) => field.field_id !== dilutionField?.field_id,
  )
  const sampleBinding = useMemo(() => sampleBindingField(fields), [fields])
  const effectiveMeasurementFieldId =
    measurementFieldId || measurementOptions.at(0)?.field_id || ''
  const measurementField = fields.find(
    (field) => field.field_id === effectiveMeasurementFieldId,
  )

  const effectivePlannedKey =
    plannedKey || datasetPlannedRows.at(0)?.planned_key || ''

  const parsed = Number.parseFloat(value.replace(',', '.'))
  const parsedDilution = Number.parseFloat(dilutionValue.replace(',', '.'))
  const valueValid =
    value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0
  const dilutionValid =
    dilutionValue.trim() === '' ||
    (Number.isFinite(parsedDilution) && parsedDilution > 0)
  const canSubmit =
    Boolean(sample) &&
    Boolean(effectivePlannedKey) &&
    Boolean(measurementField) &&
    valueValid &&
    dilutionValid

  const unit = measurementField ? readingFieldUnit(measurementField) : null
  const willFlag =
    measurementField && valueValid
      ? isReadingOutOfRange(measurementField, parsed)
      : false
  const reported =
    measurementField && valueValid
      ? reportedConcentration(
          parsed,
          dilutionField && dilutionValue.trim() !== '' ? parsedDilution : null,
        )
      : null

  const save = useMutation({
    mutationFn: async (input: PendingPhoto & { idempotencyKey: string }) => {
      const result = await submitBenchReading(notebookDataClient, {
        datasetId: effectiveDatasetId,
        expectedRevision: Number(dataset?.revision ?? 0),
        idempotencyKey: input.idempotencyKey,
        fields,
        plannedKey: effectivePlannedKey,
        measurementFieldId: effectiveMeasurementFieldId,
        measurementValue: parsed,
        sample: { id: sample!.id, identifier: sample!.identifier },
        dilutionFieldId: dilutionField?.field_id ?? null,
        dilutionFactor:
          dilutionField && dilutionValue.trim() !== '' ? parsedDilution : null,
        noteFieldId: noteField?.field_id ?? null,
        note: note.trim() || null,
      })
      if (!result.ok) {
        throw new Error(
          readingCommitErrorMessage(result, fields) ?? 'Validation failed.',
        )
      }
      return result
    },
    onSuccess: async (_result, input) => {
      let photoWarning = ''
      if (input.file) {
        try {
          await attachPhotoToSample(notebookDataClient, {
            sampleRecordId: sample!.id,
            projectId: input.projectId,
            file: input.file,
          })
        } catch (error) {
          photoWarning =
            error instanceof Error
              ? ` The photo did not attach: ${error.message}`
              : ' The photo did not attach.'
        }
      }
      toast('Reading saved', {
        description: `${measurementField?.label ?? 'Reading'} ${parsed}${
          unit ? ` ${unit}` : ''
        }${willFlag ? ' · flagged out of range' : ''}${photoWarning}`,
      })
      void queryClient.invalidateQueries({
        queryKey: readingQueryKeys.plannedRows,
      })
      void queryClient.invalidateQueries({
        queryKey: readingQueryKeys.datasets,
      })
      if (effectiveDatasetId) {
        void queryClient.invalidateQueries({
          queryKey: ['dataset-value-flags', 'active', effectiveDatasetId],
        })
      }
      void navigate({
        to: '/samples/$sampleId/measurements',
        params: { sampleId: sample!.id },
      })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Couldn’t save it.')
    },
  })

  // The dataset list is built from both queries: until the planned rows land it
  // is empty, so the warning waits for them instead of flashing before data.
  const plansLoading = datasets.isLoading || plannedRows.isLoading
  const noPlans = !plansLoading && datasetsWithPlans.length === 0
  const noFields =
    Boolean(dataset) &&
    !fieldsQuery.isLoading &&
    measurementOptions.length === 0

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader crumbs="Readings" title="Record reading" />
      <form
        className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-4 md:px-6 md:py-6"
        onSubmit={(e) => {
          e.preventDefault()
          setTouched(true)
          if (!canSubmit) return
          save.mutate({
            file: photo,
            projectId: sample?.project_id ?? '',
            idempotencyKey: crypto.randomUUID(),
          })
        }}
      >
        <Field label="Sample" required>
          <NativeSelect
            value={effectiveSampleId}
            onChange={(e) => setSampleId(e.target.value)}
            disabled={samples.isLoading}
          >
            {sampleRows.length === 0 ? (
              <option value="">No samples yet</option>
            ) : null}
            {sampleRows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.identifier} · {s.title}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {noPlans ? (
          <Notice tone="warn" title="No planned rows to fill">
            Readings are recorded into a planned dataset row. Request a repeat
            in a dataset first, then return here.
          </Notice>
        ) : (
          <>
            <Field label="Dataset" required>
              <NativeSelect
                value={effectiveDatasetId}
                onChange={(e) => {
                  setDatasetId(e.target.value)
                  setPlannedKey('')
                  setMeasurementFieldId('')
                  setDilutionValue('')
                }}
                disabled={datasets.isLoading}
              >
                {datasetsWithPlans.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.display_id ? `${d.display_id} · ` : ''}
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              label="Planned row"
              required
              hint="The sample or well key this reading fills."
            >
              <NativeSelect
                value={effectivePlannedKey}
                onChange={(e) => setPlannedKey(e.target.value)}
              >
                {datasetPlannedRows.map((row) => (
                  <option key={row.id} value={row.planned_key ?? ''}>
                    {row.planned_key ?? 'Unkeyed row'}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </>
        )}

        {noFields ? (
          <Notice tone="warn" title="No numeric fields">
            This dataset has no numeric field to record a reading against.
          </Notice>
        ) : null}

        {dataset && !fieldsQuery.isLoading && !noFields && !sampleBinding ? (
          <Notice tone="warn" title="No sample field">
            This dataset has no sample field, so the reading will not be linked
            to the sample.
          </Notice>
        ) : null}

        <Field label="Measurement" required>
          <NativeSelect
            value={effectiveMeasurementFieldId}
            onChange={(e) => setMeasurementFieldId(e.target.value)}
            disabled={fieldsQuery.isLoading || measurementOptions.length === 0}
          >
            {measurementOptions.length === 0 ? (
              <option value="">No measurement field</option>
            ) : null}
            {measurementOptions.map((field) => (
              <option key={field.field_id} value={field.field_id}>
                {field.label}
                {readingFieldUnit(field) ? ` (${readingFieldUnit(field)})` : ''}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <div className="flex gap-2">
          <Field
            label="Value"
            required
            error={
              touched && !valueValid ? 'Enter a number, 0 or more.' : undefined
            }
          >
            <Input
              value={value}
              inputMode="decimal"
              autoFocus
              className="num h-12 text-[20px]"
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          {dilutionField ? (
            <Field
              label={`Dilution (${dilutionField.label})`}
              error={
                touched && !dilutionValid
                  ? 'Enter a factor greater than zero.'
                  : undefined
              }
            >
              <Input
                value={dilutionValue}
                inputMode="decimal"
                className="num h-12 text-[20px]"
                onChange={(e) => setDilutionValue(e.target.value)}
              />
            </Field>
          ) : null}
        </div>

        {reported != null ? (
          <p className="m-0 text-label text-fg-muted">
            Reported concentration{' '}
            <span className="num text-fg">
              {reported}
              {unit ? ` ${unit}` : ''}
            </span>
            {dilutionField && dilutionValue.trim() !== ''
              ? ` (raw ${parsed} × ${parsedDilution})`
              : ''}
          </p>
        ) : null}

        {willFlag ? (
          <Notice tone="warn" title="Out of range">
            This value will be recorded and flagged for review, not rejected.
          </Notice>
        ) : null}

        {noteField ? (
          <Field label="Note" hint="Optional.">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        ) : null}

        <Field
          label="Photo"
          hint={
            sample?.project_id
              ? 'Optional. Attached to the sample as evidence.'
              : 'Attach a photo from the sample page; this sample has no project.'
          }
        >
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={!sample?.project_id}
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            className="block w-full text-label text-fg-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-2 file:text-label file:text-fg"
          />
        </Field>

        <div className="flex flex-col gap-2 md:flex-row-reverse md:justify-start">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={save.isPending || !canSubmit}
          >
            {save.isPending ? 'Saving…' : 'Save reading'}
          </Button>
          <Button size="lg" nativeButton={false} render={<Link to="/scan" />}>
            Scan instead
          </Button>
        </div>

        {sampleRows.length === 0 && !samples.isLoading ? (
          <p className="m-0 text-label text-fg-muted">
            Register a sample first; a reading is measured against one.
          </p>
        ) : null}
      </form>
    </div>
  )
}
