import { useQuery } from '@tanstack/react-query'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { fetchStorageOverviewFn } from '#/lib/admin-platform'
import { formatDate } from '#/lib/workspace-admin'

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

export function AdminStorage({ workspaceId }: { workspaceId: string }) {
  const query = useQuery({
    queryKey: ['admin', workspaceId, 'storage'],
    queryFn: () => fetchStorageOverviewFn({ data: { workspaceId } }),
  })
  const data = query.data
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="font-semibold">Storage overview</h2>
        <dl className="grid gap-3 sm:grid-cols-4">
          {[
            ['File count', data?.fileCount.toLocaleString() ?? '—'],
            ['File bytes', data ? formatBytes(data.fileBytes) : '—'],
            ['Datasets', data?.datasetCount.toLocaleString() ?? '—'],
            [
              'Dataset versions',
              data?.datasetVersionCount.toLocaleString() ?? '—',
            ],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-background p-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Largest files</h2>
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Storage backend</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.largestFiles.map((file) => (
                <TableRow key={file.id}>
                  <TableCell className="font-medium">
                    {file.displayName}
                  </TableCell>
                  <TableCell>{file.mediaType}</TableCell>
                  <TableCell>{formatBytes(Number(file.byteSize))}</TableCell>
                  <TableCell>{file.status}</TableCell>
                  <TableCell>{file.storageBackend}</TableCell>
                  <TableCell>{formatDate(file.createdAt)}</TableCell>
                </TableRow>
              ))}
              {!data?.largestFiles.length ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No files.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}
