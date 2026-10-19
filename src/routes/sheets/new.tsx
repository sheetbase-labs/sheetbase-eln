import { useState } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'

import { PageHeader, Muted } from '#/components/v3/ui/layout'
import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { toast } from '#/components/v3/ui/sonner'
import { Icon } from '#/components/v3/icons'
import { createAdHocSheetInstance } from '#/lib/sheet-instance-data'
import type { SheetInstanceState } from '#/lib/sheet-instance'
import { fetchProjectSummaries } from '#/components/v3/projects/project-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { insertSheetInstanceBlock } from '#/lib/notebook-mutations'
import {
  fetchDatasetSheetOptions,
  openDatasetInSheet,
} from '#/lib/sheet-from-dataset'
import { cancelTarget, parseCreateContext } from '#/lib/create-context-search'
import type { CreateContextSearch } from '#/lib/create-context-search'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** A new working sheet. It takes the shared create-context params, so a page
 * that links here hands over what it is about: `project` picks the project,
 * `experiment` puts the sheet in that notebook, `dataset` opens that dataset in
 * the sheet, and `returnTo` is where Cancel goes. The sheet is created through
 * the canonical RPCs and the person lands on it. */
export const Route = createFileRoute('/sheets/new')({
  validateSearch: (search: Record<string, unknown>): CreateContextSearch =>
    parseCreateContext(search),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: NewSheet,
})

function blankState(): SheetInstanceState {
  return {
    bindings: [],
    localFields: [],
    localValues: {},
    calculationOverrides: {},
    presentation: {
      columnOrder: [],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
      filters: [],
      sorts: [],
    },
    provenance: { createdFrom: 'ad_hoc' },
  }
}

const starts = [
  {
    icon: 'database' as const,
    title: 'From a dataset',
    body: 'Pick a dataset to see its columns in a sheet. They stay read-only and come from the dataset.',
    to: '/datasets' as const,
  },
  {
    icon: 'template' as const,
    title: 'From a template',
    body: 'Pick a notebook template, then choose Use template to start a notebook with its sheets and fields.',
    to: '/templates' as const,
  },
  {
    icon: 'upload' as const,
    title: 'Paste or import a file',
    body: 'CSV or Excel. Values stay local until you keep them.',
    to: '/import' as const,
  },
  {
    icon: 'table' as const,
    title: 'Blank sheet',
    body: 'Start with local columns only, then promote them into a dataset.',
    blank: true,
    to: '/sheets/new' as const,
  },
]

