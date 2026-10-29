import { useMemo } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'

import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Select } from '#/components/v3/ui/select'
import { Inspector, InspectorSection, Muted } from '#/components/v3/ui/layout'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
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
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

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
      return { tone: 'ok', label: t('library.templates.inUse.signed') }
    case 'in-review':
      return { tone: 'review', label: t('library.templates.inUse.inReview') }
    default: {
      const key = record.status.toLowerCase()
      if (key.includes('draft'))
        return { tone: 'draft', label: t('library.templates.inUse.draft') }
      return {
        tone: 'progress',
        label: record.status || t('library.templates.inUse.inProgress'),
      }
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
        {t('library.templates.inUse.staysOnV', { version: version.version })}
      </span>
    )
  }
  if (record.status.toLowerCase().includes('review')) {
    return (
      <span className="text-label text-fg-muted">
        {t('library.templates.inUse.updateAfterReview')}
      </span>
    )
  }
  return (
    <Link
      to="/templates/$templateId/update"
      params={{ templateId: version.templateId }}
      search={{ record: record.id }}
      className="text-label"
    >
      {t('library.templates.inUse.updateAvailable')}
    </Link>
  )
}

/** The records-on-a-version table's columns; `projects` resolves the project
 * name and `updateCell` states whether the record can move to the current
 * version. */
function inUseRecordColumns({
  projects,
  userLabel,
  version,
  current,
}: {
  projects: Map<string, string> | undefined
  userLabel: (userId: string) => string
  version: NotebookTemplateVersion
  current: NotebookTemplateVersion | undefined
}): RegistryColumn<TemplateUsageRecord>[] {
  return [
    {
      id: 'record',
      header: t('library.templates.inUse.record'),
      meta: { headerClassName: 'pl-3!', cellClassName: 'pl-3!' },
      cell: ({ row }) => (
        <>
          <Link
            to="/experiments/$expId"
            params={{ expId: row.original.id }}
            className="mono"
          >
            {row.original.identifier}
          </Link>
          <span className="block text-label text-fg-muted">
            {row.original.title}
          </span>
        </>
      ),
    },
    {
      id: 'project',
      header: t('library.templates.inUse.project'),
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) =>
        row.original.project_id
          ? (projects?.get(row.original.project_id) ?? row.original.project_id)
          : '—',
    },
    {
      id: 'owner',
      header: t('library.templates.inUse.owner'),
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) =>
        row.original.created_by_user_id
          ? userLabel(row.original.created_by_user_id)
          : '—',
    },
    {
      id: 'status',
      header: t('library.templates.inUse.status'),
      cell: ({ row }) => {
        const status = recordStatus(row.original)
        return <Status tone={status.tone}>{status.label}</Status>
      },
    },
    {
      id: 'pinned',
      header: t('library.templates.inUse.pinnedSince'),
      meta: { cellClassName: 'text-fg-muted' },
      cell: ({ row }) => formatDate(row.original.created_at),
    },
    {
      id: 'update',
      header: t('library.templates.inUse.update'),
      meta: {
        ...rightAligned<TemplateUsageRecord>().meta,
        headerClassName: 'pr-3! text-right',
        cellClassName: 'pr-3! text-right',
      },
      cell: ({ row }) => updateCell(row.original, version, current),
    },
  ]
}

