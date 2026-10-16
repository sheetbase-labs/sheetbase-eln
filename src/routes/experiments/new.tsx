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
import { NativeSelect } from '#/components/v3/projects/select'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { toast } from '#/components/v3/ui/sonner'
import {
  applyExperimentSetup,
  createBlankExperiment,
} from '#/lib/notebook-create'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchMyProjectAssignments } from '#/lib/workspace-access'

/** One project as the picker needs it: its access is resolved separately. */
interface ProjectOption {
  id: string
  title: string
  archived_at: string | null
  status: string
}

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
  validateSearch: (search: Record<string, unknown>): { project?: string } => ({
    project: typeof search.project === 'string' ? search.project : undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
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
          '?select=id,title,archived_at,status&order=title.asc',
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
  const [reviewerId, setReviewerId] = useState('')
  const [plannedEnd, setPlannedEnd] = useState('')
  const [protocolId, setProtocolId] = useState('')
  const [protocolVersionId, setProtocolVersionId] = useState('')
  const [startNow, setStartNow] = useState(false)
  const [copyFromId, setCopyFromId] = useState('')
  const [touched, setTouched] = useState(false)

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

  const create = useMutation({
    mutationFn: async () => {
      const record = await createBlankExperiment(notebookDataClient, {
        projectId: effectiveProjectId,
        title: title.trim(),
      })
      if (reviewerId || plannedEnd) {
        await notebookDataClient.rpc('set_experiment_fields', {
          p_record_id: record.id,
          p_reviewer_user_id: reviewerId || null,
          p_planned_end: plannedEnd || null,
        })
      }
      await applyExperimentSetup(notebookDataClient, record.id, {
        protocolRecordId: protocolId || undefined,
        copyFromRecordId: copyFromId || undefined,
      })
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
          p_protocol_version_id: protocolVersionId || null,
          p_reason: 'Started from the new experiment form',
        })
        return { record, started: true }
      }
      return { record, started: false }
    },
    onSuccess: ({ record, started }) => {
      toast(
        started
          ? `Experiment ${record.identifier} started`
          : `Draft ${record.identifier} created`,
        {
          description: started
            ? 'It opens on its notebook; edits to pinned steps are recorded as deviations.'
            : 'It opens on a blank notebook; add blocks as you work.',
        },
      )
      void navigate({
        to: '/experiments/$expId/notebook',
        params: { expId: record.id },
      })
    },
    onError: (error: unknown) => {
      toast.error(createErrorMessage(error))
    },
  })

  const submit = () => {
    setTouched(true)
    if (accessPending || title.trim().length < 5 || !effectiveProjectId) return
    create.mutate()
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        crumbs={
          <>
            <Link to="/experiments" className="text-link">
              Experiments
            </Link>{' '}
            / New
          </>
        }
        title="New experiment"
      />
      <form
        className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-4 md:px-6"
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
          <NativeSelect
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
          </NativeSelect>
        </Field>
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
          hint="Who reviews the submitted notebook. Optional."
        >
          <NativeSelect
            value={reviewerId}
            onChange={(e) => setReviewerId(e.target.value)}
          >
            <option value="">No reviewer yet</option>
            {(members.data ?? []).map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
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
        <Field
          label="Protocol version to follow"
          hint={
            protocolVersionId && !startNow
              ? 'A draft records the protocol but not the pinned version; tick Start the experiment now to pin this version.'
              : 'Only effective versions can start an experiment. Optional.'
          }
        >
          <NativeSelect
            value={protocolVersionId}
            onChange={(e) => {
              const value = e.target.value
              setProtocolVersionId(value)
              const chosen = (protocolVersions.data ?? []).find(
                (v) => v.id === value,
              )
              setProtocolId(chosen?.protocol_record_id ?? '')
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
          </NativeSelect>
        </Field>
        <label className="flex cursor-pointer items-center gap-2 text-label">
          <Checkbox
            checked={startNow}
            onCheckedChange={(on) => setStartNow(Boolean(on))}
          />
          Start the experiment now
        </label>
        <Field
          label="Copy materials from"
          hint="Links the same samples and materials as an earlier experiment. Optional."
        >
          <NativeSelect
            value={copyFromId}
            onChange={(e) => setCopyFromId(e.target.value)}
          >
            <option value="">Nothing</option>
            {(experiments.data ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.identifier} · {x.title}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={create.isPending || accessPending || !effectiveProjectId}
          >
            {create.isPending ? 'Creating…' : 'Create draft'}
          </Button>
          <Button nativeButton={false} render={<Link to="/experiments" />}>
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
          <Muted>Create a project first; an experiment belongs to one.</Muted>
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
