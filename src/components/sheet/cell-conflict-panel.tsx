/**
 * EXP-05.4 — the conflict surface (`canvas/NbConflict.dc.html`).
 *
 * When offline replay finds that the same cell changed on this device and
 * elsewhere, `api.sheet_cell_conflicts` keeps both sides — values, authors and
 * times — and the person chooses one (or types their own). The panel is the
 * place that choice is made: it shows the two attributable edits, asks for the
 * value and a reason, and settles the conflict through
 * `api.resolve_cell_conflict`, which records the decision and the decider.
 *
 * A conflict never looks settled before it is: the decision is only rendered
 * once the row (or the RPC's returned row) reports a resolution with its
 * resolver, time and reason.
 */
import { rich, t } from '#/copy'
import { useMemo, useState } from 'react'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Choice } from '#/components/v3/ui/choice'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted } from '#/components/v3/ui/layout'
import { RadioGroup } from '#/components/v3/ui/radio-group'
import type { DataClient } from '#/lib/data-client'
import { formatCellValue } from '#/lib/format-numbers'
import { formatNotebookDateTime, notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { cn } from '#/lib/utils'

/** Matches `chk_sheet_cell_conflicts_state`. */
export type CellConflictState = 'open' | 'resolved'

/** Wire shape of one `api.sheet_cell_conflicts` row (snake_case via PostgREST). */
export interface CellConflictRow {
  id: string
  sheet_instance_id: string
  row_key: string
  field_id: string
  /** The value this device had edited but not yet sent. */
  local_value: unknown
  local_author_user_id: string
  local_at: string
  /** The value that arrived first from elsewhere. */
  remote_value: unknown
  remote_author_user_id: string | null
  remote_at: string | null
  state: CellConflictState
  resolved_value: unknown
  resolved_by_user_id: string | null
  resolved_at: string | null
  reason: string | null
}

/** Matches `chk_sheet_cell_conflicts_resolution`'s reason bound. */
export const CONFLICT_REASON_MAX = 2000

/** Fetch a Sheet Instance's cell conflicts, newest first. */
export function fetchCellConflicts(
  client: DataClient,
  instanceId: string,
  options: { state?: CellConflictState; limit?: number } = {},
): Promise<CellConflictRow[]> {
  const state = options.state ? `&state=eq.${options.state}` : ''
  const limit = options.limit ?? 50
  return client.list<CellConflictRow>(
    'sheet_cell_conflicts',
    `?sheet_instance_id=eq.${instanceId}${state}&order=created_at.desc&limit=${limit}`,
  )
}

/** Settle one conflict: the chosen value, the reason, and (server-side) who decided. */
export function resolveCellConflict(
  client: DataClient,
  conflictId: string,
  value: unknown,
  reason: string,
): Promise<CellConflictRow> {
  return client.rpc<CellConflictRow>('resolve_cell_conflict', {
    p_conflict_id: conflictId,
    p_value: value,
    p_reason: reason,
  })
}

/**
 * Interpret text typed into "Enter another value" the way a cell stores it:
 * numbers as numbers, `true`/`false` as booleans, everything else as a
 * trimmed string. Empty text stays empty and the caller rejects it.
 */
export function parseEnteredValue(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  const asNumber = Number(trimmed)
  if (Number.isFinite(asNumber)) return asNumber
  return trimmed
}

type SelectedSide = 'remote' | 'local' | 'other'

export interface CellConflictPanelProps {
  /** The conflict to settle. */
  conflict: CellConflictRow
  /** The signed-in user, so their own edit reads "You". */
  currentUserId?: string | null
  /** Describes the cell, e.g. `row 6, Capsid titre`. */
  cellLabel?: string
  /** The value both edits replaced, when the caller knows it. */
  previousValue?: unknown
  /** Measurement unit appended to the values, when the column has one. */
  unit?: string
  client?: DataClient
  /** Called with the resolved row; the host refreshes lists from here. */
  onResolved?: (conflict: CellConflictRow) => void
  /** Optional secondary action (canvas: "Ask Priya"); hidden when omitted. */
  onAsk?: () => void
  /** Label for the secondary action, e.g. the other editor's name. */
  askLabel?: string
  className?: string
}

export function CellConflictPanel({
  conflict: initialConflict,
  currentUserId,
  cellLabel,
  previousValue,
  unit,
  client = notebookDataClient,
  onResolved,
  onAsk,
  askLabel = t('notebook.cellConflictPanel.ask'),
  className,
}: CellConflictPanelProps) {
  const [conflict, setConflict] = useState(initialConflict)
  const [side, setSide] = useState<SelectedSide>('remote')
  const [entered, setEntered] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const authorIds = useMemo(() => {
    // `useUserNames` de-duplicates; this only drops the signed-in user, whose
    // own edits read "You" instead of their name.
    return [
      conflict.remote_author_user_id,
      conflict.local_author_user_id,
      conflict.resolved_by_user_id,
    ].filter((id): id is string => Boolean(id) && id !== currentUserId)
  }, [conflict, currentUserId])
  const { userLabel } = useUserNames(authorIds)

  // The database guarantees a resolved row carries its resolver, time and
  // reason; treat anything less as still open so it cannot look settled.
  const isResolved =
    conflict.state === 'resolved' &&
    conflict.resolved_by_user_id !== null &&
    conflict.resolved_at !== null &&
    conflict.reason !== null

  if (isResolved) {
    return (
      <ResolvedConflict
        conflict={conflict}
        currentUserId={currentUserId}
        cellLabel={cellLabel}
        unit={unit}
        userLabel={userLabel}
        className={className}
      />
    )
  }

  const trimmedReason = reason.trim()
  const reasonValid =
    trimmedReason.length > 0 && trimmedReason.length <= CONFLICT_REASON_MAX
  const valueReady = side !== 'other' || entered.trim() !== ''
  const canResolve = valueReady && reasonValid && !pending

  async function submit() {
    if (!canResolve) return
    const value =
      side === 'remote'
        ? conflict.remote_value
        : side === 'local'
          ? conflict.local_value
          : parseEnteredValue(entered)
    setPending(true)
    setError(null)
    try {
      const next = await resolveCellConflict(
        client,
        conflict.id,
        value,
        trimmedReason,
      )
      setConflict(next)
      onResolved?.(next)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('notebook.cellConflictPanel.couldNotResolveThis'),
      )
    } finally {
      setPending(false)
    }
  }

  function actorLine(authorUserId: string | null, at: string | null): string {
    const who =
      authorUserId === null
        ? t('notebook.cellConflictPanel.anotherEditor')
        : authorUserId === currentUserId
          ? t('notebook.cellConflictPanel.you')
          : userLabel(authorUserId)
    return `${who} · ${formatNotebookDateTime(at)}`
  }

  return (
    <aside
      aria-label={t('notebook.cellConflictPanel.ariaLabel')}
      data-cell-conflict
      className={cn(
        'flex w-80 shrink-0 flex-col gap-3.5 border-l border-border bg-surface p-4',
        className,
      )}
    >
      <section>
        <h3 className="mb-1.5 font-sans text-label font-semibold">
          {cellLabel
            ? t('notebook.cellConflictPanel.headingCell', { cell: cellLabel })
            : t('notebook.cellConflictPanel.heading')}
        </h3>
        <Muted>
          {previousValue !== undefined
            ? rich('notebook.cellConflictPanel.bothOfYouChanged2', {
                value: (
                  <span className="num text-fg">
                    {formatCellValue(previousValue)}
                  </span>
                ),
              })
            : t('notebook.cellConflictPanel.bothOfYouChanged')}
        </Muted>
      </section>

      <RadioGroup
        aria-label={t('notebook.cellConflictPanel.chooseValueAriaLabel')}
        value={side}
        onValueChange={(value) => setSide(value as SelectedSide)}
        className="flex flex-col gap-2"
      >
        <Choice
          value="remote"
          title={
            <span className="num font-semibold">
              {formatCellValue(conflict.remote_value)}
              {unit ? ` ${unit}` : ''}
            </span>
          }
        >
          {t('notebook.cellConflictPanel.actorlineOnline', {
            actorLine: actorLine(
              conflict.remote_author_user_id,
              conflict.remote_at,
            ),
          })}
        </Choice>
        <Choice
          value="local"
          title={
            <span className="num font-semibold">
              {formatCellValue(conflict.local_value)}
              {unit ? ` ${unit}` : ''}
            </span>
          }
        >
          {t('notebook.cellConflictPanel.actorlineOffline', {
            actorLine: actorLine(
              conflict.local_author_user_id,
              conflict.local_at,
            ),
          })}
        </Choice>
        <Choice value="other" title={t('notebook.cellConflictPanel.title')} />
      </RadioGroup>

      {side === 'other' ? (
        <Field
          label={t('notebook.cellConflictPanel.label')}
          error={
            valueReady
              ? undefined
              : t('notebook.cellConflictPanel.enterAValueTo')
          }
        >
          <Input
            value={entered}
            onChange={(event) => setEntered(event.target.value)}
            aria-label={t('notebook.cellConflictPanel.label')}
          />
        </Field>
      ) : null}

      <Field
        label={t('notebook.cellConflictPanel.reasonLabel')}
        required
        hint={t('common.states.required')}
      >
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-label={t('notebook.cellConflictPanel.reasonLabel')}
          maxLength={CONFLICT_REASON_MAX}
        />
      </Field>

      {error ? (
        <Notice tone="bad" icon="warn">
          {error}
        </Notice>
      ) : null}

      <div className="flex gap-1.5">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => void submit()}
          disabled={!canResolve}
        >
          {pending
            ? t('notebook.cellConflictPanel.resolving')
            : t('notebook.cellConflictPanel.resolve')}
        </Button>
        {onAsk ? (
          <Button type="button" size="sm" onClick={onAsk}>
            {askLabel}
          </Button>
        ) : null}
      </div>

      <Muted>{t('notebook.cellConflictPanel.bothValuesAndYour')}</Muted>
    </aside>
  )
}

