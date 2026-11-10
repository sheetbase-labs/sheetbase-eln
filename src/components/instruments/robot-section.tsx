/**
 * A robot instrument: how it is reached, whether its agent is running, and the
 * worklist jobs sent to it. A person presses Start on each job.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Button } from '#/components/ui/button'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { DescriptionList, Section } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { Tooltip } from '#/components/ui/tooltip'
import { t } from '#/copy'
import type { CopyKey } from '#/copy'
import { AGENT_SYSTEMS } from '#/lib/connectors/agent-package'
import type { AgentSystem } from '#/lib/connectors/agent-package'
import {
  agentQueryKeys,
  downloadRobotAgent,
  fetchRobotAgentStatus,
} from '#/lib/connectors/agent-client'
import { formatRelativeTime, notebookDataClient } from '#/lib/notebook-data'
import {
  FILE_ROBOT_FORMATS,
  ROBOT_DRIVERS,
  isOpenJob,
  isRobotDriver,
  jobReference,
  labwareFieldsFor,
  queueJob,
  robotQueryKeys,
  fetchInstrumentJobs,
  fetchRobotSettings,
  saveRobotSettings,
  clearRobotSettings,
  startJob,
  cancelJob,
} from '#/lib/robots'
import type {
  InstrumentJobWire,
  RobotDriver,
  RobotJobStatus,
  RobotLabware,
  RobotSettingsWire,
} from '#/lib/robots'
import type { WorklistFormat } from '#/lib/plate-worklist'
import type { InstrumentRow } from './instruments-data'
import { JOB_TONES } from './instruments-data'

const client = notebookDataClient

export function JobStatus({ status }: { status: RobotJobStatus }) {
  return (
    <Status tone={JOB_TONES[status]}>
      {t(`automation.robot.jobs.statuses.${status}`)}
    </Status>
  )
}

function useRobotSettings(instrumentId: string) {
  return useQuery({
    queryKey: robotQueryKeys.settings(instrumentId),
    queryFn: async () =>
      (await fetchRobotSettings(client)).find(
        (row) => row.instrument_id === instrumentId,
      ) ?? null,
    staleTime: 15_000,
  })
}

function AgentLine({ instrumentId }: { instrumentId: string }) {
  const status = useQuery({
    queryKey: agentQueryKeys.robotStatus(instrumentId),
    queryFn: () => fetchRobotAgentStatus(instrumentId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  if (!status.data) return <span className="text-fg-muted">—</span>
  const { downloaded, running, lastSeenAt } = status.data

  if (!downloaded)
    return <Status tone="none">{t('automation.robot.agentNone')}</Status>

  if (!lastSeenAt)
    return <Status tone="draft">{t('automation.robot.agentWaiting')}</Status>
  const when = formatRelativeTime(lastSeenAt)

  return running ? (
    <Status tone="ok">{t('automation.robot.agentRunning', { when })}</Status>
  ) : (
    <Status tone="warn">{t('automation.robot.agentQuiet', { when })}</Status>
  )
}

export function RobotSection({
  instrument,
  canManage,
  canRun,
}: {
  instrument: InstrumentRow
  canManage: boolean
  canRun: boolean
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const settings = useRobotSettings(instrument.id)
  const robot = settings.data ?? null

  const jobs = useQuery({
    queryKey: robotQueryKeys.jobs(instrument.id),
    queryFn: () => fetchInstrumentJobs(client, { instrumentId: instrument.id }),
    enabled: robot !== null,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((job) => isOpenJob(job.status))
        ? 4_000
        : 30_000,
    staleTime: 2_000,
  })

  const remove = useMutation({
    mutationFn: () => clearRobotSettings(client, instrument.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['robots'] })
      toast.success(t('automation.robot.removed'))
      setRemoving(false)
    },
    onError: (e) =>
      toast.error(e instanceof Error && e.message ? e.message : ''),
  })

  if (settings.isPending) return null

  if (!robot && !canManage) return null

  return (
    <Section
      className="border-t border-border pt-4"
      title={t('automation.robot.title')}
      action={
        canManage ? (
          robot ? (
            <span className="flex items-center gap-2">
              <Button size="sm" onClick={() => setAgentOpen(true)}>
                {t('automation.robot.downloadAgent')}
              </Button>
              <Button size="sm" onClick={() => setEditing(true)}>
                {t('automation.robot.edit')}
              </Button>
            </span>
          ) : (
            <Button size="sm" onClick={() => setEditing(true)}>
              {t('automation.robot.setUp')}
            </Button>
          )
        ) : undefined
      }
    >
      {robot ? (
        <div className="flex flex-col gap-4">
          <DescriptionList
            labelWidth={130}
            items={[
              [
                t('automation.robot.connection'),
                t(`automation.robot.drivers.${robot.driver}`),
              ],
              [
                t('automation.robot.worklistFormat'),
                t(`plates.worklist.formats.${robot.worklist_format}`),
              ],
              [
                t('automation.robot.labware'),
                <LabwareSummary key="labware" robot={robot} />,
              ],
              [
                <Tooltip
                  key="agent"
                  content={t('automation.robot.agentTooltip')}
                >
                  <span className="cursor-help">
                    {t('automation.robot.agent')}
                  </span>
                </Tooltip>,
                <AgentLine key="status" instrumentId={instrument.id} />,
              ],
            ]}
          />
          <RobotJobsTable
            jobs={jobs.data ?? []}
            loading={jobs.isPending}
            canRun={canRun}
          />
          {canManage ? (
            <div>
              <Button
                variant="quiet"
                size="sm"
                onClick={() => setRemoving(true)}
              >
                {t('automation.robot.remove')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="m-0 text-body text-fg-muted">
          {t('automation.robot.notSetUp')}
        </p>
      )}
      {editing ? (
        <RobotSetupDialog
          instrument={instrument}
          current={robot}
          onClose={() => setEditing(false)}
        />
      ) : null}
      {agentOpen && robot ? (
        <RobotAgentDialog
          instrument={instrument}
          robot={robot}
          onClose={() => setAgentOpen(false)}
        />
      ) : null}
      {/* react-doctor-disable-next-line react-doctor/duplicate-jsx-subtree -- Robot removal and stocktake cancellation share dialog primitives, not workflow, copy or cache ownership. */}
      <ConfirmDialog open={removing} onOpenChange={setRemoving}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('automation.robot.removeTitle')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('automation.robot.removeBody')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t('automation.robot.remove')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </Section>
  )
}

