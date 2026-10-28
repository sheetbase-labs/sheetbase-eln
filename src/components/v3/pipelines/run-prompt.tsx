import { formatNotebookDateTime } from '#/lib/notebook-data'
import { useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
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
import type { PipelineRunPromptAnswer } from '#/lib/pipelines/data'
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
export type PromptFieldType =
  'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'timestamp'

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
  proposalRows: Record<string, unknown>[]
}

const FIELD_TYPES: readonly PromptFieldType[] = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
]

/** Read the author's jsonb form schema without trusting its shape. */
export function readPromptFormSchema(
  raw: Record<string, unknown>,
): PromptFormSchema {
  const fields: PromptField[] = Array.isArray(raw.fields)
    ? raw.fields.flatMap((entry): PromptField[] => {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
          return []
        const field = entry as Record<string, unknown>
        if (typeof field.key !== 'string') return []
        const type = FIELD_TYPES.includes(field.type as PromptFieldType)
          ? (field.type as PromptFieldType)
          : 'text'
        return [
          {
            key: field.key,
            label: typeof field.label === 'string' ? field.label : field.key,
            type,
            required: field.required === true,
            options: Array.isArray(field.options)
              ? field.options.filter((o): o is string => typeof o === 'string')
              : [],
          },
        ]
      })
    : []
  const proposal = raw.proposal
  const proposalRecord =
    proposal !== null &&
    typeof proposal === 'object' &&
    !Array.isArray(proposal)
      ? (proposal as Record<string, unknown>)
      : null
  const proposalRows: unknown[] =
    proposalRecord && Array.isArray(proposalRecord.rows)
      ? proposalRecord.rows
      : []
  const rows = proposalRows.filter(
    (row): row is Record<string, unknown> =>
      row !== null && typeof row === 'object' && !Array.isArray(row),
  )
  const columns = rows.length ? Object.keys(rows[0]) : []
  return {
    title: typeof raw.title === 'string' ? raw.title : null,
    description: typeof raw.description === 'string' ? raw.description : null,
    fields,
    proposalStep:
      proposalRecord && typeof proposalRecord.step === 'string'
        ? proposalRecord.step
        : null,
    proposalColumns: columns,
    proposalRows: rows,
  }
}

const DECISION_LABELS: Record<string, string> = {
  confirm: 'Confirmed',
  skip: 'Skipped this step',
  stop: 'Stopped the run',
}

export interface PromptAnswerView {
  decision: string
  values: { label: string; value: string }[]
  reason: string | null
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return JSON.stringify(value)
}

/** Read an answered prompt's answer: the decision, the field values and why. */
export function readPromptAnswer(
  prompt: PipelineRunPromptWire,
  schema: PromptFormSchema,
): PromptAnswerView | null {
  const answer = prompt.answer
  if (!answer) return null
  const rawValues =
    answer.values !== null &&
    typeof answer.values === 'object' &&
    !Array.isArray(answer.values)
      ? (answer.values as Record<string, unknown>)
      : {}
  const labelByKey = Object.fromEntries(
    schema.fields.map((f) => [f.key, f.label]),
  )
  return {
    decision:
      typeof answer.decision === 'string'
        ? (DECISION_LABELS[answer.decision] ?? answer.decision)
        : 'Answered',
    values: Object.entries(rawValues).map(([key, value]) => ({
      label: labelByKey[key] ?? key,
      value: displayValue(value),
    })),
    reason: typeof answer.reason === 'string' ? answer.reason : null,
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

function ProposalTable({ schema }: { schema: PromptFormSchema }) {
  if (!schema.proposalColumns.length) return null
  return (
    <TableBox>
      <Table aria-label="What the step proposes">
        <TableHeader>
          <TableRow>
            {schema.proposalColumns.map((column) => (
              <TableHead key={column}>{column.replaceAll('_', ' ')}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {schema.proposalRows.map((row, index) => (
            <TableRow key={index}>
              {schema.proposalColumns.map((column) => (
                <TableCell key={column}>{displayValue(row[column])}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableBox>
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
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  const title = schema.title ?? `Confirm ${prompt.step_id}`
  const answer = readPromptAnswer(prompt, schema)
  const asked = prompt.asked_user_ids.map(nameOf)

  function submit(decision: PipelineRunPromptAnswer['decision']) {
    if (decision !== 'stop' && reason.trim() === '') {
      setReasonError('Say why, so the decision is clear in the record.')
      return
    }
    setReasonError(null)
    onAnswer?.({ decision, values, reason: reason.trim() || undefined })
  }

  if (answer) {
    return (
      <section
        aria-label="Answered prompt"
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
            ? `Answered by ${nameOf(prompt.answered_by_user_id)}`
            : 'Answered'}
          {prompt.answered_at ? ` on ${formatMoment(prompt.answered_at)}` : ''}
          {' · '}
          Step {prompt.step_id}
        </p>
      </section>
    )
  }

  return (
    <section
      aria-label="Waiting prompt"
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
          This run is no longer waiting for an answer. Step{' '}
          <span className="mono">{prompt.step_id}</span> was never answered.
        </Notice>
      ) : (
        <div className="flex flex-col gap-3">
          {schema.fields.map((field) => {
            const label = (
              <span>
                {field.label}
                {field.required ? (
                  <span className="text-fg-muted"> required</span>
                ) : null}
              </span>
            )
            if (field.type === 'boolean') {
              return (
                <label
                  key={field.key}
                  className="flex items-center gap-2 text-label"
                >
                  <Checkbox
                    checked={values[field.key] === true}
                    onCheckedChange={(checked) =>
                      setValues((v) => ({ ...v, [field.key]: checked }))
                    }
                  />
                  {label}
                </label>
              )
            }
            if (field.type === 'text' && field.options.length) {
              return (
                <Field key={field.key} label={label} required={field.required}>
                  <Select
                    aria-label={field.label}
                    value={String(values[field.key] ?? '')}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [field.key]: e.target.value }))
                    }
                  >
                    <option value="">Choose…</option>
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
              <Field key={field.key} label={label} required={field.required}>
                <Input
                  aria-label={field.label}
                  type={inputType}
                  step={field.type === 'decimal' ? 'any' : undefined}
                  value={String(values[field.key] ?? '')}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                />
              </Field>
            )
          })}

          <Field
            label={
              <span>
                Reason <span className="text-fg-muted">required</span>
              </span>
            }
            error={reasonError}
          >
            <Input
              aria-label="Reason"
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
              Confirm and continue
            </Button>
            <Button disabled={submitting} onClick={() => submit('skip')}>
              Skip this step
            </Button>
            <Button
              variant="quiet"
              disabled={submitting}
              onClick={() => submit('stop')}
            >
              Stop run
            </Button>
          </div>

          <p className="m-0 text-caption leading-[18px] text-fg-muted">
            Skipping leaves the reported values unchanged. Step{' '}
            <span className="mono">{prompt.step_id}</span> was raised{' '}
            {formatMoment(prompt.created_at)}
            {prompt.expires_at
              ? `; if nobody answers by ${formatMoment(prompt.expires_at)}, the run follows its no-answer setting.`
              : '.'}{' '}
            {asked.length ? `Asked: ${asked.join(', ')}.` : 'No one was named.'}
          </p>
        </div>
      )}
    </section>
  )
}
