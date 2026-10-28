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
import { Select } from '#/components/v3/ui/select'
import { Checkbox } from '#/components/v3/ui/checkbox'
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

/** One project as the picker needs it: its access is resolved separately. */
interface ProjectOption {
  id: string
  title: string
  archived_at: string | null
  status: string
  default_reviewer_user_id?: string | null
}

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
            `${label} did not answer within ${FORM_READ_TIMEOUT_MS / 1000} seconds.`,
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
    return 'That project is archived, so it cannot take a new experiment. Pick another project, or restore the project first.'
  }
  if (/row-level security|permission_denied|permission denied/i.test(message)) {
    return 'You don’t have permission to create records in that project. Pick a project you can edit, or ask a workspace owner to grant edit access.'
  }
  return message || 'Couldn’t create the draft.'
}

/**
 * UI port (roadmap-4/ui-app3): New experiment. app-3's form asks for a
 * reviewer, planned end and a protocol to follow; the ELN models an experiment
 * as a record with a project and a title, so only those are asked for and the
 * rest are stated as gaps. Creation uses the canonical
 * `create_record_with_blocks` RPC, so the new notebook opens on its own data.
 */
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
        'The project list',
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
        'The project-permission check',
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
  const experiments = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'sources'],
    queryFn: () =>
      notebookDataClient.list<{
        id: string
        identifier: string
        title: string
      }>(
        'records',
        '?kind=eq.experiment&deleted_at=is.null&order=updated_at.desc&select=id,identifier,title&limit=50',
      ),
    staleTime: 30_000,
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
  const projectNote = (project: ProjectOption) =>
    !accessKnown
      ? ''
      : isArchived(project)
        ? ' · archived'
        : writableProjectIds.has(project.id)
          ? ''
          : ' · read-only'
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
      ? 'Use at least 5 characters so the title says what is being tested.'
      : undefined
  const projectError =
    touched && !effectiveProjectId
      ? rows.length === 0
        ? 'Choose a project.'
        : 'Choose a project you can edit that is not archived.'
      : undefined

  // Starting from a protocol pins its version, and the server only starts an
  // experiment whose version the operator has acknowledged: ask for that here,
  // before anything is created, instead of leaving a draft behind a refusal.
  const needsAcknowledgement =
    startNow && startFrom === 'protocol' && Boolean(effectiveProtocolVersionId)

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
        if (!templateVersion) throw new Error('Choose a published template.')
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
            error instanceof Error ? error.message : 'The pin was refused.'
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
          p_reason: 'Started from the new experiment form',
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
          ? `Experiment ${record.identifier} started`
          : `Draft ${record.identifier} created`,
        {
          description: protocolPinError
            ? `The protocol could not be added to the notebook: ${protocolPinError}`
            : protocolInNotebook
              ? 'The protocol is pinned at the top of the notebook.'
              : started
                ? 'It opens on its notebook.'
                : 'Start it from the experiment page when you are ready.',
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
    if (
      startFrom === 'template' &&
      (!templateVersion || missingTemplateParameters.length > 0)
    )
      return
    create.mutate()
  }

  const trail = effectiveProject
    ? [
        { label: 'Projects', link: { to: '/projects' as const } },
        {
          label: effectiveProject.title,
          link: {
            to: '/projects/$projectId' as const,
            params: { projectId: effectiveProject.id },
          },
        },
        { label: 'New experiment' },
      ]
    : [
        { label: 'Experiments', link: { to: '/experiments' as const } },
        { label: 'New' },
      ]

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader trail={trail} title="New experiment" />
      <form
        className="flex w-full max-w-3xl flex-col gap-4 px-4 py-4 md:px-6"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field
          label="Project"
          required
          error={projectError}
          hint={
            accessKnown && rows.some((p) => !canCreateIn(p))
              ? 'Projects you can only view, and archived projects, cannot hold a new experiment.'
              : undefined
          }
        >
          <Select
            value={effectiveProjectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={projects.isLoading || accessPending || rows.length === 0}
          >
            {projects.isLoading ? (
              <option value="">Loading projects…</option>
            ) : projects.isError ? (
              <option value="">Project list unavailable</option>
            ) : accessPending ? (
              <option value="">Checking project access…</option>
            ) : rows.length === 0 ? (
              <option value="">No projects yet</option>
            ) : null}
            {rows.map((p) => (
              <option key={p.id} value={p.id} disabled={!canCreateIn(p)}>
                {p.title}
                {projectNote(p)}
              </option>
            ))}
          </Select>
        </Field>
        {projectReplaced ? (
          <Muted>
            The project you came from can’t take a new experiment (it is
            read-only or archived), so {effectiveProject.title} is selected
            instead.
          </Muted>
        ) : null}
        {sample.data ? (
          <Muted>
            Sample {sample.data.identifier} · {sample.data.title} will be linked
            to this experiment.
          </Muted>
        ) : null}
        <Field
          label="Title"
          required
          error={titleError}
          hint="What is being tested. It becomes the notebook title."
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            aria-invalid={Boolean(titleError) || undefined}
          />
        </Field>
        <Field
          label="Reviewer"
          hint={
            reviewerId === null && effectiveReviewerId
              ? 'The project’s default reviewer. Submit will offer this person.'
              : 'Who reviews the submitted notebook. Submit will offer this person. Optional.'
          }
        >
          <Select
            value={effectiveReviewerId}
            onChange={(e) => setReviewerId(e.target.value)}
          >
            <option value="">No reviewer yet</option>
            {(members.data ?? []).map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Planned end"
          hint="When the experiment is expected to finish. Optional."
        >
          <Input
            type="date"
            value={plannedEnd}
            onChange={(e) => setPlannedEnd(e.target.value)}
          />
        </Field>
        <div
          role="group"
          aria-label="Start from"
          className="flex flex-col gap-1.5"
        >
          <span className="text-label font-medium text-fg">Start from</span>
          <div className="flex gap-1.5">
            {(
              [
                ['blank', 'Blank notebook'],
                ['protocol', 'A protocol'],
                ['template', 'A template'],
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
            label="Protocol version to follow"
            hint={
              effectiveProtocolVersionId && !startNow
                ? 'A draft follows the protocol but does not pin the version; tick Start the experiment now to pin this version.'
                : 'The protocol is pinned in the notebook, with its steps when it has them. Only effective versions can start an experiment.'
            }
          >
            <Select
              value={effectiveProtocolVersionId}
              onChange={(e) => {
                setProtocolVersionId(e.target.value)
                setAcknowledged(false)
              }}
            >
              <option value="">No protocol</option>
              {(protocolVersions.data ?? []).map((v) => {
                const record = (protocols.data ?? []).find(
                  (p) => p.id === v.protocol_record_id,
                )
                return (
                  <option key={v.id} value={v.id}>
                    {record
                      ? `${record.identifier} · ${record.title}`
                      : 'Protocol'}{' '}
                    · v{v.version}
                  </option>
                )
              })}
            </Select>
          </Field>
        ) : null}
        {startFrom === 'template' ? (
          <>
            <Field
              label="Template"
              required
              error={
                touched && !templateVersion
                  ? 'Choose a published template.'
                  : undefined
              }
              hint="The notebook starts from the template’s latest published version and keeps it until you take a newer one."
            >
              <Select
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value)
                  setTemplateValues({})
                  setIdempotencyKey(crypto.randomUUID())
                }}
                disabled={templates.isLoading}
              >
                <option value="">
                  {templates.isLoading
                    ? 'Loading templates…'
                    : (templates.data ?? []).length === 0
                      ? 'No published templates'
                      : 'Choose a template'}
                </option>
                {(templates.data ?? []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} · v{row.published?.version}
                  </option>
                ))}
              </Select>
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
                    ? 'The template needs this value to start.'
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
          Start the experiment now
        </label>
        {needsAcknowledgement ? (
          <Field
            label="Protocol acknowledgement"
            error={
              touched && !acknowledged
                ? 'Acknowledge the protocol version to start from it.'
                : undefined
            }
          >
            <label className="flex cursor-pointer items-center gap-2 text-label">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(on) => setAcknowledged(Boolean(on))}
              />
              I have read this protocol version and will follow it
            </label>
          </Field>
        ) : null}
        <Field
          label="Copy materials from"
          hint="Links the same samples and materials as an earlier experiment. Optional."
        >
          <Select
            value={copyFromId}
            onChange={(e) => setCopyFromId(e.target.value)}
          >
            <option value="">Nothing</option>
            {(experiments.data ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.identifier} · {x.title}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={create.isPending || accessPending || !effectiveProjectId}
          >
            {create.isPending
              ? 'Creating…'
              : startNow
                ? 'Create and start'
                : 'Create draft'}
          </Button>
          <Button
            nativeButton={false}
            render={<Link to={cancelTarget(search, '/experiments')} />}
          >
            Cancel
          </Button>
        </div>
        {create.error ? (
          <p role="alert" className="m-0 text-label text-danger-text">
            {createErrorMessage(create.error)}
          </p>
        ) : null}
        {projects.isLoading ? (
          <Muted>Loading the projects you can put an experiment in…</Muted>
        ) : null}
        {projects.isError ? (
          <span className="flex items-center gap-2">
            <Muted>
              Couldn’t load the project list, so there is nothing to choose.
            </Muted>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => void projects.refetch()}
            >
              Retry
            </Button>
          </span>
        ) : null}
        {accessPending ? (
          <Muted>Checking which projects you can write to…</Muted>
        ) : null}
        {assignments.isError ? (
          <span className="flex items-center gap-2">
            <Muted>
              Couldn’t check which projects you can write to, so every project
              is listed. A create in a project you can only view is refused, and
              the refusal is shown here.
            </Muted>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => void assignments.refetch()}
            >
              Retry
            </Button>
          </span>
        ) : null}
        {rows.length === 0 && !projects.isLoading && !projects.isError ? (
          <Muted>
            An experiment belongs to a project.{' '}
            <Link to="/projects" search={{ new: true }} className="text-link">
              Create a project first
            </Link>
            .
          </Muted>
        ) : null}
        {accessKnown && rows.length > 0 && !effectiveProjectId ? (
          <Muted>
            No project here can take a new experiment: you need edit access and
            the project must not be archived. A workspace owner or admin can
            change that in Settings → Access.
          </Muted>
        ) : null}
      </form>
    </div>
  )
}
