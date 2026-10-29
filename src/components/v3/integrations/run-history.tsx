/** INT-01 — execution history for one connector: runs, logs, errors, provenance.
 * UI port: app-3's v3 kit. */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '#/components/v3/ui/collapsible'
import { CodeBlock } from '#/components/v3/ui/code-block'
import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
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

function runTone(status: ConnectorRunWire['status']): {
  tone: Tone
  label: string
} {
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
function runSummary(run: ConnectorRunWire): string {
  const result = run.result
  const parts: string[] = []
  if (typeof result['kind'] === 'string') parts.push(result['kind'])
  if (result['rowCount'] !== undefined)
    parts.push(`${String(result['rowCount'])} rows`)
  const source = result['source'] as Record<string, unknown> | undefined
  if (source && typeof source === 'object') {
    if (source['kind'] === 's3_object') {
      parts.push(`${String(source['bucket'])}/${String(source['key'])}`)
    } else if (source['kind'] === 'postgres_table') {
      parts.push(
        `${String(source['database'])}.${String(source['schema'])}.${String(source['table'])}`,
      )
    }
  }
  if (typeof result['fileSha256'] === 'string') {
    parts.push(`sha256 ${String(result['fileSha256']).slice(0, 12)}…`)
  }
  return parts.join(' · ')
}

export function RunHistory({ connectorId }: { connectorId: string }) {
  const [expandedRun, setExpandedRun] = useState<string | null>(null)

  return (
    <Table aria-label={t('settings.integrations.runHistory.connectorRunsAria')}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('settings.integrations.runHistory.started')}</TableHead>
          <TableHead>{t('settings.integrations.runHistory.trigger')}</TableHead>
          <TableHead>{t('settings.integrations.runHistory.status')}</TableHead>
          <TableHead>{t('settings.integrations.runHistory.attempt')}</TableHead>
          <TableHead>{t('settings.integrations.runHistory.digest')}</TableHead>
          <TableHead>{t('settings.integrations.runHistory.detail')}</TableHead>
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
          {new Date(run.started_at).toLocaleString()}
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
          <p className="m-0 text-label">{runSummary(run)}</p>
          {typeof run.result['datasetId'] === 'string' && (
            <p className="m-0 text-label text-fg-muted">
              {t('settings.integrations.runHistory.dataset')}
              <span className="mono">{String(run.result['datasetId'])}</span>
              {run.result['datasetRevision']
                ? ` · revision ${String(run.result['datasetRevision'])}`
                : ''}
              {typeof run.result['fileRecordId'] === 'string' ? (
                <>
                  {t('settings.integrations.runHistory.rawFile')}
                  <span className="mono">
                    {String(run.result['fileRecordId'])}
                  </span>
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
          [{new Date(log.at).toLocaleTimeString()}] {log.level} {log.stage}:{' '}
          {log.message}
        </p>
      ))}
    </TableCell>
  )
}
