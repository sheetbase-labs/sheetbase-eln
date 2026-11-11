import { rich, t } from '#/copy'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { useMemo, useState } from 'react'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { Notice } from '#/components/ui/alert'
import { Select } from '#/components/ui/select'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { TableBox } from '#/components/ui/table'
import type { PipelineRunPromptAnswer } from '#/lib/pipelines/data'
import { PARAMETER_TYPES } from '#/lib/pipelines/config'
import type { PipelineConfirmField } from '#/lib/pipelines/config'
import {
  pipelineJsonObjectSchema,
  pipelineJsonValueSchema,
} from '#/lib/pipelines/types'
import type { PipelineRunPromptWire } from '#/lib/pipelines/types'

/**
 * PIPE-02.4 — the waiting run's confirm step. A `waiting` run raised one
 * pipeline_run_prompts row: the author's typed form schema, the people asked,
 * and (once given) the answer, its author and its time. The panel renders the
 * proposal the step wants confirmed, the form controls the author typed, and
 * the controls that answer it. An answered prompt shows the decision and who
 * made it instead. Nothing is fabricated: a prompt-less run renders nothing.
 */

/** The author's confirm-step field vocabulary (PipelineConfirmField). */
export type PromptFieldType = PipelineConfirmField['type']

export interface PromptField {
  key: string
  label: string
  type: PromptFieldType
  required: boolean
  options: string[]
}

export interface PromptFormSchema {
  title: string | null
  description: string | null
  fields: PromptField[]
  proposalStep: string | null
  proposalColumns: string[]
  proposalRows: z.infer<typeof pipelineJsonObjectSchema>[]
}

const stringListSchema = z
  .array(pipelineJsonValueSchema)
  .catch([])
  .transform((values) =>
    values.flatMap((value) => {
      const parsed = z.string().safeParse(value)

      return parsed.success ? [parsed.data] : []
    }),
  )

const promptFieldSchema = z
  .object({
    key: z.string(),
    label: z.string().optional().catch(undefined),
    type: z.enum(PARAMETER_TYPES).catch('text'),
    required: z.boolean().catch(false),
    options: stringListSchema,
  })
  .transform((field): PromptField => ({
    ...field,
    label: field.label ?? field.key,
  }))

const proposalSchema = z
  .object({
    step: z.string().nullable().catch(null),
    rows: z
      .array(pipelineJsonValueSchema)
      .catch([])
      .transform((rows) =>
        rows.flatMap((row) => {
          const parsed = pipelineJsonObjectSchema.safeParse(row)

          return parsed.success ? [parsed.data] : []
        }),
      ),
  })
  .catch({ step: null, rows: [] })

const promptFormSchema = z.object({
  title: z.string().nullable().catch(null),
  description: z.string().nullable().catch(null),
  fields: z
    .array(pipelineJsonValueSchema)
    .catch([])
    .transform((fields) =>
      fields.flatMap((field) => {
        const parsed = promptFieldSchema.safeParse(field)

        return parsed.success ? [parsed.data] : []
      }),
    ),
  proposal: proposalSchema,
})

/** Read the author's jsonb form schema without trusting its shape. */
function readPromptFormSchema(
  raw: PipelineRunPromptWire['form_schema'],
): PromptFormSchema {
  const parsed = promptFormSchema.parse(raw)
  const rows = parsed.proposal.rows
  const columns = rows.length ? Object.keys(rows[0]) : []

  return {
    title: parsed.title,
    description: parsed.description,
    fields: parsed.fields,
    proposalStep: parsed.proposal.step,
    proposalColumns: columns,
    proposalRows: rows,
  }
}

const DECISION_LABELS = new Map([
  ['confirm', t('data.runPrompt.confirmed')],
  ['skip', t('data.runPrompt.skippedStep')],
  ['stop', t('data.runPrompt.stoppedRun')],
])

export interface PromptAnswerView {
  decision: string
  values: { label: string; value: string }[]
  reason: string | null
}

function displayValue(
  value: z.infer<typeof pipelineJsonValueSchema> | undefined,
): string {
  if (value === null || value === undefined) return '—'

  const primitive = z
    .union([z.string(), z.number(), z.boolean()])
    .safeParse(value)

  if (primitive.success) return String(primitive.data)

  return JSON.stringify(value)
}

