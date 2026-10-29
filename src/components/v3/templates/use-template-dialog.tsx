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
import { projectOption } from '#/components/v3/record-picker/entity-options'
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
import { t } from '#/copy'

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
    return t('library.templates.useTemplateDialog.thatProjectIsArchivedSo')
  }
  if (/row-level security|permission_denied|permission denied/i.test(message)) {
    return t('library.templates.useTemplateDialog.youDontHavePermissionTo')
  }
  return (
    message || t('library.templates.useTemplateDialog.couldNotStartTheNotebook')
  )
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
      if (!version)
        throw new Error(
          t('library.templates.useTemplateDialog.thisTemplateHasNoPublished'),
        )
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
      toast(
        t('library.templates.useTemplateDialog.notebookStarted', {
          identifier: result.record.identifier,
        }),
        {
          description: t(
            'library.templates.useTemplateDialog.madeFromVLaterTemplate',
            { templateName, version: version?.version ?? '' },
          ),
        },
      )
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
            ? t('library.templates.useTemplateDialog.thisVersionHasNoSections')
            : t('library.templates.useTemplateDialog.publishAVersionFirstA')
        }
      >
        {t('library.templates.useTemplateDialog.useTemplate')}
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
        {t('library.templates.useTemplateDialog.useTemplate')}
      </DialogTrigger>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.templates.useTemplateDialog.newNotebookFrom', {
            templateName,
          })}
          description={t(
            'library.templates.useTemplateDialog.startsFromPublishedVThe',
            { version: version.version },
          )}
        />
        <DialogBody>
          {projects.isError || assignments.isError ? (
            <Notice
              tone="bad"
              title={t(
                'library.templates.useTemplateDialog.couldNotLoadYourProjects',
              )}
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    void projects.refetch()
                    void assignments.refetch()
                  }}
                >
                  {t('common.actions.tryAgain')}
                </Button>
              }
            >
              {t('library.templates.useTemplateDialog.aNotebookLivesInA')}
            </Notice>
          ) : null}
          <Field
            label={t('library.templates.useTemplateDialog.project')}
            required
            error={
              touched && !effectiveProjectId
                ? t('library.templates.useTemplateDialog.chooseAProjectYouCan')
                : undefined
            }
            hint={
              !projects.isLoading &&
              !assignments.isLoading &&
              usable.length === 0
                ? t('library.templates.useTemplateDialog.youCantEditAnyActive')
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
          <Field
            label={t('library.templates.useTemplateDialog.title')}
            hint={t(
              'library.templates.useTemplateDialog.optionalDefaultsToTheTemplate',
            )}
          >
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
                  ? t(
                      'library.templates.useTemplateDialog.thisParameterNeedsAValue',
                    )
                  : undefined
              }
            >
              <Input
                value={values[p.id] ?? ''}
                placeholder={
                  p.type.kind === 'scalar' && p.type.valueType === 'date'
                    ? t('library.templates.useTemplateDialog.yyyyMmDd')
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
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={start.isPending || !effectiveProjectId}
            onClick={submit}
          >
            {start.isPending
              ? t('library.templates.useTemplateDialog.starting')
              : t('library.templates.useTemplateDialog.startNotebook')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
