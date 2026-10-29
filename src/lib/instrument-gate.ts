import { useQuery } from '@tanstack/react-query'

import { createDataClient } from './data-client'
import { adminQueryKeys, fetchWorkspaceSettings } from './workspace-admin'
import type { InstrumentGateMode } from './workspace-admin'

const dataClient = createDataClient()

export const INSTRUMENT_GATE_MODES: readonly InstrumentGateMode[] = [
  'off',
  'warn',
  'block',
]

/** The workspace's rule for instruments that are not fit to take data. */
export function useInstrumentGateMode(
  workspaceId: string | undefined,
): InstrumentGateMode {
  const settings = useQuery({
    queryKey: adminQueryKeys.settings(workspaceId ?? ''),
    queryFn: () => fetchWorkspaceSettings(dataClient, workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  })
  return settings.data?.instrumentGateMode ?? 'warn'
}

export async function setInstrumentGateMode(
  workspaceId: string,
  mode: InstrumentGateMode,
): Promise<void> {
  await dataClient.rpc('set_instrument_gate_mode', {
    p_workspace_id: workspaceId,
    p_mode: mode,
  })
}

/** What the database found wrong with an instrument when data arrived. */
export type InstrumentFinding =
  'retired' | 'unqualified' | 'calibration_overdue'

/** The findings an import or run was flagged with, from its stored outcome. */
export function instrumentWarningsOf(outcome: unknown): InstrumentFinding[] {
  if (!outcome || typeof outcome !== 'object') return []
  const found = (outcome as { instrumentWarnings?: unknown }).instrumentWarnings
  if (!Array.isArray(found)) return []
  return found.filter(
    (f): f is InstrumentFinding =>
      f === 'retired' || f === 'unqualified' || f === 'calibration_overdue',
  )
}
