import { createFileRoute, Link } from '@tanstack/react-router'

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
import { Status } from '#/components/v3/ui/status'
import {
  useTemplateUsers,
  useTemplateVersions,
} from '#/components/v3/templates/templates-data'

/** UI port (roadmap-4/ui-app3): the notebooks made from this template, pinned
 * to the exact version each started from. */
export const Route = createFileRoute('/templates/$templateId/in-use')({
  component: TemplateInUse,
})

function TemplateInUse() {
  const { templateId } = Route.useParams()
  const versions = useTemplateVersions(templateId)
  const list = versions.data ?? []
  const users = useTemplateUsers(list.map((v) => v.id))
  const rows = users.data ?? []
  const versionLabel = (versionId: string | null) => {
    const v = list.find((x) => x.id === versionId)
    return v ? `v${v.version}` : '—'
  }

  if (!rows.length) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="template"
          title="Not used yet"
          body="Notebooks made from this template appear here, pinned to the version they started from."
        />
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <TableBox>
        <Table aria-label="Notebooks using this template">
          <TableHeader>
            <TableRow>
              <TableHead>Notebook</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Started on</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="mono">
                  <Link to="/experiments/$expId" params={{ expId: r.id }}>
                    {r.identifier}
                  </Link>
                </TableCell>
                <TableCell>{r.title}</TableCell>
                <TableCell>
                  <Status tone="stored">
                    {versionLabel(r.source_notebook_template_version_id)}
                  </Status>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableBox>
      <Muted className="mt-3">
        {rows.length} {rows.length === 1 ? 'notebook' : 'notebooks'}. Each keeps
        the version it started from until its owner takes a newer one.
      </Muted>
    </div>
  )
}
