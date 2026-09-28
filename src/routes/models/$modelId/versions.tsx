import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Status } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { toast } from '#/components/v3/ui/sonner'
import { publishDatasetSchemaVersion } from '#/lib/dataset-schema-definition-rpc'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  modelStatus,
  useModelVersions,
} from '#/components/v3/models/models-data'

/** UI port (roadmap-4/ui-app3): the Versions tab. Publishing runs the
 * publish RPC, so the database holds the rules. */
export const Route = createFileRoute('/models/$modelId/versions')({
  component: ModelVersions,
})

function ModelVersions() {
  const { modelId } = Route.useParams()
  const queryClient = useQueryClient()
  const versions = useModelVersions(modelId)
  const rows = versions.data ?? []

  const publish = useMutation({
    mutationFn: (versionId: string) =>
      publishDatasetSchemaVersion(notebookDataClient, versionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
      toast('Version published', {
        description: 'New and existing datasets can now use it.',
      })
    },
    onError: (error: unknown) => {
      toast('Could not publish', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      })
    },
  })

  if (!rows.length) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="table"
          title="No versions yet"
          body="Start a version from the header, add fields, then publish it."
        />
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <TableBox>
        <Table aria-label="Model versions">
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Published</TableHead>
              <TableHead align="right">{''}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-medium">v{v.version}</TableCell>
                <TableCell>
                  <Status tone={modelStatus(v.lifecycle).tone}>
                    {modelStatus(v.lifecycle).label}
                  </Status>
                </TableCell>
                <TableCell className="text-fg-muted">
                  {v.published_at ? v.published_at.slice(0, 10) : '—'}
                </TableCell>
                <TableCell align="right">
                  {v.lifecycle === 'draft' ? (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={publish.isPending}
                      onClick={() => publish.mutate(v.id)}
                    >
                      Publish
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableBox>
      <Muted className="mt-3">
        Datasets pin the version they were created on; publishing a new version
        never changes existing work.
      </Muted>
    </div>
  )
}
