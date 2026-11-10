import { PickerSelect } from '#/components/record-picker/entity-picker'
import {
  datasetOption,
  recordOption,
} from '#/components/record-picker/entity-options'
import { useMemo, useRef, useState } from 'react'
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { rich, t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { Notice } from '#/components/ui/alert'
import { PageHeader } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'
import { parseCreateContext } from '#/lib/create-context-search'
import type { CreateContextSearch } from '#/lib/create-context-search'
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
import type {
  ReadingDatasetWire,
  ReadingFieldWire,
  ReadingPlannedRowWire,
  ReadingSampleWire,
} from '#/lib/readings-data'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** UI port (RM-109 / MOB-02): record a reading at the bench into a planned
 * Dataset row. The value is validated against its Schema field rules and an
 * out-of-range value becomes a system flag; the dilution factor is stored as
 * the dataset's dilution field value; an optional photo is attached to the
 * sample through the existing file routes. */
export const Route = createFileRoute('/readings/new')({
  // The page that linked here hands over the sample or dataset in view and where
  // to return to, so the form opens on them and Cancel goes back.
  validateSearch: (search): CreateContextSearch & { plannedKey?: string } => {
    const { sample, dataset, returnTo } = parseCreateContext(search)
    const plannedKey = z.string().safeParse(search.plannedKey)
    const context: CreateContextSearch & { plannedKey?: string } = {}

    if (sample) context.sample = sample

    if (dataset) context.dataset = dataset

    if (returnTo) context.returnTo = returnTo

    if (plannedKey.success && plannedKey.data) {
      context.plannedKey = plannedKey.data
    }

    return context
  },
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: NewReading,
})

interface PendingPhoto {
  file: File | null
  projectId: string
  sampleId: string
}

function NewReading() {
  const search = Route.useSearch()

  const samples = useQuery({
    queryKey: [...readingQueryKeys.samples, search.sample],
    queryFn: () => listReadingSamples(notebookDataClient, search.sample),
    staleTime: 30_000,
  })

  const datasets = useQuery({
    queryKey: [...readingQueryKeys.datasets, search.dataset],
    queryFn: () => listReadingDatasets(notebookDataClient, search.dataset),
    staleTime: 30_000,
  })

  const plannedRows = useQuery({
    queryKey: [
      ...readingQueryKeys.plannedRows,
      search.dataset,
      search.plannedKey,
    ],
    queryFn: () =>
      listReadingPlannedRows(
        notebookDataClient,
        search.dataset,
        search.plannedKey,
      ),
    staleTime: 30_000,
  })

  const listedSamples = samples.data ?? []
  const allPlannedRows = plannedRows.data ?? []

  const [sampleId, setSampleId] = useState(search.sample ?? '')
  const [datasetId, setDatasetId] = useState(search.dataset ?? '')
  const [plannedKey, setPlannedKey] = useState(search.plannedKey ?? '')
  const [measurementFieldId, setMeasurementFieldId] = useState('')
  const [value, setValue] = useState('')
  const [dilutionValue, setDilutionValue] = useState('')
  const [note, setNote] = useState('')
  // The chosen photo is only read when the reading is saved; a ref keeps the
  // picker from re-rendering the whole form.
  const photo = useRef<File | null>(null)
  const [touched, setTouched] = useState(false)

  // Only datasets that actually have a fillable planned row are offered, so an
  // empty selection can never pretend a reading will land somewhere.
  const datasetsWithPlans = useMemo(
    () => fillableDatasets(datasets.data, plannedRows.data),
    [datasets.data, plannedRows.data],
  )

  const {
    dataset,
    datasetPlannedRows,
    effectiveDatasetId,
    effectivePlannedKey,
    selectedPlan,
  } = planChoice(datasetId, plannedKey, datasetsWithPlans, allPlannedRows)

  const planSample = useQuery({
    queryKey: ['readings', 'plan-sample', selectedPlan?.sample_id],
    queryFn: () =>
      listReadingSamples(notebookDataClient, selectedPlan!.sample_id!),
    enabled:
      Boolean(selectedPlan?.sample_id) &&
      !listedSamples.some((s) => s.id === selectedPlan?.sample_id),
    staleTime: 30_000,
  })

  const sampleRows = knownSamples(
    listedSamples,
    planSample.data,
    selectedPlan?.sample_id,
  )

  const { sample, effectiveSampleId } = sampleChoice(
    selectedPlan,
    sampleId,
    sampleRows,
  )

  const fieldsQuery = useQuery({
    queryKey: readingQueryKeys.fields(dataset?.schema_version_id ?? ''),
    queryFn: () =>
      listReadingFields(notebookDataClient, dataset!.schema_version_id),
    enabled: Boolean(dataset?.schema_version_id),
  })

  const { fields, numericFields, dilutionField, noteField, sampleBinding } =
    useMemo(() => fieldChoices(fieldsQuery.data ?? []), [fieldsQuery.data])

  const measurementOptions = numericFields.filter(
    (field) => field.field_id !== dilutionField?.field_id,
  )

  const { effectiveMeasurementFieldId, measurementField } = fieldChoice(
    measurementFieldId,
    selectedPlan,
    measurementOptions,
    fields,
  )

  const { parsed, parsedDilution, valueValid, dilutionValid } = readingInput(
    value,
    dilutionValue,
  )

  const canSubmit = readyToSave({
    sample,
    selectedPlan,
    measurementField,
    valueValid,
    dilutionValid,
  })

  const { unit, willFlag, reported } = measurementPreview(
    measurementField,
    valueValid,
    parsed,
    parsedDilution,
    Boolean(dilutionField) && dilutionValue.trim() !== '',
  )

  const save = useSaveReading({
    dataset,
    datasetId: effectiveDatasetId,
    plannedKey: effectivePlannedKey,
    measurementFieldId: effectiveMeasurementFieldId,
    measurementValue: parsed,
    sample,
    fields,
    dilutionField,
    dilutionFactor: dilutionFactor(
      dilutionField,
      dilutionValue,
      parsedDilution,
    ),
    noteField,
    note,
    measurementLabel: measurementField?.label,
    parsed,
    unit,
    flagged: willFlag,
    returnTo: search.returnTo,
  })

  // The dataset list is built from both queries: until the planned rows land it
  // is empty, so the warning waits for them instead of flashing before data.
  const { noPlans, noFields } = formVisibility({
    datasetsLoading: datasets.isLoading,
    plansLoading: plannedRows.isLoading,
    datasetsWithPlans,
    dataset,
    fieldsLoading: fieldsQuery.isLoading,
    measurementOptions,
  })

  // Why Save is disabled, in the order the user can fix it.
  const saveBlockedReason = blockedReasonFor({
    canSubmit,
    saving: save.isPending,
    hasSample: Boolean(sample),
    plannedKey,
    hasSelectedPlan: Boolean(selectedPlan),
    plansLoading: plannedRows.isLoading,
    noPlans,
    effectivePlannedKey,
    hasMeasurementField: Boolean(measurementField),
    valueValid,
    dilutionValid,
  })

  const submitReading = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTouched(true)

    if (!canSubmit) return
    save.mutate({
      file: photo.current,
      projectId: sample?.project_id ?? '',
      sampleId: sample?.id ?? '',
      idempotencyKey: crypto.randomUUID(),
    })
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader title={t('data.newReading.recordReading')} />
      <form
        className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4 md:px-6 md:py-6"
        onSubmit={submitReading}
      >
        <ReadingTargetFields
          sampleRows={sampleRows}
          samplesLoading={samples.isLoading}
          sampleId={effectiveSampleId}
          sampleLocked={Boolean(selectedPlan?.sample_id)}
          onSampleChange={setSampleId}
          noPlans={noPlans}
          datasetsWithPlans={datasetsWithPlans}
          datasetsLoading={datasets.isLoading}
          datasetId={effectiveDatasetId}
          onDatasetChange={(id) => {
            setDatasetId(id)
            setPlannedKey('')
            setMeasurementFieldId('')
            setDilutionValue('')
          }}
          plannedRows={datasetPlannedRows}
          plannedKey={effectivePlannedKey}
          onPlannedKeyChange={setPlannedKey}
        />

        <ReadingMeasurementFields
          noFields={noFields}
          dataset={dataset}
          fieldsLoading={fieldsQuery.isLoading}
          sampleBinding={sampleBinding}
          measurementOptions={measurementOptions}
          measurementFieldId={effectiveMeasurementFieldId}
          onMeasurementFieldChange={setMeasurementFieldId}
          touched={touched}
          value={value}
          valueValid={valueValid}
          onValueChange={setValue}
          dilutionField={dilutionField}
          dilutionValue={dilutionValue}
          dilutionValid={dilutionValid}
          onDilutionChange={setDilutionValue}
          reported={reported}
          unit={unit}
          parsed={parsed}
          parsedDilution={parsedDilution}
          willFlag={willFlag}
          noteField={noteField}
          note={note}
          onNoteChange={setNote}
        />

        <ReadingFormFooter
          projectId={sample?.project_id}
          savePending={save.isPending}
          canSubmit={canSubmit}
          returnTo={search.returnTo}
          blockedReason={saveBlockedReason}
          noSamples={sampleRows.length === 0 && !samples.isLoading}
          onPhotoPicked={(file) => {
            photo.current = file
          }}
        />
      </form>
    </div>
  )
}

