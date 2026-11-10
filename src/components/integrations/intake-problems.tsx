/**
 * Files an instrument sent that Sheetbase couldn’t read: which file, why, and
 * the three things a person can do — try again, try with another parser, or
 * dismiss it. Shown wherever someone looks after an instrument's data, whether
 * the file came from the folder agent or was uploaded by hand.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Section } from '#/components/ui/layout'
import { Tooltip } from '#/components/ui/tooltip'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Select } from '#/components/ui/select'
import { createDataClient } from '#/lib/data-client'
import { formatRelativeTime } from '#/lib/notebook-data'
import {
  fetchParserSettings,
  parserSettingsQueryKeys,
} from '#/lib/parser-settings'
import {
  dismissIntakeProblem,
  fetchIntakeProblems,
  intakeQueryKeys,
  postIntake,
  IntakeClientError,
} from '#/lib/connectors/intake-client'
import type { IntakeProblem } from '#/lib/connectors/intake-client'
import { t } from '#/copy'

const client = createDataClient()

const SHORT_REASON_VALUES = [
  'addressRefused',
  'badAnswer',
  'empty',
  'noKey',
  'noMapping',
  'noRows',
  'notText',
  'parserNotApproved',
  'parserUnknown',
  'parserUnrecognised',
  'parserUnsupported',
  'serviceDown',
  'serviceRefused',
  'serviceSlow',
  'tooLarge',
  'unreadable',
  'workbook',
] as const

type ShortReasonValue = (typeof SHORT_REASON_VALUES)[number]

const SHORT_REASON: ReadonlyMap<string, ShortReasonValue> = new Map([
  ['parser_unrecognised', 'parserUnrecognised'],
  ['parser_not_approved', 'parserNotApproved'],
  ['parser_unknown', 'parserUnknown'],
  ['parser_unsupported', 'parserUnsupported'],
  ['unsupported_format', 'notText'],
  ['unreadable_workbook', 'workbook'],
  ['webhook_unreachable', 'serviceDown'],
  ['webhook_timeout', 'serviceSlow'],
  ['webhook_no_key', 'noKey'],
  ['webhook_address_refused', 'addressRefused'],
  ['webhook_bad_answer', 'badAnswer'],
  ['webhook_error', 'serviceRefused'],
  ['webhook_refused', 'serviceRefused'],
  ['no_rows', 'noRows'],
  ['no_mapping', 'noMapping'],
  ['file_too_large', 'tooLarge'],
  ['empty_file', 'empty'],
])

/** One short line for the table; the full explanation goes in a tooltip. */
function shortReason(code: string): string {
  const key = SHORT_REASON.get(code) ?? 'unreadable'

  return t(`data.intake.problems.short.${key}`)
}

/** Rows shown before "Show all"; the rest stay one click away. */
const PREVIEW_ROWS = 5

export function IntakeProblems({
  workspaceId,
  instrumentId,
  connectorId,
  canManage,
}: {
  workspaceId: string
  instrumentId?: string
  connectorId?: string
  canManage: boolean
}) {
  const scope = instrumentId ?? connectorId ?? 'all'

  const problems = useQuery({
    queryKey: intakeQueryKeys.problems(scope),
    queryFn: () => fetchIntakeProblems(client, { instrumentId, connectorId }),
    enabled: Boolean(workspaceId),
  })

  const [imported, setImported] = useState('')
  const [showAll, setShowAll] = useState(false)

  if (problems.isError) {
    return <Notice tone="warn">{t('data.intake.problems.loadFailed')}</Notice>
  }

  const rows = problems.data ?? []
  const shown = showAll ? rows : rows.slice(0, PREVIEW_ROWS)

  if (!rows.length && !imported) return null

  return (
    <ProblemsSection
      rows={shown}
      total={rows.length}
      imported={imported}
      showAll={showAll}
      onToggleShowAll={() => setShowAll((open) => !open)}
      workspaceId={workspaceId}
      onImported={setImported}
      canManage={canManage}
      scope={scope}
    />
  )
}