/** The settled state: the decision, who made it, when and why — no controls. */
function ResolvedConflict({
  conflict,
  currentUserId,
  cellLabel,
  unit,
  userLabel,
  className,
}: {
  conflict: CellConflictRow
  currentUserId?: string | null
  cellLabel?: string
  unit?: string
  userLabel: (userId: string) => string
  className?: string
}) {
  const resolverId = conflict.resolved_by_user_id
  const resolver =
    resolverId === null
      ? t('notebook.cellConflictPanel.unknown')
      : resolverId === currentUserId
        ? t('notebook.cellConflictPanel.you')
        : userLabel(resolverId)

  return (
    <aside
      aria-label={t('notebook.cellConflictPanel.resolvedConflictAriaLabel')}
      data-cell-conflict-resolved
      className={cn(
        'flex w-80 shrink-0 flex-col gap-3.5 border-l border-border bg-surface p-4',
        className,
      )}
    >
      <section>
        <h3 className="mb-1.5 font-sans text-label font-semibold">
          {cellLabel
            ? t('notebook.cellConflictPanel.headingCell', { cell: cellLabel })
            : t('notebook.cellConflictPanel.heading')}
        </h3>
        <Notice tone="info" icon="check">
          {t('notebook.cellConflictPanel.resolved')}
        </Notice>
      </section>

      <div>
        <span className="num block font-semibold text-fg">
          {formatCellValue(conflict.resolved_value)}
          {unit ? ` ${unit}` : ''}
        </span>
        <Muted>
          {resolver} · {formatNotebookDateTime(conflict.resolved_at)}
        </Muted>
        {conflict.reason ? <Muted>“{conflict.reason}”</Muted> : null}
      </div>

      <Muted>{t('notebook.cellConflictPanel.bothValuesAndThis')}</Muted>
    </aside>
  )
}