/** The datasets that actually have a planned row to fill. */
function fillableDatasets(
  datasets: ReadingDatasetWire[] | undefined,
  plannedRows: ReadingPlannedRowWire[] | undefined,
): ReadingDatasetWire[] {
  const withPlan = new Set((plannedRows ?? []).map((row) => row.dataset_id))

  return (datasets ?? []).filter((candidate) => withPlan.has(candidate.id))
}

/** Whether the form can offer a dataset at all, and whether it has numeric fields. */
function formVisibility(state: {
  datasetsLoading: boolean
  plansLoading: boolean
  datasetsWithPlans: ReadingDatasetWire[]
  dataset: ReadingDatasetWire | undefined
  fieldsLoading: boolean
  measurementOptions: ReadingFieldWire[]
}) {
  const plansLoading = state.datasetsLoading || state.plansLoading

  return {
    noPlans: !plansLoading && state.datasetsWithPlans.length === 0,
    noFields:
      Boolean(state.dataset) &&
      !state.fieldsLoading &&
      state.measurementOptions.length === 0,
  }
}

/** The dilution factor actually recorded, or nothing when none was typed. */
function dilutionFactor(
  dilutionField: ReadingFieldWire | null,
  dilutionValue: string,
  parsed: number,
) {
  return dilutionField && dilutionValue.trim() !== '' ? parsed : null
}