/** The problems table and the actions that retry or import each read. */
function ProblemsSection({
  rows,
  total,
  imported,
  showAll,
  onToggleShowAll,
  workspaceId,
  canManage,
  scope,
  onImported,
}: {
  rows: IntakeProblem[]
  total: number
  imported: string
  showAll: boolean
  onToggleShowAll: () => void
  workspaceId: string
  canManage: boolean
  scope: string
  onImported: (message: string) => void
}): React.ReactElement {
  return (
    <Section title={t('data.intake.problems.title')} count={total}>
      <ProblemsSummary count={total} imported={imported} />
      <TableBox>
        <Table aria-label={t('data.intake.problems.listAria')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('data.intake.problems.columns.file')}</TableHead>
              <TableHead>{t('data.intake.problems.columns.reason')}</TableHead>
              <TableHead>
                {t('data.intake.problems.columns.lastTried')}
              </TableHead>
              <TableHead>
                <span className="sr-only">
                  {t('data.intake.problems.columns.actions')}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((problem) => (
              <ProblemRow
                key={problem.id}
                problem={problem}
                workspaceId={workspaceId}
                canManage={canManage}
                scope={scope}
                onImported={onImported}
              />
            ))}
          </TableBody>
        </Table>
      </TableBox>
      <ShowAllToggle
        count={total}
        showAll={showAll}
        onToggle={onToggleShowAll}
      />
    </Section>
  )
}

