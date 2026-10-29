import { useMemo } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import { Status } from '#/components/v3/ui/status'
import { Pager } from '#/components/v3/ui/pager'
import {
  ProjectList,
  ProjectListFailure,
  ProjectListOutOfRange,
} from '#/components/v3/projects/project-list'
import {
  projectPageSummary,
  parseProjectPage,
  useProjectSamplesPage,
  PROJECT_LIST_PAGE_SIZE,
} from '#/components/v3/projects/project-lists'
import { toSampleListRow } from '#/components/v3/samples/samples-data'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'

/**
 * R5-SURF-02 — the project's Samples tab.
 *
 * Samples are model records, so scope is `api.records.project_id` with
 * `kind = 'sample'` (see `project-lists.ts` for the recorded scope decision);
 * the `properties.project` string is display-only and is not used here. The
 * read is filtered at the `/api/db` boundary and paged.
 */
export const Route = createFileRoute('/projects/$projectId/samples')({
  validateSearch: (search: Record<string, unknown>): { page?: number } => {
    const page = parseProjectPage(search.page)
    return page > 1 ? { page } : {}
  },
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect(signInRedirect(location))
    return { context }
  },
  component: ProjectSamplesTab,
})

function ProjectSamplesTab() {
  const { projectId } = Route.useParams()
  const { page: pageParam } = Route.useSearch()
  const page = pageParam ?? 1
  const query = useProjectSamplesPage(projectId, page)
  const rows = query.data?.rows ?? []
  const total = query.data?.total ?? 0

  const display = useMemo(
    () =>
      rows.map((r) => ({
        key: r.id,
        ...toSampleListRow(r, new Map(), undefined),
      })),
    [rows],
  )

  if (query.isError) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-auto px-4 py-[22px] md:px-8">
        <ProjectListFailure
          error={query.error}
          onRetry={() => void query.refetch()}
          what={t('projects.projectSamples.what')}
        />
      </div>
    )
  }

  const { pageCount, start, end } = projectPageSummary(page, total)

  if (total > 0 && page > pageCount) {
    return (
      <ProjectListOutOfRange
        total={total}
        label={t('projects.projectSamples.noun')}
        link={{
          to: '/projects/$projectId/samples',
          params: { projectId },
          search: {},
        }}
      />
    )
  }

  return (
    <ProjectList
      title={t('projects.projectSamples.title')}
      count={total}
      action={
        <span className="flex items-center gap-3">
          <Link
            to="/samples"
            search={{ new: true, project: projectId }}
            className="text-label text-link"
          >
            {t('projects.projectSamples.register')}
          </Link>
          <Link to="/samples" className="text-label text-link">
            {t('projects.projectSamples.all')}
          </Link>
        </span>
      }
      cols={[
        {
          key: 'id',
          label: t('projects.projectSamples.columns.id'),
          cell: (s) => (
            <Link
              to="/samples/$sampleId"
              params={{ sampleId: s.key }}
              className="mono text-link"
            >
              {s.id}
            </Link>
          ),
        },
        {
          key: 'name',
          label: t('projects.projectSamples.columns.name'),
          cell: (s) => <span className="font-medium">{s.name}</span>,
        },
        {
          key: 'type',
          label: t('projects.projectSamples.columns.type'),
          cell: (s) => s.type,
        },
        {
          key: 'quantity',
          label: t('projects.projectSamples.columns.quantity'),
          align: 'right',
          cell: (s) => s.quantity,
        },
        {
          key: 'location',
          label: t('projects.projectSamples.columns.location'),
          cell: (s) => s.location,
        },
        {
          key: 'status',
          label: t('projects.projectSamples.columns.status'),
          cell: (s) => <Status tone={s.status.tone}>{s.status.label}</Status>,
        },
      ]}
      rows={display}
      mobile={display.map((s) => ({
        key: s.key,
        title: s.name,
        meta: (
          <>
            <span className="mono">{s.id}</span> · {s.quantity} · {s.location}
          </>
        ),
        status: s.status,
        link: { to: '/samples/$sampleId', params: { sampleId: s.key } },
      }))}
      empty={{
        icon: 'tube',
        title: t('projects.projectSamples.empty.title'),
        body: t('projects.projectSamples.empty.body'),
      }}
      footer={
        total > PROJECT_LIST_PAGE_SIZE ? (
          <Pager
            page={page}
            pageCount={pageCount}
            start={start}
            end={end}
            total={total}
            noun={t('projects.projectSamples.noun')}
            linkFor={(next) => ({
              to: '/projects/$projectId/samples',
              params: { projectId },
              search: { page: next },
            })}
          />
        ) : undefined
      }
    />
  )
}