function NewSheet() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const workspaceId = context.workspace?.id ?? ''
  const navigate = useNavigate()
  const projects = useQuery({
    queryKey: ['ui-port', 'sheets', 'new', 'projects'],
    queryFn: () => fetchProjectSummaries(undefined),
  })
  const experiment = useQuery({
    queryKey: ['ui-port', 'sheets', 'new', 'experiment', search.experiment],
    enabled: Boolean(search.experiment),
    queryFn: () =>
      notebookDataClient
        .list<{
          id: string
          identifier: string
          title: string
          project_id: string | null
          locked_at: string | null
        }>(
          'records',
          `?id=eq.${encodeURIComponent(search.experiment ?? '')}&select=id,identifier,title,project_id,locked_at&limit=1`,
        )
        .then((rows) => rows[0] ?? null),
  })
  const dataset = useQuery({
    queryKey: ['ui-port', 'sheets', 'new', 'dataset', search.dataset],
    enabled: Boolean(search.dataset),
    queryFn: () =>
      notebookDataClient
        .list<{
          id: string
          name: string
          display_id: string | null
          primary_project_id: string | null
        }>(
          'datasets',
          `?id=eq.${encodeURIComponent(search.dataset ?? '')}&select=id,name,display_id,primary_project_id&limit=1`,
        )
        .then((rows) => rows[0] ?? null),
  })
  const options = useQuery({
    queryKey: ['ui-port', 'sheets', 'new', 'dataset-sheet-options'],
    enabled: Boolean(search.dataset),
    queryFn: () => fetchDatasetSheetOptions(notebookDataClient),
  })

  // The project a handed-over context implies, until the person picks another.
  const impliedProject =
    search.project ??
    experiment.data?.project_id ??
    dataset.data?.primary_project_id ??
    ''
  const [chosenProject, setChosenProject] = useState<string | null>(null)
  const projectId = chosenProject ?? impliedProject
  const [name, setName] = useState('Untitled sheet')
  const [optionId, setOptionId] = useState('')
  const option =
    (options.data ?? []).find((o) => o.versionId === optionId) ??
    (options.data ?? []).at(0)
  const datasetLabel = dataset.data
    ? (dataset.data.display_id ?? dataset.data.name)
    : null
  const experimentLocked = Boolean(experiment.data?.locked_at)

  const land = (sheetId: string) =>
    navigate({
      to: '/sheets/$sheetId',
      params: { sheetId },
      search: { projectId },
    })

  const create = useMutation({
    mutationFn: async () => {
      const notebook = experiment.data?.id ?? null
      const sheetName = name.trim() || 'Untitled sheet'
      if (search.dataset && option) {
        return openDatasetInSheet(notebookDataClient, {
          workspaceId,
          name: sheetName,
          option,
          datasetId: search.dataset,
          projectId: projectId || null,
          notebookRecordId: notebook,
        })
      }
      const instance = await createAdHocSheetInstance({
        workspaceId,
        name: sheetName,
        projectId,
        notebookRecordId: notebook,
        state: blankState(),
      })
      return instance
    },
    onSuccess: async (instance) => {
      let inNotebook = false
      if (experiment.data) {
        try {
          await insertSheetInstanceBlock(notebookDataClient, {
            recordId: experiment.data.id,
            instanceId: instance.id,
          })
          inNotebook = true
        } catch {
          inNotebook = false
        }
      }
      toast('Sheet created', {
        description: experiment.data
          ? inNotebook
            ? `It is in ${experiment.data.identifier}'s notebook.`
            : `It belongs to ${experiment.data.identifier}; add it to the notebook from the block menu.`
          : datasetLabel && search.dataset
            ? `${datasetLabel} is open in it.`
            : 'Bring in data you want to look at, then add local columns.',
      })
      await land(instance.id)
    },
    onError: (error: unknown) =>
      toast('Could not create the sheet', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  const datasetBlocked = Boolean(search.dataset) && options.isSuccess && !option
  const cancelTo = cancelTarget(search, '/sheets/new')
  const hasContext = Boolean(
    search.project || search.experiment || search.dataset,
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        trail={[{ label: 'New' }]}
        title="New sheet"
        meta={
          <span>Sheets are private to a project and are never evidence.</span>
        }
      />
      <div className="flex justify-center px-4 pb-8 pt-8 md:px-6">
        <div className="flex w-[560px] max-w-full flex-col gap-3.5">
          {hasContext ? (
            <Notice tone="info" title="Starting from where you were">
              <ul className="m-0 list-none space-y-0.5 p-0">
                {experiment.data ? (
                  <li>
                    In notebook{' '}
                    <ObjectLink
                      kind="experiment"
                      id={experiment.data.id}
                      identifier={experiment.data.identifier}
                    />{' '}
                    {experiment.data.title}
                  </li>
                ) : null}
                {dataset.data ? (
                  <li>
                    Showing dataset{' '}
                    <ObjectLink
                      kind="dataset"
                      id={dataset.data.id}
                      identifier={datasetLabel}
                    />{' '}
                    {dataset.data.name}
                  </li>
                ) : null}
                {projectId && !experiment.data && !dataset.data ? (
                  <li>
                    In project{' '}
                    <ObjectLink
                      kind="project"
                      id={projectId}
                      identifier={
                        (projects.data ?? []).find((p) => p.id === projectId)
                          ?.displayId ?? 'this project'
                      }
                    />
                  </li>
                ) : null}
              </ul>
            </Notice>
          ) : (
            <>
              <EmptyState
                icon="table"
                title="This sheet is empty"
                description="A working sheet is for trying things. Bring in data you want to look at, then add local columns to explore it."
                className="py-0"
              />
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {starts.map((o) =>
                  'blank' in o && o.blank ? (
                    <button
                      key={o.title}
                      type="button"
                      onClick={() => {
                        document.getElementById('new-sheet')?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'start',
                        })
                        document.getElementById('new-sheet-name')?.focus()
                      }}
                      className="flex min-h-14 cursor-pointer gap-2.5 rounded-md border border-border bg-surface p-3 text-left text-fg hover:bg-surface-hover"
                    >
                      <span className="mt-px shrink-0 text-fg-muted">
                        <Icon name={o.icon} size={16} />
                      </span>
                      <span>
                        <b className="block font-medium">{o.title}</b>
                        <span className="text-caption text-fg-muted">
                          {o.body}
                        </span>
                      </span>
                    </button>
                  ) : (
                    <Link
                      key={o.title}
                      to={o.to}
                      search={
                        o.to === '/import'
                          ? {
                              project: projectId || undefined,
                              experiment: search.experiment,
                              returnTo: search.returnTo,
                            }
                          : undefined
                      }
                      className="flex min-h-14 gap-2.5 rounded-md border border-border bg-surface p-3 text-fg no-underline hover:bg-surface-hover hover:text-fg hover:no-underline"
                    >
                      <span className="mt-px shrink-0 text-fg-muted">
                        <Icon name={o.icon} size={16} />
                      </span>
                      <span>
                        <b className="block font-medium">{o.title}</b>
                        <span className="text-caption text-fg-muted">
                          {o.body}
                        </span>
                      </span>
                    </Link>
                  ),
                )}
              </div>
            </>
          )}

          <div
            id="new-sheet"
            className="mt-2 flex flex-col gap-3 rounded-md border border-border p-3"
          >
            {experimentLocked ? (
              <Notice
                tone="warn"
                title={`${experiment.data?.identifier} is signed.`}
              >
                A signed notebook takes no new blocks. Amend it first, or create
                the sheet in the project instead.
              </Notice>
            ) : null}
            {search.dataset ? (
              datasetBlocked ? (
                <Notice
                  tone="warn"
                  title="No sheet definition can show a dataset yet."
                >
                  A sheet shows a dataset through a published sheet definition
                  that takes a dataset as an input, and none is published in
                  this workspace. A steward or admin can publish one; until then
                  you can start a blank sheet and bring the data in with a
                  definition later.
                </Notice>
              ) : (
                <Field
                  label="Sheet definition"
                  hint="Decides which of the dataset’s columns the sheet shows."
                >
                  <Select
                    value={option?.versionId ?? ''}
                    onChange={(e) => setOptionId(e.target.value)}
                    disabled={options.isPending}
                  >
                    {(options.data ?? []).map((o) => (
                      <option key={o.versionId} value={o.versionId}>
                        {o.definitionName} v{o.version}
                      </option>
                    ))}
                  </Select>
                </Field>
              )
            ) : null}
            <Field label="Project" required>
              <Select
                value={projectId}
                onChange={(e) => setChosenProject(e.target.value)}
              >
                <option value="">Choose a project…</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayId ? `${p.displayId} · ${p.title}` : p.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Name">
              <Input
                id="new-sheet-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={
                  !projectId ||
                  create.isPending ||
                  experimentLocked ||
                  (Boolean(search.dataset) && !option)
                }
                onClick={() => create.mutate()}
              >
                {search.dataset && option
                  ? 'Open dataset in a new sheet'
                  : 'Create blank sheet'}
              </Button>
              {hasContext ? (
                <Button nativeButton={false} render={<Link to={cancelTo} />}>
                  Cancel
                </Button>
              ) : null}
            </div>
            {datasetBlocked ? (
              <Muted>
                To start without the dataset, remove it from this page’s address
                or{' '}
                <Link
                  to="/sheets/new"
                  search={{ project: projectId || undefined }}
                  className="text-link"
                >
                  start a blank sheet
                </Link>
                .
              </Muted>
            ) : null}
          </div>

          <Muted>
            Sheets are private to the project and never count as evidence.
            Promote columns into a dataset when you want to keep them.
          </Muted>
        </div>
      </div>
    </div>
  )
}
