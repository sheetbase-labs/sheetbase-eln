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
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { isUuid } from '#/lib/field-value-validation'
import { createModelRule, removeModelRule } from '#/lib/model-rules'
import type { ModelRuleCondition, ModelRuleEffect } from '#/lib/model-rules'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  useModelRules,
  useRecordModelFields,
  useWorkspaceRecordModel,
} from '#/components/v3/models/models-data'

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
  { value: 'warn', label: 'Warn' },
  { value: 'block', label: 'Block' },
  { value: 'flag_block_submit', label: 'Flag and block submission' },
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
          title="Rules apply to record models"
          body="This is a dataset schema. Model rules attach to a record model's fields, so author them from the model that defines those records."
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
        caught instanceof Error ? caught.message : 'Could not save rule.',
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
        caught instanceof Error ? caught.message : 'Could not remove the rule.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-auto px-4 py-4 md:px-6">
      <Section title="Rules" count={rows.length}>
        <Muted>
          Rules apply to {model.data?.name ?? modelKey}&rsquo;s fields and run
          on the server when a record is written or submitted. A block refuses
          the write; a flag blocks submission until it is cleared.
        </Muted>
        {removeError ? (
          <p role="alert" className="m-0 text-label text-danger-text">
            {removeError}
          </p>
        ) : null}
        {rows.length ? (
          <TableBox>
            <Table aria-label="Model rules">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Applies to</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Effect</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.name}</TableCell>
                    <TableCell className="text-fg-muted">
                      {rule.fieldKeys.join(', ')}
                    </TableCell>
                    <TableCell className="mono text-fg-muted">
                      {describeCondition(rule.condition)}
                    </TableCell>
                    <TableCell>{rule.effect}</TableCell>
                    <TableCell className="text-fg-muted">
                      {rule.message}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="quiet"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          setPendingRemove({ id: rule.id, name: rule.name })
                        }
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <EmptyState
            icon="schema"
            title="No rules yet"
            body="Add a rule to make the model enforce a condition in the write and submit paths."
          />
        )}
      </Section>

      <Section title="Add a rule">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-xs text-fg-muted">
              Name *
              <Input
                className="mt-1 h-8 text-xs"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-label="Rule name"
              />
            </label>
            <label className="text-xs text-fg-muted">
              Effect
              <Select
                className="mt-1 h-8 text-xs"
                value={effect}
                onChange={(event) =>
                  setEffect(event.target.value as ModelRuleEffect)
                }
                aria-label="Rule effect"
              >
                {EFFECTS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-fg-muted">
              Field
              <Select
                className="mt-1 h-8 text-xs"
                value={conditionFieldName}
                onChange={(event) => setConditionField(event.target.value)}
                aria-label="Rule field"
              >
                {fieldOptions.map((field) => (
                  <option key={field.fieldName} value={field.fieldName}>
                    {field.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-fg-muted">
              Condition
              <div className="mt-1 flex gap-2">
                <Select
                  className="h-8 text-xs"
                  value={op}
                  onChange={(event) => setOp(event.target.value as Op)}
                  aria-label="Rule operator"
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
                  aria-label="Rule value"
                  placeholder="value"
                />
              </div>
            </label>
          </div>

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1 text-xs text-fg-muted">Applies to *</legend>
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
            Message *
            <Input
              className="mt-1 h-8 text-xs"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              aria-label="Rule message"
            />
          </label>

          {error ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {error}
            </p>
          ) : null}

          <div>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {busy ? 'Saving…' : 'Add rule'}
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
              Remove the “{pendingRemove?.name}” rule?
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              The model stops enforcing this rule on the next write or
              submission. This cannot be undone.
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>Cancel</ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="danger-fill"
              disabled={busy}
              onClick={() => {
                if (!pendingRemove) return
                void remove(pendingRemove.id)
                setPendingRemove(null)
              }}
            >
              Remove rule
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}
