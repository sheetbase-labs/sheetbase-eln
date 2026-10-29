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
  useProjectDatasetsPage,
  PROJECT_LIST_PAGE_SIZE,
} from '#/components/v3/projects/project-lists'
import { datasetValidation } from '#/components/v3/datasets/datasets-data'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'

/**
 * R5-SURF-02 — the project's Datasets tab.
 *
 * Scope is `api.datasets.primary_project_id`, filtered inside the canonical
 * `dataset_list_summary` RPC (see `project-lists.ts` for the recorded scope
 * decision) — never by filtering the global registry in the browser. Archived
 * datasets are excluded from the project view, matching the design's "current
 * project" reading; the global registry still shows them.
 */
export const Route = createFileRoute('/projects/$projectId/datasets')({
  validateSearch: (search: Record<string, unknown>): { page?: number } => {
    const page = parseProjectPage(search.page)
    return page > 1 ? { page } : {}
  },
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect(signInRedirect(location))
    return { context }
  },
  component: ProjectDatasetsTab,
})

function ProjectDatasetsTab() {
  const { projectId } = Route.useParams()
  const { page: pageParam } = Route.useSearch()
  const page = pageParam ?? 1
  const query = useProjectDatasetsPage(projectId, page)
  const rows = query.data?.rows ?? []
  const total = query.data?.total ?? 0

  const display = rows.map((d) => ({ key: d.uuid, ...d }))

  if (query.isError) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-auto px-4 py-[22px] md:px-8">
        <ProjectListFailure
          error={query.error}
          onRetry={() => void query.refetch()}
          what={t('projects.projectDatasets.what')}
        />
      </div>
    )
  }

  const { pageCount, start, end } = projectPageSummary(page, total)

  if (total > 0 && page > pageCount) {
    return (
      <ProjectListOutOfRange
        total={total}
        label={t('projects.projectDatasets.noun')}
        link={{
          to: '/projects/$projectId/datasets',
          params: { projectId },
          search: {},
        }}
      />
    )
  }

  return (
    <ProjectList
      title={t('projects.projectDatasets.title')}
      count={total}
      action={
        <Link to="/datasets" className="text-label text-link">
          {t('projects.projectDatasets.all')}
        </Link>
      }
      cols={[
        {
          key: 'id',
          label: t('projects.projectDatasets.columns.id'),
          cell: (d) => (
            <Link
              to="/datasets/$datasetId"
              params={{ datasetId: d.key }}
              className="mono text-link"
            >
              {d.id}
            </Link>
          ),
        },
        {
          key: 'name',
          label: t('projects.projectDatasets.columns.name'),
          cell: (d) => <span className="font-medium">{d.name}</span>,
        },
        {
          key: 'model',
          label: t('projects.projectDatasets.columns.model'),
          cell: (d) => d.model,
        },
        {
          key: 'rows',
          label: t('projects.projectDatasets.columns.rows'),
          align: 'right',
          cell: (d) => d.rows,
        },
        {
          key: 'validation',
          label: t('projects.projectDatasets.columns.validation'),
          cell: (d) => {
            const v = datasetValidation(d)
            return <Status tone={v.tone}>{v.label}</Status>
          },
        },
      ]}
      rows={display}
      mobile={display.map((d) => ({
        key: d.key,
        title: d.name,
        meta: (
          <>
            <span className="mono">{d.id}</span> ·{' '}
            {t('common.counts.rows', { count: d.rows })}
          </>
        ),
        status: datasetValidation(d),
        link: { to: '/datasets/$datasetId', params: { datasetId: d.key } },
      }))}
      empty={{
        icon: 'database',
        title: t('projects.projectDatasets.empty.title'),
        body: t('projects.projectDatasets.empty.body'),
      }}
      footer={
        total > PROJECT_LIST_PAGE_SIZE ? (
          <Pager
            page={page}
            pageCount={pageCount}
            start={start}
            end={end}
            total={total}
            noun={t('projects.projectDatasets.noun')}
            linkFor={(next) => ({
              to: '/projects/$projectId/datasets',
              params: { projectId },
              search: { page: next },
            })}
          />
        ) : undefined
      }
    />
  )
}