function inUseMatrixColumns(
  currentId: string | undefined,
): RegistryColumn<ReturnType<typeof buildInUseMatrix>[number]>[] {
  const right = () =>
    rightAligned<ReturnType<typeof buildInUseMatrix>[number]>().meta
  return [
    {
      id: 'version',
      header: t('library.templates.inUse.version'),
      meta: { headerClassName: 'pl-3!', cellClassName: 'pl-3!' },
      cell: ({ row }) => (
        <>
          v{row.original.version.version}
          {row.original.version.id === currentId ? (
            <span className="ml-1.5 text-label text-fg-muted">current</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'inProgress',
      header: t('library.templates.inUse.inProgress'),
      meta: right(),
      cell: ({ row }) => row.original.inProgress,
    },
    {
      id: 'inReview',
      header: t('library.templates.inUse.inReview'),
      meta: right(),
      cell: ({ row }) => row.original.inReview,
    },
    {
      id: 'signed',
      header: t('library.templates.inUse.signed'),
      meta: right(),
      cell: ({ row }) => row.original.signed,
    },
    {
      id: 'total',
      header: t('library.templates.inUse.total'),
      meta: {
        ...right(),
        headerClassName: 'pr-3! text-right',
        cellClassName: 'pr-3! text-right font-medium',
      },
      cell: ({ row }) => row.original.total,
    },
  ]
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
      : t('library.templates.inUse.aRecordMadeFromThis') +
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
            title={t('library.templates.inUse.noRecordsYouCanAccess')}
            description={unlistedEmptyBody}
          />
        ) : (
          <EmptyState
            icon="template"
            title={t('library.templates.inUse.noRecordsUseThisTemplate')}
            description={t(
              'library.templates.inUse.recordsMadeFromAppearHere',
              { value: current ? `v${current.version}` : 'this template' },
            )}
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
            {t('library.templates.inUse.youCanSeeRecordsHere', {
              unlistedNotice,
              count: rows.length,
            })}
            {unlistedCount > 0
              ? '.'
              : t('library.templates.inUse.askTheProjectLeadFor')}
          </Notice>
        ) : null}
        {staleness.behind > 0 && current ? (
          <Notice tone="info" className="mb-3" icon="warn">
            {t('library.templates.inUse.recordsOnOlderVersions', {
              count: staleness.behind,
            })}
            {staleness.updatable > 0
              ? t('library.templates.inUse.canMoveToVNow', {
                  updatable: staleness.updatable,
                  version: current.version,
                })
              : ''}
            {staleness.stays > 0
              ? t('library.templates.inUse.signedRecordsStayWhereThey', {
                  count: staleness.stays,
                })
              : ''}
          </Notice>
        ) : null}
        {versionFilterIsStale ? (
          <Notice
            tone="warn"
            className="mb-3"
            action={
              <Button size="sm" onClick={clearFilters}>
                {t('library.templates.inUse.clearFilters')}
              </Button>
            }
          >
            {t('library.templates.inUse.thisFilterNamesAVersion')}
          </Notice>
        ) : null}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-label text-fg-muted">
            {t('library.templates.inUse.version')}
            <Select
              aria-label={t('library.templates.inUse.filterByVersion')}
              size="sm"
              value={versionFilter ?? ''}
              onChange={(e) =>
                updateSearch({ version: e.target.value || undefined })
              }
            >
              <option value="">
                {t('library.templates.inUse.allVersions')}
              </option>
              {list.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-1.5 text-label text-fg-muted">
            {t('library.templates.inUse.project')}
            <Select
              aria-label={t('library.templates.inUse.filterByProject')}
              size="sm"
              value={projectFilter ?? ''}
              onChange={(e) =>
                updateSearch({ project: e.target.value || undefined })
              }
            >
              <option value="">
                {t('library.templates.inUse.allProjects')}
              </option>
              {projectIds.map((id) => (
                <option key={id} value={id}>
                  {projects.data?.get(id) ?? id}
                </option>
              ))}
            </Select>
          </label>
          {filtersActive ? (
            <Button size="sm" onClick={clearFilters}>
              {t('library.templates.inUse.clearFilters')}
            </Button>
          ) : null}
          <span className="num text-label text-fg-muted">
            {t('library.templates.inUse.of', {
              filtered: filtered.length,
              rows: rows.length,
            })}
          </span>
        </div>

        {groups.length === 0 ? (
          <EmptyState
            icon="search"
            title={t('library.templates.inUse.noRecordsMatchTheseFilters')}
            description={t(
              'library.templates.inUse.tryAnotherVersionOrProject',
            )}
            action={
              <Button size="sm" onClick={clearFilters}>
                {t('library.templates.inUse.clearFilters')}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map(({ version, records }) => (
              <section
                key={version.id}
                aria-label={t('library.templates.inUse.version2', {
                  version: version.version,
                })}
              >
                <h2 className="mb-1 flex items-center gap-2 text-section">
                  v{version.version}
                  <Status tone={version.id === current?.id ? 'ok' : 'none'}>
                    {version.id === current?.id
                      ? t('library.templates.inUse.current')
                      : t('library.templates.inUse.published')}
                  </Status>
                  <span className="num text-label font-normal text-fg-muted">
                    {t('library.templates.inUse.records', {
                      records: records.length,
                    })}
                  </span>
                </h2>
                <div className="overflow-hidden rounded-md border border-border">
                  <RegistryGrid
                    label={t('library.templates.inUse.recordsOnVersion', {
                      version: version.version,
                    })}
                    rows={records}
                    columns={inUseRecordColumns({
                      projects: projects.data,
                      userLabel: names.userLabel,
                      version,
                      current,
                    })}
                    getRowId={(record) => record.id}
                    selectable={false}
                  />
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <Inspector label={t('library.templates.inUse.inUseDetails')} width={320}>
        <InspectorSection title={t('library.templates.inUse.recordsByVersion')}>
          <TableBox>
            <RegistryGrid
              label={t('library.templates.inUse.recordsByVersion')}
              rows={matrix}
              columns={inUseMatrixColumns(current?.id)}
              getRowId={(row) => row.version.id}
              selectable={false}
            />
          </TableBox>
          <Muted className="mt-2">
            {t('library.templates.inUse.recordsInTotalSignedIn', {
              count: totals.total,
              signed: totals.signed,
              inReview: totals.inReview,
            })}
          </Muted>
        </InspectorSection>
        <InspectorSection title={t('library.templates.inUse.whatUpdatingDoes')}>
          <Muted>
            {t('library.templates.inUse.signedRecordsNeverChangeIn')}
          </Muted>
        </InspectorSection>
        <InspectorSection title={t('library.templates.inUse.retiringAVersion')}>
          <Muted>{t('library.templates.inUse.aVersionCanOnlyBe')}</Muted>
          <Link
            to="/templates/$templateId/versions"
            params={{ templateId }}
            className="text-label"
          >
            {t('library.templates.inUse.openVersions')}
          </Link>
        </InspectorSection>
      </Inspector>
    </div>
  )
}
