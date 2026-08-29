import { useQuery } from '@tanstack/react-query'

import { Badge, Table, TableBody, TableCell, TableRow } from '#/components/ui'
import { fetchDiagnosticsFn } from '#/lib/admin-platform'

const runbooks = [
  ['Deployment', 'docs/deployment.md'],
  ['Recovery', 'docs/recovery.md'],
  ['Security', 'docs/security.md'],
  ['Performance', 'docs/performance.md'],
  ['Observability', 'docs/observability.md'],
] as const

export function AdminDeployment({ workspaceId }: { workspaceId: string }) {
  const diagnostics = useQuery({
    queryKey: ['admin-diagnostics', workspaceId],
    queryFn: () => fetchDiagnosticsFn({ data: { workspaceId } }),
  })

  if (diagnostics.isPending)
    return (
      <p className="text-sm text-muted-foreground">
        Loading deployment information…
      </p>
    )
  if (diagnostics.isError)
    return (
      <p className="text-sm text-destructive">
        Deployment information could not be loaded.
      </p>
    )

  const { deployment, migration } = diagnostics.data
  const migrationState =
    migration.status === 'compatible'
      ? { label: 'Compatible', variant: 'success' as const }
      : migration.status === 'incompatible'
        ? { label: 'Behind', variant: 'warning' as const }
        : { label: 'Not checked', variant: 'outline' as const }
  const rows: Array<[string, React.ReactNode]> = [
    ['Sheetbase version', deployment.artifactVersion],
    [
      'Commit SHA',
      <span className="font-mono text-xs">{deployment.artifactDigest}</span>,
    ],
    ['Environment', deployment.environment],
    ['Secret source', deployment.secretSource],
    [
      'Migration state',
      <Badge variant={migrationState.variant}>{migrationState.label}</Badge>,
    ],
    ['Expected migration', deployment.expectedMigration],
    ['Applied migration', migration.applied ?? 'not checked'],
  ]

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="font-semibold">Deployment</h2>
        <Table>
          <TableBody>
            {rows.map(([label, value]) => (
              <TableRow key={label}>
                <TableCell className="w-64 text-muted-foreground">
                  {label}
                </TableCell>
                <TableCell className="font-medium">{value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Operational runbooks</h2>
        <Table>
          <TableBody>
            {runbooks.map(([label, path]) => (
              <TableRow key={label}>
                <TableCell className="w-64 text-muted-foreground">
                  {label}
                </TableCell>
                <TableCell className="font-mono text-xs">{path}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  )
}
