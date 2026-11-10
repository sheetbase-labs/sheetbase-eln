import { t } from '#/copy'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { useRef, useState } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'

import { PageHeader, Muted } from '#/components/ui/layout'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { Checkbox } from '#/components/ui/checkbox'
import { Select } from '#/components/ui/select'
import { EmptyState } from '#/components/ui/empty-state'
import { ObjectLink } from '#/components/ui/object-link'
import { toast } from '#/components/ui/sonner'
import { Icon } from '#/components/icons'
import { createAdHocSheetInstance } from '#/lib/sheet-instance-data'
import type { SheetInstanceState } from '#/lib/sheet-instance'
import { fetchProjectSummaries } from '#/components/projects/project-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { insertSheetInstanceBlock } from '#/lib/notebook-mutations'
import {
  fetchDatasetSheetOptions,
  openDatasetInSheet,
} from '#/lib/sheet-from-dataset'
import type { DatasetSheetOption } from '#/lib/sheet-from-dataset'
import type { ProjectSummary } from '#/components/projects/project-data'
import type { UseQueryResult } from '@tanstack/react-query'
import { cancelTarget, parseCreateContext } from '#/lib/create-context-search'
import type { CreateContextSearch } from '#/lib/create-context-search'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** A new working sheet. It takes the shared create-context params, so a page
 * that links here hands over what it is about: `project` picks the project,
 * `experiment` puts the sheet in that notebook, `dataset` opens that dataset in
 * the sheet, and `returnTo` is where Cancel goes. The sheet is created through
 * the canonical RPCs and the person lands on it. */
export const Route = createFileRoute('/sheets/new')({
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack Router hands validateSearch the raw URL values as Record<string, unknown>; parseCreateContext decodes every value before use.
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

/** The notebook a link handed over, as this screen reads it. */
type NewSheetExperiment = {
  id: string
  identifier: string
  title: string
  project_id: string | null
  locked_at: string | null
}

/** The dataset a link handed over, as this screen reads it. */
type NewSheetDataset = {
  id: string
  name: string
  display_id: string | null
  primary_project_id: string | null
}

/** One blank-sheet start the screen offers. */
type SheetStart = (typeof starts)[number]

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
  const impliedProject = impliedProjectOf(search, experiment.data, dataset.data)

  const [chosenProject, setChosenProject] = useState<string | null>(null)
  const projectId = chosenProject ?? impliedProject
  const [name, setName] = useState('Untitled sheet')
  // Set by the Paste a table start: the new sheet opens its Paste data dialog.
  const [pasteFirst, setPasteFirst] = useState(false)
  const [optionId, setOptionId] = useState('')

  const option = chosenDatasetOption(options.data, optionId)
  const datasetLabel = datasetLabelOf(dataset.data)

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

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- The flow lands on the sheet it just created, so no list is left on screen; every other sheet list reads its own key when it next mounts.
  const create = useMutation({
    mutationFn: () =>
      createSheet({
        workspaceId,
        name: name.trim(),
        datasetId: search.dataset,
        option,
        projectId,
        notebookRecordId: experiment.data?.id ?? null,
      }),
    onSuccess: async (instance) => {
      const inNotebook = await attachToNotebook(experiment.data, instance.id)

      toast(t('notebook.sheetsNew.sheetCreated'), {
        description: createdDescription({
          experiment: experiment.data,
          datasetLabel,
          datasetId: search.dataset,
          inNotebook,
        }),
      })
      await land(instance.id)
    },
    onError: (error) =>
      toast(t('notebook.sheetsNew.couldNotCreateThe'), {
        description:
          error instanceof Error
            ? error.message
            : t('notebook.sheetsNew.theDatabaseRefusedItDescription'),
      }),
  })

  const datasetBlocked = Boolean(search.dataset) && options.isSuccess && !option
  const cancelTo = cancelTarget(search, '/sheets/new')
  const hasContext = hasCreateContext(search)

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        title={t('notebook.sheetsNew.newSheetTitle')}
        meta={<span>{t('notebook.sheetsNew.combineDatasetColumnsAnd')}</span>}
      />
      <div className="flex justify-center px-4 pb-8 pt-8 md:px-6">
        <div className="flex w-[560px] max-w-full flex-col gap-3.5">
          {hasContext ? (
            <NewSheetContext
              experiment={experiment.data}
              dataset={dataset.data}
              datasetLabel={datasetLabel}
              projectId={projectId}
              projects={projects.data}
            />
          ) : (
            <SheetStarts
              onStart={(start) => {
                setPasteFirst('paste' in start && start.paste === true)
                formRef.current?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                })
                nameRef.current?.focus()
              }}
            />
          )}

          <CreateSheetForm
            formRef={formRef}
            nameRef={nameRef}
            experimentLocked={experimentLocked}
            experimentIdentifier={experiment.data?.identifier}
            datasetOption={{
              required: Boolean(search.dataset),
              options,
              blocked: datasetBlocked,
              chosen: option,
              onChoose: setOptionId,
            }}
            projectId={projectId}
            onChooseProject={setChosenProject}
            projects={projects.data}
            name={name}
            onName={setName}
            offerPaste={!search.dataset}
            pasteFirst={pasteFirst}
            onPasteFirst={setPasteFirst}
            datasetOpen={Boolean(search.dataset) && Boolean(option)}
            isPending={create.isPending}
            isError={create.isError}
            error={create.error}
            onCreate={() => create.mutate()}
            cancelTo={hasContext ? cancelTo : undefined}
          />

          <Muted>{t('notebook.sheetsNew.sheetsKeepLocalChanges')}</Muted>
        </div>
      </div>
    </div>
  )
}

