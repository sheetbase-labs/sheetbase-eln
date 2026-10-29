/**
 * The folder agent for one instrument: download it with its settings already
 * in, and see whether it is running. Nothing is typed in afterwards.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { Status } from '#/components/v3/ui/status'
import { Tooltip } from '#/components/v3/ui/tooltip'
import { AGENT_SYSTEMS } from '#/lib/connectors/agent-package'
import type { AgentSystem } from '#/lib/connectors/agent-package'
import {
  agentQueryKeys,
  downloadAgent,
  fetchAgentStatus,
} from '#/lib/connectors/agent-client'
import { formatRelativeTime } from '#/lib/notebook-data'
import { t } from '#/copy'

/** Whether the agent for this instrument is running, in one line. */
export function AgentStatusLine({
  connectorId,
  fetchStatus = fetchAgentStatus,
}: {
  connectorId: string
  fetchStatus?: typeof fetchAgentStatus
}) {
  const status = useQuery({
    queryKey: agentQueryKeys.status(connectorId),
    queryFn: () => fetchStatus(connectorId),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  if (!status.data) return <span className="text-fg-muted">—</span>
  const { downloaded, running, lastSeenAt } = status.data
  if (!downloaded) {
    return (
      <Status tone="none">
        {t('library.instruments.agent.notDownloaded')}
      </Status>
    )
  }
  if (!lastSeenAt) {
    return (
      <Status tone="draft">{t('library.instruments.agent.waiting')}</Status>
    )
  }
  const when = formatRelativeTime(lastSeenAt)
  return running ? (
    <Status tone="ok">
      {t('library.instruments.agent.running', { when })}
    </Status>
  ) : (
    <Status tone="warn">
      {t('library.instruments.agent.quiet', { when })}
    </Status>
  )
}

/** The label that goes beside the status, with what the agent is on hover. */
export function AgentStatusLabel() {
  return (
    <Tooltip content={t('library.instruments.agent.statusTooltip')}>
      <span className="cursor-help">
        {t('library.instruments.agent.statusLabel')}
      </span>
    </Tooltip>
  )
}

export function AgentDownload({
  connectorId,
  canManage,
  download = downloadAgent,
}: {
  connectorId: string
  canManage: boolean
  download?: typeof downloadAgent
}) {
  const queryClient = useQueryClient()
  const [system, setSystem] = useState<AgentSystem>('windows')
  const [folder, setFolder] = useState('')
  const [downloaded, setDownloaded] = useState<string | null>(null)
  const example =
    AGENT_SYSTEMS.find((entry) => entry.value === system)?.folderExample ?? ''
  const chosen = folder.trim() || example

  const run = useMutation({
    mutationFn: () => download({ connectorId, system, folder: chosen }),
    onSuccess: () => {
      setDownloaded(chosen)
      void queryClient.invalidateQueries({
        queryKey: agentQueryKeys.status(connectorId),
      })
    },
  })

  if (!canManage) {
    return (
      <p className="m-0 text-body text-fg-muted">
        {t('library.instruments.agent.needsAccess')}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-body text-fg-muted">
        {t('library.instruments.agent.explain')}
      </p>
      <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
        <Field label={t('library.instruments.agent.system')}>
          <Select
            value={system}
            onChange={(event) => {
              setSystem(event.target.value as AgentSystem)
              setDownloaded(null)
            }}
          >
            {AGENT_SYSTEMS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {t(`library.instruments.agent.systems.${entry.value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('library.instruments.agent.folder')}
          hint={t('library.instruments.agent.folderHint')}
        >
          <Input
            value={folder}
            placeholder={example}
            onChange={(event) => {
              setFolder(event.target.value)
              setDownloaded(null)
            }}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={run.isPending}
          onClick={() => run.mutate()}
        >
          {run.isPending
            ? t('library.instruments.agent.downloading')
            : downloaded
              ? t('library.instruments.agent.downloadAgain')
              : t('library.instruments.agent.download')}
        </Button>
        <span className="text-label text-fg-muted">
          {t('library.instruments.agent.replacesOld')}
        </span>
      </div>
      {run.isError ? (
        <Notice tone="bad" title={t('library.instruments.agent.cantDownload')}>
          {run.error instanceof Error ? run.error.message : ''}
        </Notice>
      ) : null}
      {downloaded ? (
        <Notice title={t('library.instruments.agent.downloaded')}>
          <ol className="m-0 flex list-decimal flex-col gap-0.5 pl-5">
            <li>{t('library.instruments.agent.stepUnzip')}</li>
            <li>{t('library.instruments.agent.stepStart')}</li>
            <li>
              {t('library.instruments.agent.stepSave', { folder: downloaded })}
            </li>
          </ol>
        </Notice>
      ) : null}
    </div>
  )
}
