import { useMemo } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'

import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Inspector, InspectorSection, Muted } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { useUserNames } from '#/lib/user-names'
import {
  buildInUseMatrix,
  countTemplateUse,
  filterInUseRecords,
  inUseStaleness,
  templateUseStatus,
} from '#/lib/notebook-template-usage'
import type { TemplateUsageRecord } from '#/lib/notebook-template-usage'
import {
  publishedTemplateVersion,
  useTemplateMadeCount,
  useTemplateProjects,
  useTemplateUsers,
  useTemplateVersions,
} from '#/components/v3/templates/templates-data'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'

/**
 * UI port (roadmap-4/ui-app3): the records made from this template, grouped by
 * the exact version each started from. Records stay on their version until
 * their owner takes a newer one; signed records never change. R5-CONFIG-04 adds
 * the records-by-version matrix, wires the project filter, states how far the
 * in-use set is behind the current version, and states how many records the
 * viewer cannot see — from the workspace-wide instantiation count, not from
 * `?state=denied` alone. `?state=denied` renders the restricted view the
 * acceptance suite drives without a restricted account.
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

function recordStatus(record: TemplateUsageRecord): {
  tone: Tone
  label: string
} {
  switch (templateUseStatus(record)) {
    case 'signed':
      return { tone: 'ok', label: 'Signed' }
    case 'in-review':
      return { tone: 'review', label: 'In review' }
    default: {
      const key = record.status.toLowerCase()
      if (key.includes('draft')) return { tone: 'draft', label: 'Draft' }
      return { tone: 'progress', label: record.status || 'In progress' }
    }
  }
}

function updateCell(
  record: TemplateUsageRecord,
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
  const {
    version: versionFilter,
    project: projectFilter,
    state,
  } = Route.useSearch()
  const navigate = useNavigate()
  const versions = useTemplateVersions(templateId)
  const list = [...(versions.data ?? [])].sort((a, b) => b.version - a.version)
  const current = publishedTemplateVersion(list)
  const users = useTemplateUsers(list.map((v) => v.id))
  const names = useUserNames(
    (users.data ?? []).map((r) => r.created_by_user_id ?? '').filter(Boolean),
  )
  const rows = users.data ?? []

  // Only the records in projects this viewer can open are listed, but the
  // workspace-scoped instantiation count says how many records were made from
  // these versions in total, so the page can say how many it is not showing
  // instead of guessing from the URL. Unknown count (still loading, or the
  // read failed) states nothing.
  const made = useTemplateMadeCount(list.map((v) => v.id))
  const unlistedCount =
    made.data === undefined ? 0 : Math.max(0, made.data - rows.length)
  const restrictedView = state === 'denied' || unlistedCount > 0
  const unlistedNotice =
    unlistedCount > 0
      ? `${unlistedCount} ${unlistedCount === 1 ? 'record' : 'records'} made ` +
        `from this template ${unlistedCount === 1 ? 'isn’t' : 'aren’t'} listed ` +
        `here, because you’re not a member of the project ` +
        `${unlistedCount === 1 ? 'it was' : 'they were'} made in.`
      : 'A record made from this template isn’t listed here when you’re not a ' +
        'member of the project it was made in.'
  const unlistedEmptyBody =
    `${unlistedCount} ${unlistedCount === 1 ? 'record' : 'records'} made from ` +
    `this template ${unlistedCount === 1 ? 'is' : 'are'} in a project you’re ` +
    'not a member of. Ask the project lead for access.'

  const projects = useTemplateProjects(
    rows.map((row) => row.project_id).filter((id): id is string => Boolean(id)),
  )
  const projectIds = useMemo(
    () =>
      [...new Set(rows.map((row) => row.project_id))]
        .filter((id): id is string => Boolean(id))
        .sort((a, b) =>
          (projects.data?.get(a) ?? a).localeCompare(
            projects.data?.get(b) ?? b,
          ),
        ),
    [rows, projects.data],
  )

  const filtered = filterInUseRecords(rows, {
    versionId: versionFilter,
    projectId: projectFilter,
  })

  const groups = useMemo(() => {
    const byVersion = new Map<string, TemplateUsageRecord[]>()
    for (const record of filtered) {
      const key = record.source_notebook_template_version_id ?? ''
      const bucket = byVersion.get(key) ?? []
      bucket.push(record)
      byVersion.set(key, bucket)
    }
    return list
      .map((version) => ({ version, records: byVersion.get(version.id) ?? [] }))
      .filter((group) => group.records.length)
  }, [filtered, list])

  const matrix = useMemo(() => buildInUseMatrix(rows, list), [rows, list])
  const totals = useMemo(() => countTemplateUse(rows), [rows])
  const staleness = inUseStaleness(rows, current?.id)
  const filtersActive = Boolean(versionFilter || projectFilter)
  const versionFilterIsStale = Boolean(
    versionFilter && !list.some((v) => v.id === versionFilter),
  )

  const clearFilters = () =>
    void navigate({
      to: '/templates/$templateId/in-use',
      params: { templateId },
      search: {},
      replace: true,
    })

  const updateSearch = (patch: Record<string, unknown>) =>
    void navigate({
      to: '/templates/$templateId/in-use',
      params: { templateId },
      search: (s: Record<string, unknown>) => ({ ...s, ...patch }),
      replace: true,
    })

  if (!rows.length) {
    return (
      <div className="px-4 py-4 md:px-6">
        {unlistedCount > 0 ? (
          <EmptyState
            icon="lock"
            title="No records you can access yet"
            body={unlistedEmptyBody}
          />
        ) : (
          <EmptyState
            icon="template"
            title="No records use this template yet"
            body={`Records made from ${current ? `v${current.version}` : 'this template'} appear here, grouped by the version they were made from.`}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {restrictedView ? (
          <Notice tone="info" className="mb-3" icon="lock">
            {unlistedNotice} You can see {rows.length} record
            {rows.length === 1 ? '' : 's'} here
            {unlistedCount > 0 ? '.' : '; ask the project lead for access.'}
          </Notice>
        ) : null}
        {staleness.behind > 0 && current ? (
          <Notice tone="info" className="mb-3" icon="warn">
            {staleness.behind} record{staleness.behind === 1 ? '' : 's'} on
            older versions.
            {staleness.updatable > 0
              ? ` ${staleness.updatable} can move to v${current.version} now.`
              : ''}
            {staleness.stays > 0
              ? ` ${staleness.stays} signed record${staleness.stays === 1 ? '' : 's'} stay${staleness.stays === 1 ? 's' : ''} where they are.`
              : ''}
          </Notice>
        ) : null}
        {versionFilterIsStale ? (
          <Notice
            tone="warn"
            className="mb-3"
            action={
              <Button size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          >
            This filter names a version this template no longer has, so no
            records are shown.
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
                updateSearch({ version: e.target.value || undefined })
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
          <label className="flex items-center gap-1.5 text-label text-fg-muted">
            Project
            <select
              aria-label="Filter by project"
              className="h-[26px] rounded-md border border-border bg-surface px-1.5 text-label text-fg"
              value={projectFilter ?? ''}
              onChange={(e) =>
                updateSearch({ project: e.target.value || undefined })
              }
            >
              <option value="">All projects</option>
              {projectIds.map((id) => (
                <option key={id} value={id}>
                  {projects.data?.get(id) ?? id}
                </option>
              ))}
            </select>
          </label>
          {filtersActive ? (
            <Button size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
          <span className="num text-label text-fg-muted">
            {filtered.length} of {rows.length}
          </span>
        </div>

        {groups.length === 0 ? (
          <EmptyState
            icon="search"
            title="No records match these filters"
            body="Try another version or project."
          >
            <Button size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map(({ version, records }) => (
              <section
                key={version.id}
                aria-label={`Version ${version.version}`}
              >
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
                  <Table caption={`Records on version ${version.version}`}>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="first:pl-3">Record</TableHead>
                        <TableHead>Project</TableHead>
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
                        const status = recordStatus(r)
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
                              {r.project_id
                                ? (projects.data?.get(r.project_id) ??
                                  r.project_id)
                                : '—'}
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
      </div>

      <Inspector label="In-use details" width={320}>
        <InspectorSection title="Records by version">
          <TableBox>
            <Table caption="Records by version">
              <TableHeader>
                <TableRow>
                  <TableHead className="first:pl-3">Version</TableHead>
                  <TableHead align="right">In progress</TableHead>
                  <TableHead align="right">In review</TableHead>
                  <TableHead align="right">Signed</TableHead>
                  <TableHead align="right" className="pr-3">
                    Total
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matrix.map((row) => (
                  <TableRow key={row.version.id}>
                    <TableCell className="first:pl-3">
                      v{row.version.version}
                      {row.version.id === current?.id ? (
                        <span className="ml-1.5 text-label text-fg-muted">
                          current
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell align="right">{row.inProgress}</TableCell>
                    <TableCell align="right">{row.inReview}</TableCell>
                    <TableCell align="right">{row.signed}</TableCell>
                    <TableCell align="right" className="pr-3 font-medium">
                      {row.total}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
          <Muted className="mt-2">
            {totals.total} record{totals.total === 1 ? '' : 's'} in total ·{' '}
            {totals.signed} signed · {totals.inReview} in review.
          </Muted>
        </InspectorSection>
        <InspectorSection title="What updating does">
          <Muted>
            Signed records never change. In-progress records can move to the
            current version by their owner, which only adds sections and fields;
            records in review update after the review returns or is signed.
          </Muted>
        </InspectorSection>
        <InspectorSection title="Retiring a version">
          <Muted>
            A version can only be retired while no unsigned record is still on
            it. Retiring is blocked otherwise.
          </Muted>
          <Link
            to="/templates/$templateId/versions"
            params={{ templateId }}
            className="text-label"
          >
            Open Versions
          </Link>
        </InspectorSection>
      </Inspector>
    </div>
  )
}
