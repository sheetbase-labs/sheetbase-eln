import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Input } from '#/components/v3/ui/input'
import { Muted, Section } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import { TableBox } from '#/components/v3/ui/table'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { builtInModel } from '#/lib/built-in-models'
import { isUuid } from '#/lib/field-value-validation'
import { createModelRule, removeModelRule } from '#/lib/model-rules'
import type { ModelRuleCondition, ModelRuleEffect } from '#/lib/model-rules'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  useModelRules,
  useRecordModelFields,
  useWorkspaceRecordModel,
} from '#/components/v3/models/models-data'
import { t } from '#/copy'

/**
 * UI port (roadmap-4/ui-app3): the Rules tab authors `api.model_rules`. Rules
 * key by a record model (built-in kind or workspace model, ADR-0051) and are
 * enforced by the canonical write and submit paths.
 */
export const Route = createFileRoute('/models/$modelId/rules')({
  component: ModelRules,
})

const OPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'in', 'not_in'] as const
type Op = (typeof OPS)[number]

const EFFECTS: Array<{ value: ModelRuleEffect; label: string }> = [
  { value: 'warn', label: t('library.models.rules.warn') },
  { value: 'block', label: t('library.models.rules.block') },
  {
    value: 'flag_block_submit',
    label: t('library.models.rules.flagAndBlockSubmission'),
  },
]

function parseConditionValue(op: Op, raw: string): unknown {
  if (op === 'in' || op === 'not_in') {
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => (Number.isFinite(Number(entry)) ? Number(entry) : entry))
  }
  if (raw.trim() === '') return null
  return Number.isFinite(Number(raw)) ? Number(raw) : raw
}

function describeCondition(condition: ModelRuleCondition): string {
  if ('field' in condition && condition.field) {
    const value = Array.isArray(condition.value)
      ? condition.value.join(', ')
      : String(condition.value ?? '')
    return `${condition.field} ${condition.op ?? 'eq'} ${value}`.trim()
  }
  return 'always'
}

function ModelRules() {
  const { modelId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''

  // Rules apply to record models, not dataset schemas: a dataset schema's
  // fields live in `dataset_schema_version_fields`, which `model_rules` does
  // not read. Tell the truth rather than offer a form that cannot save.
  if (isUuid(modelId)) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          icon="schema"
          title={t('library.models.rules.rulesApplyToRecordModels')}
          description={t('library.models.rules.thisIsADatasetSchema')}
        />
      </div>
    )
  }
  return <RecordModelRules modelKey={modelId} workspaceId={workspaceId} />
}

