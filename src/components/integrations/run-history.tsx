/** INT-01 — execution history for one connector: runs, logs, errors, provenance. */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import {
  connectorQueryKeys,
  describeConnectorsError,
  listConnectorRuns,
  listRunLogs,
} from '#/lib/connectors/client'
import type { ConnectorRunWire } from '#/lib/connectors/types'

const dataClient = createDataClient()

function statusBadge(status: ConnectorRunWire['status']) {
  if (status === 'succeeded') return <Badge variant="default">succeeded</Badge>
  if (status === 'failed') return <Badge variant="danger">failed</Badge>
  return <Badge variant="secondary">running</Badge>
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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Started</TableHead>
          <TableHead>Trigger</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Attempt</TableHead>
          <TableHead>Digest</TableHead>
          <TableHead>Detail</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <ConnectedRunRows
          connectorId={connectorId}
          expandedRun={expandedRun}
          onToggle={(runId) =>
            setExpandedRun((current) => (current === runId ? null : runId))
          }
        />
      </TableBody>
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
      <TableRow>
        <TableCell colSpan={6} className="text-muted-foreground text-sm">
          No runs yet.
        </TableCell>
      </TableRow>
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
  return (
    <>
      <TableRow>
        <TableCell className="text-sm">
          {new Date(run.started_at).toLocaleString()}
        </TableCell>
        <TableCell className="text-sm">{run.trigger_kind}</TableCell>
        <TableCell>{statusBadge(run.status)}</TableCell>
        <TableCell className="text-sm">#{run.attempt}</TableCell>
        <TableCell className="font-mono text-xs">
          {run.request_digest ? `${run.request_digest.slice(0, 10)}…` : '—'}
        </TableCell>
        <TableCell>
          <Button size="sm" variant="ghost" onClick={onToggle}>
            {expanded ? 'Hide' : 'Show'}
          </Button>
        </TableCell>
      </TableRow>
      {expanded && <ExpandedRunRow runId={run.id} run={run} />}
    </>
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
    <TableRow>
      <TableCell colSpan={6} className="bg-muted/40">
        {run.status === 'failed' && (
          <p role="alert" className="text-destructive mb-2 text-sm">
            {run.error_code}: {run.error_message ?? 'No error message.'}
          </p>
        )}
        {run.status === 'succeeded' && Object.keys(run.result).length > 0 && (
          <div className="mb-2">
            <p className="text-xs">{runSummary(run)}</p>
            {typeof run.result['datasetId'] === 'string' && (
              <p className="text-muted-foreground text-xs">
                Dataset{' '}
                <span className="font-mono">
                  {String(run.result['datasetId'])}
                </span>
                {run.result['datasetRevision']
                  ? ` · revision ${String(run.result['datasetRevision'])}`
                  : ''}
                {typeof run.result['fileRecordId'] === 'string' ? (
                  <>
                    {' '}
                    · raw file{' '}
                    <span className="font-mono">
                      {String(run.result['fileRecordId'])}
                    </span>
                  </>
                ) : null}
              </p>
            )}
            <details className="mt-1">
              <summary className="text-muted-foreground cursor-pointer text-xs">
                Technical result payload
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2 text-xs">
                {JSON.stringify(run.result, null, 2)}
              </pre>
            </details>
          </div>
        )}
        {logsQuery.error instanceof Error && (
          <p role="alert" className="text-destructive text-sm">
            {describeConnectorsError(logsQuery.error)}
          </p>
        )}
        {(logsQuery.data ?? []).map((log) => (
          <p key={log.id} className="text-muted-foreground font-mono text-xs">
            [{new Date(log.at).toLocaleTimeString()}] {log.level} {log.stage}:{' '}
            {log.message}
          </p>
        ))}
      </TableCell>
    </TableRow>
  )
}