/** The listed samples, plus the planned row's sample when it is not among them. */
function knownSamples(
  listed: ReadingSampleWire[],
  planned: ReadingSampleWire[] | undefined,
  plannedSampleId: string | null | undefined,
) {
  const known = listed.some((sample) => sample.id === plannedSampleId)

  return known ? listed : [...listed, ...(planned ?? [])]
}

/** Everything the form derives from a dataset's fields. */
function fieldChoices(fields: ReadingFieldWire[]) {
  const numericFields = fields.filter(
    (field) =>
      field.logical_type === 'integer' || field.logical_type === 'decimal',
  )

  return {
    fields,
    numericFields,
    dilutionField: dilutionReadingField(fields),
    noteField:
      fields.find(
        (field) =>
          field.logical_type === 'text' &&
          (/note/i.test(field.key) || /note/i.test(field.label)),
      ) ?? null,
    sampleBinding: sampleBindingField(fields),
  }
}

/** Whether the reading can be saved at all. */
function readyToSave(state: {
  sample: ReadingSampleWire | undefined
  selectedPlan: ReadingPlannedRowWire | undefined
  measurementField: ReadingFieldWire | undefined
  valueValid: boolean
  dilutionValid: boolean
}) {
  return (
    Boolean(state.sample) &&
    Boolean(state.selectedPlan) &&
    Boolean(state.measurementField) &&
    state.valueValid &&
    state.dilutionValid
  )
}