function RecordModelRules({
  modelKey,
  workspaceId,
}: {
  modelKey: string
  workspaceId: string
}) {
  const model = useWorkspaceRecordModel(modelKey)
  const fieldsQuery = useRecordModelFields(modelKey)
  const rules = useModelRules(modelKey)
  const fieldOptions = fieldsQuery.data ?? []

  const [name, setName] = useState('')
  const [fieldKeys, setFieldKeys] = useState<string[]>([])
  const [conditionField, setConditionField] = useState('')
  const [op, setOp] = useState<Op>('gt')
  const [value, setValue] = useState('')
  const [effect, setEffect] = useState<ModelRuleEffect>('warn')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<{
    id: string
    name: string
  } | null>(null)

  const rows = rules.data ?? []
  const conditionFieldName = conditionField || fieldOptions[0]?.fieldName || ''
  const canSubmit =
    Boolean(workspaceId) &&
    name.trim().length > 0 &&
    fieldKeys.length > 0 &&
    message.trim().length > 0 &&
    conditionFieldName.length > 0 &&
    !busy

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await createModelRule(notebookDataClient, {
        workspaceId,
        modelKey,
        name: name.trim(),
        fieldKeys,
        condition: {
          field: conditionFieldName,
          op,
          value: parseConditionValue(op, value),
        },
        effect,
        message: message.trim(),
      })
      setName('')
      setFieldKeys([])
      setValue('')
      setMessage('')
      await rules.refetch()
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t('library.models.rules.couldNotSaveRule'),
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    setRemoveError(null)
    try {
      await removeModelRule(notebookDataClient, id)
      await rules.refetch()
    } catch (caught) {
      setRemoveError(
        caught instanceof Error
          ? caught.message
          : t('library.models.rules.couldNotRemoveTheRule'),
      )
    } finally {
      setBusy(false)
    }
  }

  const columns: RegistryColumn<(typeof rows)[number]>[] = [
    {
      id: 'name',
      header: t('library.models.rules.name'),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      id: 'appliesTo',
      header: t('library.models.rules.appliesTo'),
      cell: ({ row }) => row.original.fieldKeys.join(', '),
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'when',
      header: t('library.models.rules.when'),
      cell: ({ row }) => (
        <span className="mono">
          {describeCondition(row.original.condition)}
        </span>
      ),
      meta: { cellClassName: 'mono text-fg-muted' },
    },
    {
      id: 'effect',
      header: t('library.models.rules.effect'),
      cell: ({ row }) => row.original.effect,
    },
    {
      id: 'message',
      header: t('library.models.rules.message'),
      cell: ({ row }) => row.original.message,
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'actions',
      header: () => (
        <span className="sr-only">{t('library.models.rules.actions')}</span>
      ),
      cell: ({ row }) => (
        <Button
          variant="quiet"
          size="sm"
          disabled={busy}
          onClick={() =>
            setPendingRemove({ id: row.original.id, name: row.original.name })
          }
        >
          {t('common.actions.remove')}
        </Button>
      ),
    },
  ]

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-auto px-4 py-4 md:px-6">
      <Section title={t('library.models.rules.rules')} count={rows.length}>
        <Muted>
          {t('library.models.rules.rulesApplyToSFields', {
            name: model.data?.name ?? builtInModel(modelKey)?.name ?? modelKey,
          })}
        </Muted>
        {removeError ? (
          <p role="alert" className="m-0 text-label text-danger-text">
            {removeError}
          </p>
        ) : null}
        {rows.length ? (
          <TableBox>
            <RegistryGrid
              label={t('library.models.rules.modelRules')}
              rows={rows}
              columns={columns}
              getRowId={(rule) => rule.id}
              selectable={false}
            />
          </TableBox>
        ) : (
          <EmptyState
            icon="schema"
            title={t('library.models.rules.noRulesYet')}
            description={t('library.models.rules.addARuleBelowTo')}
          />
        )}
      </Section>

      <Section title={t('library.models.rules.addARule')}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-xs text-fg-muted">
              {t('library.models.rules.name2')}
              <Input
                className="mt-1 h-8 text-xs"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-label={t('library.models.rules.ruleName')}
              />
            </label>
            <label className="text-xs text-fg-muted">
              {t('library.models.rules.effect')}
              <Select
                className="mt-1 h-8 text-xs"
                value={effect}
                onChange={(event) =>
                  setEffect(event.target.value as ModelRuleEffect)
                }
                aria-label={t('library.models.rules.ruleEffect')}
              >
                {EFFECTS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-fg-muted">
              {t('library.models.rules.field')}
              <Select
                className="mt-1 h-8 text-xs"
                value={conditionFieldName}
                onChange={(event) => setConditionField(event.target.value)}
                aria-label={t('library.models.rules.ruleField')}
              >
                {fieldOptions.map((field) => (
                  <option key={field.fieldName} value={field.fieldName}>
                    {field.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-fg-muted">
              {t('library.models.rules.condition')}
              <div className="mt-1 flex gap-2">
                <Select
                  className="h-8 text-xs"
                  value={op}
                  onChange={(event) => setOp(event.target.value as Op)}
                  aria-label={t('library.models.rules.ruleOperator')}
                >
                  {OPS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </Select>
                <Input
                  className="h-8 text-xs"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  aria-label={t('library.models.rules.ruleValue')}
                  placeholder="value"
                />
              </div>
            </label>
          </div>

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1 text-xs text-fg-muted">
              {t('library.models.rules.appliesTo2')}
            </legend>
            <div className="flex flex-wrap gap-3">
              {fieldOptions.map((field) => (
                <label
                  key={field.fieldName}
                  className="flex items-center gap-1.5 text-xs"
                >
                  <Checkbox
                    checked={fieldKeys.includes(field.fieldName)}
                    onCheckedChange={(checked) =>
                      setFieldKeys((current) =>
                        checked === true
                          ? [...current, field.fieldName]
                          : current.filter((key) => key !== field.fieldName),
                      )
                    }
                    aria-label={field.label}
                  />
                  {field.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="text-xs text-fg-muted">
            {t('library.models.rules.message2')}
            <Input
              className="mt-1 h-8 text-xs"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              aria-label={t('library.models.rules.ruleMessage')}
            />
          </label>

          {error ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {error}
            </p>
          ) : null}

          <div>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {busy
                ? t('common.states.saving')
                : t('library.models.rules.addRule')}
            </Button>
          </div>
        </form>
      </Section>

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('library.models.rules.removeTheRule', {
                name: pendingRemove?.name ?? '',
              })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('library.models.rules.theModelStopsEnforcingThis')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="danger-fill"
              disabled={busy}
              onClick={() => {
                if (!pendingRemove) return
                void remove(pendingRemove.id)
                setPendingRemove(null)
              }}
            >
              {t('library.models.rules.removeRule')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}