/** Read an answered prompt's answer: the decision, the field values and why. */
function readPromptAnswer(
  prompt: PipelineRunPromptWire,
  schema: PromptFormSchema,
): PromptAnswerView | null {
  const answer = prompt.answer

  if (!answer) return null

  const rawValues = pipelineJsonObjectSchema.catch({}).parse(answer.values)

  const labelByKey = Object.fromEntries(
    schema.fields.map((f) => [f.key, f.label]),
  )

  const decision = z.string().safeParse(answer.decision)

  return {
    decision: decision.success
      ? (DECISION_LABELS.get(decision.data) ?? decision.data)
      : t('data.runPrompt.answered'),
    values: Object.entries(rawValues).map(([key, value]) => ({
      label: labelByKey[key] ?? key,
      value: displayValue(value),
    })),
    reason: z.string().nullable().catch(null).parse(answer.reason),
  }
}

function formatMoment(iso: string | null): string {
  return iso ? formatNotebookDateTime(iso, { zone: true }) : ''
}

export interface RunPromptPanelProps {
  prompt: PipelineRunPromptWire
  /** The run is still `waiting`, so the prompt can be answered. */
  canAnswer: boolean
  /** user id → display name for the asked people and the answerer. */
  nameOf?: (userId: string) => string
  onAnswer?: (answer: PipelineRunPromptAnswer) => void
  submitting?: boolean
  error?: string | null
}

type ProposalRow = {
  key: string
  row: PromptFormSchema['proposalRows'][number]
}

function ProposalTable({ schema }: { schema: PromptFormSchema }) {
  if (!schema.proposalColumns.length) return null

  return <ProposalGrid schema={schema} />
}

function ProposalGrid({ schema }: { schema: PromptFormSchema }) {
  const rows = useMemo<ProposalRow[]>(() => {
    const occurrences = new Map<string, number>()

    return schema.proposalRows.map((row) => {
      const content = JSON.stringify(row)
      const occurrence = occurrences.get(content) ?? 0
      occurrences.set(content, occurrence + 1)

      return { row, key: `${content}:${occurrence}` }
    })
  }, [schema.proposalRows])

  const columns = useMemo<RegistryColumn<ProposalRow>[]>(
    () =>
      schema.proposalColumns.map((column) => ({
        id: column,
        header: column.replaceAll('_', ' '),
        accessorFn: (entry: ProposalRow) => displayValue(entry.row[column]),
        cell: ({ row }) => displayValue(row.original.row[column]),
      })),
    [schema.proposalColumns],
  )

  return (
    <TableBox>
      <RegistryGrid
        label={t('data.runPrompt.ariaWhatStepProposes')}
        rows={rows}
        columns={columns}
        getRowId={(entry) => entry.key}
        selectable={false}
      />
    </TableBox>
  )
}

