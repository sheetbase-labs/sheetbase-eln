/**
 * Files an instrument sent that Sheetbase couldn’t read: which file, why, and
 * the three things a person can do — try again, try with another parser, or
 * dismiss it. Shown wherever someone looks after an instrument's data, whether
 * the file came from the folder agent or was uploaded by hand.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Section } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { Select } from '#/components/v3/ui/select'
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
} from '#/lib/connectors/intake-client'
import type { IntakeProblem } from '#/lib/connectors/intake-client'
import { t } from '#/copy'

const client = createDataClient()

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
    <Section title={t('data.intake.problems.title')} count={rows.length}>
      {rows.length ? (
        <p className="m-0 text-body text-fg-muted">
          {t('data.intake.problems.intro')}
        </p>
      ) : null}
      {imported ? (
        <p role="status" className="m-0 text-body">
          {imported}
        </p>
      ) : null}
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
            {shown.map((problem) => (
              <ProblemRow
                key={problem.id}
                problem={problem}
                workspaceId={workspaceId}
                canManage={canManage}
                scope={scope}
                onImported={setImported}
              />
            ))}
          </TableBody>
        </Table>
      </TableBox>
      {rows.length > PREVIEW_ROWS ? (
        <div>
          <Button
            size="sm"
            variant="quiet"
            aria-expanded={showAll}
            onClick={() => setShowAll((open) => !open)}
          >
            {showAll
              ? t('data.intake.problems.showFewer')
              : t('data.intake.problems.showAll', { count: rows.length })}
          </Button>
        </div>
      ) : null}
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
          {retry.error instanceof Error ? retry.error.message : problem.message}
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
          {canManage ? (
            <div className="flex justify-end gap-2 whitespace-nowrap">
              <Button
                size="sm"
                variant="primary"
                disabled={busy || !problem.file_record_id}
                aria-label={t('data.intake.problems.tryAgainAria', {
                  file: problem.file_name,
                })}
                onClick={() => retry.mutate(null)}
              >
                {retry.isPending
                  ? t('data.intake.problems.trying')
                  : t('data.intake.problems.tryAgain')}
              </Button>
              <Button
                size="sm"
                disabled={busy || !problem.file_record_id}
                aria-expanded={choosing}
                aria-label={t('data.intake.problems.chooseParserAria', {
                  file: problem.file_name,
                })}
                onClick={() => setChoosing((open) => !open)}
              >
                {t('data.intake.problems.chooseParser')}
              </Button>
              <Button
                size="sm"
                variant="quiet"
                disabled={busy}
                aria-label={t('data.intake.problems.dismissAria', {
                  file: problem.file_name,
                })}
                onClick={() => dismiss.mutate()}
              >
                {t('data.intake.problems.dismiss')}
              </Button>
            </div>
          ) : null}
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
