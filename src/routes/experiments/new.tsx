import { useMemo, useState } from 'react'
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'

import { PageHeader, Muted } from '#/components/ui/layout'
import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import type { PickerOption } from '#/components/record-picker/entity-picker'
import {
  personOption,
  projectOption,
  recordSearch,
} from '#/components/record-picker/entity-options'
import { Checkbox } from '#/components/ui/checkbox'
import {
  AddedFieldsFormSection,
  useAddedFieldDraft,
} from '#/components/models/added-fields'
import { toast } from '#/components/ui/sonner'
import {
  askedParameters,
  parameterInput,
} from '#/components/templates/templates-data'
import type { buildTemplateRows } from '#/components/templates/templates-data'
import { cancelTarget, parseCreateContext } from '#/lib/create-context-search'
import type { CreateContextSearch } from '#/lib/create-context-search'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { rich, t } from '#/copy'
import {
  FORM_READ_TIMEOUT_MS,
  useNewExperimentSources,
} from './-new-experiment-sources'
import type { ProjectOption } from './-new-experiment-sources'
import { runCreateExperiment } from './-new-experiment-create'
import type { CreatedExperiment } from './-new-experiment-create'

export { FORM_READ_TIMEOUT_MS }

/** Earlier experiments to copy from: searched on the server, not preloaded. */
const copyFromSearch = recordSearch(['Experiment'])

type StartFrom = 'blank' | 'protocol' | 'template'

/**
 * The refusal the create RPC actually returns, said in a way the author can
 * act on. A row-level-security rejection means the project is view-only for
 * this account (or the workspace role cannot create records there at all), so
 * it names the fix instead of printing the policy name.
 */
function createErrorMessage(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the create refusal is a caught throw, so it reaches this message untyped; `instanceof` below narrows it to its message.
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : ''

  if (/project is archived/i.test(message)) {
    return t('projects.newExperiment.errors.archived')
  }

  if (/row-level security|permission_denied|permission denied/i.test(message)) {
    return t('projects.newExperiment.errors.permission')
  }

  return message || t('projects.newExperiment.errors.generic')
}

/** A project is archived when either flag says so; the create RPC refuses both. */
function projectArchived(project: ProjectOption): boolean {
  return Boolean(project.archived_at) || project.status === 'archived'
}

/**
 * A project can hold a new experiment when the account can edit it and the
 * project is not archived. Until the permission read answers we do not know,
 * so every project counts as usable: the create states its own refusal
 * inline, which beats an inert form.
 */
function projectUsable(
  project: ProjectOption,
  writableProjectIds: ReadonlySet<string>,
  accessKnown: boolean,
): boolean {
  if (!accessKnown) return true

  return writableProjectIds.has(project.id) && !projectArchived(project)
}

/** The project the form creates in: the chosen one when usable, else the first that is. */
function usableProjectId(
  rows: ProjectOption[],
  canCreateIn: (project: ProjectOption) => boolean,
  chosenProject: ProjectOption | undefined,
): string {
  if (chosenProject && canCreateIn(chosenProject)) return chosenProject.id

  return rows.find((project) => canCreateIn(project))?.id ?? ''
}

/** What the project picker says while the reads settle. */
function projectPickerPlaceholder(state: {
  loading: boolean
  failed: boolean
  accessPending: boolean
  projectCount: number
}): string | undefined {
  if (state.loading) return t('projects.newExperiment.loadingProjects')

  if (state.failed) return t('projects.newExperiment.listUnavailable')

  if (state.accessPending) return t('projects.newExperiment.checkingAccess')

  if (state.projectCount === 0) return t('projects.newExperiment.noProjects')

  return undefined
}

/** The project picker's hint: said only when some project cannot be chosen. */
function projectPickerHint(
  rows: ProjectOption[],
  accessKnown: boolean,
  canCreateIn: (project: ProjectOption) => boolean,
): string | undefined {
  const refused = rows.some((project) => !canCreateIn(project))

  return accessKnown && refused
    ? t('projects.newExperiment.projectHint')
    : undefined
}

/** The project picker's options, naming why an unusable project is unusable. */
function projectPickerOptions(
  rows: ProjectOption[],
  canCreateIn: (project: ProjectOption) => boolean,
): PickerOption[] {
  return rows.map((project) =>
    projectOption(
      project,
      canCreateIn(project)
        ? null
        : projectArchived(project)
          ? t('projects.newExperiment.archived')
          : 'Read-only',
    ),
  )
}

