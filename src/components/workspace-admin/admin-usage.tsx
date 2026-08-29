import { useQuery } from '@tanstack/react-query'

import { Badge, Table, TableBody, TableCell, TableRow } from '#/components/ui'
import { fetchUsageFn } from '#/lib/admin-platform'
import { formatBytes } from './admin-storage'

export function AdminUsage({ workspaceId }: { workspaceId: string }) {
  const query = useQuery({
    queryKey: ['admin', workspaceId, 'usage'],
    queryFn: () => fetchUsageFn({ data: { workspaceId } }),
  })
  const data = query.data
  const rows: Array<[string, string]> = data
    ? [
        ['Members', data.members.toLocaleString()],
        ['Records', data.records.toLocaleString()],
        ['Datasets', data.datasets.toLocaleString()],
        ['Dataset versions', data.datasetVersions.toLocaleString()],
        ['Files', data.files.toLocaleString()],
        ['File storage', formatBytes(data.fileBytes)],
        ['Connectors', data.connectors.toLocaleString()],
        ['Pipeline definitions', data.pipelineDefinitions.toLocaleString()],
        ['Pipeline runs', data.pipelineRuns.toLocaleString()],
        ['Connector runs', data.connectorRuns.toLocaleString()],
      ]
    : []
  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-background">
        <Table>
          <TableBody>
            {rows.map(([label, value]) => (
              <TableRow key={label}>
                <TableCell className="font-medium">{label}</TableCell>
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
                <span>{warning.message}</span>
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