/** Which dataset is in view, its planned rows, and the planned row chosen on it. */
function planChoice(
  datasetId: string,
  plannedKey: string,
  datasetsWithPlans: ReadingDatasetWire[],
  allPlannedRows: ReadingPlannedRowWire[],
) {
  const effectiveDatasetId = datasetId || datasetsWithPlans.at(0)?.id || ''

  const dataset = datasetsWithPlans.find(
    (candidate) => candidate.id === effectiveDatasetId,
  )

  const datasetPlannedRows = allPlannedRows.filter(
    (row) => row.dataset_id === effectiveDatasetId,
  )

  const effectivePlannedKey =
    plannedKey || datasetPlannedRows.at(0)?.planned_key || ''

  return {
    dataset,
    datasetPlannedRows,
    effectiveDatasetId,
    effectivePlannedKey,
    selectedPlan: datasetPlannedRows.find(
      (row) => row.planned_key === effectivePlannedKey,
    ),
  }
}

/** Which sample the reading is taken from: the planned row's, the chosen one, or the first. */
function sampleChoice(
  selectedPlan: ReadingPlannedRowWire | undefined,
  sampleId: string,
  sampleRows: ReadingSampleWire[],
) {
  const effectiveSampleId =
    selectedPlan?.sample_id || sampleId || sampleRows.at(0)?.id || ''

  return {
    effectiveSampleId,
    sample: sampleRows.find((candidate) => candidate.id === effectiveSampleId),
  }
}

/** Which measurement field the value is for: the chosen one, the row's, or the first. */
function fieldChoice(
  measurementFieldId: string,
  selectedPlan: ReadingPlannedRowWire | undefined,
  measurementOptions: ReadingFieldWire[],
  fields: ReadingFieldWire[],
) {
  const effectiveMeasurementFieldId =
    measurementFieldId ||
    selectedPlan?.measurement_field_id ||
    measurementOptions.at(0)?.field_id ||
    ''

  return {
    effectiveMeasurementFieldId,
    measurementField: fields.find(
      (field) => field.field_id === effectiveMeasurementFieldId,
    ),
  }
}

/** The numbers a typed value and dilution make, and whether each is usable. */
function readingInput(value: string, dilutionValue: string) {
  const parsed = Number.parseFloat(value.replace(',', '.'))
  const parsedDilution = Number.parseFloat(dilutionValue.replace(',', '.'))

  return {
    parsed,
    parsedDilution,
    valueValid: value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0,
    dilutionValid:
      dilutionValue.trim() === '' ||
      (Number.isFinite(parsedDilution) && parsedDilution > 0),
  }
}

/** What the measured value reports: its unit, whether it flags, its concentration. */
function measurementPreview(
  measurementField: ReadingFieldWire | undefined,
  valueValid: boolean,
  parsed: number,
  parsedDilution: number,
  diluted: boolean,
) {
  if (!measurementField) return { unit: null, willFlag: false, reported: null }

  if (!valueValid) {
    return {
      unit: readingFieldUnit(measurementField),
      willFlag: false,
      reported: null,
    }
  }

  return {
    unit: readingFieldUnit(measurementField),
    willFlag: isReadingOutOfRange(measurementField, parsed),
    reported: reportedConcentration(parsed, diluted ? parsedDilution : null),
  }
}

