import { useMemo, useState } from 'react'
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'

import { PageHeader, Muted } from '#/components/v3/ui/layout'
import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import type { PickerOption } from '#/components/v3/record-picker/entity-picker'
import {
  personOption,
  projectOption,
  recordSearch,
} from '#/components/v3/record-picker/entity-options'
import { Checkbox } from '#/components/v3/ui/checkbox'
import {
  AddedFieldsFormSection,
  useAddedFieldDraft,
} from '#/components/v3/models/added-fields'
import { requireBuiltInModel } from '#/lib/built-in-models'
import { saveNewObjectFields } from '#/lib/model-subtypes'
import { toast } from '#/components/v3/ui/sonner'
import {
  askedParameters,
  parameterInput,
} from '#/components/v3/templates/use-template-dialog'
import { buildTemplateRows } from '#/components/v3/templates/templates-data'
import { acknowledgeProtocolVersion } from '#/lib/controlled-protocols'
import {
  applyExperimentSetup,
  createBlankExperiment,
  insertPinnedProtocol,
} from '#/lib/notebook-create'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchAllNotebookTemplateVersions,
  fetchNotebookTemplates,
  instantiateNotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import type { NotebookTemplateParameterInput } from '#/lib/notebook-template-data'
import { cancelTarget, parseCreateContext } from '#/lib/create-context-search'
import type { CreateContextSearch } from '#/lib/create-context-search'
import { fetchMyProjectAssignments } from '#/lib/workspace-access'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { rich, t } from '#/copy'

/** One project as the picker needs it: its access is resolved separately. */
interface ProjectOption {
  id: string
  title: string
  archived_at: string | null
  status: string
  default_reviewer_user_id?: string | null
}

/** Earlier experiments to copy from: searched on the server, not preloaded. */
const copyFromSearch = recordSearch(['Experiment'])

type StartFrom = 'blank' | 'protocol' | 'template'

/**
 * How long the form waits for the reads that gate the picker. The form cannot
 * stay inert on a read that never settles — a stalled request, a hydration
 * mismatch or a dead proxy all look identical to the author — so past the
 * deadline the form states the failure and offers a retry.
 */
export const FORM_READ_TIMEOUT_MS = 10_000

/** Reject when `read` has not answered within the form's budget. */
function withDeadline<T>(read: Promise<T>, label: string): Promise<T> {
  // Executor form: tsconfig lib predates Promise.withResolvers (ES2024).
  const deadline = new Promise<never>((_resolve, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            t('projects.newExperiment.timeout', {
              label,
              seconds: FORM_READ_TIMEOUT_MS / 1000,
            }),
          ),
        ),
      FORM_READ_TIMEOUT_MS,
    )
  })
  // The losing side is handled by `race`, so a late rejection is never
  // unhandled — and a settled read leaves only one idle timer behind.
  return Promise.race([read, deadline])
}

/**
 * The refusal the create RPC actually returns, said in a way the author can
 * act on. A row-level-security rejection means the project is view-only for
 * this account (or the workspace role cannot create records there at all), so
 * it names the fix instead of printing the policy name.
 */
function createErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/project is archived/i.test(message)) {
    return t('projects.newExperiment.errors.archived')
  }
  if (/row-level security|permission_denied|permission denied/i.test(message)) {
    return t('projects.newExperiment.errors.permission')
  }
  return message || t('projects.newExperiment.errors.generic')
}

/**
 * UI port (roadmap-4/ui-app3): New experiment. app-3's form asks for a
 * reviewer, planned end and a protocol to follow; the ELN models an experiment
 * as a record with a project and a title, so only those are asked for and the
 * rest are stated as gaps. Creation uses the canonical
 * `create_record_with_blocks` RPC, so the new notebook opens on its own data.
 */
const EXPERIMENT_MODEL = requireBuiltInModel('experiment')

