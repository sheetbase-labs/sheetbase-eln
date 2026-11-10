/**
 * Liquid handler worklists: making a transfer file from a plate run, and
 * reading the robot's log back to complete it and record what was used.
 */
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  SendToRobotDialog,
  WorklistJobLine,
  useWorklistOpenJob,
} from '#/components/instruments/robot-section'
import { RecordPickerDialog } from '#/components/record-picker/record-picker'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { FileDrop } from '#/components/ui/file-drop'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { t } from '#/copy'
import { downloadTextFile } from '#/lib/download'
import { notebookDataClient } from '#/lib/notebook-data'
import { PLATE_FORMATS } from '#/lib/plate-map'
import type { PlateFormat } from '#/lib/plate-map'
import {
  cancelPlateWorklist,
  completePlateWorklist,
  createPlateWorklist,
  messageOf,
  plateRunKeys,
  plateRunReference,
  worklistReference,
} from '#/lib/plate-runs'
import type { PlateRunRow, PlateWorklistRow } from '#/lib/plate-runs'
import {
  WORKLIST_FILE_EXTENSION,
  WORKLIST_FORMATS,
  WORKLIST_MODES,
  buildWorklist,
  parseRunLog,
  reconcileRunLog,
  writeWorklist,
} from '#/lib/plate-worklist'
import type {
  DestinationWell,
  ReconciledTransfer,
  Transfer,
  WorklistFormat,
  WorklistMode,
} from '#/lib/plate-worklist'

const client = notebookDataClient

const worklistFormatSchema = z.enum(WORKLIST_FORMATS).catch('csv')
const worklistModeSchema = z.enum(WORKLIST_MODES).catch('stamp')
const plateFormatSchema = z.enum(PLATE_FORMATS).catch('96_well')
const volumeUnitSchema = z.enum(['ul', 'nl', 'ml']).catch('ul')

/** A robot log's reason for skipping a transfer, as the worklist screen shows it. */
const SKIP_REASON_LABELS = new Map([
  ['not_found', t('plates.worklists.result.reasons.not_found')],
  ['not_a_volume', t('plates.worklists.result.reasons.not_a_volume')],
  ['refused', t('plates.worklists.result.reasons.refused')],
])

/** A stored reconciled transfer, as the completing screen reads it back. */
const reconciledTransferSchema = z.object({
  sourcePlate: z.string(),
  sourceWell: z.string(),
  destPlate: z.string(),
  destWell: z.string(),
  volumeUl: z.number(),
  label: z.string(),
  sampleId: z.string().nullable(),
  status: z.enum(['done', 'short', 'failed', 'skipped', 'missing']),
  movedUl: z.number(),
})

const storedReconciled = z.array(reconciledTransferSchema).catch([])

function positive(text: string): number | undefined {
  const n = Number(text)

  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined
}

export function WorklistBuilderDialog({
  run,
  open,
  onOpenChange,
}: {
  run: PlateRunRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const reference = plateRunReference(run.number)

  // The form starts fresh for each opening and each run it is opened for; a
  // new key remounts it with the starting values instead of an effect.
  const formKey = open ? `${reference}:${run.name}:${run.format}` : 'closed'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <WorklistBuilderForm
        key={formKey}
        run={run}
        reference={reference}
        onOpenChange={onOpenChange}
      />
    </Dialog>
  )
}

