/** INT-01 — execution history for one connector: runs, logs, errors, provenance.
 * UI port: app-3's v3 kit. */
import { useState } from 'react'
import { formatDate, formatTime } from '#/lib/format-date'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { CodeBlock } from '#/components/ui/code-block'
import { Button } from '#/components/ui/button'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { createDataClient } from '#/lib/data-client'
import {
  connectorQueryKeys,
  describeConnectorsError,
  listConnectorRuns,
  listRunLogs,
} from '#/lib/connectors/client'
import type { ConnectorRunWire } from '#/lib/connectors/types'
import { t } from '#/copy'

const dataClient = createDataClient()

/** How one run's status is painted and named. */
interface RunTone {
  tone: Tone
  label: string
}

/**
 * The parts of a connector run's result this history names. A connector's
 * result is its own JSON, so it is decoded once here rather than probed field by
 * field; anything the schema does not name is left to the technical payload.
 */
const runResult = z.object({
  kind: z.string().optional(),
  rowCount: z.union([z.number(), z.string()]).optional(),
  source: z
    .object({
      kind: z.string().optional(),
      bucket: z.string().optional(),
      key: z.string().optional(),
      database: z.string().optional(),
      schema: z.string().optional(),
      table: z.string().optional(),
    })
    .optional(),
  fileSha256: z.string().optional(),
  datasetId: z.string().optional(),
  datasetRevision: z.union([z.string(), z.number()]).optional(),
  fileRecordId: z.string().optional(),
})

function runTone(status: ConnectorRunWire['status']): RunTone {
  if (status === 'succeeded')
    return {
      tone: 'ok',
      label: t('settings.integrations.runHistory.succeeded'),
    }

  if (status === 'failed')
    return { tone: 'bad', label: t('common.states.failed') }

  return {
    tone: 'progress',
    label: t('settings.integrations.runHistory.running'),
  }
}

/** Semantic one-line summary of a run result (INT-03 / INT-02 kinds). */
function runSummary(result: ConnectorRunWire['result']): string {
  const decoded = runResult.safeParse(result)

  if (!decoded.success) return ''

  const { kind, rowCount, source, fileSha256 } = decoded.data
  const parts: string[] = []

  if (kind !== undefined) parts.push(kind)

  if (rowCount !== undefined) parts.push(`${String(rowCount)} rows`)

  if (source?.kind === 's3_object') {
    if (source.bucket !== undefined && source.key !== undefined) {
      parts.push(`${source.bucket}/${source.key}`)
    }
  } else if (
    source?.kind === 'postgres_table' &&
    source.database !== undefined &&
    source.schema !== undefined &&
    source.table !== undefined
  ) {
    parts.push(`${source.database}.${source.schema}.${source.table}`)
  }

  if (fileSha256 !== undefined) parts.push(`sha256 ${fileSha256.slice(0, 12)}…`)

  return parts.join(' · ')
}

