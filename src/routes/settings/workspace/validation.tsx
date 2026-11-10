import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Notice } from '#/components/ui/alert'
import { Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/settings/settings-page'
import { createDataClient } from '#/lib/data-client'
import { downloadTextFile } from '#/lib/download'
import { formatDate } from '#/lib/format-date'
import { canManageSettings } from '#/lib/settings-access'
import { useRegulatedLab } from '#/lib/regulated-lab'
import { REQUIREMENTS } from '#/lib/validation/requirements'
import trace from '#/lib/validation/trace.generated.json'
import {
  fetchCanRunValidation,
  fetchValidationPack,
  fetchValidationRuns,
  startValidationRun,
  validationKeys,
} from '#/lib/validation/client'
import type { CheckStatus } from '#/lib/validation/types'
import { t } from '#/copy'

/** Settings → Validation: run the installation and operation checks, keep the
 * evidence, and download the pack a validation team files. Regulated labs
 * only. */
export const Route = createFileRoute('/settings/workspace/validation')({
  component: Validation,
})

const dataClient = createDataClient()

const TONE: Record<CheckStatus, 'ok' | 'warn' | 'bad'> = {
  passed: 'ok',
  skipped: 'warn',
  failed: 'bad',
}

function statusLabel(status: CheckStatus): string {
  return t(`settings.validation.${status}`)
}

function testCount(requirementId: string): number {
  return trace.entries.filter((e) => e.requirement === requirementId).length
}

function Validation() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const { regulated, loaded } = useRegulatedLab(workspaceId)
  const canManage = canManageSettings(context.workspace, 'audit')
  const queryClient = useQueryClient()
  const [downloading, setDownloading] = useState(false)

  const allowed = useQuery({
    queryKey: validationKeys.allowed(workspaceId),
    queryFn: () => fetchCanRunValidation(dataClient, workspaceId),
    enabled: Boolean(workspaceId) && regulated,
  })

  const runs = useQuery({
    queryKey: validationKeys.runs(workspaceId),
    queryFn: () => fetchValidationRuns(dataClient),
    enabled: Boolean(workspaceId) && regulated,
  })

  const run = useMutation({
    mutationFn: startValidationRun,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: validationKeys.runs(workspaceId),
      })
      toast(t('settings.validation.ranToast'))
    },
  })

  const header = <SettingsHeader title={t('settings.validation.title')} />

  if (loaded && !regulated) {
    return (
      <>
        {header}
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title={t('settings.validation.notAvailable')}
          />
        </div>
      </>
    )
  }

  const can = canManage && allowed.data === true
  const latest = runs.data?.[0]

  const download = async () => {
    setDownloading(true)

    try {
      downloadTextFile(
        'validation-pack.zip',
        await fetchValidationPack(),
        'application/zip',
      )
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      <SettingsHeader
        title={t('settings.validation.title')}
        actions={
          <>
            <Button
              disabled={!can || downloading || !latest}
              onClick={() => void download()}
            >
              {downloading
                ? t('settings.validation.downloading')
                : t('settings.validation.download')}
            </Button>
            <Button
              variant="primary"
              disabled={!can || run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending
                ? t('settings.validation.running')
                : t('settings.validation.run')}
            </Button>
          </>
        }
      />
      <ValidationEvidence
        runs={runs.data}
        runsLoaded={runs.isSuccess}
        accessRefused={!can && allowed.isSuccess}
        runError={run.isError ? run.error : null}
      />
    </>
  )
}

function ValidationEvidence({
  runs,
  runsLoaded,
  accessRefused,
  runError,
}: {
  runs: Awaited<ReturnType<typeof fetchValidationRuns>> | undefined
  runsLoaded: boolean
  accessRefused: boolean
  runError: Error | null
}) {
  const latest = runs?.[0]
  const resultById = new Map((latest?.results ?? []).map((r) => [r.id, r]))

  return (
    <SettingsBody>
      <Muted>{t('settings.validation.description')}</Muted>
      {accessRefused ? (
        <Notice>{t('settings.validation.needsAccess')}</Notice>
      ) : null}
      {runError ? (
        <Notice tone="bad">
          {runError instanceof Error ? runError.message : String(runError)}
        </Notice>
      ) : null}

      {latest ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-heading">
            {t('settings.validation.resultsTitle')}
          </h2>
          <Muted>
            {t('settings.validation.lastRun')}:{' '}
            {formatDate(latest.finished_at, { time: true })} ·{' '}
            {t('settings.validation.summary', {
              passed: latest.passed,
              failed: latest.failed,
              skipped: latest.skipped,
            })}
          </Muted>
          <Table caption={t('settings.validation.resultsTitle')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.validation.check')}</TableHead>
                <TableHead>{t('settings.validation.kind')}</TableHead>
                <TableHead>{t('settings.validation.result')}</TableHead>
                <TableHead>{t('settings.validation.found')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {latest.results.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span title={`${r.method}\n${r.expected}`}>{r.title}</span>
                  </TableCell>
                  <TableCell>
                    {r.kind === 'iq'
                      ? t('settings.validation.iq')
                      : t('settings.validation.oq')}
                  </TableCell>
                  <TableCell>
                    <Status tone={TONE[r.status]}>
                      {statusLabel(r.status)}
                    </Status>
                  </TableCell>
                  <TableCell>
                    <span
                      title={r.detail}
                      className="block max-w-[44ch] truncate"
                    >
                      {r.detail}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : runsLoaded ? (
        <Muted>{t('settings.validation.neverRun')}</Muted>
      ) : null}

      {runs && runs.length > 1 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-heading">
            {t('settings.validation.historyTitle')}
          </h2>
          <Table caption={t('settings.validation.historyTitle')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.validation.when')}</TableHead>
                <TableHead>{t('settings.validation.result')}</TableHead>
                <TableHead>{t('settings.validation.version')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {formatDate(r.finished_at, { time: true })}
                  </TableCell>
                  <TableCell>
                    <Status tone={r.status === 'passed' ? 'ok' : 'bad'}>
                      {t('settings.validation.summary', {
                        passed: r.passed,
                        failed: r.failed,
                        skipped: r.skipped,
                      })}
                    </Status>
                  </TableCell>
                  <TableCell>{r.app_version}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-heading">{t('settings.validation.traceTitle')}</h2>
        <Muted>{t('settings.validation.traceHint')}</Muted>
        <Table caption={t('settings.validation.traceTitle')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('settings.validation.requirement')}</TableHead>
              <TableHead>{t('settings.validation.area')}</TableHead>
              <TableHead>{t('settings.validation.tests')}</TableHead>
              <TableHead>{t('settings.validation.checks')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {REQUIREMENTS.map((req) => (
              <TableRow key={req.id}>
                <TableCell>
                  <span title={req.statement}>{req.id}</span>
                </TableCell>
                <TableCell>{req.area}</TableCell>
                <TableCell>{testCount(req.id)}</TableCell>
                <TableCell>
                  {req.checks.length === 0
                    ? '—'
                    : req.checks.map((id) => {
                        const r = resultById.get(id)

                        return (
                          <span key={id} className="mr-2 inline-block">
                            {r ? (
                              <Status tone={TONE[r.status]}>{r.title}</Status>
                            ) : (
                              id
                            )}
                          </span>
                        )
                      })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </SettingsBody>
  )
}
