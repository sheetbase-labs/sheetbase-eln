import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { IconButton } from '#/components/ui/icon-button'
import { Muted } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { SettingsBody } from '#/components/settings/settings-page'
import { createDataClient } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import { fetchSampleTypes } from '#/lib/release-rules'
import {
  ACTION_KINDS,
  COMMON_SAMPLE_FIELDS,
  NOTIFY_ROLES,
  blankAction,
  blankStage,
  blankWorkflow,
  describeAction,
  fetchWorkflowDraft,
  fetchWorkflowSummaries,
  saveWorkflow,
  setWorkflowStatus,
  validateAction,
  validateWorkflow,
  workflowKeys,
} from '#/lib/sample-workflows'
import type {
  WorkflowAction,
  WorkflowDraft,
  WorkflowStageDraft,
  WorkflowSummary,
} from '#/lib/sample-workflows'
import { t } from '#/copy'

const defaultClient = createDataClient()

function errorMessage(error: Error): string {
  return error instanceof Error
    ? error.message
    : t('settings.sampleWorkflows.databaseRefused')
}

/**
 * Settings → Storage and labels → Workflows. The workflows a lab's samples move
 * through, set up without code: pick a workflow to edit its steps, or start a
 * new one. Who may change them is the workspace's choice for this section; the
 * database refuses a change from anyone else.
 */
export function SampleWorkflowsPanel({
  workspaceId,
  canManage,
  editing,
  onEdit,
  client = defaultClient,
}: {
  workspaceId: string
  canManage: boolean
  /** The workflow being edited (its id, or `new`), kept in the address so a reload returns to it. */
  editing: string | null
  onEdit: (id: string | null) => void
  client?: DataClient
}) {
  const setEditing = onEdit

  if (editing) {
    return (
      <WorkflowEditor
        key={editing}
        workflowId={editing === 'new' ? null : editing}
        workspaceId={workspaceId}
        canManage={canManage}
        client={client}
        onClose={() => setEditing(null)}
      />
    )
  }

  return (
    <WorkflowList
      workspaceId={workspaceId}
      canManage={canManage}
      client={client}
      onOpen={setEditing}
    />
  )
}

function WorkflowList({
  workspaceId,
  canManage,
  client,
  onOpen,
}: {
  workspaceId: string
  canManage: boolean
  client: DataClient
  onOpen: (id: string) => void
}) {
  const list = useQuery({
    queryKey: workflowKeys.all(workspaceId),
    queryFn: () => fetchWorkflowSummaries(client),
    enabled: Boolean(workspaceId),
  })

  if (list.isError) {
    return (
      <SettingsBody>
        <Notice tone="bad">
          {t('settings.sampleWorkflows.loadError')}
          {errorMessage(list.error)}
        </Notice>
      </SettingsBody>
    )
  }

  const columns: RegistryColumn<WorkflowSummary>[] = [
    {
      id: 'workflow',
      header: t('settings.sampleWorkflows.workflow'),
      accessorFn: (workflow) => workflow.name,
      cell: ({ row }) => (
        <span className="font-medium text-fg">{row.original.name}</span>
      ),
    },
    {
      id: 'appliesTo',
      header: t('settings.sampleWorkflows.appliesTo'),
      accessorFn: (workflow) =>
        workflow.sampleType ?? t('settings.sampleWorkflows.anyType'),
    },
    {
      id: 'steps',
      header: t('settings.sampleWorkflows.steps'),
      accessorFn: (workflow) => workflow.stageCount,
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
    },
    {
      id: 'inProgress',
      header: t('settings.sampleWorkflows.inProgress'),
      accessorFn: (workflow) => workflow.inProgress,
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
    },
    {
      id: 'starts',
      header: t('settings.sampleWorkflows.starts'),
      accessorFn: (workflow) =>
        workflow.autoEnrol
          ? t('settings.sampleWorkflows.startsOnItsOwn')
          : t('settings.sampleWorkflows.startedByHand'),
    },
    {
      id: 'state',
      header: t('settings.sampleWorkflows.state'),
      accessorFn: (workflow) =>
        workflow.status === 'archived'
          ? t('settings.sampleWorkflows.archived')
          : t('settings.sampleWorkflows.active'),
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {row.original.status === 'archived'
            ? t('settings.sampleWorkflows.archived')
            : t('settings.sampleWorkflows.active')}
        </span>
      ),
    },
  ]

  return (
    <SettingsBody>
      <p className="m-0 max-w-prose text-body text-fg-muted">
        {t('settings.sampleWorkflows.intro')}
      </p>
      {canManage ? (
        <div>
          <Button icon="plus" onClick={() => onOpen('new')}>
            {t('settings.sampleWorkflows.newWorkflow')}
          </Button>
        </div>
      ) : (
        <Notice>{t('settings.sampleWorkflows.viewOnly')}</Notice>
      )}
      {!list.isLoading && (list.data ?? []).length === 0 ? (
        <Muted>{t('settings.sampleWorkflows.none')}</Muted>
      ) : (
        <TableBox>
          <RegistryGrid
            label={t('settings.sampleWorkflows.title')}
            rows={list.data ?? []}
            columns={columns}
            getRowId={(workflow) => workflow.id}
            onRowClick={(workflow) => onOpen(workflow.id)}
            isLoading={list.isLoading}
          />
        </TableBox>
      )}
    </SettingsBody>
  )
}