/** Saving a bench reading: the commit, the photo that rides with it, and where it goes after. */
function useSaveReading(input: {
  dataset: ReadingDatasetWire | undefined
  datasetId: string
  plannedKey: string
  measurementFieldId: string
  measurementValue: number
  sample: ReadingSampleWire | undefined
  fields: ReadingFieldWire[]
  dilutionField: ReadingFieldWire | null
  dilutionFactor: number | null
  noteField: ReadingFieldWire | null
  note: string
  measurementLabel: string | undefined
  parsed: number
  unit: string | null
  flagged: boolean
  returnTo: string | undefined
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  return useMutation({
    mutationFn: async (pending: PendingPhoto & { idempotencyKey: string }) => {
      const result = await submitBenchReading(notebookDataClient, {
        datasetId: input.datasetId,
        expectedRevision: Number(input.dataset?.revision ?? 0),
        idempotencyKey: pending.idempotencyKey,
        fields: input.fields,
        plannedKey: input.plannedKey,
        measurementFieldId: input.measurementFieldId,
        measurementValue: input.measurementValue,
        sample: { id: input.sample!.id, identifier: input.sample!.identifier },
        dilutionFieldId: input.dilutionField?.field_id ?? null,
        dilutionFactor: input.dilutionFactor,
        noteFieldId: input.noteField?.field_id ?? null,
        note: input.note.trim() || null,
      })

      if (!result.ok) {
        throw new Error(
          readingCommitErrorMessage(result, input.fields) ??
            t('data.newReading.validationFailed'),
        )
      }

      return result
    },
    onSuccess: async (_result, pending) => {
      const photoWarning = await attachPendingPhoto(pending)

      const label = input.measurementLabel ?? t('data.newReading.reading')
      const amount = `${label} ${input.parsed}${input.unit ? ` ${input.unit}` : ''}`

      toast(t('data.newReading.readingSaved'), {
        description: [
          amount,
          input.flagged ? t('data.newReading.flaggedOutOfRange') : null,
          photoWarning,
        ]
          .filter(Boolean)
          .join(' · '),
      })
      void queryClient.invalidateQueries({
        queryKey: readingQueryKeys.plannedRows,
      })
      void queryClient.invalidateQueries({
        queryKey: readingQueryKeys.datasets,
      })

      if (input.datasetId) {
        void queryClient.invalidateQueries({
          queryKey: ['dataset-value-flags', 'active', input.datasetId],
        })
      }

      if (input.returnTo) {
        void navigate({ to: input.returnTo })
      } else {
        void navigate({
          to: '/samples/$sampleId/measurements',
          params: { sampleId: input.sample!.id },
        })
      }
    },
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A failed save carries whatever the transport threw; its message is shown only when it is an Error.
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error
          ? error.message
          : t('data.newReading.couldnTSave'),
      )
    },
  })
}

/** Attach the photo the person picked, if any; a refused photo is reported, not fatal. */
async function attachPendingPhoto(
  pending: PendingPhoto,
): Promise<string | null> {
  if (!pending.file) return null

  try {
    await attachPhotoToSample(notebookDataClient, {
      sampleRecordId: pending.sampleId,
      projectId: pending.projectId,
      file: pending.file,
    })

    return null
  } catch (error) {
    return error instanceof Error
      ? t('data.newReading.photoDidAttach', { message: error.message })
      : t('data.newReading.photoDidAttach2')
  }
}

