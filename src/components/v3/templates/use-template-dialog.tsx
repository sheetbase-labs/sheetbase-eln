import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import {
  projectOption,
} from '#/components/v3/record-picker/entity-options'
import { toast } from '#/components/v3/ui/sonner'
import {
  instantiateNotebookTemplateVersion,
  notebookTemplateDataClient,
} from '#/lib/notebook-template-data'
import type {
  NotebookTemplateParameterInput,
  NotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import { fetchMyProjectAssignments } from '#/lib/workspace-access'
import type { Parameter } from '#/lib/parameter'

interface ProjectOption {
  id: string
  title: string
  archived_at: string | null
  status: string
}

/** Parameters the form can ask for: required scalars with no default. */
export function askedParameters(version: NotebookTemplateVersion): Parameter[] {
  return version.configuration.parameters.filter(
    (p) =>
      p.required && p.type.kind === 'scalar' && p.defaultValue === undefined,
  )
}

export function parameterInput(
  parameter: Parameter,
  raw: string,
): NotebookTemplateParameterInput | null {
  if (parameter.type.kind !== 'scalar') return null
  const text = raw.trim()
  if (text === '') return null
  switch (parameter.type.valueType) {
    case 'integer':
    case 'decimal': {
      const value = Number(text)
      return Number.isFinite(value)
        ? { parameterId: parameter.id, kind: 'scalar', value }
        : null
    }
    case 'boolean':
      return {
        parameterId: parameter.id,
        kind: 'scalar',
        value: text === 'true',
      }
    default:
      return { parameterId: parameter.id, kind: 'scalar', value: text }
  }
}

function startErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/project is archived/i.test(message)) {
    return 'That project is archived, so it cannot take a new notebook. Pick another project, or restore the project first.'
  }
  if (/row-level security|permission_denied|permission denied/i.test(message)) {
    return 'You don’t have permission to create notebooks in that project. Pick a project you can edit, or ask a workspace owner to grant edit access.'
  }
  return message || 'Could not start the notebook from this template.'
}

/**
 * Start a notebook from a published template version. Calls
 * `instantiate_notebook_template_version`, which pins the version on the new
 * record, then opens the notebook. One idempotency key per opening of the
 * dialog, so a double click never makes two notebooks.
 */