export function RunHistory({ connectorId }: { connectorId: string }) {
  const [expandedRun, setExpandedRun] = useState<string | null>(null)

  const headings = [
    { key: 'started', label: t('settings.integrations.runHistory.started') },
    { key: 'trigger', label: t('settings.integrations.runHistory.trigger') },
    { key: 'status', label: t('settings.integrations.runHistory.status') },
    { key: 'attempt', label: t('settings.integrations.runHistory.attempt') },
    { key: 'digest', label: t('settings.integrations.runHistory.digest') },
    { key: 'detail', label: t('settings.integrations.runHistory.detail') },
  ]

  return (
    <Table aria-label={t('settings.integrations.runHistory.connectorRunsAria')}>
      <TableHeader>
        <TableRow>
          {headings.map((heading) => (
            <TableHead key={heading.key}>{heading.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      {/* The rows own their row groups: an expanded run's detail row is a
          sibling of its trigger row, and only a row group can hold both. */}
      <ConnectedRunRows
        connectorId={connectorId}
        expandedRun={expandedRun}
        onToggle={(runId) =>
          setExpandedRun((current) => (current === runId ? null : runId))
        }
      />
    </Table>
  )
}

function ConnectedRunRows({
  connectorId,
  expandedRun,
  onToggle,
}: {
  connectorId: string
  expandedRun: string | null
  onToggle: (runId: string) => void
}) {
  const query = useQuery({
    queryKey: connectorQueryKeys.runs(connectorId),
    queryFn: () => listConnectorRuns(dataClient, connectorId),
  })

  if (!query.data) return null

  if (query.data.length === 0) {
    return (
      <TableBody>
        <TableRow>
          <TableCell colSpan={6} className="text-body text-fg-muted">
            {t('settings.integrations.runHistory.runsYet')}
          </TableCell>
        </TableRow>
      </TableBody>
    )
  }

  return (
    <>
      {query.data.map((run) => (
        <RunRowWithLogs
          key={run.id}
          run={run}
          expanded={expandedRun === run.id}
          onToggle={() => onToggle(run.id)}
        />
      ))}
    </>
  )
}

function RunRowWithLogs({
  run,
  expanded,
  onToggle,
}: {
  run: ConnectorRunWire
  expanded: boolean
  onToggle: () => void
}) {
  const status = runTone(run.status)

  return (
    // The disclosure wraps the trigger row and its detail row, so the control
    // carries aria-expanded and aria-controls. A row group is the only element
    // that can contain both rows, so each run is its own <tbody> — which the
    // table element allows and renders no differently.
    <Collapsible
      open={expanded}
      onOpenChange={(open) => {
        if (open !== expanded) onToggle()
      }}
      render={<tbody />}
    >
      <TableRow>
        <TableCell className="text-body">
          {formatDate(run.started_at, { time: true })}
        </TableCell>
        <TableCell className="text-body">{run.trigger_kind}</TableCell>
        <TableCell>
          <Status tone={status.tone}>{status.label}</Status>
        </TableCell>
        <TableCell className="text-body">#{run.attempt}</TableCell>
        <TableCell className="mono text-label">
          {run.request_digest ? `${run.request_digest.slice(0, 10)}…` : '—'}
        </TableCell>
        <TableCell>
          <CollapsibleTrigger render={<Button size="sm" variant="quiet" />}>
            {expanded
              ? t('settings.integrations.runHistory.hideAction')
              : t('settings.integrations.runHistory.showAction')}
          </CollapsibleTrigger>
        </TableCell>
      </TableRow>
      <CollapsiblePanel render={<tr />} className="bg-surface-muted">
        <ExpandedRunRow runId={run.id} run={run} />
      </CollapsiblePanel>
    </Collapsible>
  )
}

function ExpandedRunRow({
  runId,
  run,
}: {
  runId: string
  run: ConnectorRunWire
}) {
  const logsQuery = useQuery({
    queryKey: connectorQueryKeys.runLogs(runId),
    queryFn: () => listRunLogs(dataClient, runId),
  })

  const decodedResult = runResult.safeParse(run.result)
  const detail = decodedResult.success ? decodedResult.data : null

  return (
    <TableCell colSpan={6}>
      {run.status === 'failed' && (
        <p role="alert" className="m-0 mb-2 text-body text-danger-text">
          {run.error_code}:{' '}
          {run.error_message ??
            t('settings.integrations.runHistory.errorMessage')}
        </p>
      )}
      {run.status === 'succeeded' && Object.keys(run.result).length > 0 && (
        <div className="mb-2">
          <p className="m-0 text-label">{runSummary(run.result)}</p>
          {detail?.datasetId !== undefined && (
            <p className="m-0 text-label text-fg-muted">
              {t('settings.integrations.runHistory.dataset')}
              <span className="mono">{detail.datasetId}</span>
              {detail.datasetRevision
                ? ` · revision ${String(detail.datasetRevision)}`
                : ''}
              {detail.fileRecordId !== undefined ? (
                <>
                  {t('settings.integrations.runHistory.rawFile')}
                  <span className="mono">{detail.fileRecordId}</span>
                </>
              ) : null}
            </p>
          )}
          <Collapsible className="mt-1">
            <CollapsibleTrigger className="text-label text-fg-muted">
              {t('settings.integrations.runHistory.technicalResultPayload')}
            </CollapsibleTrigger>
            <CollapsiblePanel className="mt-1">
              <CodeBlock
                code={JSON.stringify(run.result, null, 2)}
                label={t(
                  'settings.integrations.runHistory.technicalResultPayload',
                )}
                maxHeight="sm"
              />
            </CollapsiblePanel>
          </Collapsible>
        </div>
      )}
      {logsQuery.error instanceof Error && (
        <p role="alert" className="m-0 text-body text-danger-text">
          {describeConnectorsError(logsQuery.error)}
        </p>
      )}
      {(logsQuery.data ?? []).map((log) => (
        <p key={log.id} className="m-0 mono text-label text-fg-muted">
          [{formatTime(log.at)}] {log.level} {log.stage}: {log.message}
        </p>
      ))}
    </TableCell>
  )
}
