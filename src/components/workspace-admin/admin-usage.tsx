import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { Badge, Table, TableBody, TableCell, TableRow } from '#/components/ui'
import { fetchUsageFn } from '#/lib/admin-platform'
import { formatBytes } from './admin-storage'

export function AdminUsage({ workspaceId }: { workspaceId: string }) {
  const query = useQuery({
    queryKey: ['admin', workspaceId, 'usage'],
    queryFn: () => fetchUsageFn({ data: { workspaceId } }),
  })
  const data = query.data
  // Limit context comes from the server (null = no quota configured).
  // Never invent a theatre number here — the note states what is true.
  const quota = data?.limits.fileBytes
  const quotaNote =
    quota == null || quota.byteLimit == null
      ? 'No quota configured — observed usage, nothing blocked.'
      : `Quota ${formatBytes(quota.byteLimit)} — ${quota.atLimitBehaviour ?? 'limit enforced'}.`
  const rows: Array<[string, string, string | null]> = data
    ? [
        ['Members', data.members.toLocaleString(), null],
        ['Records', data.records.toLocaleString(), null],
        ['Datasets', data.datasets.toLocaleString(), null],
        ['Dataset versions', data.datasetVersions.toLocaleString(), null],
        ['Files', data.files.toLocaleString(), null],
        ['File storage', formatBytes(data.fileBytes), quotaNote],
        ['Connectors', data.connectors.toLocaleString(), null],
        [
          'Pipeline definitions',
          data.pipelineDefinitions.toLocaleString(),
          null,
        ],
        ['Pipeline runs', data.pipelineRuns.toLocaleString(), null],
        ['Connector runs', data.connectorRuns.toLocaleString(), null],
      ]
    : []
  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-background">
        <Table>
          <TableBody>
            {rows.map(([label, value, note]) => (
              <TableRow key={label}>
                <TableCell className="font-medium">
                  {label}
                  {note ? (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {note}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {value}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <section className="space-y-3">
        <h2 className="font-semibold">Capacity indicators</h2>
        {data?.capacityWarnings.length ? (
          <div className="space-y-2">
            {data.capacityWarnings.map((warning, index) => (
              <div
                key={`${warning.category}-${index}`}
                className="flex items-center gap-2 rounded-md border p-3 text-sm"
              >
                <Badge
                  className={
                    warning.level === 'warning'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-blue-100 text-blue-800'
                  }
                >
                  {warning.level}
                </Badge>
                <span className="min-w-0 flex-1">{warning.message}</span>
                {warning.runbook ? (
                  <Link
                    to="/docs/$name"
                    params={{ name: warning.runbook }}
                    className="shrink-0 text-muted-foreground hover:underline"
                  >
                    Runbook
                  </Link>
                ) : null}
                {warning.link ? (
                  <Link
                    to={warning.link}
                    className="shrink-0 font-medium text-primary hover:underline"
                  >
                    View
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No capacity concerns.</p>
        )}
      </section>
    </div>
  )
}