export function UseTemplateDialog({
  templateName,
  version,
  size = 'md',
  variant = 'primary',
}: {
  templateName: string
  /** The published version to start from; null when none is published yet. */
  version: NotebookTemplateVersion | null
  size?: 'sm' | 'md'
  variant?: 'primary' | 'secondary'
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  )

  const projects = useQuery({
    queryKey: ['ui-port', 'templates', 'use', 'projects'],
    queryFn: () =>
      notebookTemplateDataClient.list<ProjectOption>(
        'projects',
        '?select=id,title,archived_at,status&order=title.asc',
      ),
    enabled: open,
    staleTime: 60_000,
  })
  const assignments = useQuery({
    queryKey: ['ui-port', 'templates', 'use', 'project-access'],
    queryFn: () => fetchMyProjectAssignments(notebookTemplateDataClient),
    enabled: open,
    staleTime: 60_000,
  })
  const writable = useMemo(
    () =>
      new Set(
        (assignments.data ?? [])
          .filter((a) => a.can_edit)
          .map((a) => a.project_id),
      ),
    [assignments.data],
  )
  const usable = (projects.data ?? []).filter(
    (p) => writable.has(p.id) && !p.archived_at && p.status !== 'archived',
  )
  const effectiveProjectId = usable.some((p) => p.id === projectId)
    ? projectId
    : (usable.at(0)?.id ?? '')
  const asked = version ? askedParameters(version) : []
  const missing = asked.filter(
    (p) => parameterInput(p, values[p.id] ?? '') === null,
  )

  const start = useMutation({
    mutationFn: () => {
      if (!version) throw new Error('This template has no published version.')
      return instantiateNotebookTemplateVersion({
        versionId: version.id,
        targetProjectId: effectiveProjectId,
        title: title.trim() || undefined,
        parameterInputs: asked.flatMap((p) => {
          const input = parameterInput(p, values[p.id] ?? '')
          return input ? [input] : []
        }),
        idempotencyKey,
      })
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'templates'] })
      setOpen(false)
      toast(`Notebook ${result.record.identifier} started`, {
        description: `Made from ${templateName} v${version?.version ?? ''}. Later template versions do not change it unless you take them.`,
      })
      void navigate({
        to: '/experiments/$expId/notebook',
        params: { expId: result.record.id },
      })
    },
    onError: (error: unknown) => {
      // Mint a new key so a corrected form is not answered with the earlier
      // refusal.
      setIdempotencyKey(crypto.randomUUID())
      toast.error(startErrorMessage(error))
    },
  })

  const submit = () => {
    setTouched(true)
    if (!effectiveProjectId || missing.length > 0) return
    start.mutate()
  }

  // A version with no sections would start an empty notebook.
  const empty =
    version !== null && version.configuration.placements.length === 0
  if (!version || empty) {
    return (
      <Button
        size={size}
        variant={variant}
        disabled
        title={
          empty
            ? 'This version has no sections yet. Add sections and publish it before starting a notebook.'
            : 'Publish a version first: a notebook can only start from a published one.'
        }
      >
        Use template
      </Button>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setIdempotencyKey(crypto.randomUUID())
        } else {
          setTitle('')
          setValues({})
          setTouched(false)
        }
      }}
    >
      <DialogTrigger render={<Button size={size} variant={variant} />}>
        Use template
      </DialogTrigger>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={`New notebook from ${templateName}`}
          description={`Starts from published v${version.version}. The notebook keeps that version until its owner chooses to take a newer one.`}
        />
        <DialogBody>
          {projects.isError || assignments.isError ? (
            <Notice
              tone="bad"
              title="Could not load your projects"
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    void projects.refetch()
                    void assignments.refetch()
                  }}
                >
                  Try again
                </Button>
              }
            >
              A notebook lives in a project, so the list has to load first.
            </Notice>
          ) : null}
          <Field
            label="Project"
            required
            error={
              touched && !effectiveProjectId
                ? 'Choose a project you can edit that is not archived.'
                : undefined
            }
            hint={
              !projects.isLoading &&
              !assignments.isLoading &&
              usable.length === 0
                ? 'You can’t edit any active project. Ask a project owner for edit access.'
                : undefined
            }
          >
            <PickerSelect
              noun="project"
              value={effectiveProjectId}
              onChange={(id) => setProjectId(id)}
              disabled={
                projects.isLoading || assignments.isLoading || !usable.length
              }
              placeholder={
                projects.isLoading || assignments.isLoading
                  ? 'Loading projects…'
                  : usable.length === 0
                    ? 'No project available'
                    : undefined
              }
              options={usable.map((p) => projectOption(p))}
            />
          </Field>
          <Field label="Title" hint="Optional. Defaults to the template name.">
            <Input
              value={title}
              placeholder={templateName}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          {asked.map((p) => (
            <Field
              key={p.id}
              label={p.label}
              required
              error={
                touched && missing.includes(p)
                  ? 'This parameter needs a value to start.'
                  : undefined
              }
            >
              <Input
                value={values[p.id] ?? ''}
                placeholder={
                  p.type.kind === 'scalar' && p.type.valueType === 'date'
                    ? 'YYYY-MM-DD'
                    : undefined
                }
                onChange={(e) =>
                  setValues((v) => ({ ...v, [p.id]: e.target.value }))
                }
              />
            </Field>
          ))}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={start.isPending || !effectiveProjectId}
            onClick={submit}
          >
            {start.isPending ? 'Starting…' : 'Start notebook'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