function WorklistBuilderForm({
  run,
  reference,
  onOpenChange,
}: {
  run: PlateRunRow
  reference: string
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(`${reference} ${run.name}`)
  const [format, setFormat] = useState<WorklistFormat>('csv')
  const [mode, setMode] = useState<WorklistMode>('stamp')
  const [sourcePlate, setSourcePlate] = useState('SRC1')
  const [sourceFormat, setSourceFormat] = useState<PlateFormat>(run.format)
  const [destPlate, setDestPlate] = useState(reference)
  const [defaultVolume, setDefaultVolume] = useState('10')
  const [wellVolume, setWellVolume] = useState('')
  const [minVolume, setMinVolume] = useState('')
  const [maxVolume, setMaxVolume] = useState('')

  const [experiment, setExperiment] = useState<{
    id: string
    name: string
  } | null>(null)

  const [picking, setPicking] = useState(false)

  const destinations = useMemo<DestinationWell[]>(
    () =>
      run.wells
        .filter((w) => w.role !== 'empty' && w.role !== 'blank')
        .map((w) => ({
          wellCode: w.wellCode,
          sampleId: w.sampleId ?? null,
          label: w.sampleLabel ?? t(`plates.worklist.roles.${w.role}`),
          volumeUl: w.volumeUl ?? null,
        })),
    [run.wells],
  )

  const plan = useMemo(
    () =>
      buildWorklist(destinations, {
        mode,
        sourcePlate: sourcePlate.trim() || 'SRC1',
        sourceFormat,
        destFormat: run.format,
        destPlate: destPlate.trim() || reference,
        defaultVolumeUl: positive(defaultVolume),
        sourceWellVolumeUl: positive(wellVolume),
        minVolumeUl: positive(minVolume),
        maxVolumeUl: positive(maxVolume),
      }),
    [
      destinations,
      mode,
      sourcePlate,
      sourceFormat,
      run.format,
      destPlate,
      reference,
      defaultVolume,
      wellVolume,
      minVolume,
      maxVolume,
    ],
  )

  const save = useMutation({
    mutationFn: async () => {
      const worklist = await createPlateWorklist(client, {
        name,
        format,
        mode,
        sourcePlate: sourcePlate.trim() || 'SRC1',
        sourceFormat,
        destPlate: destPlate.trim() || reference,
        destFormat: run.format,
        transfers: plan.transfers,
        runId: run.id,
        recordId: experiment?.id ?? null,
        options: {
          defaultVolumeUl: positive(defaultVolume) ?? null,
          sourceWellVolumeUl: positive(wellVolume) ?? null,
        },
      })

      const file = writeWorklist(format, plan.transfers, {
        sourceFormat,
        destFormat: run.format,
        title: name,
      })

      const filename = `${worklistReference(worklist.number)}.${WORKLIST_FILE_EXTENSION[format]}`
      downloadTextFile(filename, file)

      return { worklist, filename }
    },
    onSuccess: ({ worklist, filename }) => {
      void queryClient.invalidateQueries({ queryKey: plateRunKeys.all })
      toast.success(
        t('plates.worklist.created', {
          reference: worklistReference(worklist.number),
        }),
      )
      toast.message(t('plates.worklist.downloaded', { file: filename }))
      onOpenChange(false)
    },
    onError: (e) =>
      toast.error(messageOf(e, t('plates.worklist.couldNotSave'))),
  })

  const blocking = plan.transfers.length === 0 || name.trim() === ''

  return (
    <>
      <DialogContent className="w-[min(720px,calc(100vw-32px))]">
        <DialogHeader title={t('plates.worklist.title')} />
        <DialogBody>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label={t('plates.worklist.name')} className="md:col-span-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('plates.worklist.format')}>
              <Select
                value={format}
                onChange={(e) =>
                  setFormat(worklistFormatSchema.parse(e.target.value))
                }
              >
                {WORKLIST_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {t(`plates.worklist.formats.${f}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('plates.worklist.mode')}>
              <Select
                value={mode}
                onChange={(e) =>
                  setMode(worklistModeSchema.parse(e.target.value))
                }
              >
                {WORKLIST_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`plates.worklist.modes.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('plates.worklist.sourcePlate')}>
              <Input
                value={sourcePlate}
                onChange={(e) => setSourcePlate(e.target.value)}
              />
            </Field>
            <Field label={t('plates.worklist.sourceFormat')}>
              <Select
                value={sourceFormat}
                onChange={(e) =>
                  setSourceFormat(plateFormatSchema.parse(e.target.value))
                }
              >
                {PLATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {t(`plates.formats.${f}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('plates.worklist.destPlate')}>
              <Input
                value={destPlate}
                onChange={(e) => setDestPlate(e.target.value)}
              />
            </Field>
            <Field label={t('plates.worklist.defaultVolume')}>
              <Input
                inputMode="decimal"
                value={defaultVolume}
                onChange={(e) => setDefaultVolume(e.target.value)}
              />
            </Field>
            <Field label={t('plates.worklist.wellVolume')}>
              <Input
                inputMode="decimal"
                value={wellVolume}
                onChange={(e) => setWellVolume(e.target.value)}
              />
            </Field>
            <Field label={t('plates.worklist.minVolume')}>
              <Input
                inputMode="decimal"
                value={minVolume}
                onChange={(e) => setMinVolume(e.target.value)}
              />
            </Field>
            <Field label={t('plates.worklist.maxVolume')}>
              <Input
                inputMode="decimal"
                value={maxVolume}
                onChange={(e) => setMaxVolume(e.target.value)}
              />
            </Field>
            <div className="flex flex-col gap-1 text-label">
              <span className="font-medium">
                {t('plates.worklist.experiment')}
              </span>
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-fg-muted">
                  {experiment?.name ?? t('plates.worklist.noExperiment')}
                </span>
                <Button size="sm" onClick={() => setPicking(true)}>
                  {t('plates.worklists.complete.choose')}
                </Button>
              </div>
            </div>
          </div>
          <div
            role="status"
            className="mt-3 rounded-md bg-muted px-3 py-2 text-label text-fg-muted"
          >
            {plan.transfers.length === 0
              ? t('plates.worklist.previewNone')
              : t('plates.worklist.preview', {
                  transfers: plan.transfers.length,
                  sources: plan.sources.length,
                })}
            {plan.issues.length > 0 ? (
              <ul className="mt-1 list-disc pl-4 text-warning-text">
                {plan.issues.slice(0, 5).map((issue) => (
                  <li key={`${issue.code}-${issue.wellCode ?? issue.message}`}>
                    {t(`plates.worklist.issues.${issue.code}`, {
                      well: issue.wellCode ?? '',
                      message: issue.message,
                    })}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={blocking || save.isPending}
            onClick={() => save.mutate()}
          >
            {t('plates.worklist.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
      <RecordPickerDialog
        open={picking}
        onOpenChange={setPicking}
        title={t('plates.worklists.complete.choose')}
        allowed={['Experiment']}
        onPick={(items) =>
          setExperiment(
            items[0] ? { id: items[0].id, name: items[0].name } : null,
          )
        }
      />
    </>
  )
}

/** A worklist opened: its transfers, and completing or cancelling it. */
/** What completing a worklist needs: the robot log, its unit, and the purpose. */
function CompleteWorklistFields({
  unit,
  onUnitChange,
  logText,
  onLogText,
  withdraw,
  onWithdrawChange,
  experimentName,
  recordId,
  needExperiment,
  counts,
  onChooseExperiment,
}: {
  unit: 'ul' | 'nl' | 'ml'
  onUnitChange: (unit: 'ul' | 'nl' | 'ml') => void
  logText: string | null
  onLogText: (text: string | null) => void
  withdraw: boolean
  onWithdrawChange: (withdraw: boolean) => void
  experimentName: string | null
  recordId: string | null
  needExperiment: boolean
  counts: {
    done: number
    short: number
    failed: number
    skipped: number
    missing: number
  }
  onChooseExperiment: () => void
}) {
  return (
    <>
      <p className="text-label text-fg-muted">
        {t('plates.worklists.complete.intro')}
      </p>
      <FileDrop
        label={t('plates.worklists.complete.log')}
        hint={t('plates.worklists.complete.logHint')}
        accept=".csv,.tsv,.txt,.log"
        onFile={async (file) => onLogText(file ? await file.text() : null)}
      />
      <Field label={t('plates.worklists.complete.unit')}>
        <Select
          value={unit}
          onChange={(e) => onUnitChange(volumeUnitSchema.parse(e.target.value))}
        >
          {(['ul', 'nl', 'ml'] as const).map((u) => (
            <option key={u} value={u}>
              {t(`plates.worklists.complete.units.${u}`)}
            </option>
          ))}
        </Select>
      </Field>
      <p role="status" className="text-label text-fg-muted">
        {logText === null
          ? t('plates.worklists.complete.noLog')
          : t('plates.worklists.complete.summary', counts)}
      </p>
      <label className="flex items-start gap-2 text-label">
        <Checkbox
          checked={withdraw}
          onCheckedChange={(v) => onWithdrawChange(v === true)}
        />
        <span className="flex flex-col">
          {t('plates.worklists.complete.withdraw')}
          <span className="text-fg-muted">
            {t('plates.worklists.complete.withdrawHint')}
          </span>
        </span>
      </label>
      {withdraw && !recordId ? (
        <div className="flex items-center gap-2 text-label">
          <span className="font-medium">
            {t('plates.worklists.complete.experiment')}
          </span>
          <span className="flex-1 truncate text-fg-muted">
            {experimentName ?? ''}
          </span>
          <Button size="sm" onClick={onChooseExperiment}>
            {t('plates.worklists.complete.choose')}
          </Button>
        </div>
      ) : null}
      {needExperiment ? (
        <p className="text-label text-danger-text">
          {t('plates.worklists.complete.needExperiment')}
        </p>
      ) : null}
    </>
  )
}

/** What a worklist says about itself: its plates, state and what was withdrawn. */
function WorklistSummary({
  worklist,
  isPlanned,
}: {
  worklist: PlateWorklistRow
  isPlanned: boolean
}) {
  const tone =
    worklist.status === 'complete'
      ? 'ok'
      : worklist.status === 'cancelled'
        ? 'draft'
        : 'progress'

  return (
    <>
      <p className="text-label text-fg-muted">
        {t(`plates.worklist.formats.${worklist.format}`)} ·{' '}
        {worklist.source_plate} → {worklist.dest_plate}
        {' · '}
        <Status tone={tone}>
          {t(`plates.worklists.statuses.${worklist.status}`)}
        </Status>
      </p>
      {isPlanned ? <WorklistJobLine worklistId={worklist.id} /> : null}
      {worklist.withdrawals ? (
        <div className="flex flex-col gap-1 text-label">
          {worklist.withdrawals.withdrawn.length > 0 ? (
            <span>
              <b>{t('plates.worklists.result.withdrawn')}:</b>{' '}
              {worklist.withdrawals.withdrawn
                .map((w) => `${w.identifier} ${w.quantity} ${w.unit}`)
                .join(', ')}
            </span>
          ) : null}
          {worklist.withdrawals.skipped.length > 0 ? (
            <span className="text-warning-text">
              <b>{t('plates.worklists.result.skipped')}:</b>{' '}
              {worklist.withdrawals.skipped
                .map((s) =>
                  `${s.identifier ?? ''} ${SKIP_REASON_LABELS.get(s.reason) ?? s.reason}`.trim(),
                )
                .join(', ')}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

/** The transfers a worklist asks the liquid handler to make. */
function WorklistTransfersTable({
  rows,
  showStatus,
}: {
  rows: ReconciledTransfer[]
  showStatus: boolean
}) {
  return (
    <TableBox className="max-h-[320px] overflow-auto">
      <Table aria-label={t('plates.worklists.transfers')}>
        <TableHeader>
          <TableRow>
            <TableHead>
              {t('plates.worklists.transferColumns.sourceWell')}
            </TableHead>
            <TableHead>
              {t('plates.worklists.transferColumns.destWell')}
            </TableHead>
            <TableHead>
              {t('plates.worklists.transferColumns.volume')}
            </TableHead>
            <TableHead>
              {t('plates.worklists.transferColumns.sample')}
            </TableHead>
            {showStatus ? (
              <TableHead>
                {t('plates.worklists.transferColumns.status')}
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody colSpan={5}>
          {rows.slice(0, 500).map((row) => (
            <TableRow key={`${row.sourceWell}-${row.destWell}`}>
              <TableCell className="mono">{row.sourceWell}</TableCell>
              <TableCell className="mono">{row.destWell}</TableCell>
              <TableCell className="num">{row.volumeUl}</TableCell>
              <TableCell className="truncate">{row.label}</TableCell>
              {showStatus ? (
                <TableCell>
                  {t(`plates.worklists.transferStatus.${row.status}`)}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableBox>
  )
}

export function WorklistDialog({
  worklist,
  canWrite,
  onClose,
}: {
  worklist: PlateWorklistRow | null
  canWrite: boolean
  onClose: () => void
}) {
  if (!worklist) return null

  // One worklist's screen starts fresh when another worklist is opened, so the
  // body is keyed by it rather than reset from an effect.
  return (
    <WorklistBody
      key={worklist.id}
      worklist={worklist}
      canWrite={canWrite}
      onClose={onClose}
    />
  )
}

/** What is stored against a worklist as done, or the plan while it is planned. */
function transfersToShow(
  worklist: PlateWorklistRow,
  reconciled: ReconciledTransfer[],
  planned: Transfer[],
): ReconciledTransfer[] {
  if (worklist.status === 'planned') return reconciled

  const stored = storedReconciled.parse(worklist.reconciled)

  if (stored.length > 0) return stored

  return planned.map((p) => ({
    ...p,
    status: 'done' as const,
    movedUl: p.volumeUl,
  }))
}

/** The buttons under a worklist: complete, cancel, download or send to a robot. */
function WorklistFooter({
  completing,
  canWrite,
  isPlanned,
  needExperiment,
  completingNow,
  cancelling,
  hasOpenJob,
  onBack,
  onComplete,
  onCancel,
  onDownload,
  onSend,
}: {
  completing: boolean
  canWrite: boolean
  isPlanned: boolean
  needExperiment: boolean
  completingNow: boolean
  cancelling: boolean
  hasOpenJob: boolean
  onBack: () => void
  onComplete: () => void
  onCancel: () => void
  onDownload: () => void
  onSend: () => void
}) {
  if (completing)
    return (
      <>
        <Button variant="quiet" onClick={onBack}>
          {t('common.actions.back')}
        </Button>
        <span className="flex-1" />
        <Button
          variant="primary"
          disabled={completingNow || needExperiment}
          onClick={onComplete}
        >
          {t('plates.worklists.complete.submit')}
        </Button>
      </>
    )

  const mayChange = canWrite && isPlanned

  return (
    <>
      {mayChange ? (
        <Button variant="quiet" disabled={cancelling} onClick={onCancel}>
          {t('plates.worklists.cancel')}
        </Button>
      ) : null}
      <span className="flex-1" />
      <Button onClick={onDownload}>{t('plates.worklist.download')}</Button>
      {mayChange ? (
        <Button disabled={hasOpenJob} onClick={onSend}>
          {t('automation.robot.send.button')}
        </Button>
      ) : null}
      {mayChange ? (
        <Button variant="primary" onClick={() => onBack()}>
          {t('plates.worklists.complete.submit')}
        </Button>
      ) : (
        <DialogClose render={<Button variant="quiet" />}>
          {t('common.actions.close')}
        </DialogClose>
      )}
    </>
  )
}

function WorklistBody({
  worklist,
  canWrite,
  onClose,
}: {
  worklist: PlateWorklistRow
  canWrite: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [unit, setUnit] = useState<'ul' | 'nl' | 'ml'>('ul')
  const [logText, setLogText] = useState<string | null>(null)
  const [withdraw, setWithdraw] = useState(true)

  const [experiment, setExperiment] = useState<{
    id: string
    name: string
  } | null>(null)

  const [picking, setPicking] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [sending, setSending] = useState(false)
  const openJob = useWorklistOpenJob(worklist.id)

  const planned = useMemo<Transfer[]>(
    () =>
      worklist.transfers.map((tr) => ({
        sourcePlate: worklist.source_plate,
        destPlate: worklist.dest_plate,
        sourceWell: tr.sourceWell,
        destWell: tr.destWell,
        volumeUl: tr.volumeUl,
        label: tr.label,
        sampleId: tr.sampleId ?? null,
      })),
    [worklist],
  )

  const reconciled = useMemo<ReconciledTransfer[]>(() => {
    if (logText === null) {
      return planned.map((tr) => ({
        ...tr,
        status: 'done' as const,
        movedUl: tr.volumeUl,
      }))
    }

    return reconcileRunLog(
      planned,
      parseRunLog(logText, { volumeUnit: unit }).entries,
    )
  }, [planned, logText, unit])

  const counts = useMemo(() => {
    const c = { done: 0, short: 0, failed: 0, skipped: 0, missing: 0 }

    for (const r of reconciled) c[r.status] += 1

    return c
  }, [reconciled])

  const complete = useMutation({
    mutationFn: async () => {
      return completePlateWorklist(client, {
        worklistId: worklist.id,
        reconciled: reconciled.map((r) => ({
          sourceWell: r.sourceWell,
          destWell: r.destWell,
          volumeUl: r.volumeUl,
          movedUl: r.movedUl,
          status: r.status,
          label: r.label,
          sampleId: r.sampleId,
        })),
        purposeRecordId: experiment?.id ?? null,
        recordWithdrawals: withdraw,
      })
    },
    onSuccess: (done) => {
      void queryClient.invalidateQueries({ queryKey: plateRunKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['records'] })
      toast.success(
        t('plates.worklists.complete.completed', {
          reference: worklistReference(done.number),
        }),
      )
      const w = done.withdrawals

      if (w && w.withdrawn.length > 0)
        toast.message(
          t('plates.worklists.complete.withdrawn', {
            count: w.withdrawn.length,
          }),
        )

      if (w && w.skipped.length > 0)
        toast.warning(
          t('plates.worklists.complete.skipped', { count: w.skipped.length }),
        )
      onClose()
    },
    onError: (e) =>
      toast.error(
        messageOf(e, t('plates.worklists.complete.couldNotComplete')),
      ),
  })

  const cancel = useMutation({
    mutationFn: async () => {
      await cancelPlateWorklist(client, worklist.id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: plateRunKeys.all })
      toast.success(
        t('plates.worklists.cancelled', {
          reference: worklistReference(worklist.number),
        }),
      )
      onClose()
    },
    onError: (e) => toast.error(messageOf(e, '')),
  })

  const reference = worklistReference(worklist.number)
  const isPlanned = worklist.status === 'planned'
  const needExperiment = withdraw && !experiment && !worklist.record_id

  const shown = transfersToShow(worklist, reconciled, planned)

  function download() {
    const file = writeWorklist(worklist.format, planned, {
      sourceFormat: worklist.source_format,
      destFormat: worklist.dest_format,
      title: worklist.name,
    })

    try {
      downloadTextFile(
        `${reference}.${WORKLIST_FILE_EXTENSION[worklist.format]}`,
        file,
      )
    } catch (e) {
      toast.error(messageOf(e, ''))
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="w-[min(780px,calc(100vw-32px))]">
          <DialogHeader
            title={
              completing
                ? t('plates.worklists.complete.title', { reference })
                : `${reference} · ${worklist.name}`
            }
          />
          <DialogBody>
            <div className="flex flex-col gap-3">
              {completing ? (
                <CompleteWorklistFields
                  unit={unit}
                  onUnitChange={setUnit}
                  logText={logText}
                  onLogText={setLogText}
                  withdraw={withdraw}
                  onWithdrawChange={setWithdraw}
                  experimentName={experiment?.name ?? null}
                  recordId={worklist.record_id}
                  needExperiment={needExperiment}
                  counts={counts}
                  onChooseExperiment={() => setPicking(true)}
                />
              ) : (
                <WorklistSummary worklist={worklist} isPlanned={isPlanned} />
              )}
              <WorklistTransfersTable
                rows={shown}
                showStatus={!isPlanned || completing}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <WorklistFooter
              completing={completing}
              canWrite={canWrite}
              isPlanned={isPlanned}
              needExperiment={needExperiment}
              completingNow={complete.isPending}
              cancelling={cancel.isPending}
              hasOpenJob={openJob !== null}
              onBack={() => setCompleting(false)}
              onComplete={() => complete.mutate()}
              onCancel={() => cancel.mutate()}
              onDownload={download}
              onSend={() => setSending(true)}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RecordPickerDialog
        open={picking}
        onOpenChange={setPicking}
        title={t('plates.worklists.complete.choose')}
        allowed={['Experiment']}
        onPick={(items) =>
          setExperiment(
            items[0] ? { id: items[0].id, name: items[0].name } : null,
          )
        }
      />
      {sending ? (
        <SendToRobotDialog
          worklistId={worklist.id}
          reference={reference}
          onClose={() => setSending(false)}
        />
      ) : null}
    </>
  )
}