/** The banner naming the notebook, dataset or project a link handed over. */
function NewSheetContext({
  experiment,
  dataset,
  datasetLabel,
  projectId,
  projects,
}: {
  experiment: NewSheetExperiment | undefined
  dataset: NewSheetDataset | undefined
  datasetLabel: string | null
  projectId: string
  projects: ProjectSummary[] | undefined
}) {
  return (
    <Notice
      tone="info"
      title={t('notebook.sheetsNew.startingFromWhereYouTitle')}
    >
      <ul className="m-0 list-none space-y-0.5 p-0">
        {experiment ? (
          <li>
            {t('notebook.sheetsNew.inNotebook')}
            <ObjectLink
              kind="experiment"
              id={experiment.id}
              identifier={experiment.identifier}
            />{' '}
            {experiment.title}
          </li>
        ) : null}
        {dataset ? (
          <li>
            {t('notebook.sheetsNew.showingDataset')}
            <ObjectLink
              kind="dataset"
              id={dataset.id}
              identifier={datasetLabel}
            />{' '}
            {dataset.name}
          </li>
        ) : null}
        {projectId && !experiment && !dataset ? (
          <li>
            {t('notebook.sheetsNew.inProject')}
            <ObjectLink
              kind="project"
              id={projectId}
              identifier={
                (projects ?? []).find((p) => p.id === projectId)?.displayId ??
                t('notebook.sheetsNew.thisProject')
              }
            />
          </li>
        ) : null}
      </ul>
    </Notice>
  )
}

/** The blank-sheet starts a person can pick from when no context came in. */
function SheetStarts({ onStart }: { onStart: (start: SheetStart) => void }) {
  return (
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
              onClick={() => onStart(o)}
              className="flex min-h-14 cursor-pointer gap-2.5 rounded-md border border-border bg-surface p-3 text-left text-fg hover:bg-surface-hover"
            >
              <span className="mt-px shrink-0 text-fg-muted">
                <Icon name={o.icon} size={16} />
              </span>
              <span>
                <b className="block font-medium">{o.title}</b>
                <span className="text-caption text-fg-muted">{o.body}</span>
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
                <span className="text-caption text-fg-muted">{o.body}</span>
              </span>
            </Link>
          ),
        )}
      </div>
    </>
  )
}

/** The sheet-definition choice a dataset brings, or why it cannot open here. */
function DatasetSheetOption({
  required,
  options,
  blocked,
  chosen,
  onChoose,
}: {
  required: boolean
  options: UseQueryResult<DatasetSheetOption[]>
  blocked: boolean
  chosen: DatasetSheetOption | undefined
  onChoose: (versionId: string) => void
}) {
  if (!required) return null

  if (options.isError)
    return (
      <Notice
        tone="bad"
        title={t('notebook.sheetsNew.sheetCompatibilityCouldNotTitle')}
        action={
          <Button onClick={() => void options.refetch()}>
            {t('common.actions.tryAgain')}
          </Button>
        }
      >
        {t('notebook.sheetsNew.checkYourWorkspaceAccess')}
      </Notice>
    )

  if (blocked)
    return (
      <Notice
        tone="warn"
        title={t('notebook.sheetsNew.noCompatibleSheetDefinitionTitle')}
      >
        {t('notebook.sheetsNew.publishedDefinitionMustAccept')}
        {(options.data ?? []).map((o) => (
          <p key={o.versionId}>
            {o.definitionName}: {o.unavailableReason}
          </p>
        ))}
      </Notice>
    )

  return (
    <Field
      label={t('notebook.sheetsNew.label')}
      hint={t('notebook.sheetsNew.hint')}
    >
      <Select
        value={chosen?.versionId ?? ''}
        onChange={(e) => onChoose(e.target.value)}
        disabled={options.isPending}
      >
        {(options.data ?? []).map((o) => (
          <option
            key={o.versionId}
            value={o.versionId}
            disabled={Boolean(o.unavailableReason) || !o.datasetParameterId}
          >
            {o.definitionName} v{o.version}
            {o.unavailableReason ? ` — ${o.unavailableReason}` : ''}
          </option>
        ))}
      </Select>
    </Field>
  )
}

