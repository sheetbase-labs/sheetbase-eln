/**
 * Adding a plate run: drop the file the plate reader wrote (CSV or Excel) or
 * paste it, say which wells are controls, and see the plate and its quality
 * before anything is saved. A run can belong to an experiment, and then lands
 * in that experiment's notebook by itself.
 */
import { useState } from 'react'

import { useRecordModelProjects } from '#/components/models/models-data'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { t } from '#/copy'
import type { PlateFormat } from '#/lib/plate-map'
import type { PlateRunRow } from '#/lib/plate-runs'
import { AssaySetupSection } from './assay-setup'
import { ControlColumns, PlatePreview } from './plate-preview'
import { PlateTextFields } from './plate-text-fields'
import { RunDetailsFields } from './run-details-fields'
import { RunFileSection } from './run-file-section'
import { PlateMapFillSection } from './plate-map-fill-section'
import { RunStepField } from './run-step-field'
import { useExperimentSamples } from './use-experiment-samples'
import { useRunStep } from './use-run-step'
import { useRunFile } from './use-run-file'
import { useCreatePlateRun } from './use-create-plate-run'
import { useAssaySetupChoice } from './use-assay-setup'
import { usePlateDraft } from './use-plate-draft'

export function NewRunDialog({
  open,
  onOpenChange,
  onCreated,
  experimentId,
  initialFile,
  chooseStep = false,
  stepBlockId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `stepBlockId` is the protocol step the person chose, or null for none. */
  onCreated: (run: PlateRunRow, stepBlockId: string | null) => void
  /**
   * The experiment the run belongs to, when the dialog was opened from one. It
   * is fixed, and the notebook is left to the caller (it is already showing
   * the run's block).
   */
  experimentId?: string
  /**
   * Offer the experiment's protocol steps, so the caller can put the run in the
   * step it is for. `stepBlockId` is the step to start on (the Now card's).
   */
  chooseStep?: boolean
  stepBlockId?: string
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
          chooseStep={chooseStep}
          initialStep={stepBlockId}
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
  chooseStep,
  initialStep,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (run: PlateRunRow, stepBlockId: string | null) => void
  fixedExperimentId: string | undefined
  initialFile: File | null
  chooseStep: boolean
  initialStep: string | undefined
}) {
  const projects = useRecordModelProjects().data ?? []
  const [name, setName] = useState('')
  const [formatChoice, setFormatChoice] = useState<'auto' | PlateFormat>('auto')
  const [data, setData] = useState('')
  const [layout, setLayout] = useState('')
  const [projectId, setProjectId] = useState('')
  const [pickedExperiment, setPickedExperiment] = useState('')
  const [addToNotebook, setAddToNotebook] = useState(true)

  const experimentId = fixedExperimentId ?? pickedExperiment

  const runStep = useRunStep({
    experimentId,
    experimentFixed: Boolean(fixedExperimentId),
    chooseStep,
    initialStep,
  })

  const experimentSamples = useExperimentSamples(experimentId).data ?? []

  // The assay's design brings its controls and settings with it, so a second
  // plate of the same assay needs none of them typed again.
  const assay = useAssaySetupChoice({ enabled: open, experimentId })

  const [analyseNow, setAnalyseNow] = useState(true)
  const [interacted, setInteracted] = useState(false)

  const { file, candidateId, fileError, takeCandidate, readFile } = useRunFile({
    initialFile,
    setData,
    setFormatChoice,
    setName,
    onGuess: assay.onGuess,
  })

  const { parsed, format, readCount, controls, samples, preview } =
    usePlateDraft({
      data,
      layout,
      formatChoice,
      negativeColumns: assay.negative,
      positiveColumns: assay.positive,
      config: assay.config,
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
      designId: assay.designId,
      experimentId,
      experimentFixed: Boolean(fixedExperimentId),
      stepBlockId: runStep.saved,
      addToNotebook,
      analyseNow,
      config: assay.config,
      negativeColumns: assay.negative,
      positiveColumns: assay.positive,
      remember: assay.request,
    },
    (run) => {
      onOpenChange(false)
      onCreated(run, runStep.saved ?? null)
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
          <RunFileSection
            file={file}
            candidateId={candidateId}
            fileError={fileError}
            onFile={readFile}
            onCandidate={takeCandidate}
          />
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
            designs={assay.designs.map((d) => ({
              id: d.id,
              name: d.name,
              engine: d.setup?.config.method ?? null,
            }))}
            designId={assay.designId}
            onDesign={assay.onDesign}
            projects={projects}
            projectId={projectId}
            onProject={setProjectId}
          />
          {runStep.wants ? (
            <RunStepField
              steps={runStep.steps}
              value={runStep.step}
              onChange={runStep.onPick}
            />
          ) : null}
          {!layout.trim() && assay.method === 'screen' ? (
            <ControlColumns
              negative={assay.negative}
              positive={assay.positive}
              guessed={assay.guessed}
              onNegative={assay.onNegative}
              onPositive={assay.onPositive}
            />
          ) : null}
          <AssaySetupSection choice={assay} hasLayout={layout.trim() !== ''} />
          {experimentSamples.length > 0 ? (
            <PlateMapFillSection
              samples={experimentSamples}
              method={assay.method}
              dilution={assay.dilutionFactor}
              format={format ?? '96_well'}
              onFill={setLayout}
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
            quantify={assay.method === 'quantify'}
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