/** The title's error, once the author has tried to submit. */
function titleErrorOf(touched: boolean, title: string): string | undefined {
  return touched && title.trim().length < 5
    ? t('projects.newExperiment.titleError')
    : undefined
}

/** The project's error, once the author has tried to submit. */
function projectErrorOf(
  touched: boolean,
  effectiveProjectId: string,
  rows: ProjectOption[],
): string | undefined {
  if (!touched || effectiveProjectId) return undefined

  return rows.length === 0
    ? t('projects.newExperiment.chooseProject')
    : t('projects.newExperiment.chooseEditable')
}

/**
 * UI port (roadmap-4/ui-app3): New experiment. app-3's form asks for a
 * reviewer, planned end and a protocol to follow; the ELN models an experiment
 * as a record with a project and a title, so only those are asked for and the
 * rest are stated as gaps. Creation uses the canonical
 * `create_record_with_blocks` RPC, so the new notebook opens on its own data.
 */
/** The toast title for a created experiment: started, or made as a draft. */
function createdTitle(result: CreatedExperiment): string {
  return result.started
    ? t('projects.newExperiment.started', {
        identifier: result.record.identifier,
      })
    : t('projects.newExperiment.created', {
        identifier: result.record.identifier,
      })
}

/** What the toast says under that title about the protocol and the start. */
function createdDescription(result: CreatedExperiment): string {
  if (result.protocolPinError) {
    return t('projects.newExperiment.pinFailed', {
      reason: result.protocolPinError,
    })
  }

  if (result.protocolInNotebook) return t('projects.newExperiment.pinned')

  if (result.started) return t('projects.newExperiment.opensOnNotebook')

  return t('projects.newExperiment.startLater')
}

/** The breadcrumb: under the project once one is usable, else under Experiments. */
function breadcrumbTrail(effectiveProject: ProjectOption | undefined) {
  if (!effectiveProject) {
    return [
      {
        label: t('projects.newExperiment.experiments'),
        link: { to: '/experiments' as const },
      },
      { label: t('projects.newExperiment.new') },
    ]
  }

  return [
    {
      label: t('projects.newExperiment.projects'),
      link: { to: '/projects' as const },
    },
    {
      label: effectiveProject.title,
      link: {
        to: '/projects/$projectId' as const,
        params: { projectId: effectiveProject.id },
      },
    },
    { label: t('projects.newExperiment.title') },
  ]
}

/** Protocol versions as the picker lists them, named after their protocol. */
function protocolOptionsOf(
  versions: Array<{ id: string; protocol_record_id: string; version: number }>,
  protocols: Array<{ id: string; identifier: string; title: string }>,
): PickerOption[] {
  return versions.map((version) => {
    const record = protocols.find(
      (candidate) => candidate.id === version.protocol_record_id,
    )

    return {
      id: version.id,
      identifier: record?.identifier,
      label: `${record?.title ?? t('projects.newExperiment.protocol')} · v${version.version}`,
      status: {
        tone: 'ok' as const,
        label: t('projects.newExperiment.label'),
      },
    }
  })
}

/** What the protocol picker says before a version is chosen. */
function protocolHintOf(
  effectiveProtocolVersionId: string,
  startNow: boolean,
): string {
  return effectiveProtocolVersionId && !startNow
    ? t('projects.newExperiment.protocolDraftHint')
    : t('projects.newExperiment.protocolPinnedHint')
}

/** What the template picker says while its list loads or is empty. */
function templatePlaceholderOf(
  loading: boolean,
  templateCount: number,
): string {
  if (loading) return t('projects.newExperiment.loadingTemplates')

  if (templateCount === 0) return t('projects.newExperiment.noTemplates')

  return t('projects.newExperiment.pickTemplate')
}

type TemplateRow = ReturnType<typeof buildTemplateRows>[number]

/** Published templates as the picker lists them. */
function templateOptionsOf(templates: TemplateRow[]): PickerOption[] {
  return templates.map((row) => ({
    id: row.id,
    label: row.name,
    detail: t('projects.newExperiment.detail', {
      version: row.published?.version ?? '',
    }),
  }))
}

/** One asked template parameter with what the author has typed for it. */
interface AskedParameterRow {
  id: string
  label: string
  value: string
  error: string | undefined
}

