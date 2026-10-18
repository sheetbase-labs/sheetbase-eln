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
          what="this project's samples"
        />
      </div>
    )
  }

  const { pageCount, start, end } = projectPageSummary(page, total)

  if (total > 0 && page > pageCount) {
    return (
      <ProjectListOutOfRange
        total={total}
        label="samples"
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
      title="Samples"
      count={total}
      action={
        <Link to="/samples" className="text-label text-link">
          All samples
        </Link>
      }
      cols={[
        {
          key: 'id',
          label: 'ID',
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
          label: 'Name',
          cell: (s) => <span className="font-medium">{s.name}</span>,
        },
        { key: 'type', label: 'Type', cell: (s) => s.type },
        {
          key: 'quantity',
          label: 'Quantity',
          align: 'right',
          cell: (s) => s.quantity,
        },
        { key: 'location', label: 'Location', cell: (s) => s.location },
        {
          key: 'status',
          label: 'Status',
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
        title: 'No samples yet',
        body: 'Samples registered against this project appear here.',
      }}
      footer={
        total > PROJECT_LIST_PAGE_SIZE ? (
          <Pager
            page={page}
            pageCount={pageCount}
            start={start}
            end={end}
            total={total}
            noun="samples"
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
