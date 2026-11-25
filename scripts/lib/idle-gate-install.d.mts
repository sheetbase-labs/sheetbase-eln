import type { IdleGate } from './idle-gate.mjs'

export function gateStartedIntervals(
  env?: Record<string, string | undefined>,
): IdleGate | undefined