/** Why Save is unavailable, in the order the person can fix it. */
function blockedReasonFor(state: {
  canSubmit: boolean
  saving: boolean
  hasSample: boolean
  plannedKey: string
  hasSelectedPlan: boolean
  plansLoading: boolean
  noPlans: boolean
  effectivePlannedKey: string
  hasMeasurementField: boolean
  valueValid: boolean
  dilutionValid: boolean
}): string | null {
  if (state.canSubmit || state.saving) return null

  if (!state.hasSample) return t('data.newReading.chooseSampleRecordAgainst')

  if (state.plannedKey && !state.hasSelectedPlan && !state.plansLoading)
    return t('data.newReading.plannedRowLongerAvailable')

  if (state.noPlans || !state.effectivePlannedKey)
    return t('data.newReading.saveUnavailableUntilDataset')

  if (!state.hasMeasurementField)
    return t('data.newReading.saveUnavailableUntilDataset2')

  if (!state.valueValid) return t('data.newReading.enterNumber0More')

  if (!state.dilutionValid)
    return t('data.newReading.enterDilutionFactorGreater')

  return null
}

/** Which sample and planned dataset row the reading goes into. */
function ReadingTargetFields({
  sampleRows,
  samplesLoading,
  sampleId,
  sampleLocked,
  onSampleChange,
  noPlans,
  datasetsWithPlans,
  datasetsLoading,
  datasetId,
  onDatasetChange,
  plannedRows,
  plannedKey,
  onPlannedKeyChange,
}: {
  sampleRows: ReadingSampleWire[]
  samplesLoading: boolean
  sampleId: string
  sampleLocked: boolean
  onSampleChange: (id: string) => void
  noPlans: boolean
  datasetsWithPlans: ReadingDatasetWire[]
  datasetsLoading: boolean
  datasetId: string
  onDatasetChange: (id: string) => void
  plannedRows: ReadingPlannedRowWire[]
  plannedKey: string
  onPlannedKeyChange: (key: string) => void
}) {
  return (
    <>
      <Field label={t('data.newReading.sample')} required>
        <PickerSelect
          noun="sample"
          value={sampleId}
          onChange={onSampleChange}
          disabled={samplesLoading || sampleLocked}
          placeholder={
            sampleRows.length === 0
              ? t('data.newReading.samplesYet')
              : undefined
          }
          options={sampleRows.map((row) => recordOption(row))}
        />
      </Field>

      {noPlans ? (
        <Notice
          tone="warn"
          title={t('data.newReading.plannedRowsFill')}
          action={
            <Button
              size="sm"
              nativeButton={false}
              render={<Link to="/datasets" search={{ tab: 'issues' }} />}
            >
              {t('data.newReading.openDatasets')}
            </Button>
          }
        >
          {t('data.newReading.readingsRecordedIntoPlanned')}
        </Notice>
      ) : (
        <>
          <Field label={t('data.newReading.dataset')} required>
            <PickerSelect
              noun="dataset"
              value={datasetId}
              onChange={onDatasetChange}
              disabled={datasetsLoading}
              options={datasetsWithPlans.map((row) =>
                datasetOption({
                  id: row.id,
                  name: row.name,
                  displayId: row.display_id,
                }),
              )}
            />
          </Field>

          <Field
            label={t('data.newReading.plannedRow')}
            required
            hint={t('data.newReading.sampleWellKeyReading')}
          >
            <Select
              value={plannedKey}
              onChange={(e) => onPlannedKeyChange(e.target.value)}
            >
              {plannedRows.map((row) => (
                <option key={row.id} value={row.planned_key ?? ''}>
                  {row.planned_key ?? t('data.newReading.unkeyedRow')}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
    </>
  )
}

/** What was measured, its value and dilution, and the notices about them. */
function ReadingMeasurementFields({
  noFields,
  dataset,
  fieldsLoading,
  sampleBinding,
  measurementOptions,
  measurementFieldId,
  onMeasurementFieldChange,
  touched,
  value,
  valueValid,
  onValueChange,
  dilutionField,
  dilutionValue,
  dilutionValid,
  onDilutionChange,
  reported,
  unit,
  parsed,
  parsedDilution,
  willFlag,
  noteField,
  note,
  onNoteChange,
}: {
  noFields: boolean
  dataset: ReadingDatasetWire | undefined
  fieldsLoading: boolean
  sampleBinding: ReadingFieldWire | null
  measurementOptions: ReadingFieldWire[]
  measurementFieldId: string
  onMeasurementFieldChange: (id: string) => void
  touched: boolean
  value: string
  valueValid: boolean
  onValueChange: (value: string) => void
  dilutionField: ReadingFieldWire | null
  dilutionValue: string
  dilutionValid: boolean
  onDilutionChange: (value: string) => void
  reported: number | null
  unit: string | null
  parsed: number
  parsedDilution: number
  willFlag: boolean
  noteField: ReadingFieldWire | null
  note: string
  onNoteChange: (note: string) => void
}) {
  return (
    <>
      <ReadingDatasetNotices
        noFields={noFields}
        dataset={dataset}
        fieldsLoading={fieldsLoading}
        sampleBinding={sampleBinding}
      />

      <MeasurementSelect
        options={measurementOptions}
        value={measurementFieldId}
        loading={fieldsLoading}
        onChange={onMeasurementFieldChange}
      />

      <MeasurementValueFields
        touched={touched}
        value={value}
        valueValid={valueValid}
        onValueChange={onValueChange}
        dilutionField={dilutionField}
        dilutionValue={dilutionValue}
        dilutionValid={dilutionValid}
        onDilutionChange={onDilutionChange}
        reported={reported}
        unit={unit}
        parsed={parsed}
        parsedDilution={parsedDilution}
        willFlag={willFlag}
      />

      {noteField ? (
        <Field
          label={t('data.newReading.note')}
          hint={t('common.states.optional')}
        >
          <Input value={note} onChange={(e) => onNoteChange(e.target.value)} />
        </Field>
      ) : null}
    </>
  )
}

/** What the chosen dataset can and cannot offer a reading. */
function ReadingDatasetNotices({
  noFields,
  dataset,
  fieldsLoading,
  sampleBinding,
}: {
  noFields: boolean
  dataset: ReadingDatasetWire | undefined
  fieldsLoading: boolean
  sampleBinding: ReadingFieldWire | null
}) {
  return (
    <>
      {noFields ? (
        <Notice
          tone="warn"
          title={t('data.newReading.numericFields')}
          action={
            dataset ? (
              <Button
                size="sm"
                nativeButton={false}
                render={
                  <Link
                    to="/datasets/$datasetId"
                    params={{ datasetId: dataset.id }}
                  />
                }
              >
                {t('data.newReading.openDataset')}
              </Button>
            ) : undefined
          }
        >
          {t('data.newReading.hasNumericFieldRecord', {
            name: dataset?.name ?? t('data.newReading.thisDataset'),
          })}
        </Notice>
      ) : null}

      {dataset && !fieldsLoading && !noFields && !sampleBinding ? (
        <Notice tone="warn" title={t('data.newReading.sampleField')}>
          {t('data.newReading.hasSampleFieldSo', { name: dataset.name })}
        </Notice>
      ) : null}
    </>
  )
}

/** Which numeric field the value is recorded against. */
function MeasurementSelect({
  options,
  value,
  loading,
  onChange,
}: {
  options: ReadingFieldWire[]
  value: string
  loading: boolean
  onChange: (id: string) => void
}) {
  return (
    <Field label={t('data.newReading.measurement')} required>
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading || options.length === 0}
      >
        {options.length === 0 ? (
          <option value="">{t('data.newReading.measurementField')}</option>
        ) : null}
        {options.map((field) => (
          <option key={field.field_id} value={field.field_id}>
            {field.label}
            {readingFieldUnit(field) ? ` (${readingFieldUnit(field)})` : ''}
          </option>
        ))}
      </Select>
    </Field>
  )
}

/** The measured value, its dilution, and what they report. */
function MeasurementValueFields({
  touched,
  value,
  valueValid,
  onValueChange,
  dilutionField,
  dilutionValue,
  dilutionValid,
  onDilutionChange,
  reported,
  unit,
  parsed,
  parsedDilution,
  willFlag,
}: {
  touched: boolean
  value: string
  valueValid: boolean
  onValueChange: (value: string) => void
  dilutionField: ReadingFieldWire | null
  dilutionValue: string
  dilutionValid: boolean
  onDilutionChange: (value: string) => void
  reported: number | null
  unit: string | null
  parsed: number
  parsedDilution: number
  willFlag: boolean
}) {
  return (
    <>
      <div className="flex gap-2">
        <Field
          label={t('data.newReading.value')}
          required
          error={
            touched && !valueValid
              ? t('data.newReading.enterNumber0More2')
              : undefined
          }
        >
          <Input
            value={value}
            inputMode="decimal"
            autoFocus
            className="num h-12 text-[20px]"
            onChange={(e) => onValueChange(e.target.value)}
          />
        </Field>
        {dilutionField ? (
          <Field
            label={t('data.newReading.dilution', {
              label: dilutionField.label,
            })}
            error={
              touched && !dilutionValid
                ? t('data.newReading.enterFactorGreaterThan')
                : undefined
            }
          >
            <Input
              value={dilutionValue}
              inputMode="decimal"
              className="num h-12 text-[20px]"
              onChange={(e) => onDilutionChange(e.target.value)}
            />
          </Field>
        ) : null}
      </div>

      {reported != null ? (
        <p className="m-0 text-label text-fg-muted">
          {t('data.newReading.reportedConcentration')}{' '}
          <span className="num text-fg">
            {reported}
            {unit ? ` ${unit}` : ''}
          </span>
          {dilutionField && dilutionValue.trim() !== ''
            ? ` ${t('data.newReading.raw', { parsed, parsedDilution })}`
            : ''}
        </p>
      ) : null}

      {willFlag ? (
        <Notice tone="warn" title={t('data.newReading.outRange')}>
          {t('data.newReading.valueRecordedFlaggedReview')}
        </Notice>
      ) : null}
    </>
  )
}

/** The photo picker, why Save is unavailable, and the form's buttons. */
function ReadingFormFooter({
  projectId,
  savePending,
  canSubmit,
  returnTo,
  blockedReason,
  noSamples,
  onPhotoPicked,
}: {
  projectId: string | null | undefined
  savePending: boolean
  canSubmit: boolean
  returnTo: string | null | undefined
  blockedReason: string | null
  noSamples: boolean
  onPhotoPicked: (file: File | null) => void
}) {
  return (
    <>
      <Field
        label={t('data.newReading.photo')}
        hint={
          projectId
            ? t('data.newReading.optionalAttachedSampleEvidence')
            : t('data.newReading.attachPhotoFromSample')
        }
      >
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={!projectId}
          onChange={(e) => onPhotoPicked(e.target.files?.[0] ?? null)}
          className="block w-full text-label text-fg-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-2 file:text-label file:text-fg"
        />
      </Field>

      <div className="flex flex-col gap-2 md:flex-row-reverse md:justify-start">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={savePending || !canSubmit}
        >
          {savePending
            ? t('common.states.saving')
            : t('data.newReading.saveReading')}
        </Button>
        <Button size="lg" nativeButton={false} render={<Link to="/scan" />}>
          {t('data.newReading.scanInstead')}
        </Button>
        {returnTo ? (
          <Button
            size="lg"
            nativeButton={false}
            render={<Link to={returnTo} />}
          >
            {t('common.actions.cancel')}
          </Button>
        ) : null}
      </div>

      {blockedReason ? (
        <p className="m-0 text-label text-fg-muted" role="status">
          {blockedReason}
        </p>
      ) : null}

      {noSamples ? (
        <p className="m-0 text-label text-fg-muted">
          {rich('data.newReading.registerSampleFirst', {
            link: (text) => (
              <Link to="/samples" className="underline">
                {text}
              </Link>
            ),
          })}
        </p>
      ) : null}
    </>
  )
}
