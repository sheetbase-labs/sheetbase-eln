import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Notice } from '#/components/ui/alert'
import { Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
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

type Run = Awaited<ReturnType<typeof fetchValidationRuns>>[number]

type Result = Run['results'][number]

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

  const resultColumns: RegistryColumn<Result>[] = [
    {
      id: 'check',
      header: t('settings.validation.check'),
      accessorFn: (r) => r.title,
      cell: ({ row }) => (
        <span title={`${row.original.method}\n${row.original.expected}`}>
          {row.original.title}
        </span>
      ),
    },
    {
      id: 'kind',
      header: t('settings.validation.kind'),
      accessorFn: (r) =>
        r.kind === 'iq'
          ? t('settings.validation.iq')
          : t('settings.validation.oq'),
    },
    {
      id: 'result',
      header: t('settings.validation.result'),
      accessorFn: (r) => statusLabel(r.status),
      cell: ({ row }) => (
        <Status tone={TONE[row.original.status]}>
          {statusLabel(row.original.status)}
        </Status>
      ),
    },
    {
      id: 'found',
      header: t('settings.validation.found'),
      accessorFn: (r) => r.detail,
      cell: ({ row }) => (
        <span
          title={row.original.detail}
          className="block max-w-[44ch] truncate"
        >
          {row.original.detail}
        </span>
      ),
    },
  ]

  const historyColumns: RegistryColumn<Run>[] = [
    {
      id: 'when',
      header: t('settings.validation.when'),
      accessorFn: (r) => r.finished_at,
      cell: ({ row }) => formatDate(row.original.finished_at, { time: true }),
    },
    {
      id: 'result',
      header: t('settings.validation.result'),
      accessorFn: (r) => r.passed,
      cell: ({ row }) => (
        <Status tone={row.original.status === 'passed' ? 'ok' : 'bad'}>
          {t('settings.validation.summary', {
            passed: row.original.passed,
            failed: row.original.failed,
            skipped: row.original.skipped,
          })}
        </Status>
      ),
    },
    {
      id: 'version',
      header: t('settings.validation.version'),
      accessorFn: (r) => r.app_version,
    },
  ]

  const traceColumns: RegistryColumn<(typeof REQUIREMENTS)[number]>[] = [
    {
      id: 'requirement',
      header: t('settings.validation.requirement'),
      accessorFn: (req) => req.id,
      cell: ({ row }) => (
        <span title={row.original.statement}>{row.original.id}</span>
      ),
    },
    {
      id: 'area',
      header: t('settings.validation.area'),
      accessorFn: (req) => req.area,
    },
    {
      id: 'tests',
      header: t('settings.validation.tests'),
      accessorFn: (req) => testCount(req.id),
    },
    {
      id: 'checks',
      header: t('settings.validation.checks'),
      enableSorting: false,
      cell: ({ row }) =>
        row.original.checks.length === 0
          ? '—'
          : row.original.checks.map((id) => {
              const r = resultById.get(id)

              return (
                <span key={id} className="mr-2 inline-block">
                  {r ? <Status tone={TONE[r.status]}>{r.title}</Status> : id}
                </span>
              )
            }),
    },
  ]

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
          <TableBox>
            <RegistryGrid
              label={t('settings.validation.resultsTitle')}
              rows={latest.results}
              columns={resultColumns}
              getRowId={(r) => r.id}
              selectable={false}
            />
          </TableBox>
        </section>
      ) : runsLoaded ? (
        <Muted>{t('settings.validation.neverRun')}</Muted>
      ) : null}

      {runs && runs.length > 1 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-heading">
            {t('settings.validation.historyTitle')}
          </h2>
          <TableBox>
            <RegistryGrid
              label={t('settings.validation.historyTitle')}
              rows={runs}
              columns={historyColumns}
              getRowId={(r) => r.id}
              selectable={false}
            />
          </TableBox>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-heading">{t('settings.validation.traceTitle')}</h2>
        <Muted>{t('settings.validation.traceHint')}</Muted>
        <TableBox>
          <RegistryGrid
            label={t('settings.validation.traceTitle')}
            rows={REQUIREMENTS.map((req) => req)}
            columns={traceColumns}
            getRowId={(req) => req.id}
            selectable={false}
          />
        </TableBox>
      </section>
    </SettingsBody>
  )
}
