/**
 * PROJ-04.4 — the project's files tab.
 *
 * A file is a record of kind 'file' with a 1:1 api.file_objects row, so the tab lists
 * the project's file records and joins their object metadata. The columns are Name,
 * Kind, Size, Uploaded by and Uploaded; the reader is paged so a project with more
 * files than one page says so rather than dropping the rest.
 */
import { useMemo } from 'react'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import {
  ProjectList,
  ProjectListFailure,
  ProjectListOutOfRange,
} from '#/components/projects/project-list'
import { Pager } from '#/components/ui/pager'
import { Tabs } from '#/components/ui/tabs'
import { ProjectSheets } from '#/components/projects/project-sheets'
import { ProjectFolders } from './-folders-panel'
import {
  PROJECT_LIST_PAGE_SIZE,
  parseProjectPage,
  projectPageSummary,
} from '#/components/projects/project-lists'
import { useUserNames } from '#/lib/user-names'
import { notebookDataClient } from '#/lib/notebook-data'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'
import { fetchProjectFilesPage, toFileDisplayRows } from './-files-data'

export const Route = createFileRoute('/projects/$projectId/files')({
  validateSearch: (search) => {
    const page = parseProjectPage(search.page)

    const view = z
      .enum(['folders', 'sheets'])
      .optional()
      .catch(undefined)
      .parse(search.view)

    const result: FilesSearch = {}

    if (page > 1) result.page = page

    if (view) result.view = view

    return result
  },
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) throw redirect(signInRedirect(location))

    return { context }
  },
  component: ProjectFilesPage,
})

/** What the Files tab shows: the uploaded files, the folders they are
 * organised in, or the project's working sheets. */
type FilesView = 'folders' | 'sheets'

interface FilesSearch {
  page?: number
  view?: FilesView
}

/** One Files tab for everything the project keeps: files, folders and sheets. */
function ProjectFilesPage() {
  const { projectId } = Route.useParams()
  const { view } = Route.useSearch()
  const params = { projectId }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="px-4 pt-3 md:px-8">
        <Tabs
          mode="url"
          variant="segment"
          label={t('projects.projectFiles.views.label')}
          value={view ?? 'files'}
          items={[
            {
              key: 'files',
              label: t('projects.projectFiles.views.files'),
              link: { to: '/projects/$projectId/files', params, search: {} },
            },
            {
              key: 'folders',
              label: t('projects.projectFiles.views.folders'),
              link: {
                to: '/projects/$projectId/files',
                params,
                search: { view: 'folders' },
              },
            },
            {
              key: 'sheets',
              label: t('projects.projectFiles.views.sheets'),
              link: {
                to: '/projects/$projectId/files',
                params,
                search: { view: 'sheets' },
              },
            },
          ]}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        {view === 'folders' ? (
          <ProjectFolders projectId={projectId} />
        ) : view === 'sheets' ? (
          <ProjectSheets projectId={projectId} />
        ) : (
          <ProjectFilesTab />
        )}
      </div>
    </div>
  )
}

function ProjectFilesTab() {
  const { projectId } = Route.useParams()
  const { page: pageParam } = Route.useSearch()
  const page = pageParam ?? 1

  const query = useQuery({
    queryKey: ['ui-port', 'project-files', projectId, page],
    queryFn: () => fetchProjectFilesPage(notebookDataClient, projectId, page),
    enabled: projectId.length > 0,
    staleTime: 15_000,
  })

  const rows = useMemo(() => query.data?.rows ?? [], [query.data?.rows])
  const total = query.data?.total ?? 0

  const { userLabel } = useUserNames(
    useMemo(
      () => rows.flatMap((file) => (file.uploadedBy ? [file.uploadedBy] : [])),
      [rows],
    ),
  )

  const display = useMemo(
    () => toFileDisplayRows(rows, userLabel),
    [rows, userLabel],
  )

  if (query.isError) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-auto px-4 py-[22px] md:px-8">
        <ProjectListFailure
          error={query.error}
          onRetry={() => void query.refetch()}
          what={t('projects.projectFiles.what')}
        />
      </div>
    )
  }

  const { pageCount, start, end } = projectPageSummary(page, total)

  if (total > 0 && page > pageCount) {
    return (
      <ProjectListOutOfRange
        total={total}
        label={t('projects.projectFiles.noun')}
        link={{
          to: '/projects/$projectId/files',
          params: { projectId },
          search: {},
        }}
      />
    )
  }

  return (
    <ProjectList
      title={t('projects.projectFiles.title')}
      count={total}
      cols={[
        {
          key: 'name',
          label: t('projects.projectFiles.columns.name'),
          cell: (file) => (
            <Link
              to="/records/$recordId"
              params={{ recordId: file.key }}
              className="hover:underline"
            >
              {file.name}
            </Link>
          ),
        },
        {
          key: 'kind',
          label: t('projects.projectFiles.columns.kind'),
          cell: (file) => file.kind,
        },
        {
          key: 'size',
          label: t('projects.projectFiles.columns.size'),
          align: 'right',
          cell: (file) => file.size,
        },
        {
          key: 'uploadedBy',
          label: t('projects.projectFiles.columns.uploadedBy'),
          cell: (file) => file.uploadedBy,
        },
        {
          key: 'uploaded',
          label: t('projects.projectFiles.columns.uploaded'),
          align: 'right',
          className: 'text-fg-muted',
          cell: (file) => file.uploaded,
        },
      ]}
      rows={display}
      mobile={display.map((file) => ({
        key: file.key,
        title: file.name,
        meta: (
          <>
            <span className="mono">{file.id}</span> · {file.kind} · {file.size}{' '}
            · {file.uploaded}
          </>
        ),
        link: { to: '/records/$recordId', params: { recordId: file.key } },
      }))}
      empty={{
        icon: 'upload',
        title: t('projects.projectFiles.empty.title'),
        body: t('projects.projectFiles.empty.body'),
      }}
      footer={
        total > PROJECT_LIST_PAGE_SIZE ? (
          <Pager
            page={page}
            pageCount={pageCount}
            start={start}
            end={end}
            total={total}
            noun={t('projects.projectFiles.noun')}
            linkFor={(next) => ({
              to: '/projects/$projectId/files',
              params: { projectId },
              search: { page: next },
            })}
          />
        ) : undefined
      }
    />
  )
}
