import { useMemo } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
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
  useProjectExperimentsPage,
  PROJECT_LIST_PAGE_SIZE,
} from '#/components/v3/projects/project-lists'
import { toExperimentListRow } from '#/components/v3/experiments/experiments-data'
import { useUserNames } from '#/lib/user-names'

/**
 * R5-SURF-02 — the project's Experiments tab.
 *
 * Scope is `api.records.project_id` with `kind = 'experiment'`, filtered at the
 * `/api/db` boundary (see `project-lists.ts` for the recorded scope decision),
 * and paged so a project with more experiments than one page says so.
 */
export const Route = createFileRoute('/projects/$projectId/experiments')({
  validateSearch: (search: Record<string, unknown>): { page?: number } => {
    const page = parseProjectPage(search.page)
    return page > 1 ? { page } : {}
  },
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: ProjectExperimentsTab,
})

function ProjectExperimentsTab() {
  const { projectId } = Route.useParams()
  const { page: pageParam } = Route.useSearch()
  const page = pageParam ?? 1
  const query = useProjectExperimentsPage(projectId, page)
  const rows = query.data?.rows ?? []
  const total = query.data?.total ?? 0

  const ownerIds = useMemo(() => rows.map((r) => r.created_by_user_id), [rows])
  const { userLabel } = useUserNames(ownerIds)
  const ownerNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const id of ownerIds) map.set(id, userLabel(id))
    return map
  }, [ownerIds, userLabel])

  const display = useMemo(
    () =>
      rows.map((r) => ({
        key: r.id,
        ...toExperimentListRow(r, new Map(), ownerNames),
      })),
    [rows, ownerNames],
  )

  if (query.isError) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-auto px-4 py-[22px] md:px-8">
        <ProjectListFailure
          error={query.error}
          onRetry={() => void query.refetch()}
          what="this project's experiments"
        />
      </div>
    )
  }

  const { pageCount, start, end } = projectPageSummary(page, total)

  if (total > 0 && page > pageCount) {
    return (
      <ProjectListOutOfRange
        total={total}
        label="experiments"
        link={{
          to: '/projects/$projectId/experiments',
          params: { projectId },
          search: {},
        }}
      />
    )
  }

  return (
    <ProjectList
      title="Experiments"
      count={total}
      action={
        <span className="flex items-center gap-3 text-label">
          <Link
            to="/projects/$projectId/folders"
            params={{ projectId }}
            className="text-link"
          >
            Folders
          </Link>
          <Button
            size="sm"
            nativeButton={false}
            render={
              <Link to="/experiments/new" search={{ project: projectId }} />
            }
          >
            New experiment
          </Button>
        </span>
      }
      cols={[
        {
          key: 'id',
          label: 'ID',
          cell: (e) => <span className="mono">{e.id}</span>,
        },
        {
          key: 'title',
          label: 'Experiment',
          cell: (e) => <span className="font-medium">{e.title}</span>,
        },
        { key: 'owner', label: 'Owner', cell: (e) => e.owner },
        {
          key: 'status',
          label: 'Status',
          cell: (e) => <Status tone={e.status.tone}>{e.status.label}</Status>,
        },
        {
          key: 'updated',
          label: 'Updated',
          align: 'right',
          className: 'text-fg-muted',
          cell: (e) => e.updated,
        },
      ]}
      rows={display}
      mobile={display.map((e) => ({
        key: e.key,
        title: e.title,
        meta: (
          <>
            <span className="mono">{e.id}</span> · {e.owner} · {e.updated}
          </>
        ),
        status: e.status,
        link: { to: '/experiments/$expId', params: { expId: e.key } },
      }))}
      empty={{
        icon: 'flask',
        title: 'No experiments yet',
        body: 'Experiments you start in this project appear here.',
      }}
      footer={
        total > PROJECT_LIST_PAGE_SIZE ? (
          <Pager
            page={page}
            pageCount={pageCount}
            start={start}
            end={end}
            total={total}
            noun="experiments"
            linkFor={(next) => ({
              to: '/projects/$projectId/experiments',
              params: { projectId },
              search: { page: next },
            })}
          />
        ) : undefined
      }
    />
  )
}