function LabwareSummary({ robot }: { robot: RobotSettingsWire }) {
  const fields = labwareFieldsFor(robot.driver, robot.worklist_format)

  const values = fields
    .map((key) => robot.labware[key])
    .flatMap((value) => {
      const text = z.string().safeParse(value)

      return text.success && text.data !== '' ? [text.data] : []
    })

  return (
    <span className="text-fg-muted">
      {values.length > 0 ? (
        <span className="mono">{values.join(' · ')}</span>
      ) : (
        t('automation.robot.labwareNone')
      )}
    </span>
  )
}

function RobotJobsTable({
  jobs,
  loading,
  canRun,
}: {
  jobs: InstrumentJobWire[]
  loading: boolean
  canRun: boolean
}) {
  const queryClient = useQueryClient()

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ['robots', 'jobs'] })

  const start = useMutation({
    mutationFn: (job: InstrumentJobWire) => startJob(client, job.id),
    onSuccess: (job) => {
      refresh()
      toast.success(
        t('automation.robot.jobs.started', {
          reference: jobReference(job.number),
        }),
      )
    },
    onError: (e) =>
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t('automation.robot.jobs.couldNotStart'),
      ),
  })

  const stop = useMutation({
    mutationFn: (job: InstrumentJobWire) => cancelJob(client, job.id),
    onSuccess: (job) => {
      refresh()
      toast.success(
        t('automation.robot.jobs.stopped', {
          reference: jobReference(job.number),
        }),
      )
    },
    onError: (e) =>
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t('automation.robot.jobs.couldNotStop'),
      ),
  })

  const columns = useMemo<RegistryColumn<InstrumentJobWire>[]>(
    () => [
      {
        id: 'job',
        header: t('automation.robot.jobs.job'),
        size: 100,
        cell: ({ row }) => (
          <span className="mono font-medium text-fg">
            {jobReference(row.original.number)}
          </span>
        ),
      },
      {
        id: 'worklist',
        header: t('automation.robot.jobs.worklist'),
        cell: ({ row }) => (
          <span className="truncate text-fg">
            {row.original.plate_worklists?.name ?? '—'}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('automation.robot.jobs.status'),
        size: 200,
        cell: ({ row }) => <JobStatus status={row.original.status} />,
      },
      {
        id: 'result',
        header: t('automation.robot.jobs.result'),
        size: 190,
        cell: ({ row }) => {
          const job = row.original

          if (job.error_message)
            return (
              <Tooltip content={job.error_message}>
                <span className="truncate text-danger-text">
                  {job.error_message}
                </span>
              </Tooltip>
            )

          if (!job.result) return <span className="text-fg-muted">—</span>
          const failed = job.result.byStatus['failed'] ?? 0

          return (
            <span className="text-fg-muted">
              {failed > 0
                ? t('automation.robot.jobs.resultFailed', { count: failed })
                : t('automation.robot.jobs.resultTransfers', {
                    count: job.result.transfers,
                  })}
            </span>
          )
        },
      },
      {
        id: 'queued',
        header: t('automation.robot.jobs.queued'),
        size: 120,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {formatRelativeTime(row.original.created_at)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        size: 150,
        cell: ({ row }) => {
          const job = row.original

          if (!canRun || !isOpenJob(job.status)) return null

          return (
            <span className="flex items-center justify-end gap-1">
              {job.status === 'staged' ? (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={start.isPending}
                  onClick={(event) => {
                    event.stopPropagation()
                    start.mutate(job)
                  }}
                >
                  {start.isPending && start.variables.id === job.id
                    ? t('automation.robot.jobs.starting')
                    : t('automation.robot.jobs.start')}
                </Button>
              ) : null}
              {!job.cancel_requested ? (
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={stop.isPending}
                  onClick={(event) => {
                    event.stopPropagation()
                    stop.mutate(job)
                  }}
                >
                  {t('automation.robot.jobs.stop')}
                </Button>
              ) : null}
            </span>
          )
        },
      },
    ],
    [canRun, start, stop],
  )

  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-label font-medium text-fg">
        {t('automation.robot.jobs.title')}
      </h3>
      {!loading && jobs.length === 0 ? (
        <p className="m-0 text-body text-fg-muted">
          {t('automation.robot.jobs.empty')}
        </p>
      ) : (
        <TableBox>
          <RegistryGrid
            label={t('automation.robot.jobs.tableLabel')}
            rows={jobs}
            columns={columns}
            getRowId={(r) => r.id}
            isLoading={loading}
          />
        </TableBox>
      )}
    </div>
  )
}