/** The create form: what the sheet is called, where it lives and how it starts. */
function CreateSheetForm({
  formRef,
  nameRef,
  experimentLocked,
  experimentIdentifier,
  datasetOption,
  projectId,
  onChooseProject,
  projects,
  name,
  onName,
  offerPaste,
  pasteFirst,
  onPasteFirst,
  datasetOpen,
  isPending,
  isError,
  error,
  onCreate,
  cancelTo,
}: {
  formRef: React.RefObject<HTMLDivElement | null>
  nameRef: React.RefObject<HTMLInputElement | null>
  experimentLocked: boolean
  experimentIdentifier: string | undefined
  datasetOption: {
    required: boolean
    options: UseQueryResult<DatasetSheetOption[]>
    blocked: boolean
    chosen: DatasetSheetOption | undefined
    onChoose: (versionId: string) => void
  }
  projectId: string
  onChooseProject: (id: string) => void
  projects: ProjectSummary[] | undefined
  name: string
  onName: (name: string) => void
  offerPaste: boolean
  pasteFirst: boolean
  onPasteFirst: (on: boolean) => void
  datasetOpen: boolean
  isPending: boolean
  isError: boolean
  error: Error | null
  onCreate: () => void
  cancelTo: string | undefined
}) {
  return (
    <div
      ref={formRef}
      className="mt-2 flex flex-col gap-3 rounded-md border border-border p-3"
    >
      {experimentLocked ? (
        <Notice
          tone="warn"
          title={t('notebook.sheetsNew.identifierIsSignedTitle', {
            identifier: experimentIdentifier ?? '',
          })}
        >
          {t('notebook.sheetsNew.aSignedNotebookTakes')}
        </Notice>
      ) : null}
      <DatasetSheetOption
        required={datasetOption.required}
        options={datasetOption.options}
        blocked={datasetOption.blocked}
        chosen={datasetOption.chosen}
        onChoose={datasetOption.onChoose}
      />
      <Field label={t('notebook.sheetsNew.projectLabel')} required>
        <PickerSelect
          noun="project"
          value={projectId}
          onChange={onChooseProject}
          options={(projects ?? []).map((p) => ({
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
          onChange={(e) => onName(e.target.value)}
        />
      </Field>
      {!offerPaste ? null : (
        <label className="flex items-center gap-2 text-label">
          <Checkbox
            aria-label={t('notebook.sheetsNew.ariaLabel')}
            checked={pasteFirst}
            onCheckedChange={(on) => onPasteFirst(Boolean(on))}
          />
          {t('notebook.sheetsNew.pasteATableInto')}
        </label>
      )}
      <CreateSheetActions
        projectId={projectId}
        isPending={isPending}
        experimentLocked={experimentLocked}
        needsOption={datasetOption.required && !datasetOption.chosen}
        label={actionLabel({ datasetOpen, pasteFirst })}
        onCreate={onCreate}
        cancelTo={cancelTo}
        error={isError ? error : null}
        blocked={datasetOption.blocked}
      />
    </div>
  )
}

/** What the form asked for, decoded: the sheet's name, place and starting data. */
type CreateSheetInput = {
  workspaceId: string
  name: string
  datasetId: string | undefined
  option: DatasetSheetOption | undefined
  projectId: string
  notebookRecordId: string | null
}

/** Create the sheet the form described: from the chosen dataset, or blank. */
async function createSheet(input: CreateSheetInput) {
  const sheetName = input.name.trim() || t('notebook.sheetsNew.untitledSheet')

  if (input.datasetId && !input.option)
    throw new Error(t('notebook.sheetsNew.chooseACompatibleSheet'))

  if (input.datasetId && input.option) {
    return openDatasetInSheet(notebookDataClient, {
      workspaceId: input.workspaceId,
      name: sheetName,
      option: input.option,
      datasetId: input.datasetId,
      projectId: input.projectId || null,
      notebookRecordId: input.notebookRecordId,
    })
  }

  return createAdHocSheetInstance({
    workspaceId: input.workspaceId,
    name: sheetName,
    projectId: input.projectId,
    notebookRecordId: input.notebookRecordId,
    state: blankState(),
  })
}

/** Put the new sheet in the notebook it was started from, when there is one. */
async function attachToNotebook(
  experiment: NewSheetExperiment | null | undefined,
  instanceId: string,
): Promise<boolean> {
  if (!experiment) return false

  try {
    await insertSheetInstanceBlock(notebookDataClient, {
      recordId: experiment.id,
      instanceId,
    })

    return true
  } catch {
    return false
  }
}

/** The toast's second line: where the sheet went and what it holds. */
function createdDescription({
  experiment,
  datasetLabel,
  datasetId,
  inNotebook,
}: {
  experiment: NewSheetExperiment | null | undefined
  datasetLabel: string | null
  datasetId: string | undefined
  inNotebook: boolean
}): string {
  if (experiment)
    return inNotebook
      ? t('notebook.sheetsNew.description', {
          identifier: experiment.identifier,
        })
      : t('notebook.sheetsNew.itBelongsToIdentifierDescription', {
          identifier: experiment.identifier,
        })

  if (datasetLabel && datasetId)
    return t('notebook.sheetsNew.datasetlabelIsOpenInDescription', {
      datasetLabel,
    })

  return t('notebook.sheetsNew.bringInDataYouDescription')
}

/** The sheet-definition option the form starts on: the chosen one, else the first usable. */
function chosenDatasetOption(
  options: readonly DatasetSheetOption[] | undefined,
  optionId: string,
): DatasetSheetOption | undefined {
  const usable = (option: DatasetSheetOption) =>
    Boolean(option.datasetParameterId) && !option.unavailableReason

  const chosen = (options ?? []).find(
    (option) => option.versionId === optionId && usable(option),
  )

  return chosen ?? (options ?? []).find(usable)
}

/** The dataset's display label, or nothing when no dataset came with the link. */
function datasetLabelOf(
  dataset: NewSheetDataset | null | undefined,
): string | null {
  if (!dataset) return null

  return dataset.display_id ?? dataset.name
}

/** The project a handed-over context implies, until the person picks another. */
function impliedProjectOf(
  search: CreateContextSearch,
  experiment: NewSheetExperiment | null | undefined,
  dataset: NewSheetDataset | null | undefined,
): string {
  return (
    search.project ??
    experiment?.project_id ??
    dataset?.primary_project_id ??
    ''
  )
}

/** Whether a link handed over a project, notebook or dataset to start from. */
function hasCreateContext(search: CreateContextSearch): boolean {
  return Boolean(search.project || search.experiment || search.dataset)
}

/** The create button's words: what the sheet will be and where it comes from. */
function actionLabel({
  datasetOpen,
  pasteFirst,
}: {
  datasetOpen: boolean
  pasteFirst: boolean
}): string {
  if (datasetOpen) return t('notebook.sheetsNew.openDatasetInA')

  return pasteFirst
    ? t('notebook.sheetsNew.createSheetAndPaste')
    : t('notebook.sheetsNew.createBlankSheet')
}

/** The form's buttons, the create failure and the way out of a blocked dataset. */
function CreateSheetActions({
  projectId,
  isPending,
  experimentLocked,
  needsOption,
  label,
  onCreate,
  cancelTo,
  error,
  blocked,
}: {
  projectId: string
  isPending: boolean
  experimentLocked: boolean
  needsOption: boolean
  label: string
  onCreate: () => void
  cancelTo: string | undefined
  error: Error | null
  blocked: boolean
}) {
  return (
    <>
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={!projectId || isPending || experimentLocked || needsOption}
          onClick={() => onCreate()}
        >
          {label}
        </Button>
        {cancelTo ? (
          <Button nativeButton={false} render={<Link to={cancelTo} />}>
            {t('common.actions.cancel')}
          </Button>
        ) : null}
      </div>
      {error ? (
        <Notice tone="bad" title={t('notebook.sheetsNew.sheetCouldNotBeTitle')}>
          {error.message}
        </Notice>
      ) : null}
      {blocked ? (
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
    </>
  )
}
