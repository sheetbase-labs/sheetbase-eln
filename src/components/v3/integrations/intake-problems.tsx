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

  if (problems.isError) {
    return <Notice tone="warn">{t('data.intake.problems.loadFailed')}</Notice>
  }
  const rows = problems.data ?? []
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
      <ul
        aria-label={t('data.intake.problems.listAria')}
        className="m-0 flex list-none flex-col divide-y divide-border p-0"
      >
        {rows.map((problem) => (
          <ProblemRow
            key={problem.id}
            problem={problem}
            workspaceId={workspaceId}
            canManage={canManage}
            scope={scope}
            onImported={setImported}
          />
        ))}
      </ul>
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
    <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="break-all font-semibold">{problem.file_name}</span>
        <span className="text-label text-fg-muted">
          {problem.source === 'agent'
            ? t('data.intake.problems.fromAgent')
            : t('data.intake.problems.fromUpload')}
          {' · '}
          {t('data.intake.problems.lastTried', {
            when: formatRelativeTime(problem.last_attempt_at),
          })}
          {problem.attempts > 1
            ? ` · ${t('data.intake.problems.attempts', { count: problem.attempts })}`
            : ''}
        </span>
      </div>
      <p className="m-0 text-body text-danger-text">
        {retry.error instanceof Error ? retry.error.message : problem.message}
      </p>
      {error instanceof Error && !(retry.error instanceof Error) ? (
        <p role="alert" className="m-0 text-label text-danger-text">
          {error.message}
        </p>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
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
      {choosing ? (
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
      ) : null}
    </li>
  )
}
