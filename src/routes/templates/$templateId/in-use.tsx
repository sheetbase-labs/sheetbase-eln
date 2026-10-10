import { useMemo } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'

import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Muted } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { useUserNames } from '#/lib/user-names'
import {
  publishedTemplateVersion,
  useTemplateUsers,
  useTemplateVersions,
} from '#/components/v3/templates/templates-data'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'

/**
 * UI port (roadmap-4/ui-app3): the records made from this template, grouped by
 * the exact version each started from. Records stay on their version until
 * their owner takes a newer one; signed records never change. `?state=denied`
 * drives the acceptance suite.
 */
export const Route = createFileRoute('/templates/$templateId/in-use')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { version?: string; project?: string; state?: 'denied' } => ({
    version: typeof search.version === 'string' ? search.version : undefined,
    project: typeof search.project === 'string' ? search.project : undefined,
    state: search.state === 'denied' ? 'denied' : undefined,
  }),
  component: TemplateInUse,
})

function recordStatus(
  status: string,
  locked: boolean,
): { tone: Tone; label: string } {
  if (locked) return { tone: 'ok', label: 'Signed' }
  const key = status.toLowerCase()
  if (key.includes('review')) return { tone: 'review', label: 'In review' }
  if (key.includes('draft')) return { tone: 'draft', label: 'Draft' }
  if (key.includes('progress'))
    return { tone: 'progress', label: 'In progress' }
  return { tone: 'none', label: status || 'In progress' }
}

function updateCell(
  record: { id: string; locked_at: string | null; status: string },
  version: NotebookTemplateVersion | undefined,
  current: NotebookTemplateVersion | undefined,
) {
  if (!current || !version || version.id === current.id) return null
  if (record.locked_at) {
    return (
      <span className="text-label text-fg-muted">
        Stays on v{version.version}
      </span>
    )
  }
  if (record.status.toLowerCase().includes('review')) {
    return <span className="text-label text-fg-muted">Update after review</span>
  }
  return (
    <Link
      to="/templates/$templateId/update"
      params={{ templateId: version.templateId }}
      search={{ record: record.id }}
      className="text-label"
    >
      Update available
    </Link>
  )
}

function TemplateInUse() {
  const { templateId } = Route.useParams()
  const { version: versionFilter, state } = Route.useSearch()
  const navigate = useNavigate()
  const versions = useTemplateVersions(templateId)
  const list = [...(versions.data ?? [])].sort((a, b) => b.version - a.version)
  const current = publishedTemplateVersion(list)
  const users = useTemplateUsers(list.map((v) => v.id))
  const names = useUserNames(
    (users.data ?? []).map((r) => r.created_by_user_id ?? '').filter(Boolean),
  )
  const rows = users.data ?? []

  const groups = useMemo(() => {
    const byVersion = new Map<string, typeof rows>()
    for (const r of rows) {
      const key = r.source_notebook_template_version_id ?? ''
      if (versionFilter && key !== versionFilter) continue
      const bucket = byVersion.get(key) ?? []
      bucket.push(r)
      byVersion.set(key, bucket)
    }
    return list
      .map((v) => ({ version: v, records: byVersion.get(v.id) ?? [] }))
      .filter((g) => g.records.length)
  }, [rows, list, versionFilter])

  const shown = groups.reduce((n, g) => n + g.records.length, 0)

  if (!rows.length) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="template"
          title="No records use this template yet"
          body="Records made from this template appear here, grouped by the version they were made from."
        />
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      {state === 'denied' ? (
        <Notice tone="info" className="mb-3" icon="lock">
          Some records are hidden because you’re not a member of their project.
          Counts include them.
        </Notice>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-label text-fg-muted">
          Version
          <select
            aria-label="Filter by version"
            className="h-[26px] rounded-md border border-border bg-surface px-1.5 text-label text-fg"
            value={versionFilter ?? ''}
            onChange={(e) =>
              void navigate({
                to: '/templates/$templateId/in-use',
                params: { templateId },
                search: (s: Record<string, unknown>) => ({
                  ...s,
                  version: e.target.value || undefined,
                }),
                replace: true,
              })
            }
          >
            <option value="">All versions</option>
            {list.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version}
              </option>
            ))}
          </select>
        </label>
        <span className="num text-label text-fg-muted">
          {shown} of {rows.length}
        </span>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon="search"
          title="No records match these filters"
          body="Try another version."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(({ version, records }) => (
            <section key={version.id} aria-label={`Version ${version.version}`}>
              <h2 className="mb-1 flex items-center gap-2 text-section">
                v{version.version}
                <Status tone={version.id === current?.id ? 'ok' : 'none'}>
                  {version.id === current?.id ? 'Current' : 'Published'}
                </Status>
                <span className="num text-label font-normal text-fg-muted">
                  {records.length} records
                </span>
              </h2>
              <div className="overflow-hidden rounded-md border border-border">
                <Table aria-label={`Records on version ${version.version}`}>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="first:pl-3">Record</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Pinned since</TableHead>
                      <TableHead className="pr-3" align="right">
                        Update
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((r) => {
                      const status = recordStatus(
                        r.status,
                        Boolean(r.locked_at),
                      )
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="first:pl-3">
                            <Link
                              to="/experiments/$expId"
                              params={{ expId: r.id }}
                              className="mono"
                            >
                              {r.identifier}
                            </Link>
                            <span className="block text-label text-fg-muted">
                              {r.title}
                            </span>
                          </TableCell>
                          <TableCell className="text-fg-muted">
                            {r.created_by_user_id
                              ? names.userLabel(r.created_by_user_id)
                              : '—'}
                          </TableCell>
                          <TableCell>
                            <Status tone={status.tone}>{status.label}</Status>
                          </TableCell>
                          <TableCell className="text-fg-muted">
                            {r.created_at.slice(0, 10)}
                          </TableCell>
                          <TableCell align="right" className="pr-3">
                            {updateCell(r, version, current)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </section>
          ))}
        </div>
      )}
      <Muted className="mt-3">
        Signed records never change; in-progress records can move to the current
        version by their owner, which only adds sections and fields.
      </Muted>
    </div>
  )
}