const LABWARE_LABELS = {
  opentronsSourceLabware: 'automation.robot.sourceLabware',
  opentronsDestLabware: 'automation.robot.destLabware',
  opentronsPipette: 'automation.robot.pipette',
  opentronsTiprack: 'automation.robot.tiprack',
  opentronsMount: 'automation.robot.mount',
  liquidClass: 'automation.robot.liquidClass',
  tecanSourceType: 'automation.robot.sourceType',
  tecanDestType: 'automation.robot.destType',
  echoSourceType: 'automation.robot.sourceType',
} as const satisfies Record<keyof RobotLabware, CopyKey>

function RobotSetupDialog({
  instrument,
  current,
  onClose,
}: {
  instrument: InstrumentRow
  current: RobotSettingsWire | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()

  const [driver, setDriver] = useState<RobotDriver>(
    current?.driver ?? 'opentrons',
  )

  const [format, setFormat] = useState<WorklistFormat>(
    current?.worklist_format ?? 'opentrons',
  )

  const [labware, setLabware] = useState<RobotLabware>(current?.labware ?? {})

  useEffect(() => {
    const wanted = ROBOT_DRIVERS.find((d) => d.key === driver)?.worklistFormat

    if (driver === 'opentrons' && wanted) setFormat(wanted)
    else if (!FILE_ROBOT_FORMATS.includes(format)) setFormat('csv')
  }, [driver, format])

  const fields = labwareFieldsFor(driver, format)

  const save = useMutation({
    mutationFn: () => {
      const kept: RobotLabware = {}

      for (const key of fields) {
        const value = labware[key]

        if (value) Object.assign(kept, { [key]: value })
      }

      return saveRobotSettings(client, {
        instrumentId: instrument.id,
        driver,
        worklistFormat: format,
        labware: kept,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['robots'] })
      toast.success(t('automation.robot.saved'))
      onClose()
    },
    onError: (e) =>
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t('automation.robot.couldNotSave'),
      ),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('automation.robot.dialogTitle', { name: instrument.name })}
        />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <p className="m-0 text-body text-fg-muted">
              {t('automation.robot.explain')}
            </p>
            <Field label={t('automation.robot.driver')}>
              <Select
                value={driver}
                onChange={(event) => {
                  const value = event.target.value

                  if (isRobotDriver(value)) setDriver(value)
                }}
              >
                {ROBOT_DRIVERS.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {t(`automation.robot.drivers.${entry.key}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {driver === 'file' ? (
              <Field label={t('automation.robot.format')}>
                <Select
                  value={format}
                  onChange={(event) => {
                    const selected = FILE_ROBOT_FORMATS.find(
                      (entry) => entry === event.target.value,
                    )

                    if (selected) setFormat(selected)
                  }}
                >
                  {FILE_ROBOT_FORMATS.map((value) => (
                    <option key={value} value={value}>
                      {t(`plates.worklist.formats.${value}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {fields.map((key) =>
              key === 'opentronsMount' ? (
                <Field key={key} label={t('automation.robot.mount')}>
                  <Select
                    value={labware.opentronsMount ?? 'left'}
                    onChange={(event) => {
                      const selected = event.target.value

                      if (selected === 'left' || selected === 'right')
                        setLabware((c) => ({ ...c, opentronsMount: selected }))
                    }}
                  >
                    {(['left', 'right'] as const).map((mount) => (
                      <option key={mount} value={mount}>
                        {t(`automation.robot.mounts.${mount}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field key={key} label={t(LABWARE_LABELS[key])}>
                  <Input
                    value={labware[key] ?? ''}
                    onChange={(event) =>
                      setLabware((c) => ({ ...c, [key]: event.target.value }))
                    }
                  />
                </Field>
              ),
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('common.actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RobotAgentDialog({
  instrument,
  robot,
  onClose,
}: {
  instrument: InstrumentRow
  robot: RobotSettingsWire
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [system, setSystem] = useState<AgentSystem>('windows')
  const [address, setAddress] = useState('')
  const [dir, setDir] = useState('')

  const example =
    AGENT_SYSTEMS.find((entry) => entry.value === system)?.folderExample ?? ''

  const missing =
    robot.driver === 'opentrons' ? address.trim() === '' : dir.trim() === ''

  const download = useMutation({
    mutationFn: () =>
      downloadRobotAgent({
        instrumentId: instrument.id,
        system,
        robot:
          robot.driver === 'opentrons'
            ? { driver: 'opentrons', address: address.trim() }
            : { driver: 'file', dir: dir.trim() },
      }),
    onSuccess: (file) => {
      void queryClient.invalidateQueries({
        queryKey: agentQueryKeys.robotStatus(instrument.id),
      })
      toast.success(t('automation.robot.downloaded', { file }))
      onClose()
    },
    onError: (e) =>
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t('automation.robot.couldNotDownload'),
      ),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('automation.robot.agentDialogTitle', {
            name: instrument.name,
          })}
        />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <p className="m-0 text-body text-fg-muted">
              {t('automation.robot.agentExplain')}
            </p>
            <Field label={t('automation.robot.system')}>
              <Select
                value={system}
                onChange={(event) => {
                  const selected = AGENT_SYSTEMS.find(
                    (entry) => entry.value === event.target.value,
                  )

                  if (selected) setSystem(selected.value)
                }}
              >
                {AGENT_SYSTEMS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {t(`automation.robot.systems.${entry.value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {robot.driver === 'opentrons' ? (
              <Field
                label={t('automation.robot.address')}
                hint={t('automation.robot.addressHint')}
              >
                <Input
                  value={address}
                  placeholder="http://192.168.1.50:31950"
                  onChange={(event) => setAddress(event.target.value)}
                />
              </Field>
            ) : (
              <Field
                label={t('automation.robot.folder')}
                hint={t('automation.robot.folderHint')}
              >
                <Input
                  value={dir}
                  placeholder={example}
                  onChange={(event) => setDir(event.target.value)}
                />
              </Field>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={download.isPending || missing}
            onClick={() => download.mutate()}
          >
            {t('automation.robot.downloadAgent')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Instruments that are robots, for choosing where to send a worklist. */
export function useRobotInstruments() {
  return useQuery({
    queryKey: [...robotQueryKeys.allSettings, 'with-names'],
    queryFn: async () => {
      const settings = await fetchRobotSettings(client)

      if (settings.length === 0) return []

      const names = await client.list<{
        id: string
        name: string
        display_id: string | null
        retired_at: string | null
      }>(
        'instruments',
        `?select=id,name,display_id,retired_at&id=in.(${settings
          .map((row) => row.instrument_id)
          .join(',')})`,
      )

      const byId = new Map(names.map((row) => [row.id, row]))

      return settings
        .map((row) => ({
          settings: row,
          instrument: byId.get(row.instrument_id),
        }))
        .filter(
          (
            entry,
          ): entry is {
            settings: RobotSettingsWire
            instrument: NonNullable<typeof entry.instrument>
          } => Boolean(entry.instrument && !entry.instrument.retired_at),
        )
    },
    staleTime: 15_000,
  })
}

/** Send a planned worklist to one of the robots. */
export function SendToRobotDialog({
  worklistId,
  reference,
  onClose,
}: {
  worklistId: string
  reference: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const robots = useRobotInstruments()
  const [chosen, setChosen] = useState('')
  const [note, setNote] = useState('')
  const options = robots.data ?? []
  const robotId = chosen || options[0]?.instrument.id || ''

  const send = useMutation({
    mutationFn: () =>
      queueJob(client, { instrumentId: robotId, worklistId, note }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['robots'] })

      const name = options.find((o) => o.instrument.id === robotId)?.instrument
        .name

      toast.success(
        t('automation.robot.send.sent', { reference, robot: name ?? '' }),
      )
      onClose()
    },
    onError: (e) =>
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t('automation.robot.send.couldNotSend'),
      ),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader title={t('automation.robot.send.title', { reference })} />
        <DialogBody>
          {!robots.isPending && options.length === 0 ? (
            <p className="m-0 text-body text-fg-muted">
              {t('automation.robot.send.noRobots')}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <Field label={t('automation.robot.send.robot')}>
                <Select
                  value={robotId}
                  onChange={(event) => setChosen(event.target.value)}
                >
                  {options.map((o) => (
                    <option key={o.instrument.id} value={o.instrument.id}>
                      {o.instrument.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t('automation.robot.send.note')}
                hint={t('automation.robot.send.noteHint')}
              >
                <Input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={send.isPending || robotId === ''}
            onClick={() => send.mutate()}
          >
            {t('automation.robot.send.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Where a worklist is on a robot, when a job for it is open. */
/** The job a worklist is on right now, if a robot has not finished with it. */
export function useWorklistOpenJob(worklistId: string | undefined) {
  const jobs = useQuery({
    queryKey: robotQueryKeys.jobsForWorklist(worklistId ?? ''),
    queryFn: () => fetchInstrumentJobs(client, { worklistId, limit: 5 }),
    enabled: Boolean(worklistId),
    refetchInterval: 5_000,
    staleTime: 2_000,
  })

  return (jobs.data ?? []).find((j) => isOpenJob(j.status)) ?? null
}

export function WorklistJobLine({ worklistId }: { worklistId: string }) {
  const robots = useRobotInstruments()
  const job = useWorklistOpenJob(worklistId)

  if (!job) return null

  const name =
    robots.data?.find((o) => o.instrument.id === job.instrument_id)?.instrument
      .name ?? ''

  return (
    <p className="m-0 flex items-center gap-2 text-label text-fg-muted">
      <span className="mono">{jobReference(job.number)}</span>
      {t('automation.robot.send.onRobot', {
        robot: name,
        status: t(`automation.robot.jobs.statuses.${job.status}`),
      })}
    </p>
  )
}
