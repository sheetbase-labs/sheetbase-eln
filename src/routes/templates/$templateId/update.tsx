import { useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { PageHeader } from '#/components/v3/ui/layout'
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
import { NotebookTemplateUpdateView } from '#/components/v3/templates/template-update-view'
import { applyNotebookTemplateUpgrade } from '#/lib/notebook-template-data'
import type { NotebookUpgradeDecision } from '#/lib/notebook-template-upgrade'
import {
  publishedTemplateVersion,
  useTemplate,
  useTemplateNotebook,
  useTemplateUpgradePreview,
  useTemplateUsers,
  useTemplateVersions,
  templateDataQueryKeys,
} from '#/components/v3/templates/templates-data'

/** UI port (roadmap-4/ui-app3): take a new template version into one notebook.
 * A new version never changes existing work; the owner chooses. Apply runs the
 * CORE-06 upgrade RPC with the record's structure version so a stale page is
 * refused, and is recorded in the notebook's history as a template update.
 * Conflicts that need per-sheet decisions are stated with their allowed
 * outcomes, not guessed. */
export const Route = createFileRoute('/templates/$templateId/update')({
  validateSearch: (search: Record<string, unknown>): { record?: string } => ({
    record: typeof search.record === 'string' ? search.record : undefined,
  }),
  component: TemplateUpdate,
})

function TemplateUpdate() {
  const { templateId } = Route.useParams()
  const search = Route.useSearch()
  const queryClient = useQueryClient()
  const template = useTemplate(templateId)
  const versions = useTemplateVersions(templateId)
  const list = versions.data ?? []
  const target = publishedTemplateVersion(list)
  const users = useTemplateUsers(list.map((v) => v.id))
  const notebook = useTemplateNotebook(search.record)
  const preview = useTemplateUpgradePreview(search.record, target?.id)

  const eligible = useMemo(
    () =>
      (users.data ?? []).filter(
        (u) => u.source_notebook_template_version_id !== target?.id,
      ),
    [users.data, target?.id],
  )

  const sourceVersion = useMemo(() => {
    const pinned = notebook.data?.source_notebook_template_version_id
    if (!pinned) return null
    return list.find((v) => v.id === pinned)?.version ?? null
  }, [notebook.data?.source_notebook_template_version_id, list])

  async function apply(decisions: NotebookUpgradeDecision[]) {
    if (!search.record || !target || !notebook.data)
      throw new Error('Choose a notebook and a target version first.')
    await applyNotebookTemplateUpgrade({
      recordId: search.record,
      expectedStructureVersion: notebook.data.structure_version,
      targetVersionId: target.id,
      decisions,
    })
    await queryClient.invalidateQueries({
      queryKey: templateDataQueryKeys.list,
    })
    await queryClient.invalidateQueries({
      queryKey: ['ui-port', 'templates'],
    })
    toast('Notebook updated', {
      description: 'Recorded in its history as a template update.',
    })
  }

  const t = template.data
  const crumbs = (
    <>
      <Link to="/templates" className="text-link">
        Templates
      </Link>{' '}
      /{' '}
      <Link
        to="/templates/$templateId"
        params={{ templateId }}
        className="text-link mono"
      >
        {t?.key ?? templateId}
      </Link>
    </>
  )

  if (!target) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader crumbs={crumbs} title="No published version" />
        <div className="px-4 py-4 md:px-6">
          <EmptyState
            icon="template"
            title="Nothing to take yet"
            body="A notebook can only take a published version. Publish one first."
          />
        </div>
      </div>
    )
  }

  if (!search.record) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <PageHeader
          crumbs={crumbs}
          title={`Notebooks that can take v${target.version}`}
          meta={
            <>
              <span>{t?.name}</span>
              <Status tone="ok">v{target.version} published</Status>
            </>
          }
        />
        <div className="px-4 py-4 md:px-6">
          {eligible.length ? (
            <TableBox className="max-w-[760px]">
              <Table aria-label="Notebooks that can take the version">
                <TableHeader>
                  <TableRow>
                    <TableHead>Notebook</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead align="right">{''}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eligible.map((n) => (
                    <TableRow key={n.id}>
                      <TableCell className="mono">
                        <Link to="/experiments/$expId" params={{ expId: n.id }}>
                          {n.identifier}
                        </Link>
                      </TableCell>
                      <TableCell>{n.title}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="sm"
                          nativeButton={false}
                          render={
                            <Link
                              to="/templates/$templateId/update"
                              params={{ templateId }}
                              search={{ record: n.id }}
                            />
                          }
                        >
                          Review v{target.version}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <EmptyState
              icon="template"
              title="No notebook needs this version"
              body="Every notebook made from this template is already on it, or none exist yet."
            />
          )}
        </div>
      </div>
    )
  }

  const nb = notebook.data
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        crumbs={crumbs}
        title={
          nb
            ? `Update ${nb.identifier} to template v${target.version}`
            : 'Update notebook'
        }
        meta={
          <>
            <span>{t?.name}</span>
            <span>Target v{target.version}</span>
            {nb ? (
              <Link to="/experiments/$expId" params={{ expId: nb.id }}>
                {nb.title}
              </Link>
            ) : null}
          </>
        }
      />
      <NotebookTemplateUpdateView
        targetVersion={target.version}
        sourceVersion={sourceVersion}
        templateName={t?.name}
        notebookLabel={nb?.identifier}
        preview={preview.data}
        isLoading={preview.isLoading}
        onApply={apply}
        backLink={
          <Button
            nativeButton={false}
            render={<Link to="/experiments/$expId" params={{ expId: search.record }} />}
          >
            Back to notebook
          </Button>
        }
      />
    </div>
  )
}
