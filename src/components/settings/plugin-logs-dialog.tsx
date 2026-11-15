import { useQuery } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { Status } from '#/components/ui/status'
import { t } from '#/copy'
import { createDataClient } from '#/lib/data-client'
import {
  listPluginRunLogs,
  pluginRunLogsQueryKey,
} from '#/lib/extensions/run-logs-client'
import type { PluginRunLog } from '#/lib/extensions/run-logs-client'
import { formatRelativeTime } from '#/lib/notebook-data'

const client = createDataClient()

const took = (ms: number) =>
  ms < 1000
    ? t('plugins.admin.logs.took', { ms: String(ms) })
    : t('plugins.admin.logs.tookSeconds', { seconds: (ms / 1000).toFixed(1) })

/** One run: how it ended, which function, when and how long; the error and what it printed under it. */
export function PluginRunEntry({ run }: { run: PluginRunLog }) {
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Status tone={run.ok ? 'ok' : 'bad'}>
          {run.ok
            ? t('plugins.admin.logs.worked')
            : t('plugins.admin.logs.failed')}
        </Status>
        <span className="font-mono text-sm text-fg">
          {run.kind}
          {run.entry ? ` · ${run.entry}` : ''}
        </span>
        <span className="ml-auto text-xs text-fg-muted tabular-nums">
          {formatRelativeTime(run.created_at)} · {took(run.duration_ms)}
        </span>
      </div>
      {run.error ? (
        <p className="rounded-md bg-danger-subtle px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-danger">
          {run.error}
        </p>
      ) : null}
      {run.output.length > 0 ? (
        <pre
          aria-label={t('plugins.admin.logs.printed')}
          className="max-h-48 overflow-auto rounded-md bg-surface-muted px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-fg-secondary"
        >
          {run.output.join('\n')}
        </pre>
      ) : null}
    </li>
  )
}

/** The runs list on its own, so it can be shown without the dialog around it. */
export function PluginRunList({ runs }: { runs: PluginRunLog[] }) {
  if (runs.length === 0)
    return (
      <EmptyState
        icon="plug"
        title={t('plugins.admin.logs.empty')}
        description={t('plugins.admin.logs.emptyBody')}
      />
    )

  return (
    <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
      {runs.map((run) => (
        <PluginRunEntry key={run.id} run={run} />
      ))}
    </ul>
  )
}

/** A plugin's recent runs: status, duration, error and printed output. Administrators only. */
export function PluginLogsDialog({
  extensionId,
  name,
  onClose,
}: {
  extensionId: string
  name: string
  onClose: () => void
}) {
  const logs = useQuery({
    queryKey: pluginRunLogsQueryKey(extensionId),
    queryFn: () => listPluginRunLogs(client, extensionId),
  })

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="w-[min(720px,calc(100vw-32px))]">
        <DialogHeader
          title={t('plugins.admin.logs.title', { name })}
          description={t('plugins.admin.logs.intro')}
        />
        <DialogBody>
          {logs.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : logs.isError ? (
            <Notice tone="bad">{t('plugins.admin.logs.loadError')}</Notice>
          ) : (
            <PluginRunList runs={logs.data ?? []} />
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={logs.isFetching}
            onClick={() => void logs.refetch()}
          >
            {t('plugins.admin.logs.refresh')}
          </Button>
          <Button type="button" onClick={onClose}>
            {t('plugins.admin.logs.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
