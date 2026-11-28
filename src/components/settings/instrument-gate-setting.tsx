import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { GateModeField } from '#/components/settings/gate-mode-field'
import { Section } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import {
  setInstrumentGateMode,
  useInstrumentGateMode,
} from '#/lib/instrument-gate'
import { adminQueryKeys } from '#/lib/workspace-admin'
import type { InstrumentGateMode } from '#/lib/workspace-admin'
import { t } from '#/copy'

const OPTIONS: Array<{
  value: InstrumentGateMode
  label: string
  hint: string
}> = [
  {
    value: 'off',
    label: t('settings.instruments.gateOffLabel'),
    hint: t('settings.instruments.gateOffHint'),
  },
  {
    value: 'warn',
    label: t('settings.instruments.gateWarnLabel'),
    hint: t('settings.instruments.gateWarnHint'),
  },
  {
    value: 'block',
    label: t('settings.instruments.gateBlockLabel'),
    hint: t('settings.instruments.gateBlockHint'),
  },
]

/**
 * What happens when an instrument that is overdue for calibration, retired, or
 * not qualified for the person at the keyboard takes new data. Booking always
 * refuses these; this decides whether runs and imports do too.
 */
export function InstrumentGateSetting({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const stored = useInstrumentGateMode(workspaceId)
  const [mode, setMode] = useState<InstrumentGateMode>(stored)
  useEffect(() => setMode(stored), [stored])

  const save = useMutation({
    mutationFn: (next: InstrumentGateMode) =>
      setInstrumentGateMode(workspaceId, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: adminQueryKeys.settings(workspaceId),
      })
      toast(t('settings.instruments.gateSavedToast'))
    },
    onError: (error) => {
      setMode(stored)
      toast(t('settings.instruments.gateFailedToast'), {
        description: error instanceof Error ? error.message : undefined,
      })
    },
  })

  return (
    <Section
      title={t('settings.instruments.gateTitle')}
      description={t('settings.instruments.gateBody')}
    >
      <GateModeField
        label={t('settings.instruments.gateLabel')}
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