export const Route = createFileRoute('/experiments/new')({
  validateSearch: (
    search: Record<string, unknown>,
  ): CreateContextSearch & { protocol?: string; template?: string } => {
    const text = (value: unknown) =>
      typeof value === 'string' && value ? value : undefined
    return {
      ...parseCreateContext(search),
      protocol: text(search.protocol),
      template: text(search.template),
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
  const projects = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'projects'],
    queryFn: () =>
      withDeadline(
        notebookDataClient.list<ProjectOption>(
          'projects',
          '?select=id,title,archived_at,status,default_reviewer_user_id&order=title.asc',
        ),
        t('projects.newExperiment.projectList'),
      ),
    staleTime: 60_000,
    retry: false,
  })
  const rows = projects.data ?? []
  // Which of those projects the caller may write to. `api.projects` returns
  // every project the account can *view*; the create RPC inserts under
  // `records_live_insert`, so a view-only default fails with a raw RLS error.
  const assignments = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'project-access'],
    queryFn: () =>
      withDeadline(
        fetchMyProjectAssignments(notebookDataClient),
        t('projects.newExperiment.permissionCheck'),
      ),
    staleTime: 60_000,
    retry: false,
  })
  const [projectId, setProjectId] = useState(search.project ?? '')
  const [title, setTitle] = useState('')
  // null until the author chooses: until then the project's default reviewer
  // stands in, so the reviewer is chosen once and carried to Submit.
  const [reviewerId, setReviewerId] = useState<string | null>(null)
  const [plannedEnd, setPlannedEnd] = useState('')
  const [startFrom, setStartFrom] = useState<StartFrom>(
    search.template ? 'template' : search.protocol ? 'protocol' : 'blank',
  )
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

  const members = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'members'],
    queryFn: () =>
      notebookDataClient.rpc<{ user_id: string; name: string; role: string }[]>(
        'workspace_members_list',
        {},
      ),
    staleTime: 60_000,
  })
  const protocols = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'protocols'],
    queryFn: () =>
      notebookDataClient.list<{
        id: string
        identifier: string
        title: string
      }>(
        'records',
        '?kind=eq.protocol_template&deleted_at=is.null&order=identifier.asc&select=id,identifier,title&limit=100',
      ),
    staleTime: 60_000,
  })
  const protocolVersions = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'protocol-versions'],
    queryFn: () =>
      notebookDataClient.list<{
        id: string
        protocol_record_id: string
        version: number
      }>(
        'protocol_versions',
        '?status=eq.effective&order=version.desc&select=id,protocol_record_id,version&limit=100',
      ),
    staleTime: 60_000,
  })
  // Published notebook templates, only once the author asks to start from one.
  const templates = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'templates'],
    enabled: startFrom === 'template',
    queryFn: async () => {
      const [list, versions] = await Promise.all([
        fetchNotebookTemplates(notebookDataClient, { limit: 200 }),
        fetchAllNotebookTemplateVersions(notebookDataClient),
      ])
      return buildTemplateRows(list, versions, []).filter(
        (row) => row.published && row.lifecycle !== 'retired',
      )
    },
    staleTime: 60_000,
  })
  // A sample handed over by the page that linked here: it is linked to the new
  // experiment, and named in the form so the author sees what will be linked.
  const sample = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'sample', search.sample],
    queryFn: async () =>
      (
        await notebookDataClient.list<{
          id: string
          identifier: string
          title: string
        }>(
          'records',
          `?id=eq.${encodeURIComponent(search.sample ?? '')}&select=id,identifier,title&limit=1`,
        )
      ).at(0) ?? null,
    enabled: Boolean(search.sample),
    staleTime: 60_000,
  })

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
  const isArchived = (project: ProjectOption) =>
    Boolean(project.archived_at) || project.status === 'archived'
  // A project can hold a new experiment when the account can edit it and the
  // project is not archived. Until the permission read answers we do not know,
  // so every project counts as usable: the create states its own refusal
  // inline, which beats an inert form.
  const canCreateIn = (project: ProjectOption) =>
    !accessKnown || (writableProjectIds.has(project.id) && !isArchived(project))
  const firstUsableId = rows.find((project) => canCreateIn(project))?.id ?? ''
  const chosenProject = rows.find((project) => project.id === projectId)
  const effectiveProjectId =
    chosenProject && canCreateIn(chosenProject)
      ? chosenProject.id
      : firstUsableId
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
  const titleError =
    touched && title.trim().length < 5
      ? t('projects.newExperiment.titleError')
      : undefined
  const projectError =
    touched && !effectiveProjectId
      ? rows.length === 0
        ? t('projects.newExperiment.chooseProject')
        : t('projects.newExperiment.chooseEditable')
      : undefined

  // Starting from a protocol pins its version, and the server only starts an
  // experiment whose version the operator has acknowledged: ask for that here,
  // before anything is created, instead of leaving a draft behind a refusal.
  const needsAcknowledgement =
    startNow && startFrom === 'protocol' && Boolean(effectiveProtocolVersionId)

  const addedFields = useAddedFieldDraft('experiment')

  const create = useMutation({
    mutationFn: async () => {
      if (needsAcknowledgement) {
        await acknowledgeProtocolVersion(
          notebookDataClient,
          effectiveProtocolVersionId,
        )
      }
      let record: { id: string; identifier: string }
      if (startFrom === 'template') {
        if (!templateVersion)
          throw new Error(t('projects.newExperiment.chooseTemplate'))
        const instantiated = await instantiateNotebookTemplateVersion(
          {
            versionId: templateVersion.id,
            targetProjectId: effectiveProjectId,
            title: title.trim(),
            parameterInputs: askedTemplateParameters.flatMap((p) => {
              const input: NotebookTemplateParameterInput | null =
                parameterInput(p, templateValues[p.id] ?? '')
              return input ? [input] : []
            }),
            idempotencyKey,
          },
          notebookDataClient,
        )
        record = instantiated.record
      } else {
        record = await createBlankExperiment(notebookDataClient, {
          projectId: effectiveProjectId,
          title: title.trim(),
        })
      }
      if (effectiveReviewerId || plannedEnd) {
        await notebookDataClient.rpc('set_experiment_fields', {
          p_record_id: record.id,
          p_reviewer_user_id: effectiveReviewerId || null,
          p_planned_end: plannedEnd || null,
        })
      }
      // The workspace's own Experiment fields go on before anything else
      // reads the record's version.
      await saveNewObjectFields(
        notebookDataClient,
        EXPERIMENT_MODEL,
        record.id,
        addedFields.typeKey,
        addedFields.payload(),
      )
      await applyExperimentSetup(notebookDataClient, record.id, {
        protocolRecordId: protocolId || undefined,
        copyFromRecordId: copyFromId || undefined,
        sampleRecordId: sample.data?.id,
      })
      // The protocol goes into the notebook as a pinned block with its steps,
      // so the notebook and the chosen protocol cannot disagree.
      let protocolInNotebook = false
      let protocolPinError: string | undefined
      if (protocolId) {
        try {
          await insertPinnedProtocol(notebookDataClient, record.id, protocolId)
          protocolInNotebook = true
        } catch (error) {
          protocolPinError =
            error instanceof Error
              ? error.message
              : t('projects.newExperiment.pinRefused')
        }
      }
      if (startNow) {
        // Starting is a server decision: PROJ-03 and LAB-07 authority (effective
        // version, exact-version acknowledgement) are enforced by the RPC.
        // Only the checkbox starts the experiment; choosing a protocol version
        // pins the version on start, it does not start anything by itself.
        const current = await notebookDataClient.list<{
          metadata_version: number
        }>('records', `?id=eq.${record.id}&select=metadata_version&limit=1`)
        await notebookDataClient.rpc('start_experiment', {
          p_record_id: record.id,
          p_expected_metadata_version: current.at(0)?.metadata_version ?? 1,
          p_protocol_version_id: effectiveProtocolVersionId || null,
          p_reason: t('projects.newExperiment.startReason'),
        })
      }
      return {
        record,
        started: startNow,
        protocolInNotebook,
        protocolPinError,
      }
    },
    onSuccess: ({ record, started, protocolInNotebook, protocolPinError }) => {
      toast(
        started
          ? t('projects.newExperiment.started', {
              identifier: record.identifier,
            })
          : t('projects.newExperiment.created', {
              identifier: record.identifier,
            }),
        {
          description: protocolPinError
            ? t('projects.newExperiment.pinFailed', {
                reason: protocolPinError,
              })
            : protocolInNotebook
              ? t('projects.newExperiment.pinned')
              : started
                ? t('projects.newExperiment.opensOnNotebook')
                : t('projects.newExperiment.startLater'),
        },
      )
      void navigate({
        to: '/experiments/$expId/notebook',
        params: { expId: record.id },
      })
    },
    onError: (error: unknown) => {
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

  const trail = effectiveProject
    ? [
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
    : [
        {
          label: t('projects.newExperiment.experiments'),
          link: { to: '/experiments' as const },
        },
        { label: t('projects.newExperiment.new') },
      ]

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
          hint={
            accessKnown && rows.some((p) => !canCreateIn(p))
              ? t('projects.newExperiment.projectHint')
              : undefined
          }
        >
          <PickerSelect
            noun="project"
            value={effectiveProjectId}
            onChange={(id) => setProjectId(id)}
            disabled={projects.isLoading || accessPending || rows.length === 0}
            placeholder={
              projects.isLoading
                ? 'Loading projects…'
                : projects.isError
                  ? 'Project list unavailable'
                  : accessPending
                    ? 'Checking project access…'
                    : rows.length === 0
                      ? 'No projects yet'
                      : undefined
            }
            options={rows.map((p) =>
              projectOption(
                p,
                canCreateIn(p)
                  ? null
                  : isArchived(p)
                    ? 'Archived'
                    : 'Read-only',
              ),
            )}
          />
        </Field>
        {projectReplaced ? (
          <Muted>
            {t('projects.newExperiment.replaced', {
              title: effectiveProject.title,
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
                onClick={() => setStartFrom(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        {startFrom === 'protocol' ? (
          <Field
            label={t('projects.newExperiment.protocolVersion')}
            hint={
              effectiveProtocolVersionId && !startNow
                ? t('projects.newExperiment.protocolDraftHint')
                : t('projects.newExperiment.protocolPinnedHint')
            }
          >
            <PickerSelect
              noun="protocol"
              value={effectiveProtocolVersionId}
              onChange={(id) => {
                setProtocolVersionId(id)
                setAcknowledged(false)
              }}
              clearLabel="No protocol"
              options={(protocolVersions.data ?? []).map((v) => {
                const record = (protocols.data ?? []).find(
                  (p) => p.id === v.protocol_record_id,
                )
                return {
                  id: v.id,
                  identifier: record?.identifier,
                  label: `${record?.title ?? 'Protocol'} · v${v.version}`,
                  status: { tone: 'ok' as const, label: 'Effective' },
                }
              })}
            />
          </Field>
        ) : null}
        {startFrom === 'template' ? (
          <>
            <Field
              label={t('projects.newExperiment.template')}
              required
              error={
                touched && !templateVersion
                  ? t('projects.newExperiment.chooseTemplate')
                  : undefined
              }
              hint={t('projects.newExperiment.templateHint')}
            >
              <PickerSelect
                noun="template"
                value={templateId}
                onChange={(id) => {
                  setTemplateId(id)
                  setTemplateValues({})
                  setIdempotencyKey(crypto.randomUUID())
                }}
                disabled={templates.isLoading}
                placeholder={
                  templates.isLoading
                    ? 'Loading templates…'
                    : (templates.data ?? []).length === 0
                      ? 'No published templates'
                      : 'Choose a template'
                }
                options={(templates.data ?? []).map((row) => ({
                  id: row.id,
                  label: row.name,
                  detail: `Version ${row.published?.version}`,
                }))}
              />
            </Field>
            {askedTemplateParameters.map((parameter) => (
              <Field
                key={parameter.id}
                label={parameter.label}
                required
                error={
                  touched &&
                  parameterInput(
                    parameter,
                    templateValues[parameter.id] ?? '',
                  ) === null
                    ? t('projects.newExperiment.needsValue')
                    : undefined
                }
              >
                <Input
                  value={templateValues[parameter.id] ?? ''}
                  onChange={(e) =>
                    setTemplateValues((current) => ({
                      ...current,
                      [parameter.id]: e.target.value,
                    }))
                  }
                />
              </Field>
            ))}
          </>
        ) : null}
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
            {create.isPending
              ? t('projects.newExperiment.creating')
              : startNow
                ? t('projects.newExperiment.createStart')
                : t('projects.newExperiment.createDraft')}
          </Button>
          <Button
            nativeButton={false}
            render={<Link to={cancelTarget(search, '/experiments')} />}
          >
            {t('common.actions.cancel')}
          </Button>
        </div>
        {create.error ? (
          <p role="alert" className="m-0 text-label text-danger-text">
            {createErrorMessage(create.error)}
          </p>
        ) : null}
        {projects.isLoading ? (
          <Muted>{t('projects.newExperiment.loadingNote')}</Muted>
        ) : null}
        {projects.isError ? (
          <span className="flex items-center gap-2">
            <Muted>{t('projects.newExperiment.listFailed')}</Muted>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => void projects.refetch()}
            >
              {t('projects.newExperiment.retry')}
            </Button>
          </span>
        ) : null}
        {accessPending ? (
          <Muted>{t('projects.newExperiment.checkingNote')}</Muted>
        ) : null}
        {assignments.isError ? (
          <span className="flex items-center gap-2">
            <Muted>{t('projects.newExperiment.accessFailed')}</Muted>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => void assignments.refetch()}
            >
              {t('projects.newExperiment.retry')}
            </Button>
          </span>
        ) : null}
        {rows.length === 0 && !projects.isLoading && !projects.isError ? (
          <Muted>
            {rich('projects.newExperiment.needsProject', {
              link: (text) => (
                <Link
                  to="/projects"
                  search={{ new: true }}
                  className="text-link"
                >
                  {text}
                </Link>
              ),
            })}
          </Muted>
        ) : null}
        {accessKnown && rows.length > 0 && !effectiveProjectId ? (
          <Muted>{t('projects.newExperiment.noUsable')}</Muted>
        ) : null}
      </form>
    </div>
  )
}
