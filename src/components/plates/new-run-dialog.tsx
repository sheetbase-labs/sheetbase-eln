/**
 * Adding a plate run: drop the file the plate reader wrote (CSV or Excel) or
 * paste it, say which wells are controls, and see the plate and its quality
 * before anything is saved. A run can belong to an experiment, and then lands
 * in that experiment's notebook by itself.
 */
import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useRecordModelProjects } from '#/components/models/models-data'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { FileDrop } from '#/components/ui/file-drop'
import { Field } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import { fetchPlateDesignOptions, qcKeys } from '#/lib/run-qc'
import { notebookDataClient } from '#/lib/notebook-data'
import { parsePlateTable } from '#/lib/plate-assay'
import { suggestControlColumns } from '#/lib/plate-controls'
import type { PlateFormat } from '#/lib/plate-map'
import type { PlateRunRow } from '#/lib/plate-runs'
import { ControlColumns, PlatePreview } from './plate-preview'
import { PlateTextFields } from './plate-text-fields'
import { RunDetailsFields } from './run-details-fields'
import { usePlateFile } from './use-plate-file'
import { useCreatePlateRun } from './use-create-plate-run'
import { usePlateDraft } from './use-plate-draft'

const client = notebookDataClient

export function NewRunDialog({
  open,
  onOpenChange,
  onCreated,
  experimentId,
  initialFile,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (run: PlateRunRow) => void
  /**
   * The experiment the run belongs to, when the dialog was opened from one. It
   * is fixed, and the notebook is left to the caller (it is already showing
   * the run's block).
   */
  experimentId?: string
  /** A file already picked, such as one dropped on a notebook block. */
  initialFile?: File | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(860px,calc(100vw-32px))]">
        <DialogHeader title={t('plates.form.title')} />
        <NewRunBody
          open={open}
          onOpenChange={onOpenChange}
          onCreated={onCreated}
          fixedExperimentId={experimentId}
          initialFile={initialFile ?? null}
        />
      </DialogContent>
    </Dialog>
  )
}

/**
 * The dialog's form. It is mounted only while the dialog is open, so opening
 * the dialog starts a new attempt rather than showing the last one's answers.
 */