function WorkflowEditor({
  workflowId,
  workspaceId,
  canManage,
  client,
  onClose,
}: {
  workflowId: string | null
  workspaceId: string
  canManage: boolean
  client: DataClient
  onClose: () => void
}) {
  const loaded = useQuery({
    queryKey: [...workflowKeys.all(workspaceId), 'draft', workflowId],
    queryFn: () =>
      workflowId ? fetchWorkflowDraft(client, workflowId) : blankWorkflow(),
    staleTime: Infinity,
    gcTime: 0,
  })

  if (loaded.isError) {
    return (
      <SettingsBody>
        <Notice tone="bad">{errorMessage(loaded.error)}</Notice>
        <div>
          <Button onClick={onClose}>
            {t('settings.sampleWorkflows.allWorkflows')}
          </Button>
        </div>
      </SettingsBody>
    )
  }

  if (!loaded.data) {
    return (
      <SettingsBody>
        <Muted>{t('settings.sampleWorkflows.loading')}</Muted>
      </SettingsBody>
    )
  }

  return (
    <EditorBody
      initial={loaded.data}
      workspaceId={workspaceId}
      canManage={canManage}
      client={client}
      onClose={onClose}
    />
  )
}

function EditorBody({
  initial,
  workspaceId,
  canManage,
  client,
  onClose,
}: {
  initial: WorkflowDraft
  workspaceId: string
  canManage: boolean
  client: DataClient
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<WorkflowDraft>(initial)

  const [selectedKey, setSelectedKey] = useState<string | null>(
    initial.stages[0]?.key ?? null,
  )

  const sampleTypes = useQuery({
    queryKey: ['sample-types', workspaceId],
    queryFn: () => fetchSampleTypes(client),
    enabled: Boolean(workspaceId),
  })

  const problem = validateWorkflow(draft)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

  const save = useMutation({
    mutationFn: () => saveWorkflow(client, draft),
    onSuccess: async () => {
      toast(t('settings.sampleWorkflows.saved'))
      await queryClient.invalidateQueries({
        queryKey: workflowKeys.all(workspaceId),
      })
      onClose()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const archive = useMutation({
    mutationFn: (status: 'active' | 'archived') =>
      setWorkflowStatus(client, draft.id!, status),
    onSuccess: async (_, status) => {
      toast(
        status === 'archived'
          ? t('settings.sampleWorkflows.archivedToast')
          : t('settings.sampleWorkflows.restoredToast'),
      )
      await queryClient.invalidateQueries({
        queryKey: workflowKeys.all(workspaceId),
      })
      onClose()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const patch = (changes: Partial<WorkflowDraft>) =>
    setDraft({ ...draft, ...changes })

  const patchStage = (key: string, changes: Partial<WorkflowStageDraft>) =>
    patch({
      stages: draft.stages.map((s) =>
        s.key === key ? { ...s, ...changes } : s,
      ),
    })

  const move = (index: number, by: -1 | 1) => {
    const stages = [...draft.stages]
    const target = index + by

    if (target < 0 || target >= stages.length) return
    ;[stages[index], stages[target]] = [stages[target], stages[index]]
    patch({ stages })
  }

  const addStage = () => {
    const stage = blankStage()
    // Slot it before a final step, and let the step it follows lead to it.
    const lastIndex = draft.stages.length - 1
    const insertAt = draft.stages[lastIndex]?.final ? lastIndex : lastIndex + 1
    const stages = [...draft.stages]
    stages.splice(insertAt, 0, stage)
    const after = insertAt + 1 < stages.length ? stages[insertAt + 1] : null

    if (after) stage.next = [after.key]

    // The step before now leads to the new one instead of past it.
    if (insertAt > 0 && !stages[insertAt - 1].final) {
      const before = stages[insertAt - 1]
      stages[insertAt - 1] = {
        ...before,
        next:
          after && before.next.includes(after.key)
            ? before.next.map((n) => (n === after.key ? stage.key : n))
            : [...before.next, stage.key],
      }
    }

    patch({ stages })
    setSelectedKey(stage.key)
  }

  const removeStage = (key: string) => {
    patch({
      stages: draft.stages
        .filter((s) => s.key !== key)
        .map((s) => ({ ...s, next: s.next.filter((n) => n !== key) })),
    })
    setSelectedKey(null)
  }

  const selected = draft.stages.find((s) => s.key === selectedKey) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <SettingsBody className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Button icon="arrowLeft" onClick={onClose}>
            {t('settings.sampleWorkflows.allWorkflows')}
          </Button>
          <span className="flex-1" />
          {canManage && draft.id ? (
            <Button
              disabled={archive.isPending}
              onClick={() =>
                archive.mutate(
                  draft.status === 'archived' ? 'active' : 'archived',
                )
              }
            >
              {draft.status === 'archived'
                ? t('settings.sampleWorkflows.restore')
                : t('settings.sampleWorkflows.archive')}
            </Button>
          ) : null}
          {canManage ? (
            <Button
              variant="primary"
              disabled={!dirty || Boolean(problem) || save.isPending}
              onClick={() => save.mutate()}
            >
              {t('common.actions.save')}
            </Button>
          ) : null}
        </div>
        {!canManage ? (
          <Notice>{t('settings.sampleWorkflows.viewOnly')}</Notice>
        ) : problem && dirty ? (
          <Notice tone="warn">{problem}</Notice>
        ) : null}
        <fieldset
          disabled={!canManage}
          className="m-0 grid min-w-0 gap-3 border-0 p-0 md:grid-cols-2"
        >
          <Field label={t('settings.sampleWorkflows.name')} required>
            <Input
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>
          <Field
            label={t('settings.sampleWorkflows.sampleType')}
            hint={t('settings.sampleWorkflows.sampleTypeHint')}
          >
            <Input
              list="sample-workflow-types"
              value={draft.sampleType}
              onChange={(event) => patch({ sampleType: event.target.value })}
            />
            <datalist id="sample-workflow-types">
              {(sampleTypes.data ?? []).map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
          </Field>
          <Field
            label={t('settings.sampleWorkflows.description')}
            className="md:col-span-2"
          >
            <Input
              value={draft.description}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </Field>
          <label className="flex items-start gap-2 text-body md:col-span-2">
            <Checkbox
              checked={draft.autoEnrol}
              onCheckedChange={(checked) => patch({ autoEnrol: checked })}
            />
            <span className="flex flex-col">
              <span className="font-medium text-fg">
                {t('settings.sampleWorkflows.startOnItsOwn')}
              </span>
              <span className="text-label text-fg-muted">
                {t('settings.sampleWorkflows.startOnItsOwnHint')}
              </span>
            </span>
          </label>
        </fieldset>

        <WorkflowSteps
          stages={draft.stages}
          selectedKey={selectedKey}
          canManage={canManage}
          onAdd={addStage}
          onSelect={setSelectedKey}
          onMove={move}
        />
      </SettingsBody>
      <aside
        aria-label={t('settings.sampleWorkflows.stepDetails')}
        className="shrink-0 border-t border-border bg-surface p-4 lg:w-[360px] lg:border-l lg:border-t-0"
      >
        {selected ? (
          <StageEditor
            key={selected.key}
            stage={selected}
            others={draft.stages.filter((s) => s.key !== selected.key)}
            canManage={canManage}
            canRemove={draft.stages.length > 2}
            workspaceId={workspaceId}
            client={client}
            onChange={(changes) => patchStage(selected.key, changes)}
            onRemove={() => removeStage(selected.key)}
          />
        ) : (
          <Muted>{t('settings.sampleWorkflows.pickStep')}</Muted>
        )}
      </aside>
    </div>
  )
}

function WorkflowSteps({
  stages,
  selectedKey,
  canManage,
  onAdd,
  onSelect,
  onMove,
}: {
  stages: WorkflowStageDraft[]
  selectedKey: string | null
  canManage: boolean
  onAdd: () => void
  onSelect: (key: string) => void
  onMove: (index: number, by: -1 | 1) => void
}) {
  const nameOf = (key: string) =>
    stages.find((stage) => stage.key === key)?.name ||
    t('settings.sampleWorkflows.unnamedStep')

  const columns: RegistryColumn<WorkflowStageDraft>[] = [
    {
      id: 'step',
      header: t('settings.sampleWorkflows.step'),
      cell: ({ row }) => (
        <>
          <span className="font-medium text-fg">
            {row.original.name || t('settings.sampleWorkflows.unnamedStep')}
          </span>
          {row.original.final ? (
            <span className="ml-2 text-label text-fg-muted">
              {t('settings.sampleWorkflows.endsWorkflow')}
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: 'movesTo',
      header: t('settings.sampleWorkflows.movesTo'),
      cell: ({ row }) =>
        row.original.final
          ? '–'
          : row.original.next.map(nameOf).join(', ') || '–',
    },
    {
      id: 'turnaround',
      header: t('settings.sampleWorkflows.turnaround'),
      cell: ({ row }) =>
        row.original.turnaroundDays
          ? t('settings.sampleWorkflows.days', {
              count: Number(row.original.turnaroundDays),
            })
          : '–',
    },
    {
      id: 'needs',
      header: t('settings.sampleWorkflows.needs'),
      cell: ({ row }) => row.original.requiredFields.join(', ') || '–',
    },
    {
      id: 'automations',
      header: t('settings.sampleWorkflows.automations'),
      cell: ({ row }) => {
        const text = row.original.actions.map(describeAction).join('; ')

        return (
          <span className="block max-w-[14rem] truncate" title={text}>
            {text || '–'}
          </span>
        )
      },
    },
    ...(canManage
      ? [
          {
            id: 'order',
            header: '',
            enableHiding: false,
            cell: ({ row }) => (
              <span className="flex gap-0.5">
                <IconButton
                  label={t('settings.sampleWorkflows.moveUp')}
                  icon="chevronUp"
                  disabled={row.index === 0}
                  onClick={(event) => {
                    event.stopPropagation()
                    onMove(row.index, -1)
                  }}
                />
                <IconButton
                  label={t('settings.sampleWorkflows.moveDown')}
                  icon="chevronDown"
                  disabled={row.index === stages.length - 1}
                  onClick={(event) => {
                    event.stopPropagation()
                    onMove(row.index, 1)
                  }}
                />
              </span>
            ),
          } satisfies RegistryColumn<WorkflowStageDraft>,
        ]
      : []),
  ]

  return (
    <>
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-section">
          {t('settings.sampleWorkflows.stepsHeading')}
        </h2>
        <span className="flex-1" />
        {canManage ? (
          <Button icon="plus" onClick={onAdd}>
            {t('settings.sampleWorkflows.addStep')}
          </Button>
        ) : null}
      </div>
      <TableBox>
        <RegistryGrid
          label={t('settings.sampleWorkflows.stepsHeading')}
          rows={stages}
          columns={columns}
          getRowId={(stage) => stage.key}
          rowSelection={selectedKey ? { [selectedKey]: true } : {}}
          onRowClick={(stage) => onSelect(stage.key)}
          sortable={false}
        />
      </TableBox>
    </>
  )
}

function StageEditor({
  stage,
  others,
  canManage,
  canRemove,
  workspaceId,
  client,
  onChange,
  onRemove,
}: {
  stage: WorkflowStageDraft
  others: WorkflowStageDraft[]
  canManage: boolean
  canRemove: boolean
  workspaceId: string
  client: DataClient
  onChange: (changes: Partial<WorkflowStageDraft>) => void
  onRemove: () => void
}) {
  const [fieldInput, setFieldInput] = useState('')
  const nextStages = new Set(stage.next)

  const addField = () => {
    const field = fieldInput.trim()

    if (field && !stage.requiredFields.includes(field))
      onChange({ requiredFields: [...stage.requiredFields, field] })
    setFieldInput('')
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="m-0 text-section">
        {stage.name || t('settings.sampleWorkflows.unnamedStep')}
      </h2>
      <fieldset
        disabled={!canManage}
        className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
      >
        <Field label={t('settings.sampleWorkflows.stepName')} required>
          <Input
            value={stage.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </Field>
        <Field label={t('settings.sampleWorkflows.description')}>
          <Input
            value={stage.description}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </Field>
        <Field
          label={t('settings.sampleWorkflows.turnaroundDays')}
          hint={t('settings.sampleWorkflows.turnaroundHint')}
        >
          <Input
            inputMode="numeric"
            value={stage.turnaroundDays}
            onChange={(event) =>
              onChange({ turnaroundDays: event.target.value })
            }
          />
        </Field>
        <label className="flex items-start gap-2 text-body">
          <Checkbox
            checked={stage.final}
            onCheckedChange={(checked) => onChange({ final: checked })}
          />
          <span className="flex flex-col">
            <span className="font-medium text-fg">
              {t('settings.sampleWorkflows.finalStep')}
            </span>
            <span className="text-label text-fg-muted">
              {t('settings.sampleWorkflows.finalStepHint')}
            </span>
          </span>
        </label>

        {stage.final ? null : (
          <div className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-fg">
              {t('settings.sampleWorkflows.canMoveTo')}
            </span>
            {others.length === 0 ? (
              <Muted>{t('settings.sampleWorkflows.noOtherSteps')}</Muted>
            ) : null}
            {others.map((other) => (
              <label
                key={other.key}
                className="flex items-center gap-2 text-body"
              >
                <Checkbox
                  checked={nextStages.has(other.key)}
                  onCheckedChange={(checked) =>
                    onChange({
                      next: checked
                        ? [...stage.next, other.key]
                        : stage.next.filter((n) => n !== other.key),
                    })
                  }
                />
                {other.name || t('settings.sampleWorkflows.unnamedStep')}
              </label>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-fg">
            {t('settings.sampleWorkflows.mustBeFilledIn')}
          </span>
          <span className="text-label text-fg-muted">
            {t('settings.sampleWorkflows.mustBeFilledInHint')}
          </span>
          {stage.requiredFields.map((field) => (
            <span key={field} className="flex items-center gap-2 text-body">
              <span className="flex-1">{field}</span>
              <Button
                size="sm"
                variant="quiet"
                onClick={() =>
                  onChange({
                    requiredFields: stage.requiredFields.filter(
                      (f) => f !== field,
                    ),
                  })
                }
              >
                {t('common.actions.remove')}
              </Button>
            </span>
          ))}
          <div className="flex gap-2">
            <Input
              aria-label={t('settings.sampleWorkflows.fieldName')}
              list="sample-workflow-fields"
              value={fieldInput}
              onChange={(event) => setFieldInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addField()
                }
              }}
            />
            <datalist id="sample-workflow-fields">
              {COMMON_SAMPLE_FIELDS.map((field) => (
                <option key={field} value={field} />
              ))}
            </datalist>
            <Button onClick={addField} disabled={!fieldInput.trim()}>
              {t('settings.sampleWorkflows.addField')}
            </Button>
          </div>
        </div>

        <WorkflowAutomations
          initialActions={stage.actions}
          workspaceId={workspaceId}
          client={client}
          onChange={(actions) => onChange({ actions })}
        />
      </fieldset>
      {canManage ? (
        <div>
          <Button variant="danger" disabled={!canRemove} onClick={onRemove}>
            {t('settings.sampleWorkflows.removeStep')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** StageEditor is keyed by stage.key, so each stage owns its unsaved automation identities. */
function WorkflowAutomations({
  initialActions,
  workspaceId,
  client,
  onChange,
}: {
  initialActions: WorkflowAction[]
  workspaceId: string
  client: DataClient
  onChange: (actions: WorkflowAction[]) => void
}) {
  const [drafts, setDrafts] = useState(() =>
    initialActions.map((action) => ({ id: crypto.randomUUID(), action })),
  )

  const templates = useQuery({
    queryKey: ['notebook-templates-for-workflows', workspaceId],
    queryFn: () =>
      client.list<{ id: string; name: string }>(
        'notebook_templates',
        '?select=id,name&lifecycle=eq.active&order=name',
      ),
    enabled:
      Boolean(workspaceId) &&
      drafts.some(({ action }) => action.kind === 'start_experiment'),
  })

  const change = (next: typeof drafts) => {
    setDrafts(next)
    onChange(next.map(({ action }) => action))
  }

  const setAction = (id: string, action: WorkflowAction) =>
    change(
      drafts.map((draft) => (draft.id === id ? { ...draft, action } : draft)),
    )

  return (
    <div className="flex flex-col gap-2">
      <span className="text-label font-medium text-fg">
        {t('settings.sampleWorkflows.whenItArrives')}
      </span>
      {drafts.length === 0 ? (
        <Muted>{t('settings.sampleWorkflows.noAutomations')}</Muted>
      ) : null}
      {drafts.map(({ id, action }) => (
        <div
          key={id}
          className="flex flex-col gap-2 rounded-md border border-border p-3"
        >
          <div className="flex items-end gap-2">
            <Field
              label={t('settings.sampleWorkflows.automation')}
              className="min-w-0 flex-1"
            >
              <Select
                value={action.kind}
                onChange={(event) => {
                  const kind = ACTION_KINDS.find(
                    (option) => option === event.target.value,
                  )

                  if (kind) setAction(id, blankAction(kind))
                }}
              >
                {ACTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`settings.sampleWorkflows.kinds.${kind}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => change(drafts.filter((draft) => draft.id !== id))}
            >
              {t('common.actions.remove')}
            </Button>
          </div>
          {action.kind === 'notify' ? (
            <>
              <Field label={t('settings.sampleWorkflows.tell')}>
                <Select
                  value={action.to}
                  onChange={(event) =>
                    setAction(id, { ...action, to: event.target.value })
                  }
                >
                  <option value="owner">
                    {t('settings.sampleWorkflows.audience.owner')}
                  </option>
                  {NOTIFY_ROLES.map((role) => (
                    <option key={role} value={`role:${role}`}>
                      {t('settings.sampleWorkflows.audience.role', { role })}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('settings.sampleWorkflows.messageOptional')}>
                <Input
                  value={action.message ?? ''}
                  onChange={(event) =>
                    setAction(id, { ...action, message: event.target.value })
                  }
                />
              </Field>
            </>
          ) : null}
          {action.kind === 'set_field' ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('settings.sampleWorkflows.fieldName')}>
                <Input
                  list="sample-workflow-fields"
                  value={action.key}
                  onChange={(event) =>
                    setAction(id, { ...action, key: event.target.value })
                  }
                />
              </Field>
              <Field label={t('settings.sampleWorkflows.setTo')}>
                <Input
                  value={action.value}
                  onChange={(event) =>
                    setAction(id, { ...action, value: event.target.value })
                  }
                />
              </Field>
            </div>
          ) : null}
          {action.kind === 'quarantine' ? (
            <Field label={t('settings.sampleWorkflows.reasonOptional')}>
              <Input
                value={action.reason ?? ''}
                onChange={(event) =>
                  setAction(id, { ...action, reason: event.target.value })
                }
              />
            </Field>
          ) : null}
          {action.kind === 'start_experiment' ? (
            <Field label={t('settings.sampleWorkflows.fromTemplate')}>
              <Select
                value={action.templateId}
                onChange={(event) =>
                  setAction(id, { ...action, templateId: event.target.value })
                }
              >
                <option value="">
                  {t('settings.sampleWorkflows.chooseTemplate')}
                </option>
                {(templates.data ?? []).map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {validateAction(action) ? (
            <span className="text-label text-danger-text">
              {validateAction(action)}
            </span>
          ) : null}
        </div>
      ))}
      <div>
        <Button
          icon="plus"
          onClick={() =>
            change([
              ...drafts,
              { id: crypto.randomUUID(), action: blankAction('notify') },
            ])
          }
        >
          {t('settings.sampleWorkflows.addAutomation')}
        </Button>
      </div>
    </div>
  )
}
