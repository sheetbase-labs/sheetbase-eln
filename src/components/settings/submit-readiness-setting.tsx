import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { GateModeField } from '#/components/settings/gate-mode-field'
import { Section } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { createDataClient } from '#/lib/data-client'
import { adminQueryKeys, fetchWorkspaceSettings } from '#/lib/workspace-admin'
import type { InstrumentGateMode } from '#/lib/workspace-admin'
import { t } from '#/copy'

const dataClient = createDataClient()

const OPTIONS: Array<{
  value: InstrumentGateMode
  label: string
  hint: string
}> = [
  {
    value: 'block',
    label: t('features.submitReadiness.setting.blockLabel'),
    hint: t('features.submitReadiness.setting.blockHint'),
  },
  {
    value: 'warn',
    label: t('features.submitReadiness.setting.warnLabel'),
    hint: t('features.submitReadiness.setting.warnHint'),
  },
  {
    value: 'off',
    label: t('features.submitReadiness.setting.offLabel'),
    hint: t('features.submitReadiness.setting.offHint'),
  },
]

/**
 * Whether protocol steps nobody finished and a missing decision stop an
 * experiment being submitted. The database reads the same setting, so the
 * list on the experiment and the block cannot disagree.
 */
export function SubmitReadinessSetting({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()

  const settings = useQuery({
    queryKey: adminQueryKeys.settings(workspaceId),
    queryFn: () => fetchWorkspaceSettings(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })

  const stored = settings.data?.submitReadinessMode ?? 'warn'
  const [mode, setMode] = useState<InstrumentGateMode>(stored)
  useEffect(() => setMode(stored), [stored])

  const save = useMutation({
    mutationFn: (next: InstrumentGateMode) =>
      dataClient.rpc('set_submit_readiness_mode', {
        p_workspace_id: workspaceId,
        p_mode: next,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: adminQueryKeys.settings(workspaceId),
      })
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'experiment-readiness'],
      })
      toast(t('features.submitReadiness.setting.savedToast'))
    },
    onError: (error) => {
      setMode(stored)
      toast(t('features.submitReadiness.setting.failedToast'), {
        description: error instanceof Error ? error.message : undefined,
      })
    },
  })

  return (
    <Section title={t('features.submitReadiness.setting.title')}>
      <p className="m-0 max-w-2xl text-body text-fg-muted">
        {t('features.submitReadiness.setting.body')}
      </p>
      <GateModeField
        label={t('features.submitReadiness.setting.label')}
        options={OPTIONS}
        mode={mode}
        disabled={!canManage || save.isPending}
        onPick={(next) => {
          setMode(next)
          save.mutate(next)
        }}
      />
    </Section>
  )
}