function NewRunBody({
  open,
  onOpenChange,
  onCreated,
  fixedExperimentId,
  initialFile,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (run: PlateRunRow) => void
  fixedExperimentId: string | undefined
  initialFile: File | null
}) {
  const projects = useRecordModelProjects().data ?? []
  const [name, setName] = useState('')
  const [formatChoice, setFormatChoice] = useState<'auto' | PlateFormat>('auto')
  const [data, setData] = useState('')
  const [layout, setLayout] = useState('')
  const [projectId, setProjectId] = useState('')
  const [designId, setDesignId] = useState('')
  const [pickedExperiment, setPickedExperiment] = useState('')
  const [addToNotebook, setAddToNotebook] = useState(true)
  const guessedName = useRef('')
  const [guessedControls, setGuessedControls] = useState(false)
  const [negativeColumns, setNegativeColumns] = useState('')
  const [positiveColumns, setPositiveColumns] = useState('')
  const experimentId = fixedExperimentId ?? pickedExperiment

  const designs =
    useQuery({
      queryKey: qcKeys.designs,
      queryFn: () => fetchPlateDesignOptions(client),
      staleTime: 60_000,
      enabled: open,
    }).data ?? []

  const [analyseNow, setAnalyseNow] = useState(true)
  const [interacted, setInteracted] = useState(false)

  const { file, candidateId, fileError, takeCandidate, readFile } =
    usePlateFile({
      initialFile,
      onText: (text) => {
        setData(text)
        setFormatChoice('auto')

        // A reader's grid has no roles: offer the first and last columns as the
        // controls when they read like two groups far apart.
        const guess = suggestControlColumns(parsePlateTable(text).readout)

        setNegativeColumns(guess?.negative ?? '')
        setPositiveColumns(guess?.positive ?? '')
        setGuessedControls(guess !== null)
      },
      onName: (guess) =>
        setName((current) => {
          // Keep a name the person typed; follow the file while it is a guess.
          const next =
            current === '' || current === guessedName.current ? guess : current

          guessedName.current = guess

          return next
        }),
    })

  const { parsed, format, readCount, controls, samples, preview } =
    usePlateDraft({
      data,
      layout,
      formatChoice,
      negativeColumns,
      positiveColumns,
    })

  const nameError = name.trim() ? null : t('plates.form.nameRequired')

  const noWellColumn =
    data.trim() !== '' && parsed.warnings.includes('no_well_column')

  const skipped = parsed.warnings.filter(
    (w) => w.startsWith('bad_well') || w.startsWith('duplicate_well'),
  )

  const save = useCreatePlateRun(
    {
      name,
      format,
      wells: parsed.wells,
      readout: parsed.readout,
      projectId,
      designId,
      experimentId,
      experimentFixed: Boolean(fixedExperimentId),
      addToNotebook,
      analyseNow,
    },
    (run) => {
      onOpenChange(false)
      onCreated(run)
    },
  )

  function submit() {
    setInteracted(true)

    if (nameError || !format || readCount === 0 || save.isPending) return
    save.mutate()
  }

  return (
    <>
      <DialogBody>
        <div className="flex flex-col gap-3">
          <FileDrop
            label={t('features.plateRuns.form.drop')}
            hint={t('features.plateRuns.form.dropHint')}
            accept=".csv,.tsv,.txt,.xlsx"
            onFile={readFile}
          />
          {fileError ? <Notice tone="warn">{fileError}</Notice> : null}
          {file && file.candidates.length > 1 ? (
            <Field label={t('features.plateRuns.form.whichPlate')}>
              <Select
                value={candidateId}
                onChange={(e) => takeCandidate(file, e.target.value)}
              >
                {file.candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {t('features.plateRuns.form.candidate', {
                      label: candidate.title ?? candidate.label,
                      readings: candidate.readings,
                    })}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <RunDetailsFields
            name={name}
            nameError={interacted ? nameError : null}
            onName={(value) => {
              setName(value)
              setInteracted(true)
            }}
            experimentId={experimentId}
            experimentFixed={Boolean(fixedExperimentId)}
            onExperiment={setPickedExperiment}
            formatChoice={formatChoice}
            onFormatChoice={setFormatChoice}
            designs={designs}
            designId={designId}
            onDesign={setDesignId}
            projects={projects}
            projectId={projectId}
            onProject={setProjectId}
          />
          {!layout.trim() ? (
            <ControlColumns
              negative={negativeColumns}
              positive={positiveColumns}
              guessed={guessedControls}
              onNegative={(value) => {
                setGuessedControls(false)
                setNegativeColumns(value)
              }}
              onPositive={(value) => {
                setGuessedControls(false)
                setPositiveColumns(value)
              }}
            />
          ) : null}
          <PlatePreview
            readCount={readCount}
            controls={controls}
            samples={samples}
            format={format}
            preview={preview}
            wells={parsed.wells}
            readout={parsed.readout}
            skipped={skipped}
          />
          <PlateTextFields
            data={data}
            onData={setData}
            layout={layout}
            onLayout={setLayout}
            noWellColumn={noWellColumn}
            analyseNow={analyseNow}
            onAnalyseNow={setAnalyseNow}
            showNotebook={Boolean(experimentId) && !fixedExperimentId}
            addToNotebook={addToNotebook}
            onAddToNotebook={setAddToNotebook}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button variant="quiet" />}>
          {t('common.actions.cancel')}
        </DialogClose>
        <Button
          variant="primary"
          disabled={save.isPending || readCount === 0 || !format}
          onClick={submit}
        >
          {t('plates.form.create')}
        </Button>
      </DialogFooter>
    </>
  )
}
