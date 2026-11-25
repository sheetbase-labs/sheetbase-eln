import type { IdleGate } from './idle-gate.mjs'

export function gateStartedIntervals(
  env?: Record<string, string | undefined>,
  onChange?: (idle: boolean) => void,
): IdleGate | undefined