/** The template's asked parameters, with the values and errors the form shows. */
function askedParameterRowsOf(
  parameters: ReturnType<typeof askedParameters>,
  values: Record<string, string>,
  touched: boolean,
): AskedParameterRow[] {
  return parameters.map((parameter) => {
    const value = values[parameter.id] ?? ''
    const missing = parameterInput(parameter, value) === null

    return {
      id: parameter.id,
      label: parameter.label,
      value,
      error:
        touched && missing ? t('projects.newExperiment.needsValue') : undefined,
    }
  })
}

/** Where the new experiment starts: blank, a protocol's version, or a template. */
function StartFromFields({
  startFrom,
  onStartFrom,
  protocolHint,
  effectiveProtocolVersionId,
  protocolOptions,
  onProtocol,
  templateError,
  templatePlaceholder,
  templateId,
  templateOptions,
  onTemplate,
  templatesLoading,
  parameters,
  onParameter,
}: {
  startFrom: StartFrom
  onStartFrom: (value: StartFrom) => void
  protocolHint: string
  effectiveProtocolVersionId: string
  protocolOptions: PickerOption[]
  onProtocol: (id: string) => void
  templateError: string | undefined
  templatePlaceholder: string
  templateId: string
  templateOptions: PickerOption[]
  onTemplate: (id: string) => void
  templatesLoading: boolean
  parameters: AskedParameterRow[]
  onParameter: (id: string, value: string) => void
}) {
  return (
    <>
      <div
        role="group"
        aria-label={t('projects.newExperiment.startFrom')}
        className="flex flex-col gap-1.5"
      >
        <span className="text-label font-medium text-fg">
          {t('projects.newExperiment.startFrom')}
        </span>
        <div className="flex gap-1.5">
          {(
            [
              ['blank', t('projects.newExperiment.blank')],
              ['protocol', t('projects.newExperiment.aProtocol')],
              ['template', t('projects.newExperiment.aTemplate')],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={startFrom === value ? 'primary' : 'secondary'}
              aria-pressed={startFrom === value}
              onClick={() => onStartFrom(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      {startFrom === 'protocol' ? (
        <Field
          label={t('projects.newExperiment.protocolVersion')}
          hint={protocolHint}
        >
          <PickerSelect
            noun="protocol"
            value={effectiveProtocolVersionId}
            onChange={onProtocol}
            clearLabel="No protocol"
            options={protocolOptions}
          />
        </Field>
      ) : null}
      {startFrom === 'template' ? (
        <>
          <Field
            label={t('projects.newExperiment.template')}
            required
            error={templateError}
            hint={t('projects.newExperiment.templateHint')}
          >
            <PickerSelect
              noun="template"
              value={templateId}
              onChange={onTemplate}
              disabled={templatesLoading}
              placeholder={templatePlaceholder}
              options={templateOptions}
            />
          </Field>
          {parameters.map((parameter) => (
            <Field
              key={parameter.id}
              label={parameter.label}
              required
              error={parameter.error}
            >
              <Input
                value={parameter.value}
                onChange={(event) =>
                  onParameter(parameter.id, event.target.value)
                }
              />
            </Field>
          ))}
        </>
      ) : null}
    </>
  )
}

/** The reads behind the form, said at the foot of it so the author can retry. */
function FormNotes({
  createError,
  projectsLoading,
  projectsFailed,
  onRetryProjects,
  accessPending,
  accessFailed,
  onRetryAccess,
  noProjects,
  noUsableProject,
}: {
  createError: string | undefined
  projectsLoading: boolean
  projectsFailed: boolean
  onRetryProjects: () => void
  accessPending: boolean
  accessFailed: boolean
  onRetryAccess: () => void
  noProjects: boolean
  noUsableProject: boolean
}) {
  return (
    <>
      {createError ? (
        <p role="alert" className="m-0 text-label text-danger-text">
          {createError}
        </p>
      ) : null}
      {projectsLoading ? (
        <Muted>{t('projects.newExperiment.loadingNote')}</Muted>
      ) : null}
      {projectsFailed ? (
        <span className="flex items-center gap-2">
          <Muted>{t('projects.newExperiment.listFailed')}</Muted>
          <Button size="sm" variant="quiet" onClick={onRetryProjects}>
            {t('common.actions.tryAgain')}
          </Button>
        </span>
      ) : null}
      {accessPending ? (
        <Muted>{t('projects.newExperiment.checkingNote')}</Muted>
      ) : null}
      {accessFailed ? (
        <span className="flex items-center gap-2">
          <Muted>{t('projects.newExperiment.accessFailed')}</Muted>
          <Button size="sm" variant="quiet" onClick={onRetryAccess}>
            {t('common.actions.tryAgain')}
          </Button>
        </span>
      ) : null}
      {noProjects ? (
        <Muted>
          {rich('projects.newExperiment.needsProject', {
            link: (text) => (
              <Link to="/projects" search={{ new: true }} className="text-link">
                {text}
              </Link>
            ),
          })}
        </Muted>
      ) : null}
      {noUsableProject ? (
        <Muted>{t('projects.newExperiment.noUsable')}</Muted>
      ) : null}
    </>
  )
}

export const Route = createFileRoute('/experiments/new')({
  validateSearch: (
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack hands this hook the raw URL search object, which is unparsed by definition; `parseCreateContext` and the schemas below decode the keys this route owns.
    search: Record<string, unknown>,
  ): CreateContextSearch & {
    protocol?: string
    template?: string
    series?: string
  } => {
    const text = z.string().min(1).optional().catch(undefined)

    return {
      ...parseCreateContext(search),
      protocol: text.parse(search.protocol),
      template: text.parse(search.template),
      series: text.parse(search.series),
    }
  },
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: NewExperiment,
})

function NewExperiment() {
  const search = Route.useSearch()
  const navigate = useNavigate()

  const [startFrom, setStartFrom] = useState<StartFrom>(
    search.template ? 'template' : search.protocol ? 'protocol' : 'blank',
  )

  const sources = useNewExperimentSources({
    sampleId: search.sample,
    seriesId: search.series,
    templateWanted: startFrom === 'template',
  })

  const rows = sources.projects.data ?? []

  const { projects, assignments } = sources

  const [projectId, setProjectId] = useState(search.project ?? '')
  const [title, setTitle] = useState('')
  // null until the author chooses: until then the project's default reviewer
  // stands in, so the reviewer is chosen once and carried to Submit.
  const [reviewerId, setReviewerId] = useState<string | null>(null)
  const [plannedEnd, setPlannedEnd] = useState('')

  const [protocolVersionId, setProtocolVersionId] = useState('')
  const [templateId, setTemplateId] = useState(search.template ?? '')

  const [templateValues, setTemplateValues] = useState<Record<string, string>>(
    {},
  )

  const [startNow, setStartNow] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [copyFromId, setCopyFromId] = useState('')

  const [copyFromOption, setCopyFromOption] = useState<PickerOption | null>(
    null,
  )

  const [touched, setTouched] = useState(false)

  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  )

  const { members, protocols, protocolVersions, templates, sample, series } =
    sources

  // A protocol handed over by the page that linked here (`?protocol=<record>`)
  // selects its newest effective version once the versions load.
  const handedProtocolVersion = search.protocol
    ? (protocolVersions.data ?? []).find(
        (v) => v.protocol_record_id === search.protocol,
      )
    : undefined

  const effectiveProtocolVersionId =
    protocolVersionId || handedProtocolVersion?.id || ''

  const chosenProtocolVersion = (protocolVersions.data ?? []).find(
    (v) => v.id === effectiveProtocolVersionId,
  )

  const protocolId =
    startFrom === 'protocol'
      ? (chosenProtocolVersion?.protocol_record_id ?? '')
      : ''

  const chosenTemplate =
    startFrom === 'template'
      ? (templates.data ?? []).find((row) => row.id === templateId)
      : undefined

  const templateVersion = chosenTemplate?.published ?? null

  const askedTemplateParameters = templateVersion
    ? askedParameters(templateVersion)
    : []

  const missingTemplateParameters = askedTemplateParameters.filter(
    (p) => parameterInput(p, templateValues[p.id] ?? '') === null,
  )

  // Two independent reasons a project cannot take a new experiment: the
  // account cannot edit it, or the project is archived (`archive_project`
  // refuses every write under it — `internal.project_is_archived`). Both are
  // shown but neither is ever the default.
  const writableProjectIds = useMemo(
    () =>
      new Set(
        (assignments.data ?? [])
          .filter((assignment) => assignment.can_edit)
          .map((assignment) => assignment.project_id),
      ),
    [assignments.data],
  )

  const accessPending = assignments.isLoading
  const accessKnown = assignments.isSuccess

  const canCreateIn = (project: ProjectOption) =>
    projectUsable(project, writableProjectIds, accessKnown)

  const chosenProject = rows.find((project) => project.id === projectId)

  const effectiveProjectId = usableProjectId(rows, canCreateIn, chosenProject)

  const effectiveProject = rows.find((p) => p.id === effectiveProjectId)

  // A hand-off project that cannot take the experiment is replaced by the first
  // one that can; say so rather than creating it somewhere unannounced.
  const handedProject = search.project
    ? rows.find((project) => project.id === search.project)
    : undefined

  const projectReplaced =
    handedProject !== undefined &&
    !canCreateIn(handedProject) &&
    effectiveProject !== undefined &&
    effectiveProject.id !== handedProject.id

  const effectiveReviewerId =
    reviewerId ?? effectiveProject?.default_reviewer_user_id ?? ''

  const titleError = titleErrorOf(touched, title)

  const projectError = projectErrorOf(touched, effectiveProjectId, rows)

  const projectPlaceholder = projectPickerPlaceholder({
    loading: projects.isLoading,
    failed: projects.isError,
    accessPending,
    projectCount: rows.length,
  })

  const projectHint = projectPickerHint(rows, accessKnown, canCreateIn)

  const projectOptions = projectPickerOptions(rows, canCreateIn)

  // Starting from a protocol pins its version, and the server only starts an
  // experiment whose version the operator has acknowledged: ask for that here,
  // before anything is created, instead of leaving a draft behind a refusal.
  const needsAcknowledgement =
    startNow && startFrom === 'protocol' && Boolean(effectiveProtocolVersionId)

  const addedFields = useAddedFieldDraft('experiment')

  // The create answers by navigating to the new notebook, whose own reads are
  // made fresh; this screen holds no list of experiments to invalidate.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  const create = useMutation({
    mutationFn: () =>
      runCreateExperiment({
        projectId: effectiveProjectId,
        title: title.trim(),
        reviewerUserId: effectiveReviewerId,
        plannedEnd,
        startFrom,
        templateVersionRow: templateVersion,
        parameters: askedTemplateParameters,
        parameterValues: templateValues,
        acknowledgeProtocol: needsAcknowledgement,
        protocolVersionId: effectiveProtocolVersionId,
        protocolRecordId: protocolId,
        copyFromRecordId: copyFromId,
        sampleRecordId: sample.data?.id,
        seriesId: series.data?.id,
        startNow,
        idempotencyKey,
        addedFieldsTypeKey: addedFields.typeKey,
        addedFieldsPayload: () => addedFields.payload(),
      }),
    onSuccess: (result) => {
      if (result.seriesRefusal) toast.error(result.seriesRefusal)
      toast(createdTitle(result), { description: createdDescription(result) })
      void navigate({
        to: '/experiments/$expId/notebook',
        params: { expId: result.record.id },
      })
    },
    onError: (error) => {
      // A corrected form must not be answered with the earlier refusal.
      setIdempotencyKey(crypto.randomUUID())
      toast.error(createErrorMessage(error))
    },
  })

  const submit = () => {
    setTouched(true)

    if (accessPending || title.trim().length < 5 || !effectiveProjectId) return

    if (needsAcknowledgement && !acknowledged) return

    if (!addedFields.valid) return

    if (
      startFrom === 'template' &&
      (!templateVersion || missingTemplateParameters.length > 0)
    )
      return
    create.mutate()
  }

  const protocolOptions = protocolOptionsOf(
    protocolVersions.data ?? [],
    protocols.data ?? [],
  )

  const protocolHint = protocolHintOf(effectiveProtocolVersionId, startNow)

  const templatePlaceholder = templatePlaceholderOf(
    templates.isLoading,
    (templates.data ?? []).length,
  )

  const templateOptions = templateOptionsOf(templates.data ?? [])

  const parameterRows = askedParameterRowsOf(
    askedTemplateParameters,
    templateValues,
    touched,
  )

  const templateError =
    touched && !templateVersion
      ? t('projects.newExperiment.chooseTemplate')
      : undefined

  const createButtonLabel = create.isPending
    ? t('projects.newExperiment.creating')
    : startNow
      ? t('projects.newExperiment.createStart')
      : t('projects.newExperiment.createDraft')

  const trail = breadcrumbTrail(effectiveProject)

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader trail={trail} title={t('projects.newExperiment.title')} />
      <form
        className="flex w-full max-w-3xl flex-col gap-4 px-4 py-4 md:px-6"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field
          label={t('projects.newExperiment.project')}
          required
          error={projectError}
          hint={projectHint}
        >
          <PickerSelect
            noun="project"
            value={effectiveProjectId}
            onChange={(id) => setProjectId(id)}
            disabled={projects.isLoading || accessPending || rows.length === 0}
            placeholder={projectPlaceholder}
            options={projectOptions}
          />
        </Field>
        {projectReplaced ? (
          <Muted>
            {t('projects.newExperiment.replaced', {
              title: effectiveProject.title,
            })}
          </Muted>
        ) : null}
        {series.data ? (
          <Muted>
            {t('projects.newExperiment.joinsSeries', {
              identifier: series.data.identifier,
              title: series.data.title,
            })}
          </Muted>
        ) : null}
        {sample.data ? (
          <Muted>
            {t('projects.newExperiment.sampleLinked', {
              identifier: sample.data.identifier,
              title: sample.data.title,
            })}
          </Muted>
        ) : null}
        <Field
          label={t('projects.newExperiment.titleLabel')}
          required
          error={titleError}
          hint={t('projects.newExperiment.titleHint')}
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            aria-invalid={Boolean(titleError) || undefined}
          />
        </Field>
        <Field
          label={t('projects.newExperiment.reviewer')}
          hint={
            reviewerId === null && effectiveReviewerId
              ? t('projects.newExperiment.reviewerDefault')
              : t('projects.newExperiment.reviewerHint')
          }
        >
          <PickerSelect
            noun="person"
            value={effectiveReviewerId}
            onChange={(id) => setReviewerId(id)}
            clearLabel="No reviewer yet"
            options={(members.data ?? []).map((m) =>
              personOption(m.user_id, m.name, m.role),
            )}
          />
        </Field>
        <Field
          label={t('projects.newExperiment.plannedEnd')}
          hint={t('projects.newExperiment.plannedEndHint')}
        >
          <Input
            type="date"
            value={plannedEnd}
            onChange={(e) => setPlannedEnd(e.target.value)}
          />
        </Field>
        <AddedFieldsFormSection draft={addedFields} showErrors={touched} />
        <StartFromFields
          startFrom={startFrom}
          onStartFrom={setStartFrom}
          protocolHint={protocolHint}
          effectiveProtocolVersionId={effectiveProtocolVersionId}
          protocolOptions={protocolOptions}
          onProtocol={(id) => {
            setProtocolVersionId(id)
            setAcknowledged(false)
          }}
          templateError={templateError}
          templatePlaceholder={templatePlaceholder}
          templateId={templateId}
          templateOptions={templateOptions}
          onTemplate={(id) => {
            setTemplateId(id)
            setTemplateValues({})
            setIdempotencyKey(crypto.randomUUID())
          }}
          templatesLoading={templates.isLoading}
          parameters={parameterRows}
          onParameter={(id, value) =>
            setTemplateValues((current) => ({ ...current, [id]: value }))
          }
        />
        <label className="flex cursor-pointer items-center gap-2 text-label">
          <Checkbox
            checked={startNow}
            onCheckedChange={(on) => setStartNow(Boolean(on))}
          />
          {t('projects.newExperiment.startNow')}
        </label>
        {needsAcknowledgement ? (
          <Field
            label={t('projects.newExperiment.acknowledgement')}
            error={
              touched && !acknowledged
                ? t('projects.newExperiment.acknowledgeError')
                : undefined
            }
          >
            <label className="flex cursor-pointer items-center gap-2 text-label">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(on) => setAcknowledged(Boolean(on))}
              />
              {t('projects.newExperiment.acknowledge')}
            </label>
          </Field>
        ) : null}
        <Field
          label={t('projects.newExperiment.copyFrom')}
          hint={t('projects.newExperiment.copyHint')}
        >
          <PickerSelect
            noun="experiment"
            value={copyFromId}
            onChange={(id, option) => {
              setCopyFromId(id)
              setCopyFromOption(option)
            }}
            selected={copyFromOption}
            clearLabel="Nothing"
            search={copyFromSearch}
          />
        </Field>
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={create.isPending || accessPending || !effectiveProjectId}
          >
            {createButtonLabel}
          </Button>
          <Button
            nativeButton={false}
            render={<Link to={cancelTarget(search, '/experiments')} />}
          >
            {t('common.actions.cancel')}
          </Button>
        </div>
        <FormNotes
          createError={
            create.error ? createErrorMessage(create.error) : undefined
          }
          projectsLoading={projects.isLoading}
          projectsFailed={projects.isError}
          onRetryProjects={() => void projects.refetch()}
          accessPending={accessPending}
          accessFailed={assignments.isError}
          onRetryAccess={() => void assignments.refetch()}
          noProjects={
            rows.length === 0 && !projects.isLoading && !projects.isError
          }
          noUsableProject={
            accessKnown && rows.length > 0 && !effectiveProjectId
          }
        />
      </form>
    </div>
  )
}
