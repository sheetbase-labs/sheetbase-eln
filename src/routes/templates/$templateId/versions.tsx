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
import {
  publishNotebookTemplateVersion,
  retireNotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import {
  templateLifecycle,
  useTemplateVersions,
} from '#/components/v3/templates/templates-data'

/** UI port (roadmap-4/ui-app3): the Versions tab. Publish and Retire run the
 * CORE-06 RPCs, so the revision checks and rules stay server-side. */
export const Route = createFileRoute('/templates/$templateId/versions')({
  component: TemplateVersions,
})

function TemplateVersions() {
  const { templateId } = Route.useParams()
  const queryClient = useQueryClient()
  const versions = useTemplateVersions(templateId)
  const rows = [...(versions.data ?? [])].sort((a, b) => b.version - a.version)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['ui-port', 'templates'] })

  const publish = useMutation({
    mutationFn: (input: { versionId: string; revision: number }) =>
      publishNotebookTemplateVersion(input.versionId, input.revision),
    onSuccess: () => {
      void invalidate()
      toast('Version published', {
        description:
          'New notebooks can start from it; existing ones are not changed.',
      })
    },
    onError: (error: unknown) =>
      toast('Could not publish', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  const retire = useMutation({
    mutationFn: (input: { versionId: string; revision: number }) =>
      retireNotebookTemplateVersion(input.versionId, input.revision),
    onSuccess: () => {
      void invalidate()
      toast('Version retired', {
        description: 'It stays readable for notebooks that used it.',
      })
    },
    onError: (error: unknown) =>
      toast('Could not retire', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  if (!rows.length) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="template"
          title="No versions yet"
          body="A template needs a version before a notebook can be made from it."
        />
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <TableBox>
        <Table aria-label="Template versions">
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Published</TableHead>
              <TableHead align="right">Sections</TableHead>
              <TableHead align="right">{''}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-medium">v{v.version}</TableCell>
                <TableCell>
                  <Status tone={templateLifecycle(v.lifecycle).tone}>
                    {templateLifecycle(v.lifecycle).label}
                  </Status>
                </TableCell>
                <TableCell className="text-fg-muted">
                  {v.publishedAt ? v.publishedAt.slice(0, 10) : '—'}
                </TableCell>
                <TableCell align="right">
                  {v.configuration.placements.length}
                </TableCell>
                <TableCell align="right">
                  <div className="flex justify-end gap-1.5">
                    {v.lifecycle === 'draft' ? (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={publish.isPending}
                        onClick={() =>
                          publish.mutate({
                            versionId: v.id,
                            revision: v.revision,
                          })
                        }
                      >
                        Publish
                      </Button>
                    ) : null}
                    {v.lifecycle === 'published' ? (
                      <Button
                        size="sm"
                        variant="quiet"
                        disabled={retire.isPending}
                        onClick={() =>
                          retire.mutate({
                            versionId: v.id,
                            revision: v.revision,
                          })
                        }
                      >
                        Retire
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableBox>
      <Muted className="mt-3">
        Publishing keeps earlier versions readable for the notebooks that used
        them; retiring stops new notebooks from starting on that version.
      </Muted>
    </div>
  )
}