function PromptFieldInput({
  field,
  value,
  onChange,
}: {
  field: PromptField
  value: string | boolean | undefined
  onChange: (value: string | boolean) => void
}) {
  const label = (
    <span>
      {field.label}
      {field.required ? (
        <span className="text-fg-muted"> {t('data.runPrompt.required')}</span>
      ) : null}
    </span>
  )

  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-label">
        <Checkbox checked={value === true} onCheckedChange={onChange} />
        {label}
      </label>
    )
  }

  if (field.type === 'text' && field.options.length) {
    return (
      <Field label={label} required={field.required}>
        <Select
          aria-label={field.label}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{t('data.runPrompt.choose')}</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </Field>
    )
  }

  const inputType =
    field.type === 'integer' || field.type === 'decimal'
      ? 'number'
      : field.type === 'date'
        ? 'date'
        : field.type === 'timestamp'
          ? 'datetime-local'
          : 'text'

  return (
    <Field label={label} required={field.required}>
      <Input
        aria-label={field.label}
        type={inputType}
        step={field.type === 'decimal' ? 'any' : undefined}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

function AnsweredPrompt({
  prompt,
  answer,
  title,
  nameOf,
}: {
  prompt: PipelineRunPromptWire
  answer: PromptAnswerView
  title: string
  nameOf: (userId: string) => string
}) {
  return (
    <section
      aria-label={t('data.runPrompt.ariaAnsweredPrompt')}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3"
    >
      <h2 className="font-sans text-label font-semibold">{title}</h2>
      <p className="m-0 text-body">
        <span className="font-medium text-fg">{answer.decision}</span>
        {answer.values.length ? (
          <span className="text-fg-muted">
            {' · '}
            {answer.values.map((v) => `${v.label}: ${v.value}`).join(' · ')}
          </span>
        ) : null}
      </p>
      {answer.reason ? (
        <p className="m-0 text-body text-fg-muted">{answer.reason}</p>
      ) : null}
      <p className="m-0 text-caption text-fg-muted">
        {prompt.answered_by_user_id
          ? t('data.runPrompt.answeredBy', {
              value: nameOf(prompt.answered_by_user_id),
            })
          : t('data.runPrompt.answered')}
        {prompt.answered_at ? ` on ${formatMoment(prompt.answered_at)}` : ''}{' '}
        {t('data.runPrompt.step', { stepId: prompt.step_id })}
      </p>
    </section>
  )
}

export function RunPromptPanel({
  prompt,
  canAnswer,
  nameOf = (id) => id,
  onAnswer,
  submitting = false,
  error = null,
}: RunPromptPanelProps) {
  const schema = readPromptFormSchema(prompt.form_schema)
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  const title =
    schema.title ?? t('data.runPrompt.confirm', { stepId: prompt.step_id })

  const answer = readPromptAnswer(prompt, schema)
  const asked = prompt.asked_user_ids.map(nameOf)

  function submit(decision: PipelineRunPromptAnswer['decision']) {
    if (decision !== 'stop' && reason.trim() === '') {
      setReasonError(t('data.runPrompt.sayWhySoDecision'))

      return
    }

    setReasonError(null)
    onAnswer?.({ decision, values, reason: reason.trim() || undefined })
  }

  if (answer) {
    return (
      <AnsweredPrompt
        prompt={prompt}
        answer={answer}
        title={title}
        nameOf={nameOf}
      />
    )
  }

  return (
    <section
      aria-label={t('data.runPrompt.ariaWaitingPrompt')}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3"
    >
      <h2 className="font-sans text-label font-semibold">{title}</h2>
      {schema.description ? (
        <p className="m-0 max-w-[720px] text-body text-fg-muted">
          {schema.description}
        </p>
      ) : null}

      <ProposalTable schema={schema} />

      {!canAnswer ? (
        <Notice tone="info">
          {rich('data.runPrompt.runLongerWaitingAnswer', {
            step: <span className="mono">{prompt.step_id}</span>,
          })}
        </Notice>
      ) : (
        <div className="flex flex-col gap-3">
          {schema.fields.map((field) => (
            <PromptFieldInput
              key={field.key}
              field={field}
              value={values[field.key]}
              onChange={(value) =>
                setValues((v) => ({ ...v, [field.key]: value }))
              }
            />
          ))}

          <Field
            label={
              <span>
                {t('data.runPrompt.reason')}{' '}
                <span className="text-fg-muted">
                  {t('data.runPrompt.required')}
                </span>
              </span>
            }
            error={reasonError}
          >
            <Input
              aria-label={t('data.runPrompt.reason')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>

          {error ? <Notice tone="bad">{error}</Notice> : null}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={submitting}
              onClick={() => submit('confirm')}
            >
              {t('data.runPrompt.confirmContinue')}
            </Button>
            <Button disabled={submitting} onClick={() => submit('skip')}>
              {t('data.runPrompt.skipStep')}
            </Button>
            <Button
              variant="quiet"
              disabled={submitting}
              onClick={() => submit('stop')}
            >
              {t('data.runPrompt.stopRun')}
            </Button>
          </div>

          <p className="m-0 text-caption leading-[18px] text-fg-muted">
            {rich('data.runPrompt.skippingLeavesReportedValues', {
              step: <span className="mono">{prompt.step_id}</span>,
              when: formatMoment(prompt.created_at),
            })}{' '}
            {prompt.expires_at
              ? t('data.runPrompt.ifNobodyAnswersRun', {
                  when: formatMoment(prompt.expires_at),
                })
              : null}{' '}
            {asked.length
              ? t('data.runPrompt.asked', { names: asked.join(', ') })
              : t('data.runPrompt.oneNamed')}
          </p>
        </div>
      )}
    </section>
  )
}
