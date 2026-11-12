import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import {
  BoardButton,
  BoardInput,
  BoardSelect,
} from '#/features/pipelines/board/board'
import { SqlEditor } from '#/components/pipelines/sql-editor'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchLakeTableOptions,
  fetchLakehouseSettings,
  fetchRemoteConnections,
  remoteKeys,
} from '#/lib/pipelines/remote/client'
import {
  DEFAULT_REMOTE_SECRET,
  MAX_LAKE_TABLES,
  MAX_REMOTE_LIMIT_MINUTES,
  MAX_REMOTE_SCRIPT_LENGTH,
  MIN_REMOTE_LIMIT_MINUTES,
  formatLimit,
} from '#/lib/pipelines/remote/settings'
import type {
  PipelineLakehouseStep,
  PipelineRemoteJobStep,
} from '#/lib/pipelines/config'

/** A row of the step form: the board's label and its field, with a note under it. */
function Row({
  label,
  htmlFor,
  hint,
  top,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  /** A tall field: its label sits at the top, not the middle. */
  top?: boolean
  children: React.ReactNode
}) {
  return (
    <>
      <div className="frow" style={top ? { alignItems: 'start' } : undefined}>
        <label htmlFor={htmlFor}>{label}</label>
        {children}
      </div>
      {hint ? <div className="muted pl-[98px] text-xs">{hint}</div> : null}
    </>
  )
}

