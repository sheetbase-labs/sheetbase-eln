import { t } from '#/copy'
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { useRef, useState } from 'react'
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
import { Checkbox } from '#/components/v3/ui/checkbox'
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
    title: t('notebook.sheetsNew.title'),
    body: t('notebook.sheetsNew.body'),
    to: '/datasets' as const,
  },
  {
    icon: 'template' as const,
    title: t('notebook.sheetsNew.fromATemplateTitle'),
    body: t('notebook.sheetsNew.body2'),
    to: '/templates' as const,
  },
  {
    icon: 'upload' as const,
    title: t('notebook.sheetsNew.pasteATableTitle'),
    body: t('notebook.sheetsNew.body3'),
    blank: true,
    paste: true,
    to: '/sheets/new' as const,
  },
  {
    icon: 'table' as const,
    title: t('notebook.sheetsNew.blankSheetTitle'),
    body: t('notebook.sheetsNew.body4'),
    blank: true,
    to: '/sheets/new' as const,
  },
]

function NewSheet() {
  const formRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
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
    queryKey: [
      'ui-port',
      'sheets',
      'new',
      'dataset-sheet-options',
      search.dataset,
    ],
    enabled: Boolean(search.dataset),
    queryFn: () =>
      fetchDatasetSheetOptions(notebookDataClient, search.dataset!),
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
  // Set by the Paste a table start: the new sheet opens its Paste data dialog.
  const [pasteFirst, setPasteFirst] = useState(false)
  const [optionId, setOptionId] = useState('')
  const option =
    (options.data ?? []).find(
      (o) =>
        o.versionId === optionId &&
        o.datasetParameterId &&
        !o.unavailableReason,
    ) ??
    (options.data ?? []).find(
      (o) => o.datasetParameterId && !o.unavailableReason,
    )
  const datasetLabel = dataset.data
    ? (dataset.data.display_id ?? dataset.data.name)
    : null
  const experimentLocked = Boolean(experiment.data?.locked_at)

  const land = (sheetId: string) =>
    navigate({
      to: '/sheets/$sheetId',
      params: { sheetId },
      search: {
        projectId,
        paste: pasteFirst && !search.dataset ? true : undefined,
      },
    })

  const create = useMutation({
    mutationFn: async () => {
      const notebook = experiment.data?.id ?? null
      const sheetName = name.trim() || t('notebook.sheetsNew.untitledSheet')
      if (search.dataset && !option)
        throw new Error(t('notebook.sheetsNew.chooseACompatibleSheet'))
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
      toast(t('notebook.sheetsNew.sheetCreated'), {
        description: experiment.data
          ? inNotebook
            ? t('notebook.sheetsNew.description', {
                identifier: experiment.data.identifier,
              })
            : t('notebook.sheetsNew.itBelongsToIdentifierDescription', {
                identifier: experiment.data.identifier,
              })
          : datasetLabel && search.dataset
            ? t('notebook.sheetsNew.datasetlabelIsOpenInDescription', {
                datasetLabel,
              })
            : t('notebook.sheetsNew.bringInDataYouDescription'),
      })
      await land(instance.id)
    },
    onError: (error: unknown) =>
      toast(t('notebook.sheetsNew.couldNotCreateThe'), {
        description:
          error instanceof Error
            ? error.message
            : t('notebook.sheetsNew.theDatabaseRefusedItDescription'),
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
        title={t('notebook.sheetsNew.newSheetTitle')}
        meta={<span>{t('notebook.sheetsNew.combineDatasetColumnsAnd')}</span>}
      />
      <div className="flex justify-center px-4 pb-8 pt-8 md:px-6">
        <div className="flex w-[560px] max-w-full flex-col gap-3.5">
          {hasContext ? (
            <Notice
              tone="info"
              title={t('notebook.sheetsNew.startingFromWhereYouTitle')}
            >
              <ul className="m-0 list-none space-y-0.5 p-0">
                {experiment.data ? (
                  <li>
                    {t('notebook.sheetsNew.inNotebook')}
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
                    {t('notebook.sheetsNew.showingDataset')}
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
                    {t('notebook.sheetsNew.inProject')}
                    <ObjectLink
                      kind="project"
                      id={projectId}
                      identifier={
                        (projects.data ?? []).find((p) => p.id === projectId)
                          ?.displayId ?? t('notebook.sheetsNew.thisProject')
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
                title={t('notebook.sheetsNew.thisSheetIsEmptyTitle')}
                description={t('notebook.sheetsNew.aWorkingSheetIsDescription')}
                className="py-0"
              />
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {starts.map((o) =>
                  'blank' in o && o.blank ? (
                    <button
                      key={o.title}
                      type="button"
                      onClick={() => {
                        setPasteFirst('paste' in o && o.paste === true)
                        formRef.current?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'start',
                        })
                        nameRef.current?.focus()
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
            ref={formRef}
            className="mt-2 flex flex-col gap-3 rounded-md border border-border p-3"
          >
            {experimentLocked ? (
              <Notice
                tone="warn"
                title={t('notebook.sheetsNew.identifierIsSignedTitle', {
                  identifier: experiment.data?.identifier ?? '',
                })}
              >
                {t('notebook.sheetsNew.aSignedNotebookTakes')}
              </Notice>
            ) : null}
            {search.dataset ? (
              options.isError ? (
                <Notice
                  tone="bad"
                  title={t(
                    'notebook.sheetsNew.sheetCompatibilityCouldNotTitle',
                  )}
                  action={
                    <Button onClick={() => void options.refetch()}>
                      {t('common.actions.tryAgain')}
                    </Button>
                  }
                >
                  {t('notebook.sheetsNew.checkYourWorkspaceAccess')}
                </Notice>
              ) : datasetBlocked ? (
                <Notice
                  tone="warn"
                  title={t(
                    'notebook.sheetsNew.noCompatibleSheetDefinitionTitle',
                  )}
                >
                  {t('notebook.sheetsNew.publishedDefinitionMustAccept')}
                  {options.data.map((o) => (
                    <p key={o.versionId}>
                      {o.definitionName}: {o.unavailableReason}
                    </p>
                  ))}
                </Notice>
              ) : (
                <Field
                  label={t('notebook.sheetsNew.label')}
                  hint={t('notebook.sheetsNew.hint')}
                >
                  <Select
                    value={option?.versionId ?? ''}
                    onChange={(e) => setOptionId(e.target.value)}
                    disabled={options.isPending}
                  >
                    {(options.data ?? []).map((o) => (
                      <option
                        key={o.versionId}
                        value={o.versionId}
                        disabled={
                          Boolean(o.unavailableReason) || !o.datasetParameterId
                        }
                      >
                        {o.definitionName} v{o.version}
                        {o.unavailableReason ? ` — ${o.unavailableReason}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              )
            ) : null}
            <Field label="Project" required>
              <PickerSelect
                noun="project"
                value={projectId}
                onChange={(id) => setChosenProject(id)}
                options={(projects.data ?? []).map((p) => ({
                  id: p.id,
                  identifier: p.displayId ?? undefined,
                  label: p.title,
                }))}
              />
            </Field>
            <Field label={t('notebook.sheetsNew.nameLabel')}>
              <Input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            {search.dataset ? null : (
              <label className="flex items-center gap-2 text-label">
                <Checkbox
                  aria-label={t('notebook.sheetsNew.ariaLabel')}
                  checked={pasteFirst}
                  onCheckedChange={(on) => setPasteFirst(Boolean(on))}
                />
                {t('notebook.sheetsNew.pasteATableInto')}
              </label>
            )}
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
                  ? t('notebook.sheetsNew.openDatasetInA')
                  : pasteFirst
                    ? t('notebook.sheetsNew.createSheetAndPaste')
                    : t('notebook.sheetsNew.createBlankSheet')}
              </Button>
              {hasContext ? (
                <Button nativeButton={false} render={<Link to={cancelTo} />}>
                  {t('common.actions.cancel')}
                </Button>
              ) : null}
            </div>
            {create.isError ? (
              <Notice
                tone="bad"
                title={t('notebook.sheetsNew.sheetCouldNotBeTitle')}
              >
                {create.error instanceof Error
                  ? create.error.message
                  : t('notebook.sheetsNew.theDatabaseRefusedTo')}
              </Notice>
            ) : null}
            {datasetBlocked ? (
              <Muted>
                {t('notebook.sheetsNew.toStartWithoutThe')}
                <Link
                  to="/sheets/new"
                  search={{ project: projectId || undefined }}
                  className="text-link"
                >
                  {t('notebook.sheetsNew.startABlankSheet')}
                </Link>
                .
              </Muted>
            ) : null}
          </div>

          <Muted>{t('notebook.sheetsNew.sheetsKeepLocalChanges')}</Muted>
        </div>
      </div>
    </div>
  )
}