function ProblemRow({
  problem,
  workspaceId,
  canManage,
  scope,
  onImported,
}: {
  problem: IntakeProblem
  workspaceId: string
  canManage: boolean
  scope: string
  onImported: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const [choosing, setChoosing] = useState(false)
  const [parserKey, setParserKey] = useState('')

  const parsers = useQuery({
    queryKey: parserSettingsQueryKeys.list(workspaceId),
    queryFn: () => fetchParserSettings(client, workspaceId),
    enabled: choosing,
  })

  const approved = (parsers.data ?? []).filter((parser) =>
    parser.parser_versions.some((version) => version.status === 'approved'),
  )

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: intakeQueryKeys.all })

  const retry = useMutation({
    mutationFn: (key: string | null) =>
      postIntake({ kind: 'retry', failureId: problem.id, parserKey: key }),
    onSuccess: async (result) => {
      onImported(
        t('data.intake.problems.imported', {
          file: problem.file_name,
          count: result.rowCount,
        }),
      )
      setChoosing(false)
      await refresh()
    },
    // The problem stays listed with its newest reason and attempt count.
    onSettled: () => refresh(),
  })

  const dismiss = useMutation({
    mutationFn: () => dismissIntakeProblem(client, problem.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: intakeQueryKeys.problems(scope),
      })
    },
  })

  const busy = retry.isPending || dismiss.isPending
  const error = retry.error ?? dismiss.error

  return (
    <>
      <TableRow>
        <TableCell className="min-w-44 whitespace-normal break-words py-2 font-semibold">
          {problem.file_name}
        </TableCell>
        <TableCell className="whitespace-normal py-2 text-danger-text">
          <Tooltip
            content={
              <span className="block max-w-xs">
                {retry.error instanceof Error
                  ? retry.error.message
                  : problem.message}
              </span>
            }
          >
            <span
              tabIndex={0}
              className="cursor-help underline decoration-dotted underline-offset-2"
            >
              {shortReason(
                retry.error instanceof IntakeClientError
                  ? retry.error.code
                  : problem.code,
              )}
            </span>
          </Tooltip>
          {error instanceof Error && !(retry.error instanceof Error) ? (
            <span role="alert" className="block text-label">
              {error.message}
            </span>
          ) : null}
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {formatRelativeTime(problem.last_attempt_at)}
          <span className="block text-label text-fg-muted">
            {problem.source === 'agent'
              ? t('data.intake.problems.fromAgent')
              : t('data.intake.problems.fromUpload')}
            {problem.attempts > 1
              ? ` · ${t('data.intake.problems.attempts', { count: problem.attempts })}`
              : ''}
          </span>
        </TableCell>
        <TableCell>
          <ProblemActions
            file={problem.file_name}
            canManage={canManage}
            busy={busy}
            retryable={Boolean(problem.file_record_id)}
            choosing={choosing}
            retrying={retry.isPending}
            onRetry={() => retry.mutate(null)}
            onToggleChoosing={() => setChoosing((open) => !open)}
            onDismiss={() => dismiss.mutate()}
          />
        </TableCell>
      </TableRow>
      {choosing ? (
        <TableRow>
          <TableCell colSpan={5}>
            <div className="flex flex-wrap items-center gap-2">
              {parsers.isSuccess && !approved.length ? (
                <span className="text-label text-fg-muted">
                  {t('data.intake.problems.noOtherParsers')}
                </span>
              ) : (
                <>
                  <Select
                    aria-label={t('data.intake.problems.parserLabel', {
                      file: problem.file_name,
                    })}
                    value={parserKey}
                    onChange={(event) => setParserKey(event.target.value)}
                  >
                    <option value="">
                      {t('data.intake.problems.parserPlaceholder')}
                    </option>
                    {approved.map((parser) => (
                      <option key={parser.id} value={parser.key}>
                        {parser.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    disabled={!parserKey || busy}
                    onClick={() => retry.mutate(parserKey)}
                  >
                    {t('data.intake.problems.tryWithParser')}
                  </Button>
                </>
              )}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

/** The section's lead-in and the message last import left. */
function ProblemsSummary({
  count,
  imported,
}: {
  count: number
  imported: string
}): React.ReactElement {
  return (
    <>
      {count ? (
        <p className="m-0 text-body text-fg-muted">
          {t('data.intake.problems.intro')}
        </p>
      ) : null}
      {imported ? (
        <p role="status" className="m-0 text-body">
          {imported}
        </p>
      ) : null}
    </>
  )
}

/** Show every failed read, or go back to the preview. */
function ShowAllToggle({
  count,
  showAll,
  onToggle,
}: {
  count: number
  showAll: boolean
  onToggle: () => void
}): React.ReactElement | null {
  if (count <= PREVIEW_ROWS) return null

  return (
    <div>
      <Button
        size="sm"
        variant="quiet"
        aria-expanded={showAll}
        onClick={onToggle}
      >
        {showAll
          ? t('data.intake.problems.showFewer')
          : t('data.intake.problems.showAll', { count })}
      </Button>
    </div>
  )
}

/** The row's actions: try again, pick a parser, or dismiss the read. */
function ProblemActions({
  file,
  canManage,
  busy,
  retryable,
  choosing,
  retrying,
  onRetry,
  onToggleChoosing,
  onDismiss,
}: {
  file: string
  canManage: boolean
  busy: boolean
  retryable: boolean
  choosing: boolean
  retrying: boolean
  onRetry: () => void
  onToggleChoosing: () => void
  onDismiss: () => void
}): React.ReactElement {
  return (
    <TableCell>
      {canManage ? (
        <div className="flex justify-end gap-2 whitespace-nowrap">
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !retryable}
            aria-label={t('data.intake.problems.tryAgainAria', {
              file: file,
            })}
            onClick={onRetry}
          >
            {retrying
              ? t('data.intake.problems.trying')
              : t('data.intake.problems.tryAgain')}
          </Button>
          <Button
            size="sm"
            disabled={busy || !retryable}
            aria-expanded={choosing}
            aria-label={t('data.intake.problems.chooseParserAria', {
              file: file,
            })}
            onClick={onToggleChoosing}
          >
            {t('data.intake.problems.chooseParser')}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={busy}
            aria-label={t('data.intake.problems.dismissAria', {
              file: file,
            })}
            onClick={onDismiss}
          >
            {t('data.intake.problems.dismiss')}
          </Button>
        </div>
      ) : null}
    </TableCell>
  )
}