/** A job on an HPC queue: where it runs, how long it may take and the script. */
export function RemoteJobStepBody({
  step,
  index,
  workspaceId,
  onChange,
}: {
  step: PipelineRemoteJobStep
  index: number
  workspaceId: string
  onChange: (step: PipelineRemoteJobStep) => void
}) {
  const job = step.remoteJob

  const connections = useQuery({
    queryKey: [...remoteKeys.connections, workspaceId],
    queryFn: () => fetchRemoteConnections(notebookDataClient),
    staleTime: 60_000,
  })

  const patch = (next: Partial<typeof job>) =>
    onChange({ ...step, remoteJob: { ...job, ...next } })

  // A step that names no secret uses the default, so choosing it leaves the field out.
  const chooseSecret = (secret: string) => {
    const { secret: _secret, ...rest } = job

    onChange({
      ...step,
      remoteJob: secret ? { ...rest, secret } : rest,
    })
  }

  const options = connections.data ?? []
  const connection = options.find((c) => c.key === job.connection)
  const queue = connection?.queues.find((q) => q.name === job.queue)

  return (
    <>
      <Row
        label={t('features.pipelineRemote.remoteForm.connection')}
        htmlFor={`remote-connection-${index}`}
      >
        {connections.isSuccess && options.length === 0 ? (
          <div className="text-body">
            {t('features.pipelineRemote.remoteForm.noConnections')}{' '}
            <Link
              className="text-link underline"
              to="/settings/workspace/integrations"
            >
              {t('features.pipelineRemote.remoteForm.noConnectionsLink')}
            </Link>
          </div>
        ) : (
          <BoardSelect
            id={`remote-connection-${index}`}
            className="w-[260px]"
            value={job.connection}
            onChange={(e) => {
              const { secret: _secret, ...rest } = job

              onChange({
                ...step,
                remoteJob: { ...rest, connection: e.target.value, queue: '' },
              })
            }}
          >
            <option value="">
              {t('features.pipelineRemote.remoteForm.connectionPlaceholder')}
            </option>
            {options.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
            {job.connection && !connection ? (
              <option value={job.connection}>{job.connection}</option>
            ) : null}
          </BoardSelect>
        )}
      </Row>
      <Row
        label={t('features.pipelineRemote.remoteForm.queue')}
        htmlFor={`remote-queue-${index}`}
        hint={
          queue?.maxMinutes
            ? t('features.pipelineRemote.remoteForm.queueMax', {
                limit: formatLimit(queue.maxMinutes),
              })
            : undefined
        }
      >
        <BoardSelect
          id={`remote-queue-${index}`}
          className="w-[260px]"
          value={job.queue}
          disabled={!connection}
          onChange={(e) => patch({ queue: e.target.value })}
        >
          <option value="">
            {t('features.pipelineRemote.remoteForm.queuePlaceholder')}
          </option>
          {(connection?.queues ?? []).map((q) => (
            <option key={q.name} value={q.name}>
              {q.name}
            </option>
          ))}
          {job.queue && !queue ? (
            <option value={job.queue}>{job.queue}</option>
          ) : null}
        </BoardSelect>
      </Row>
      <Row
        label={t('features.pipelineRemote.remoteForm.secret')}
        htmlFor={`remote-secret-${index}`}
        hint={t('features.pipelineRemote.remoteForm.secretHint')}
      >
        <BoardSelect
          id={`remote-secret-${index}`}
          className="w-[260px]"
          value={job.secret ?? ''}
          disabled={!connection}
          onChange={(e) => chooseSecret(e.target.value)}
        >
          <option value="">
            {t('features.pipelineRemote.remoteForm.secretDefault', {
              name: DEFAULT_REMOTE_SECRET,
            })}
          </option>
          {(connection?.secrets ?? [])
            .filter((name) => name !== DEFAULT_REMOTE_SECRET)
            .map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          {job.secret && !connection?.secrets.includes(job.secret) ? (
            <option value={job.secret}>{job.secret}</option>
          ) : null}
        </BoardSelect>
      </Row>
      <Row
        label={t('features.pipelineRemote.remoteForm.limit')}
        htmlFor={`remote-limit-${index}`}
        hint={t('features.pipelineRemote.remoteForm.limitHint')}
      >
        <div className="flex items-center gap-2">
          <BoardInput
            id={`remote-limit-${index}`}
            type="number"
            mono
            className="w-[110px]"
            min={MIN_REMOTE_LIMIT_MINUTES}
            max={MAX_REMOTE_LIMIT_MINUTES}
            value={job.limitMinutes}
            onChange={(e) => patch({ limitMinutes: Number(e.target.value) })}
          />
          <span className="muted">
            {t('features.pipelineRemote.remoteForm.limitUnit')}
          </span>
          {job.limitMinutes >= 60 ? (
            <span className="muted">· {formatLimit(job.limitMinutes)}</span>
          ) : null}
        </div>
      </Row>
      <Row
        label={t('features.pipelineRemote.remoteForm.script')}
        top
        hint={t('features.pipelineRemote.remoteForm.scriptHint')}
      >
        <SqlEditor
          aria-label={t('features.pipelineRemote.remoteForm.scriptAria', {
            n: index + 1,
          })}
          value={job.script}
          rows={8}
          maxLength={MAX_REMOTE_SCRIPT_LENGTH}
          onChange={(e) => patch({ script: e.target.value })}
        />
      </Row>
      <div className="pb-gen">
        <span className="font-medium">
          {t('features.pipelineRemote.remoteForm.writes')}
        </span>
        <span className="muted">
          {t('features.pipelineRemote.remoteForm.waitNote')}
        </span>
      </div>
    </>
  )
}

/** SQL over open tables: which tables it reads, and the SQL. */
export function LakehouseStepBody({
  step,
  index,
  workspaceId,
  onChange,
}: {
  step: PipelineLakehouseStep
  index: number
  workspaceId: string
  onChange: (step: PipelineLakehouseStep) => void
}) {
  const settings = useQuery({
    queryKey: [...remoteKeys.lakehouse, workspaceId],
    queryFn: () => fetchLakehouseSettings(notebookDataClient, workspaceId),
    staleTime: 30_000,
  })

  const tables = useQuery({
    queryKey: [...remoteKeys.tables, workspaceId],
    queryFn: () => fetchLakeTableOptions(notebookDataClient),
    staleTime: 60_000,
  })

  const chosen = step.lake.tables
  const chosenNames = new Set(chosen)

  const rest = (tables.data ?? []).filter(
    (table) => !chosenNames.has(table.name),
  )

  const setTables = (next: string[]) =>
    onChange({ ...step, lake: { tables: next } })

  return (
    <>
      {settings.data && !settings.data.enabled ? (
        <p className="m-0 text-label text-warning-text" role="status">
          {t('features.pipelineRemote.lakeForm.off')}{' '}
          <Link
            className="text-link underline"
            to="/settings/workspace/open-data"
          >
            {t('features.pipelineRemote.lakeForm.offLink')}
          </Link>
        </p>
      ) : null}
      <Row
        label={t('features.pipelineRemote.lakeForm.tables')}
        hint={t('features.pipelineRemote.lakeForm.tablesHint')}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {chosen.map((name) => (
            <span
              key={name}
              className="kind mono inline-flex items-center gap-1"
            >
              {name}
              <BoardButton
                variant="quiet"
                size="sm"
                iconOnly
                icon="x"
                aria-label={t('features.pipelineRemote.lakeForm.tableRemove', {
                  name,
                })}
                onClick={() => setTables(chosen.filter((n) => n !== name))}
              />
            </span>
          ))}
          {chosen.length < MAX_LAKE_TABLES ? (
            <BoardSelect
              className="w-[220px]"
              aria-label={t('features.pipelineRemote.lakeForm.addTable')}
              value=""
              onChange={(e) => {
                if (e.target.value) setTables([...chosen, e.target.value])
              }}
            >
              <option value="">
                {tables.isSuccess && rest.length === 0 && chosen.length === 0
                  ? t('features.pipelineRemote.lakeForm.noTables')
                  : t('features.pipelineRemote.lakeForm.addTablePlaceholder')}
              </option>
              {rest.map((table) => (
                <option key={table.name} value={table.name}>
                  {table.name}
                </option>
              ))}
            </BoardSelect>
          ) : null}
        </div>
      </Row>
      <Row
        label={t('features.pipelineRemote.lakeForm.statement')}
        top
        hint={t('features.pipelineRemote.lakeForm.rowCap')}
      >
        <SqlEditor
          aria-label={t('features.pipelineRemote.lakeForm.statementAria', {
            n: index + 1,
          })}
          value={step.statement}
          rows={8}
          onChange={(e) => onChange({ ...step, statement: e.target.value })}
        />
      </Row>
    </>
  )
}
