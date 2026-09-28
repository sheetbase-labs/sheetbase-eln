import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted, PageHeader, Section } from '#/components/v3/ui/layout'
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
import { applyNotebookTemplateUpgrade } from '#/lib/notebook-template-data'
import {
  publishedTemplateVersion,
  useTemplate,
  useTemplateNotebook,
  useTemplateUpgradePreview,
  useTemplateUsers,
  useTemplateVersions,
} from '#/components/v3/templates/templates-data'

/** UI port (roadmap-4/ui-app3): take a new template version into one notebook.
 * A new version never changes existing work; the owner chooses. Apply runs the
 * CORE-06 upgrade RPC with the record's structure version so a stale page is
 * refused. Conflicts that need per-sheet decisions are stated, not guessed. */
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
  const [done, setDone] = useState(false)

  const eligible = useMemo(
    () =>
      (users.data ?? []).filter(
        (u) => u.source_notebook_template_version_id !== target?.id,
      ),
    [users.data, target?.id],
  )

  const conflicts = preview.data?.conflicts ?? []
  const unresolved = conflicts.filter(
    (c) => !c.allowedOutcomes.includes('keep'),
  )

  const apply = useMutation({
    mutationFn: () => {
      if (!search.record || !target || !notebook.data) {
        throw new Error('Choose a notebook and a target version first.')
      }
      return applyNotebookTemplateUpgrade({
        recordId: search.record,
        expectedStructureVersion: notebook.data.structure_version,
        targetVersionId: target.id,
        decisions: conflicts
          .filter((c) => c.allowedOutcomes.includes('keep'))
          .map((c) => ({ conflictId: c.id, outcome: 'keep' as const })),
      })
    },
    onSuccess: () => {
      setDone(true)
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'templates'] })
      toast('Notebook updated', {
        description:
          'Recorded in its history. Nothing already written changed.',
      })
    },
    onError: (error: unknown) =>
      toast('Could not update the notebook', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

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
      <div className="flex min-w-0 flex-col gap-5 px-4 py-4 md:px-6">
        {done ? (
          <Notice icon="check">
            <b className="font-semibold">
              Notebook updated to v{target.version}.
            </b>{' '}
            Existing text, rows and signatures were not touched.
          </Notice>
        ) : !preview.data ? (
          <Muted>
            {preview.isLoading
              ? 'Checking what the update would do…'
              : 'No preview available.'}
          </Muted>
        ) : (
          <>
            <Notice>
              Nothing in this notebook has changed yet. Applying adds the new
              placements and keeps everything the owner has written.
            </Notice>
            <Section
              title="What applying would do"
              count={preview.data.automatic.length}
            >
              {preview.data.automatic.length ? (
                <TableBox>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Change</TableHead>
                        <TableHead>Placement</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.data.automatic.map((a, i) => (
                        <TableRow key={`${a.kind}-${a.placementId ?? i}`}>
                          <TableCell>{a.kind.replace(/-/g, ' ')}</TableCell>
                          <TableCell className="mono text-fg-muted">
                            {a.placementId?.slice(0, 8) ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableBox>
              ) : (
                <Muted>No automatic changes.</Muted>
              )}
            </Section>
            {conflicts.length ? (
              <Section title="Needs a decision" count={conflicts.length}>
                <Muted>
                  {unresolved.length
                    ? `${unresolved.length} conflict(s) need a per-sheet decision and can't be applied from here; open the notebook to resolve them.`
                    : 'These conflicts will keep the current local content.'}
                </Muted>
              </Section>
            ) : null}
            <div className="flex gap-2 max-md:flex-col">
              <Button
                variant="primary"
                disabled={apply.isPending || unresolved.length > 0}
                onClick={() => apply.mutate()}
              >
                Apply v{target.version}
              </Button>
              <Button
                nativeButton={false}
                render={
                  <Link
                    to="/experiments/$expId"
                    params={{ expId: search.record }}
                  />
                }
              >
                Back to notebook
              </Button>
            </div>
          </>
        )}
        <Muted>
          Existing text, rows and signatures are never touched by a template
          update. Signed records cannot be updated; use an amendment.
        </Muted>
      </div>
    </div>
  )
}
